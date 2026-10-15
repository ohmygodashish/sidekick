//! Speech-to-Text (STT) Turn Dispatcher (REQ-009, REQ-010, AC-005, NFR-3)
//!
//! Routes audio speech turns from:
//! - Channel 0 (Interviewer): System audio from ScreenCaptureKit
//! - Channel 1 (Candidate): Local voice audio from Microphone
//!
//! To the active STT engine:
//! - `whisper_local`: On-device Metal-accelerated Whisper (100% offline, AC-005)
//! - `groq`: Cloud Groq Whisper-large-v3 (<250ms latency)
//! - `deepgram`: Cloud Deepgram Nova-2 streaming
//!
//! Emits transcribed turns to frontend via Tauri event `sidekick://stt_chunk`:
//! ```json
//! {
//!   "id": "turn_1729000000",
//!   "speaker": "interviewer" | "candidate",
//!   "text": "...",
//!   "timestamp": 1729000000000,
//!   "is_final": true
//! }
//! ```
//!
//! Decoupled from real-time audio threads via bounded non-blocking queues (`AsyncSttWorker`).

use std::path::PathBuf;
use std::str::FromStr;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{sync_channel, SyncSender, TrySendError};
use std::sync::{Arc, RwLock};
use std::thread::{self, JoinHandle};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Runtime};

use super::mixer::{AudioChunk, Channel};
use super::whisper::{LocalWhisperEngine, WhisperConfig, WhisperEngine};

/// Tauri event name emitted when a transcribed speech chunk is completed
pub const EVENT_STT_CHUNK: &str = "sidekick://stt_chunk";

/// Tauri event name emitted when the active STT engine configuration changes
pub const EVENT_STT_ENGINE_CHANGED: &str = "sidekick://stt_engine_changed";

/// Supported speech-to-text inference engines (REQ-009, REQ-010)
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SttEngineType {
    /// Local on-device Whisper inference (Metal-accelerated, 100% offline, AC-005)
    WhisperLocal,
    /// Groq Whisper-large-v3 cloud inference
    Groq,
    /// Deepgram Nova-2 cloud inference
    Deepgram,
}

impl SttEngineType {
    /// Canonical string identifier
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::WhisperLocal => "whisper_local",
            Self::Groq => "groq",
            Self::Deepgram => "deepgram",
        }
    }

    /// Human-friendly display label
    pub fn display_label(&self) -> &'static str {
        match self {
            Self::WhisperLocal => "Embedded Whisper (Local Metal)",
            Self::Groq => "Groq Whisper-large-v3 Cloud",
            Self::Deepgram => "Deepgram Nova-2 Cloud",
        }
    }
}

impl FromStr for SttEngineType {
    type Err = String;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s.trim().to_lowercase().as_str() {
            "whisper_local" | "whisper" | "local" | "whisper-local" => Ok(Self::WhisperLocal),
            "groq" | "groq_whisper" | "groq-whisper" => Ok(Self::Groq),
            "deepgram" | "deepgram_nova" | "deepgram-nova" => Ok(Self::Deepgram),
            other => Err(format!(
                "Invalid STT engine '{other}'. Supported engines: 'whisper_local', 'groq', 'deepgram'"
            )),
        }
    }
}

/// Standardized Speech-to-Text transcript chunk delivered to HUD and Session store
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct SttChunk {
    /// Unique identifier for this speech turn, e.g. "turn_1729000000"
    pub id: String,
    /// Speaker role: "interviewer" (Channel 0) or "candidate" (Channel 1)
    pub speaker: String,
    /// Decoded speech text
    pub text: String,
    /// Millisecond UNIX timestamp of turn completion
    pub timestamp: u64,
    /// Whether this chunk represents a finalized speech turn
    pub is_final: bool,
}

/// Maps internal channel enumeration to user-facing speaker label
pub fn channel_to_speaker(channel: Channel) -> &'static str {
    match channel {
        Channel::Interviewer => "interviewer",
        Channel::Candidate => "candidate",
    }
}

/// Generates a canonical turn ID from timestamp
pub fn generate_turn_id(timestamp_ms: u64) -> String {
    format!("turn_{timestamp_ms}")
}

/// Encodes 16kHz mono PCM float32 samples into a standard 16-bit signed PCM WAV buffer in-memory
/// (Used for cloud STT endpoints requiring standard WAV audio input)
pub fn encode_wav_pcm16(samples: &[f32], sample_rate: u32) -> Vec<u8> {
    let num_channels: u16 = 1;
    let bits_per_sample: u16 = 16;
    let bytes_per_sample: u16 = bits_per_sample / 8;
    let block_align: u16 = num_channels * bytes_per_sample;
    let byte_rate: u32 = sample_rate * block_align as u32;
    let data_len: u32 = (samples.len() as u32) * (bytes_per_sample as u32);
    let total_file_size: u32 = 36 + data_len;

    let mut wav = Vec::with_capacity(44 + data_len as usize);

    // RIFF chunk descriptor
    wav.extend_from_slice(b"RIFF");
    wav.extend_from_slice(&total_file_size.to_le_bytes());
    wav.extend_from_slice(b"WAVE");

    // "fmt " sub-chunk
    wav.extend_from_slice(b"fmt ");
    wav.extend_from_slice(&16u32.to_le_bytes()); // Subchunk1Size for PCM
    wav.extend_from_slice(&1u16.to_le_bytes());  // AudioFormat 1 = PCM
    wav.extend_from_slice(&num_channels.to_le_bytes());
    wav.extend_from_slice(&sample_rate.to_le_bytes());
    wav.extend_from_slice(&byte_rate.to_le_bytes());
    wav.extend_from_slice(&block_align.to_le_bytes());
    wav.extend_from_slice(&bits_per_sample.to_le_bytes());

    // "data" sub-chunk
    wav.extend_from_slice(b"data");
    wav.extend_from_slice(&data_len.to_le_bytes());

    // PCM 16-bit samples clamped between -32768 and 32767
    for &sample in samples {
        let clamped = sample.max(-1.0).min(1.0);
        let sample_i16 = (clamped * 32767.0).round() as i16;
        wav.extend_from_slice(&sample_i16.to_le_bytes());
    }

    wav
}

/// Central Speech-to-Text Dispatcher
pub struct SttDispatcher {
    active_engine: RwLock<SttEngineType>,
    local_whisper: Arc<LocalWhisperEngine>,
}

impl Default for SttDispatcher {
    fn default() -> Self {
        Self {
            active_engine: RwLock::new(SttEngineType::WhisperLocal),
            local_whisper: Arc::new(LocalWhisperEngine::new(WhisperConfig::default())),
        }
    }
}

impl SttDispatcher {
    /// Creates a new dispatcher with a specific engine and local whisper configuration
    pub fn new(engine: SttEngineType, whisper_config: WhisperConfig) -> Self {
        Self {
            active_engine: RwLock::new(engine),
            local_whisper: Arc::new(LocalWhisperEngine::new(whisper_config)),
        }
    }

    /// Creates a mock dispatcher for unit testing
    pub fn new_mock(canned_text: Option<&str>) -> Self {
        Self {
            active_engine: RwLock::new(SttEngineType::WhisperLocal),
            local_whisper: Arc::new(LocalWhisperEngine::new_mock(canned_text)),
        }
    }

    /// Retrieves the current active STT engine
    pub fn get_engine(&self) -> SttEngineType {
        self.active_engine
            .read()
            .map(|g| *g)
            .unwrap_or(SttEngineType::WhisperLocal)
    }

    /// Updates the active STT engine and returns the canonical engine name
    pub fn set_engine(&self, engine_str: &str) -> Result<String, String> {
        let engine = SttEngineType::from_str(engine_str)?;
        if let Ok(mut guard) = self.active_engine.write() {
            *guard = engine;
        }
        Ok(engine.as_str().to_string())
    }

    /// Returns a reference to the embedded local Whisper engine
    pub fn local_whisper(&self) -> &Arc<LocalWhisperEngine> {
        &self.local_whisper
    }

    /// Reloads model weights into the local Whisper engine
    pub fn reload_whisper_model(&self, model_name: &str) -> Result<PathBuf, String> {
        self.local_whisper.load_model(model_name)
    }

    /// Transcribes an audio chunk using the active STT engine and returns the SttChunk payload.
    /// In offline mode or when cloud credentials are unconfigured, automatically falls back
    /// to local whisper to guarantee zero dropped candidate/interviewer speech turns (AC-005).
    pub fn transcribe_chunk(&self, chunk: &AudioChunk) -> Result<SttChunk, String> {
        let engine = self.get_engine();
        let speaker = channel_to_speaker(chunk.channel).to_string();
        let turn_id = generate_turn_id(chunk.timestamp_ms);

        let text = match engine {
            SttEngineType::WhisperLocal => {
                let res = self.local_whisper.transcribe(&chunk.samples, chunk.sample_rate)?;
                res.text
            }
            SttEngineType::Groq => {
                // Cloud Groq Whisper: Attempt cloud inference, fallback cleanly to local whisper
                // if running offline, in test environments, or if API key is not configured.
                match self.transcribe_groq_or_fallback(chunk) {
                    Ok(text) => text,
                    Err(e) => {
                        eprintln!("[Sidekick STT] Groq transcription failed ({e}), falling back to local Whisper");
                        self.local_whisper.transcribe(&chunk.samples, chunk.sample_rate)?.text
                    }
                }
            }
            SttEngineType::Deepgram => {
                // Cloud Deepgram Nova-2: Attempt cloud inference, fallback cleanly to local whisper
                match self.transcribe_deepgram_or_fallback(chunk) {
                    Ok(text) => text,
                    Err(e) => {
                        eprintln!("[Sidekick STT] Deepgram transcription failed ({e}), falling back to local Whisper");
                        self.local_whisper.transcribe(&chunk.samples, chunk.sample_rate)?.text
                    }
                }
            }
        };

        Ok(SttChunk {
            id: turn_id,
            speaker,
            text,
            timestamp: chunk.timestamp_ms,
            is_final: true,
        })
    }

    /// Dispatches an audio chunk and emits `sidekick://stt_chunk` to frontend.
    /// Skips non-speech or silent turns.
    pub fn dispatch_chunk<R: Runtime>(&self, chunk: &AudioChunk, app: &AppHandle<R>) {
        if !chunk.is_speech || chunk.samples.is_empty() {
            return;
        }

        match self.transcribe_chunk(chunk) {
            Ok(stt_chunk) => {
                if !stt_chunk.text.trim().is_empty() {
                    let _ = app.emit(EVENT_STT_CHUNK, &stt_chunk);
                }
            }
            Err(e) => {
                eprintln!("[Sidekick STT] Chunk transcription error: {e}");
            }
        }
    }

    /// Groq Whisper cloud transcription dispatcher with offline fallback
    fn transcribe_groq_or_fallback(&self, chunk: &AudioChunk) -> Result<String, String> {
        // Attempt Groq API if key is present in Keychain
        if let Ok(key) = crate::storage::keychain::retrieve_credential("groq") {
            let key = key.trim();
            if !key.is_empty() {
                match call_groq_whisper_api(key, &chunk.samples, chunk.sample_rate) {
                    Ok(text) => return Ok(text),
                    Err(e) => {
                        eprintln!("[Sidekick STT] Groq cloud transcription warning: {e}. Falling back to local Whisper.");
                    }
                }
            }
        }

        // Fallback for offline or test environments
        self.local_whisper
            .transcribe(&chunk.samples, chunk.sample_rate)
            .map(|r| r.text)
    }

    /// Deepgram Nova-2 cloud transcription dispatcher with offline fallback
    fn transcribe_deepgram_or_fallback(&self, chunk: &AudioChunk) -> Result<String, String> {
        // Attempt Deepgram API if token is present in Keychain
        if let Ok(key) = crate::storage::keychain::retrieve_credential("deepgram") {
            let key = key.trim();
            if !key.is_empty() {
                match call_deepgram_api(key, &chunk.samples, chunk.sample_rate) {
                    Ok(text) => return Ok(text),
                    Err(e) => {
                        eprintln!("[Sidekick STT] Deepgram cloud transcription warning: {e}. Falling back to local Whisper.");
                    }
                }
            }
        }

        // Fallback for offline or test environments
        self.local_whisper
            .transcribe(&chunk.samples, chunk.sample_rate)
            .map(|r| r.text)
    }
}

/// Helper to call Groq Whisper API for low-latency cloud transcription
fn call_groq_whisper_api(api_key: &str, samples: &[f32], sample_rate: u32) -> Result<String, String> {
    let wav_bytes = encode_wav_pcm16(samples, sample_rate);
    let part = reqwest::multipart::Part::bytes(wav_bytes)
        .file_name("speech.wav")
        .mime_str("audio/wav")
        .map_err(|e| format!("Failed to create multipart audio part: {e}"))?;

    let form = reqwest::multipart::Form::new()
        .part("file", part)
        .text("model", "whisper-large-v3-turbo")
        .text("response_format", "json");

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| format!("Failed to create reqwest client: {e}"))?;

    let response = tauri::async_runtime::block_on(async {
        client
            .post("https://api.groq.com/openai/v1/audio/transcriptions")
            .header("Authorization", format!("Bearer {api_key}"))
            .multipart(form)
            .send()
            .await
    }).map_err(|e| format!("Groq HTTP error: {e}"))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = tauri::async_runtime::block_on(async { response.text().await })
            .unwrap_or_default();
        return Err(format!("Groq API error ({status}): {body}"));
    }

    #[derive(Deserialize)]
    struct GroqResponse {
        text: String,
    }

    let parsed: GroqResponse = tauri::async_runtime::block_on(async {
        response.json().await
    }).map_err(|e| format!("Failed to parse Groq response JSON: {e}"))?;

    Ok(parsed.text.trim().to_string())
}

/// Helper to call Deepgram Nova-2 API for cloud speech transcription
fn call_deepgram_api(api_key: &str, samples: &[f32], sample_rate: u32) -> Result<String, String> {
    let wav_bytes = encode_wav_pcm16(samples, sample_rate);
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| format!("Failed to create reqwest client: {e}"))?;

    let response = tauri::async_runtime::block_on(async {
        client
            .post("https://api.deepgram.com/v1/listen?model=nova-2&smart_format=true")
            .header("Authorization", format!("Token {api_key}"))
            .header("Content-Type", "audio/wav")
            .body(wav_bytes)
            .send()
            .await
    }).map_err(|e| format!("Deepgram HTTP error: {e}"))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = tauri::async_runtime::block_on(async { response.text().await })
            .unwrap_or_default();
        return Err(format!("Deepgram API error ({status}): {body}"));
    }

    #[derive(Deserialize)]
    struct DeepgramAlternative {
        transcript: String,
    }
    #[derive(Deserialize)]
    struct DeepgramChannel {
        alternatives: Vec<DeepgramAlternative>,
    }
    #[derive(Deserialize)]
    struct DeepgramResults {
        channels: Vec<DeepgramChannel>,
    }
    #[derive(Deserialize)]
    struct DeepgramResponse {
        results: DeepgramResults,
    }

    let parsed: DeepgramResponse = tauri::async_runtime::block_on(async {
        response.json().await
    }).map_err(|e| format!("Failed to parse Deepgram response: {e}"))?;

    let transcript = parsed
        .results
        .channels
        .first()
        .and_then(|ch| ch.alternatives.first())
        .map(|alt| alt.transcript.trim().to_string())
        .unwrap_or_default();

    Ok(transcript)
}

/// Item passed through the asynchronous STT worker queue
pub struct SttQueueItem {
    pub chunk: AudioChunk,
    pub emit_fn: Box<dyn FnOnce(&SttChunk) + Send>,
}

/// Background worker running STT inference asynchronously to ensure
/// zero blocking on real-time ScreenCaptureKit and CoreAudio capture threads (Review Round 1 Fix)
pub struct AsyncSttWorker {
    sender: SyncSender<SttQueueItem>,
    is_panicked: Arc<AtomicBool>,
    _worker_thread: Option<JoinHandle<()>>,
}

impl AsyncSttWorker {
    pub fn new(dispatcher: Arc<SttDispatcher>, is_panicked: Arc<AtomicBool>) -> Self {
        let (sender, receiver) = sync_channel::<SttQueueItem>(32);
        let panicked_clone = is_panicked.clone();

        let handle = thread::Builder::new()
            .name("sidekick-stt-worker".to_string())
            .spawn(move || {
                while let Ok(item) = receiver.recv() {
                    if panicked_clone.load(Ordering::SeqCst) {
                        // Immediately drain without executing during panic purge
                        continue;
                    }
                    if let Ok(stt_chunk) = dispatcher.transcribe_chunk(&item.chunk) {
                        if !stt_chunk.text.trim().is_empty() && !panicked_clone.load(Ordering::SeqCst) {
                            (item.emit_fn)(&stt_chunk);
                        }
                    }
                }
            })
            .ok();

        Self {
            sender,
            is_panicked,
            _worker_thread: handle,
        }
    }

    /// Non-blocking enqueue from audio callback threads. Returns immediately (< 0.01ms).
    pub fn try_enqueue<F>(&self, chunk: AudioChunk, emit_fn: F) -> bool
    where
        F: FnOnce(&SttChunk) + Send + 'static,
    {
        if self.is_panicked.load(Ordering::SeqCst) {
            return false;
        }

        match self.sender.try_send(SttQueueItem {
            chunk,
            emit_fn: Box::new(emit_fn),
        }) {
            Ok(()) => true,
            Err(TrySendError::Full(_)) => {
                eprintln!("[Sidekick STT] Worker queue full (32 turns buffered); dropping turn to maintain real-time audio capture");
                false
            }
            Err(TrySendError::Disconnected(_)) => false,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_stt_engine_type_parsing() {
        assert_eq!(
            SttEngineType::from_str("whisper_local").unwrap(),
            SttEngineType::WhisperLocal
        );
        assert_eq!(
            SttEngineType::from_str("groq").unwrap(),
            SttEngineType::Groq
        );
        assert_eq!(
            SttEngineType::from_str("deepgram").unwrap(),
            SttEngineType::Deepgram
        );
        assert_eq!(
            SttEngineType::from_str("local").unwrap(),
            SttEngineType::WhisperLocal
        );
        assert!(SttEngineType::from_str("invalid_engine").is_err());
    }

    #[test]
    fn test_channel_to_speaker_mapping() {
        assert_eq!(channel_to_speaker(Channel::Interviewer), "interviewer");
        assert_eq!(channel_to_speaker(Channel::Candidate), "candidate");
    }

    #[test]
    fn test_generate_turn_id() {
        assert_eq!(generate_turn_id(1729000000000), "turn_1729000000000");
    }

    #[test]
    fn test_encode_wav_pcm16_structure() {
        let samples = vec![0.0f32, 0.5f32, -0.5f32, 1.0f32];
        let wav = encode_wav_pcm16(&samples, 16000);

        // Header must be exactly 44 bytes + 4 samples * 2 bytes = 52 bytes
        assert_eq!(wav.len(), 44 + 8);
        assert_eq!(&wav[0..4], b"RIFF");
        assert_eq!(&wav[8..12], b"WAVE");
        assert_eq!(&wav[12..16], b"fmt ");
        assert_eq!(&wav[36..40], b"data");

        // Verify sample rate 16000 is encoded at byte 24
        let sample_rate = u32::from_le_bytes([wav[24], wav[25], wav[26], wav[27]]);
        assert_eq!(sample_rate, 16000);

        // Verify data length is 8 bytes
        let data_len = u32::from_le_bytes([wav[40], wav[41], wav[42], wav[43]]);
        assert_eq!(data_len, 8);
    }

    #[test]
    fn test_stt_dispatcher_routing_interviewer() {
        let dispatcher = SttDispatcher::new_mock(Some("Can you explain how consistent hashing works?"));
        let chunk = AudioChunk {
            channel: Channel::Interviewer,
            samples: vec![0.1f32; 16000],
            sample_rate: 16000,
            timestamp_ms: 1729000000000,
            duration_secs: 1.0,
            rms_energy: 0.1,
            is_speech: true,
        };

        let result = dispatcher.transcribe_chunk(&chunk).expect("transcription succeeded");
        assert_eq!(result.id, "turn_1729000000000");
        assert_eq!(result.speaker, "interviewer");
        assert_eq!(result.text, "Can you explain how consistent hashing works?");
        assert!(result.is_final);
    }

    #[test]
    fn test_stt_dispatcher_routing_candidate() {
        let dispatcher = SttDispatcher::new_mock(Some("Sure, consistent hashing minimizes key remapping."));
        let chunk = AudioChunk {
            channel: Channel::Candidate,
            samples: vec![0.1f32; 16000],
            sample_rate: 16000,
            timestamp_ms: 1729000050000,
            duration_secs: 1.0,
            rms_energy: 0.1,
            is_speech: true,
        };

        let result = dispatcher.transcribe_chunk(&chunk).expect("transcription succeeded");
        assert_eq!(result.id, "turn_1729000050000");
        assert_eq!(result.speaker, "candidate");
        assert_eq!(result.text, "Sure, consistent hashing minimizes key remapping.");
        assert!(result.is_final);
    }

    #[test]
    fn test_stt_engine_switching() {
        let dispatcher = SttDispatcher::default();
        assert_eq!(dispatcher.get_engine(), SttEngineType::WhisperLocal);

        let active = dispatcher.set_engine("groq").unwrap();
        assert_eq!(active, "groq");
        assert_eq!(dispatcher.get_engine(), SttEngineType::Groq);

        let active2 = dispatcher.set_engine("deepgram").unwrap();
        assert_eq!(active2, "deepgram");
        assert_eq!(dispatcher.get_engine(), SttEngineType::Deepgram);

        let active3 = dispatcher.set_engine("whisper_local").unwrap();
        assert_eq!(active3, "whisper_local");
        assert_eq!(dispatcher.get_engine(), SttEngineType::WhisperLocal);
    }

    #[test]
    fn test_stt_chunk_serialization_contract() {
        let chunk = SttChunk {
            id: "turn_1729000000".to_string(),
            speaker: "interviewer".to_string(),
            text: "Hello world".to_string(),
            timestamp: 1729000000000,
            is_final: true,
        };

        let json = serde_json::to_string(&chunk).unwrap();
        assert!(json.contains("\"id\":\"turn_1729000000\""));
        assert!(json.contains("\"speaker\":\"interviewer\""));
        assert!(json.contains("\"text\":\"Hello world\""));
        assert!(json.contains("\"timestamp\":1729000000000"));
        assert!(json.contains("\"is_final\":true"));
    }

    #[test]
    fn test_async_stt_worker_enqueue_and_drain() {
        let dispatcher = Arc::new(SttDispatcher::new_mock(Some("Async processing test")));
        let is_panicked = Arc::new(AtomicBool::new(false));
        let worker = AsyncSttWorker::new(dispatcher, is_panicked.clone());

        let chunk = AudioChunk {
            channel: Channel::Interviewer,
            samples: vec![0.1f32; 16000],
            sample_rate: 16000,
            timestamp_ms: 1729000000000,
            duration_secs: 1.0,
            rms_energy: 0.1,
            is_speech: true,
        };

        let (done_tx, done_rx) = std::sync::mpsc::channel();
        let enqueued = worker.try_enqueue(chunk, move |stt_chunk| {
            let _ = done_tx.send(stt_chunk.clone());
        });
        assert!(enqueued, "Chunk should be successfully enqueued to worker");

        let received = done_rx
            .recv_timeout(std::time::Duration::from_millis(500))
            .expect("Worker processed turn");
        assert_eq!(received.text, "Async processing test");

        // When panicked, enqueue is rejected immediately
        is_panicked.store(true, Ordering::SeqCst);
        let chunk2 = AudioChunk {
            channel: Channel::Candidate,
            samples: vec![0.1f32; 16000],
            sample_rate: 16000,
            timestamp_ms: 1729000001000,
            duration_secs: 1.0,
            rms_energy: 0.1,
            is_speech: true,
        };
        let rejected = worker.try_enqueue(chunk2, |_| {});
        assert!(!rejected, "Must reject turns immediately during panic");
    }
}
