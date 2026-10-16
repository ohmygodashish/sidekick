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
//! A turn with no transcript (no model, bad key, failed request) is reported on `sidekick://stt_error`
//! instead. Text is never invented.
//!
//! Decoupled from real-time audio threads via bounded non-blocking queues (`AsyncSttWorker`).

use std::collections::HashMap;
use std::path::PathBuf;
use std::str::FromStr;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{sync_channel, SyncSender, TrySendError};
use std::sync::{Arc, OnceLock, RwLock};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Runtime};

use super::mixer::{AudioChunk, Channel};
use super::whisper::{LocalWhisperEngine, WhisperConfig, WhisperEngine};

/// Tauri event name emitted when a transcribed speech chunk is completed
pub const EVENT_STT_CHUNK: &str = "sidekick://stt_chunk";

/// Tauri event name emitted when the active STT engine configuration changes
pub const EVENT_STT_ENGINE_CHANGED: &str = "sidekick://stt_engine_changed";

/// Tauri event name emitted when a turn produced no transcript, or needed the local fallback
pub const EVENT_STT_ERROR: &str = "sidekick://stt_error";

/// A repeated error message is emitted at most once per this window
const STT_ERROR_THROTTLE: Duration = Duration::from_secs(10);

const NO_MODEL_MESSAGE: &str =
    "No speech model installed. Download one in Settings → Audio, or switch to Groq.";

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

/// A turn that produced no transcript, or only after the local model took over (`sidekick://stt_error`)
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct SttFailure {
    pub engine: SttEngineType,
    pub message: String,
    pub recovered: bool,
    pub timestamp: u64,
}

impl SttFailure {
    fn new(engine: SttEngineType, message: String, recovered: bool) -> Self {
        let timestamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0);
        Self { engine, message, recovered, timestamp }
    }
}

/// What one turn produced: a transcript, a failure to report, or both when the local model recovered it
#[derive(Debug, Clone, PartialEq, Default)]
pub struct SttOutcome {
    pub chunk: Option<SttChunk>,
    pub failure: Option<SttFailure>,
}

/// Lets an error message through at most once per `STT_ERROR_THROTTLE`
#[derive(Default)]
pub struct SttErrorThrottle {
    last_sent: HashMap<String, Instant>,
}

impl SttErrorThrottle {
    /// Returns true when `message` should be emitted at `now`
    pub fn allow(&mut self, message: &str, now: Instant) -> bool {
        if let Some(last) = self.last_sent.get(message) {
            if now.duration_since(*last) < STT_ERROR_THROTTLE {
                return false;
            }
        }
        self.last_sent.insert(message.to_string(), now);
        true
    }
}

/// Why a cloud request failed, reduced to what the user can act on
#[derive(Debug, Clone, PartialEq)]
enum CloudError {
    MissingKey,
    Rejected,
    Failed(String),
}

/// User-facing text for a failed cloud turn; the local-model note only follows a generic failure
fn cloud_failure_message(engine: SttEngineType, err: &CloudError, recovered: bool) -> String {
    let name = match engine {
        SttEngineType::Groq => "Groq",
        SttEngineType::Deepgram => "Deepgram",
        SttEngineType::WhisperLocal => "Local Whisper",
    };
    match err {
        CloudError::MissingKey => format!("Add your {name} API key in Settings → Keys to transcribe."),
        CloudError::Rejected => format!("{name} rejected the API key."),
        CloudError::Failed(reason) => {
            let note = if recovered { " Used the local model instead." } else { "" };
            format!("{name} transcription failed ({reason}).{note}")
        }
    }
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

/// Sends a turn's transcript and failure to the frontend
pub fn emit_outcome<R: Runtime>(app: &AppHandle<R>, outcome: &SttOutcome) {
    if let Some(chunk) = &outcome.chunk {
        let _ = app.emit(EVENT_STT_CHUNK, chunk);
    }
    if let Some(failure) = &outcome.failure {
        let _ = app.emit(EVENT_STT_ERROR, failure);
    }
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

/// Transcription languages the settings UI offers: "auto" (detect) or an ISO-639-1 code
pub const STT_LANGUAGES: [&str; 11] = ["auto", "en", "hi", "es", "fr", "de", "pt", "ja", "zh", "ko", "ar"];

/// Checks a language chosen in settings against `STT_LANGUAGES`
pub fn validate_stt_language(language: &str) -> Result<String, String> {
    if STT_LANGUAGES.contains(&language) {
        Ok(language.to_string())
    } else {
        Err(format!(
            "Unsupported transcription language '{language}'. Use auto or one of: {}",
            STT_LANGUAGES[1..].join(", ")
        ))
    }
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

    /// Sets the spoken language for every engine, validated against `STT_LANGUAGES`
    pub fn set_language(&self, language: &str) -> Result<(), String> {
        let language = validate_stt_language(language)?;
        self.local_whisper.set_language(&language);
        Ok(())
    }

    /// Reloads model weights into the local Whisper engine
    pub fn reload_whisper_model(&self, model_name: &str) -> Result<PathBuf, String> {
        self.local_whisper.load_model(model_name)
    }

    /// Transcribes one turn with the active engine. A turn yields a transcript, a failure, or neither
    /// (silence); it never yields text that no engine produced.
    pub fn transcribe_chunk(&self, chunk: &AudioChunk) -> SttOutcome {
        let engine = self.get_engine();
        let (text, failure) = match engine {
            SttEngineType::WhisperLocal => match self.local_whisper.transcribe(&chunk.samples, chunk.sample_rate) {
                Ok(res) => (res.text, None),
                Err(e) => {
                    let message = if self.local_whisper.has_model() {
                        format!("Local transcription failed ({e}).")
                    } else {
                        NO_MODEL_MESSAGE.to_string()
                    };
                    (String::new(), Some(SttFailure::new(engine, message, false)))
                }
            },
            cloud => self.transcribe_cloud(cloud, chunk),
        };

        if let Some(failure) = &failure {
            eprintln!("[Sidekick STT] {}", failure.message);
        }

        let stt_chunk = (!text.trim().is_empty()).then(|| SttChunk {
            id: generate_turn_id(chunk.timestamp_ms),
            speaker: channel_to_speaker(chunk.channel).to_string(),
            text,
            timestamp: chunk.timestamp_ms,
            is_final: true,
        });
        SttOutcome { chunk: stt_chunk, failure }
    }

    /// Cloud transcription with a local fallback. A turn counts as recovered only when a real model ran.
    fn transcribe_cloud(&self, engine: SttEngineType, chunk: &AudioChunk) -> (String, Option<SttFailure>) {
        let language = self.local_whisper.language();
        let result = match cloud_api_key(engine) {
            None => Err(CloudError::MissingKey),
            Some(key) if engine == SttEngineType::Groq => {
                call_groq_whisper_api(&key, &chunk.samples, chunk.sample_rate, &language)
            }
            Some(key) => call_deepgram_api(&key, &chunk.samples, chunk.sample_rate, &language),
        };
        let err = match result {
            Ok(text) => return (text, None),
            Err(err) => err,
        };

        let local = if self.local_whisper.has_model() {
            self.local_whisper.transcribe(&chunk.samples, chunk.sample_rate).ok()
        } else {
            None
        };
        let recovered = local.is_some();
        let message = cloud_failure_message(engine, &err, recovered);
        let failure = SttFailure::new(engine, message, recovered);
        (local.map(|res| res.text).unwrap_or_default(), Some(failure))
    }
}

/// Saved key for a cloud engine, if one is set
fn cloud_api_key(engine: SttEngineType) -> Option<String> {
    let provider = match engine {
        SttEngineType::Groq => "groq",
        SttEngineType::Deepgram => "deepgram",
        SttEngineType::WhisperLocal => return None,
    };
    crate::storage::config::retrieve_api_key(provider)
        .ok()
        .map(|key| key.trim().to_string())
        .filter(|key| !key.is_empty())
}

/// One shared client: Groq's Cloudflare returns 403 to some default user agents
fn cloud_client() -> Result<&'static reqwest::Client, CloudError> {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    if let Some(client) = CLIENT.get() {
        return Ok(client);
    }
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(10))
        .user_agent(concat!("Sidekick/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|_| CloudError::Failed("HTTP client setup".to_string()))?;
    Ok(CLIENT.get_or_init(|| client))
}

fn http_failure(err: reqwest::Error) -> CloudError {
    let reason = if err.is_timeout() { "timed out" } else { "network error" };
    CloudError::Failed(reason.to_string())
}

fn status_failure(status: reqwest::StatusCode) -> CloudError {
    match status.as_u16() {
        401 | 403 => CloudError::Rejected,
        code => CloudError::Failed(format!("HTTP {code}")),
    }
}

/// Groq's optional `language` field: omitted for "auto" so Groq detects the language
fn groq_language_field(language: &str) -> Option<&str> {
    (language != "auto").then_some(language)
}

/// Deepgram's listen URL: a `language` code, or language detection for "auto"
fn deepgram_listen_url(language: &str) -> String {
    const BASE: &str = "https://api.deepgram.com/v1/listen?model=nova-2&smart_format=true";
    if language == "auto" {
        format!("{BASE}&detect_language=true")
    } else {
        format!("{BASE}&language={language}")
    }
}

/// Helper to call Groq Whisper API for low-latency cloud transcription
fn call_groq_whisper_api(api_key: &str, samples: &[f32], sample_rate: u32, language: &str) -> Result<String, CloudError> {
    let wav_bytes = encode_wav_pcm16(samples, sample_rate);
    let part = reqwest::multipart::Part::bytes(wav_bytes)
        .file_name("speech.wav")
        .mime_str("audio/wav")
        .map_err(|_| CloudError::Failed("bad audio part".to_string()))?;

    let mut form = reqwest::multipart::Form::new()
        .part("file", part)
        .text("model", "whisper-large-v3-turbo")
        .text("response_format", "json");
    if let Some(code) = groq_language_field(language) {
        form = form.text("language", code.to_string());
    }

    let client = cloud_client()?;
    let response = tauri::async_runtime::block_on(async {
        client
            .post("https://api.groq.com/openai/v1/audio/transcriptions")
            .header("Authorization", format!("Bearer {api_key}"))
            .multipart(form)
            .send()
            .await
    })
    .map_err(http_failure)?;

    if !response.status().is_success() {
        return Err(status_failure(response.status()));
    }

    #[derive(Deserialize)]
    struct GroqResponse {
        text: String,
    }

    let parsed: GroqResponse = tauri::async_runtime::block_on(async {
        response.json().await
    })
    .map_err(|_| CloudError::Failed("bad response".to_string()))?;

    Ok(parsed.text.trim().to_string())
}

/// Helper to call Deepgram Nova-2 API for cloud speech transcription
fn call_deepgram_api(api_key: &str, samples: &[f32], sample_rate: u32, language: &str) -> Result<String, CloudError> {
    let wav_bytes = encode_wav_pcm16(samples, sample_rate);
    let client = cloud_client()?;

    let response = tauri::async_runtime::block_on(async {
        client
            .post(deepgram_listen_url(language))
            .header("Authorization", format!("Token {api_key}"))
            .header("Content-Type", "audio/wav")
            .body(wav_bytes)
            .send()
            .await
    })
    .map_err(http_failure)?;

    if !response.status().is_success() {
        return Err(status_failure(response.status()));
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
    })
    .map_err(|_| CloudError::Failed("bad response".to_string()))?;

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
    pub emit_fn: Box<dyn FnOnce(SttOutcome) + Send>,
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
                let mut throttle = SttErrorThrottle::default();
                while let Ok(item) = receiver.recv() {
                    if panicked_clone.load(Ordering::SeqCst) {
                        // Immediately drain without executing during panic purge
                        continue;
                    }
                    let mut outcome = dispatcher.transcribe_chunk(&item.chunk);
                    let allowed = outcome
                        .failure
                        .as_ref()
                        .is_none_or(|f| throttle.allow(&f.message, Instant::now()));
                    if !allowed {
                        outcome.failure = None;
                    }
                    let has_output = outcome.chunk.is_some() || outcome.failure.is_some();
                    if has_output && !panicked_clone.load(Ordering::SeqCst) {
                        (item.emit_fn)(outcome);
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
        F: FnOnce(SttOutcome) + Send + 'static,
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

    fn speech_chunk(channel: Channel, timestamp_ms: u64) -> AudioChunk {
        AudioChunk {
            channel,
            samples: vec![0.1f32; 16000],
            sample_rate: 16000,
            timestamp_ms,
            duration_secs: 1.0,
            rms_energy: 0.1,
            is_speech: true,
        }
    }

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
        let chunk = speech_chunk(Channel::Interviewer, 1729000000000);

        let result = dispatcher.transcribe_chunk(&chunk).chunk.expect("turn has text");
        assert_eq!(result.id, "turn_1729000000000");
        assert_eq!(result.speaker, "interviewer");
        assert_eq!(result.text, "Can you explain how consistent hashing works?");
        assert!(result.is_final);
    }

    #[test]
    fn test_stt_dispatcher_routing_candidate() {
        let dispatcher = SttDispatcher::new_mock(Some("Sure, consistent hashing minimizes key remapping."));
        let chunk = speech_chunk(Channel::Candidate, 1729000050000);

        let result = dispatcher.transcribe_chunk(&chunk).chunk.expect("turn has text");
        assert_eq!(result.id, "turn_1729000050000");
        assert_eq!(result.speaker, "candidate");
        assert_eq!(result.text, "Sure, consistent hashing minimizes key remapping.");
        assert!(result.is_final);
    }

    #[test]
    fn test_turn_without_model_yields_error_not_text() {
        // A model path that does not exist forces the no-model path, whatever is installed on this machine
        let config = WhisperConfig {
            model_path: Some(PathBuf::from("/nonexistent/sidekick-test-model.bin")),
            ..WhisperConfig::default()
        };
        let dispatcher = SttDispatcher::new(SttEngineType::WhisperLocal, config);

        let outcome = dispatcher.transcribe_chunk(&speech_chunk(Channel::Candidate, 1729000000000));
        assert_eq!(outcome.chunk, None, "no model must not produce transcript text");
        let failure = outcome.failure.expect("missing model is reported");
        assert_eq!(failure.message, NO_MODEL_MESSAGE);
        assert_eq!(failure.engine, SttEngineType::WhisperLocal);
        assert!(!failure.recovered);
    }

    #[test]
    fn test_cloud_failure_messages() {
        use CloudError::*;
        assert_eq!(
            cloud_failure_message(SttEngineType::Groq, &MissingKey, false),
            "Add your Groq API key in Settings → Keys to transcribe."
        );
        assert_eq!(
            cloud_failure_message(SttEngineType::Deepgram, &MissingKey, false),
            "Add your Deepgram API key in Settings → Keys to transcribe."
        );
        assert_eq!(
            cloud_failure_message(SttEngineType::Groq, &Rejected, true),
            "Groq rejected the API key."
        );
        assert_eq!(
            cloud_failure_message(SttEngineType::Groq, &Failed("HTTP 500".into()), false),
            "Groq transcription failed (HTTP 500)."
        );
        assert_eq!(
            cloud_failure_message(SttEngineType::Groq, &Failed("timed out".into()), true),
            "Groq transcription failed (timed out). Used the local model instead."
        );
    }

    #[test]
    fn test_stt_error_throttle_repeats_once_per_window() {
        let mut throttle = SttErrorThrottle::default();
        let t0 = Instant::now();
        assert!(throttle.allow(NO_MODEL_MESSAGE, t0));
        assert!(!throttle.allow(NO_MODEL_MESSAGE, t0 + Duration::from_secs(9)));
        assert!(throttle.allow("another message", t0 + Duration::from_secs(9)));
        assert!(throttle.allow(NO_MODEL_MESSAGE, t0 + Duration::from_secs(10)));
    }

    #[test]
    fn test_stt_error_payload_contract() {
        let failure = SttFailure::new(SttEngineType::Groq, "Groq rejected the API key.".into(), true);
        let json = serde_json::to_value(&failure).unwrap();
        assert_eq!(json["engine"], "groq");
        assert_eq!(json["message"], "Groq rejected the API key.");
        assert_eq!(json["recovered"], true);
        assert!(json["timestamp"].as_u64().unwrap() > 0);
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
    fn test_stt_language_validation() {
        for code in STT_LANGUAGES {
            assert_eq!(validate_stt_language(code).unwrap(), code);
        }
        assert!(validate_stt_language("xx").is_err());
        assert!(validate_stt_language("").is_err());
        assert!(validate_stt_language("EN").is_err(), "codes are exact, as the settings UI sends them");
    }

    #[test]
    fn test_groq_language_field_omitted_for_auto() {
        assert_eq!(groq_language_field("auto"), None);
        assert_eq!(groq_language_field("hi"), Some("hi"));
        assert_eq!(groq_language_field("en"), Some("en"));
    }

    #[test]
    fn test_deepgram_listen_url_language_suffix() {
        assert_eq!(
            deepgram_listen_url("auto"),
            "https://api.deepgram.com/v1/listen?model=nova-2&smart_format=true&detect_language=true"
        );
        assert_eq!(
            deepgram_listen_url("ja"),
            "https://api.deepgram.com/v1/listen?model=nova-2&smart_format=true&language=ja"
        );
    }

    #[test]
    fn test_set_language_reaches_whisper_and_rejects_unknown() {
        let dispatcher = SttDispatcher::new_mock(None);
        assert_eq!(dispatcher.local_whisper().language(), "en");

        dispatcher.set_language("hi").unwrap();
        assert_eq!(dispatcher.local_whisper().language(), "hi");

        dispatcher.set_language("auto").unwrap();
        assert_eq!(dispatcher.local_whisper().language(), "auto");

        assert!(dispatcher.set_language("klingon").is_err());
        assert_eq!(dispatcher.local_whisper().language(), "auto", "a rejected code changes nothing");
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

        let (done_tx, done_rx) = std::sync::mpsc::channel();
        let enqueued = worker.try_enqueue(speech_chunk(Channel::Interviewer, 1729000000000), move |outcome| {
            let _ = done_tx.send(outcome.chunk.map(|c| c.text));
        });
        assert!(enqueued, "Chunk should be successfully enqueued to worker");

        let received = done_rx
            .recv_timeout(Duration::from_millis(500))
            .expect("Worker processed turn");
        assert_eq!(received.as_deref(), Some("Async processing test"));

        // When panicked, enqueue is rejected immediately
        is_panicked.store(true, Ordering::SeqCst);
        let rejected = worker.try_enqueue(speech_chunk(Channel::Candidate, 1729000001000), |_| {});
        assert!(!rejected, "Must reject turns immediately during panic");
    }
}
