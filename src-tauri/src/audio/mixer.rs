//! Dual-Channel Audio Mixer & Energy-Based Voice Activity Detection (VAD)
//!
//! Implements:
//! - Speaker diarization channels: Channel 0 (Interviewer / SCK) and Channel 1 (Candidate / Mic) (REQ-008).
//! - Linear resampling and downmixing to standard 16kHz mono PCM float32 for STT (Whisper).
//! - RMS energy calculation and VAD with 1.1s turn silence threshold (REQ-007, AC-004).
//! - Ephemeral in-memory ring buffering with zero persistent disk storage (SEC-003).
//! - Immediate buffer flush and purge for panic killswitch (REQ-004).

use std::collections::VecDeque;
use std::sync::Mutex;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use serde::{Deserialize, Serialize};

/// Standard sample rate required by speech-to-text models (Whisper / Metal STT)
pub const TARGET_SAMPLE_RATE: u32 = 16000;

/// Default turn silence threshold in seconds according to AC-004 / REQ-008
pub const DEFAULT_TURN_SILENCE_SECS: f32 = 1.1;

/// Default RMS threshold distinguishing speech from background room noise (~ -36.5 dBFS)
pub const DEFAULT_RMS_THRESHOLD: f32 = 0.015;

/// Speaker diarization channel identifiers (REQ-008)
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Channel {
    /// Channel 0: Interviewer (system/meeting audio via ScreenCaptureKit)
    Interviewer,
    /// Channel 1: Candidate (voice audio via Microphone)
    Candidate,
}

pub type AudioChannel = Channel;

impl Channel {
    /// Numerical channel ID (0 for Interviewer, 1 for Candidate)
    pub fn id(&self) -> u8 {
        match self {
            Self::Interviewer => 0,
            Self::Candidate => 1,
        }
    }

    /// Human-readable channel label
    pub fn label(&self) -> &'static str {
        match self {
            Self::Interviewer => "Interviewer",
            Self::Candidate => "Candidate",
        }
    }
}

/// Diarized speech audio chunk passed to STT dispatcher and frontend HUD
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AudioChunk {
    /// Diarization channel (Interviewer = 0, Candidate = 1)
    pub channel: Channel,
    /// 16kHz mono PCM float32 samples (normalized between -1.0 and 1.0)
    pub samples: Vec<f32>,
    /// Sample rate in Hz (16,000 Hz)
    pub sample_rate: u32,
    /// UNIX timestamp in milliseconds when the chunk was completed
    pub timestamp_ms: u64,
    /// Duration of audio in seconds
    pub duration_secs: f32,
    /// Root-mean-square energy level
    pub rms_energy: f32,
    /// Flag indicating whether voice activity was confirmed
    pub is_speech: bool,
}

/// Configuration parameters for Voice Activity Detection and chunking
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct VadConfig {
    /// RMS energy threshold to trigger speech detection (default: 0.015)
    pub threshold: f32,
    /// Silence duration in seconds required to declare turn completion (default: 1.1s)
    pub silence_threshold_secs: f32,
    /// Minimum cumulative speech duration required to qualify as an authentic turn (default: 0.3s)
    pub min_speech_secs: f32,
    /// Maximum turn duration before emitting intermediate chunk (default: 15.0s)
    pub max_turn_secs: f32,
    /// Pre-roll audio padding in seconds prepended to speech onset (default: 0.15s)
    pub pre_roll_secs: f32,
}

impl Default for VadConfig {
    fn default() -> Self {
        Self {
            threshold: DEFAULT_RMS_THRESHOLD,
            silence_threshold_secs: DEFAULT_TURN_SILENCE_SECS,
            min_speech_secs: 0.3,
            max_turn_secs: 15.0,
            pre_roll_secs: 0.15,
        }
    }
}

/// Computes the Root-Mean-Square (RMS) energy of a slice of audio samples.
pub fn compute_rms(samples: &[f32]) -> f32 {
    if samples.is_empty() {
        return 0.0;
    }
    let sum_sq: f64 = samples.iter().map(|&s| (s as f64) * (s as f64)).sum();
    ((sum_sq / samples.len() as f64).sqrt()) as f32
}

/// Minimum gap between `audio_level` events
pub const AUDIO_LEVEL_INTERVAL: Duration = Duration::from_millis(100);

/// Maps RMS to a 0..1 meter: -50 dBFS reads 0.0 (room noise), -10 dBFS reads 1.0 (loud speech)
pub fn level_from_rms(rms: f32) -> f32 {
    let db = 20.0 * rms.max(1e-10).log10();
    ((db + 50.0) / 40.0).clamp(0.0, 1.0)
}

fn window_level(sum_sq: f64, count: usize) -> f32 {
    if count == 0 {
        return 0.0;
    }
    level_from_rms((sum_sq / count as f64).sqrt() as f32)
}

#[derive(Default)]
struct MeterWindow {
    sum_sq: [f64; 2],
    count: [usize; 2],
    last_emit: Option<Instant>,
}

/// Per-channel RMS over the samples received since the last emit, shared by both capture callbacks
#[derive(Default)]
pub struct AudioLevelMeter {
    window: Mutex<MeterWindow>,
}

impl AudioLevelMeter {
    pub fn reset(&self) {
        if let Ok(mut w) = self.window.lock() {
            *w = MeterWindow::default();
        }
    }

    /// Adds a callback's samples. Returns (interviewer, candidate) levels once `AUDIO_LEVEL_INTERVAL` has passed.
    pub fn record(&self, channel: Channel, samples: &[f32]) -> Option<(f32, f32)> {
        let mut w = self.window.lock().ok()?;
        let i = channel.id() as usize;
        w.sum_sq[i] += (compute_rms(samples) as f64).powi(2) * samples.len() as f64;
        w.count[i] += samples.len();

        let now = Instant::now();
        if w.last_emit.is_some_and(|t| now.duration_since(t) < AUDIO_LEVEL_INTERVAL) {
            return None;
        }
        let levels = (window_level(w.sum_sq[0], w.count[0]), window_level(w.sum_sq[1], w.count[1]));
        *w = MeterWindow { last_emit: Some(now), ..MeterWindow::default() };
        Some(levels)
    }
}

/// Downmixes multi-channel interleaved audio to single-channel (mono) PCM.
pub fn downmix_to_mono(samples: &[f32], channels: u16) -> Vec<f32> {
    if channels <= 1 || samples.is_empty() {
        return samples.to_vec();
    }
    let ch = channels as usize;
    let frames = samples.len() / ch;
    let mut mono = Vec::with_capacity(frames);
    for frame in 0..frames {
        let mut sum = 0.0f32;
        let offset = frame * ch;
        for c in 0..ch {
            sum += samples[offset + c];
        }
        mono.push(sum / channels as f32);
    }
    mono
}

/// Resamples mono audio to the target sample rate using linear interpolation.
pub fn resample_linear(samples: &[f32], src_rate: u32, dst_rate: u32) -> Vec<f32> {
    if samples.is_empty() || src_rate == 0 || dst_rate == 0 {
        return Vec::new();
    }
    if src_rate == dst_rate {
        return samples.to_vec();
    }

    let src_len = samples.len();
    let duration = src_len as f64 / src_rate as f64;
    let dst_len = (duration * dst_rate as f64).round() as usize;
    if dst_len == 0 {
        return Vec::new();
    }

    let mut out = Vec::with_capacity(dst_len);
    let ratio = (src_len - 1) as f64 / (dst_len - 1).max(1) as f64;

    for i in 0..dst_len {
        let src_idx = i as f64 * ratio;
        let idx_low = src_idx.floor() as usize;
        let idx_high = (idx_low + 1).min(src_len - 1);
        let frac = (src_idx - idx_low as f64) as f32;

        let sample = samples[idx_low] * (1.0 - frac) + samples[idx_high] * frac;
        out.push(sample);
    }

    out
}

/// Single-channel Voice Activity Detection state machine
#[derive(Debug)]
pub struct ChannelVad {
    channel: Channel,
    config: VadConfig,
    sample_rate: u32,
    is_speaking: bool,
    turn_start_timestamp_ms: u64,
    accumulated_samples: Vec<f32>,
    speech_samples_count: usize,
    silence_samples_count: usize,
    pre_roll_buffer: VecDeque<f32>,
    max_pre_roll_samples: usize,
}

impl ChannelVad {
    pub fn new(channel: Channel, config: VadConfig, sample_rate: u32) -> Self {
        let max_pre_roll = (config.pre_roll_secs * sample_rate as f32).round() as usize;
        Self {
            channel,
            config,
            sample_rate,
            is_speaking: false,
            turn_start_timestamp_ms: 0,
            accumulated_samples: Vec::with_capacity(sample_rate as usize * 4),
            speech_samples_count: 0,
            silence_samples_count: 0,
            pre_roll_buffer: VecDeque::with_capacity(max_pre_roll + 1024),
            max_pre_roll_samples: max_pre_roll,
        }
    }

    /// Ingests resampled 16kHz mono samples and evaluates speech activity and turn completion.
    pub fn push_samples(&mut self, samples: &[f32]) -> Option<AudioChunk> {
        if samples.is_empty() {
            return None;
        }

        let current_time_ms = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0);

        let slice_rms = compute_rms(samples);
        let is_slice_speech = slice_rms >= self.config.threshold;

        if is_slice_speech {
            if !self.is_speaking {
                // Speech onset detected
                self.is_speaking = true;
                self.turn_start_timestamp_ms = current_time_ms;
                self.accumulated_samples.clear();
                // Prepend pre-roll buffer to preserve initial consonant onset
                self.accumulated_samples.extend(self.pre_roll_buffer.drain(..));
                self.speech_samples_count = 0;
            }
            self.speech_samples_count += samples.len();
            self.silence_samples_count = 0;
            self.accumulated_samples.extend_from_slice(samples);
        } else if self.is_speaking {
            // Speech was active, current slice is below threshold (silence/pause)
            self.silence_samples_count += samples.len();
            self.accumulated_samples.extend_from_slice(samples);

            let silence_secs = self.silence_samples_count as f32 / self.sample_rate as f32;
            let speech_secs = self.speech_samples_count as f32 / self.sample_rate as f32;

            if silence_secs >= self.config.silence_threshold_secs {
                // 1.1s turn silence threshold reached!
                if speech_secs >= self.config.min_speech_secs {
                    let chunk = self.finalize_turn(current_time_ms);
                    self.reset_turn();
                    return Some(chunk);
                } else {
                    // Spurious noise or too short to be speech turn
                    self.reset_turn();
                    return None;
                }
            }
        } else {
            // Idle state: maintain pre-roll buffer
            for &s in samples {
                if self.pre_roll_buffer.len() >= self.max_pre_roll_samples {
                    self.pre_roll_buffer.pop_front();
                }
                self.pre_roll_buffer.push_back(s);
            }
        }

        // Check if turn duration exceeded max limit (continuous speech without 1.1s pause)
        if self.is_speaking {
            let total_turn_secs = self.accumulated_samples.len() as f32 / self.sample_rate as f32;
            if total_turn_secs >= self.config.max_turn_secs {
                let chunk = self.finalize_turn(current_time_ms);
                self.accumulated_samples.clear();
                self.speech_samples_count = 0;
                self.silence_samples_count = 0;
                self.turn_start_timestamp_ms = current_time_ms;
                return Some(chunk);
            }
        }

        None
    }

    fn finalize_turn(&mut self, current_time_ms: u64) -> AudioChunk {
        // Leave at most ~200ms trailing padding
        let max_trailing = (0.2 * self.sample_rate as f32) as usize;
        let mut final_samples = std::mem::take(&mut self.accumulated_samples);

        if self.silence_samples_count > max_trailing {
            let excess = self.silence_samples_count - max_trailing;
            if excess < final_samples.len() {
                let new_len = final_samples.len() - excess;
                final_samples.truncate(new_len);
            }
        }

        let duration_secs = final_samples.len() as f32 / self.sample_rate as f32;
        let rms_energy = compute_rms(&final_samples);

        AudioChunk {
            channel: self.channel,
            samples: final_samples,
            sample_rate: self.sample_rate,
            timestamp_ms: current_time_ms,
            duration_secs,
            rms_energy,
            is_speech: true,
        }
    }

    fn reset_turn(&mut self) {
        self.is_speaking = false;
        self.turn_start_timestamp_ms = 0;
        self.accumulated_samples.clear();
        self.speech_samples_count = 0;
        self.silence_samples_count = 0;
        self.pre_roll_buffer.clear();
    }

    /// Resets and purges all buffered data immediately
    pub fn purge(&mut self) {
        self.reset_turn();
    }

    pub fn is_speaking(&self) -> bool {
        self.is_speaking
    }
}

/// Ephemeral in-memory circular ring buffer for recent audio inspection (SEC-003)
#[derive(Debug)]
pub struct EphemeralRingBuffer {
    buffer: VecDeque<f32>,
    max_capacity_samples: usize,
}

impl EphemeralRingBuffer {
    pub fn new(capacity_secs: f32, sample_rate: u32) -> Self {
        let max_capacity = (capacity_secs * sample_rate as f32).round() as usize;
        Self {
            buffer: VecDeque::with_capacity(max_capacity),
            max_capacity_samples: max_capacity,
        }
    }

    pub fn push_slice(&mut self, samples: &[f32]) {
        for &s in samples {
            if self.buffer.len() >= self.max_capacity_samples {
                self.buffer.pop_front();
            }
            self.buffer.push_back(s);
        }
    }

    pub fn len(&self) -> usize {
        self.buffer.len()
    }

    pub fn is_empty(&self) -> bool {
        self.buffer.is_empty()
    }

    /// Returns a copy of the most recent N samples (in chronological order)
    pub fn get_recent_samples(&self, count: usize) -> Vec<f32> {
        let available = self.buffer.len();
        let take_count = count.min(available);
        let start_idx = available - take_count;
        self.buffer.range(start_idx..).copied().collect()
    }

    /// Immediately flushes and erases all buffered audio (SEC-003, REQ-004)
    pub fn purge(&mut self) {
        self.buffer.clear();
    }
}

/// Dual-channel audio stream mixer managing ScreenCaptureKit and Microphone streams
#[derive(Debug)]
pub struct AudioMixer {
    vad_interviewer: ChannelVad,
    vad_candidate: ChannelVad,
    ring_interviewer: EphemeralRingBuffer,
    ring_candidate: EphemeralRingBuffer,
    config: VadConfig,
}

impl AudioMixer {
    /// Creates a new AudioMixer with default or custom VAD configuration
    pub fn new(config: VadConfig) -> Self {
        let ring_duration_secs = 60.0; // 60s ephemeral in-memory buffer
        Self {
            vad_interviewer: ChannelVad::new(Channel::Interviewer, config.clone(), TARGET_SAMPLE_RATE),
            vad_candidate: ChannelVad::new(Channel::Candidate, config.clone(), TARGET_SAMPLE_RATE),
            ring_interviewer: EphemeralRingBuffer::new(ring_duration_secs, TARGET_SAMPLE_RATE),
            ring_candidate: EphemeralRingBuffer::new(ring_duration_secs, TARGET_SAMPLE_RATE),
            config,
        }
    }

    /// Processes incoming raw PCM float32 samples from either Channel 0 or Channel 1.
    /// Performs downmixing to mono, linear resampling to 16kHz, ring buffering, and VAD analysis.
    pub fn process_samples(
        &mut self,
        channel: Channel,
        raw_samples: &[f32],
        src_rate: u32,
        src_channels: u16,
    ) -> Option<AudioChunk> {
        if raw_samples.is_empty() {
            return None;
        }

        // 1. Downmix to mono
        let mono_samples = downmix_to_mono(raw_samples, src_channels);

        // 2. Resample to standard 16kHz
        let resampled = resample_linear(&mono_samples, src_rate, TARGET_SAMPLE_RATE);
        if resampled.is_empty() {
            return None;
        }

        // 3. Push to ephemeral ring buffer
        match channel {
            Channel::Interviewer => {
                self.ring_interviewer.push_slice(&resampled);
                self.vad_interviewer.push_samples(&resampled)
            }
            Channel::Candidate => {
                self.ring_candidate.push_slice(&resampled);
                self.vad_candidate.push_samples(&resampled)
            }
        }
    }

    /// Retrieves current RMS level for a channel (useful for UI HUD / notch waveform)
    pub fn get_recent_rms(&self, channel: Channel, window_samples: usize) -> f32 {
        let samples = match channel {
            Channel::Interviewer => self.ring_interviewer.get_recent_samples(window_samples),
            Channel::Candidate => self.ring_candidate.get_recent_samples(window_samples),
        };
        compute_rms(&samples)
    }

    /// Purges all in-memory buffers across both channels (Panic REQ-004, Burn Session)
    pub fn purge(&mut self) {
        self.vad_interviewer.purge();
        self.vad_candidate.purge();
        self.ring_interviewer.purge();
        self.ring_candidate.purge();
    }

    pub fn is_interviewer_speaking(&self) -> bool {
        self.vad_interviewer.is_speaking()
    }

    pub fn is_candidate_speaking(&self) -> bool {
        self.vad_candidate.is_speaking()
    }

    pub fn config(&self) -> &VadConfig {
        &self.config
    }
}

impl Default for AudioMixer {
    fn default() -> Self {
        Self::new(VadConfig::default())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_compute_rms_empty_and_silence() {
        assert_eq!(compute_rms(&[]), 0.0);
        assert_eq!(compute_rms(&[0.0, 0.0, 0.0]), 0.0);
    }

    #[test]
    fn test_compute_rms_sine_wave() {
        // Sine wave with amplitude 1.0 has theoretical RMS of 1 / sqrt(2) ≈ 0.7071
        let sample_rate = 16000;
        let freq = 440.0;
        let mut samples = Vec::with_capacity(sample_rate);
        for i in 0..sample_rate {
            let t = i as f32 / sample_rate as f32;
            samples.push((2.0 * std::f32::consts::PI * freq * t).sin());
        }
        let rms = compute_rms(&samples);
        assert!((rms - 0.7071).abs() < 0.01, "Expected RMS ~0.7071, got {rms}");
    }

    #[test]
    fn test_downmix_to_mono() {
        // Mono identity
        let mono_input = vec![0.5, -0.5, 0.2];
        assert_eq!(downmix_to_mono(&mono_input, 1), mono_input);

        // Stereo interleaved downmix: [L0, R0, L1, R1]
        let stereo = vec![1.0, 0.0, -0.5, 0.5];
        let downmixed = downmix_to_mono(&stereo, 2);
        assert_eq!(downmixed.len(), 2);
        assert_eq!(downmixed[0], 0.5);
        assert_eq!(downmixed[1], 0.0);
    }

    #[test]
    fn test_resample_linear() {
        // Identity rate
        let original = vec![0.1, 0.2, 0.3, 0.4];
        let resampled = resample_linear(&original, 16000, 16000);
        assert_eq!(original, resampled);

        // Downsampling 32000 -> 16000 (length halves)
        let samples_32k = vec![0.0, 0.5, 1.0, 0.5, 0.0];
        let samples_16k = resample_linear(&samples_32k, 32000, 16000);
        assert!(!samples_16k.is_empty());
        assert!((samples_16k.len() as i32 - (samples_32k.len() / 2) as i32).abs() <= 1);
    }

    #[test]
    fn test_vad_turn_silence_1_1s_detection() {
        let config = VadConfig {
            threshold: 0.05,
            silence_threshold_secs: 1.1,
            min_speech_secs: 0.3,
            max_turn_secs: 15.0,
            pre_roll_secs: 0.1,
        };
        let mut vad = ChannelVad::new(Channel::Interviewer, config, TARGET_SAMPLE_RATE);

        // 1. Generate 1.0 second of speech (16,000 samples of 0.2 amplitude sine wave)
        let speech_samples: Vec<f32> = (0..TARGET_SAMPLE_RATE)
            .map(|i| 0.2 * (i as f32 * 0.1).sin())
            .collect();
        assert!(compute_rms(&speech_samples) > 0.05);

        // Push speech in 100ms slices (1600 samples each)
        for chunk in speech_samples.chunks(1600) {
            let res = vad.push_samples(chunk);
            assert!(res.is_none(), "Should not complete turn during active speech");
        }
        assert!(vad.is_speaking());

        // 2. Push 0.8 seconds of silence (8 * 1600 samples) -> under 1.1s threshold
        let silence_chunk = vec![0.0f32; 1600];
        for _ in 0..8 {
            let res = vad.push_samples(&silence_chunk);
            assert!(res.is_none(), "Silence is under 1.1s, turn should remain open");
        }
        assert!(vad.is_speaking());

        // 3. Push remaining silence to exceed 1.1s (0.4s more = 4 slices = total 1.2s silence)
        let mut completed_chunk = None;
        for _ in 0..4 {
            if let Some(chunk) = vad.push_samples(&silence_chunk) {
                completed_chunk = Some(chunk);
                break;
            }
        }

        assert!(completed_chunk.is_some(), "Turn should complete after 1.1s of silence");
        let chunk = completed_chunk.unwrap();
        assert_eq!(chunk.channel, Channel::Interviewer);
        assert!(chunk.is_speech);
        assert!(chunk.duration_secs >= 1.0);
        assert!(!vad.is_speaking(), "VAD should reset to idle after turn completion");
    }

    #[test]
    fn test_vad_channel_segregation() {
        let config = VadConfig {
            threshold: 0.05,
            silence_threshold_secs: 1.1,
            min_speech_secs: 0.3,
            max_turn_secs: 15.0,
            pre_roll_secs: 0.1,
        };
        let mut mixer = AudioMixer::new(config);

        // 1. Speech on Channel::Candidate (Mic)
        let candidate_speech: Vec<f32> = (0..TARGET_SAMPLE_RATE)
            .map(|i| 0.3 * (i as f32 * 0.1).sin())
            .collect();

        // Feed candidate speech
        for chunk in candidate_speech.chunks(1600) {
            let _ = mixer.process_samples(Channel::Candidate, chunk, TARGET_SAMPLE_RATE, 1);
        }
        assert!(mixer.is_candidate_speaking());
        assert!(!mixer.is_interviewer_speaking(), "Interviewer must remain silent");

        // Feed silence to trigger candidate turn completion
        let silence = vec![0.0f32; 1600];
        let mut turn = None;
        for _ in 0..15 {
            if let Some(c) = mixer.process_samples(Channel::Candidate, &silence, TARGET_SAMPLE_RATE, 1) {
                turn = Some(c);
                break;
            }
        }

        assert!(turn.is_some());
        let chunk = turn.unwrap();
        assert_eq!(chunk.channel, Channel::Candidate);
        assert_eq!(chunk.channel.id(), 1);
        assert_eq!(chunk.channel.label(), "Candidate");
    }

    #[test]
    fn test_vad_filters_brief_transient_click() {
        let config = VadConfig {
            threshold: 0.05,
            silence_threshold_secs: 1.1,
            min_speech_secs: 0.4,
            max_turn_secs: 15.0,
            pre_roll_secs: 0.1,
        };
        let mut vad = ChannelVad::new(Channel::Interviewer, config, TARGET_SAMPLE_RATE);

        // Brief 50ms click (800 samples)
        let click = vec![0.5f32; 800];
        let _ = vad.push_samples(&click);

        // 1.2s silence
        let silence = vec![0.0f32; 1600];
        let mut emitted = None;
        for _ in 0..12 {
            if let Some(c) = vad.push_samples(&silence) {
                emitted = Some(c);
                break;
            }
        }

        assert!(emitted.is_none(), "Clicks shorter than min_speech_secs must not emit turns");
        assert!(!vad.is_speaking());
    }

    #[test]
    fn test_ring_buffer_and_purge() {
        let mut rb = EphemeralRingBuffer::new(2.0, 16000); // 32,000 capacity
        assert_eq!(rb.len(), 0);

        let data = vec![0.25f32; 1000];
        rb.push_slice(&data);
        assert_eq!(rb.len(), 1000);

        let recent = rb.get_recent_samples(500);
        assert_eq!(recent.len(), 500);
        assert_eq!(recent[0], 0.25);

        // Purge erases all data
        rb.purge();
        assert_eq!(rb.len(), 0);
        assert!(rb.is_empty());
    }

    #[test]
    fn test_level_from_rms_maps_db_range() {
        assert_eq!(level_from_rms(0.0), 0.0);
        assert_eq!(level_from_rms(10f32.powf(-56.0 / 20.0)), 0.0, "below -50 dBFS reads zero");
        assert!((level_from_rms(10f32.powf(-30.0 / 20.0)) - 0.5).abs() < 1e-4);
        assert_eq!(level_from_rms(1.0), 1.0, "0 dBFS clamps to full scale");
    }

    #[test]
    fn test_audio_level_meter_throttles_and_reports_both_channels() {
        let meter = AudioLevelMeter::default();
        let speech = vec![0.1f32; 1600];

        assert!(meter.record(Channel::Candidate, &speech).is_some(), "first window emits at once");
        assert!(meter.record(Channel::Candidate, &speech).is_none(), "second callback is inside the interval");

        std::thread::sleep(AUDIO_LEVEL_INTERVAL);
        let (interviewer, candidate) = meter
            .record(Channel::Interviewer, &speech)
            .expect("interval passed, so a window is emitted");
        let expected = level_from_rms(0.1);
        assert!((interviewer - expected).abs() < 1e-3);
        assert!((candidate - expected).abs() < 1e-3);
    }
}
