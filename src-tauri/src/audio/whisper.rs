//! Embedded Local Whisper STT Engine with Apple Metal Acceleration (REQ-009, REQ-010, AC-005, NFR-3)
//!
//! Features:
//! - 100% offline speech-to-text inference executing entirely on-device (AC-005).
//! - Native Apple Metal GPU/ANE acceleration via whisper.cpp / whisper-rs (NFR-3).
//! - Model asset manager targeting `~/Library/Application Support/Sidekick/models/`:
//!   - `ggml-tiny.en.bin` (~75MB, bundled default)
//!   - `ggml-base.en.bin` (~140MB, high-accuracy option)
//! - In-flight streaming model downloader with atomic persistence.
//! - Robust mock/fallback inference pipeline for headless compilation, CI, and test environments.

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, RwLock};
use std::time::Instant;
use serde::{Deserialize, Serialize};
use whisper_rs::{FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters};

/// Standard model directory under macOS Application Support
pub const SIDEKICK_MODELS_SUBDIR: &str = "Sidekick/models";

/// Default local STT model filename
pub const DEFAULT_TINY_MODEL: &str = "ggml-tiny.en.bin";

/// Higher-accuracy local STT model filename
pub const DEFAULT_BASE_MODEL: &str = "ggml-base.en.bin";

/// Official Whisper GGML model download repository
pub const WHISPER_HF_REPO: &str = "https://huggingface.co/ggerganov/whisper.cpp/resolve/main";

/// Resolves the canonical model directory:
/// `~/Library/Application Support/Sidekick/models/`
pub fn get_models_dir() -> PathBuf {
    if let Ok(home) = std::env::var("HOME") {
        PathBuf::from(home)
            .join("Library")
            .join("Application Support")
            .join("Sidekick")
            .join("models")
    } else {
        std::env::temp_dir().join("sidekick_models")
    }
}

/// Ensures the local models directory exists on disk
pub fn ensure_models_dir() -> Result<PathBuf, String> {
    let dir = get_models_dir();
    if !dir.exists() {
        fs::create_dir_all(&dir).map_err(|e| {
            format!("Failed to create models directory at {}: {e}", dir.display())
        })?;
    }
    Ok(dir)
}

/// Normalizes a model identifier into its canonical GGML filename
pub fn normalize_model_filename(model_name: &str) -> &'static str {
    match model_name.trim().to_lowercase().as_str() {
        "tiny" | "tiny.en" | "ggml-tiny.en.bin" => DEFAULT_TINY_MODEL,
        "base" | "base.en" | "ggml-base.en.bin" => DEFAULT_BASE_MODEL,
        _ => DEFAULT_TINY_MODEL,
    }
}

/// Resolves the absolute path to a model file if it exists on disk
pub fn resolve_model_path(model_name: &str) -> Option<PathBuf> {
    let filename = normalize_model_filename(model_name);
    let dir = get_models_dir();
    let candidate = dir.join(filename);
    if candidate.exists() && candidate.is_file() {
        Some(candidate)
    } else {
        None
    }
}

/// Returns the official download URL for a given model
pub fn get_model_download_url(model_name: &str) -> String {
    let filename = normalize_model_filename(model_name);
    format!("{}/{}", WHISPER_HF_REPO, filename)
}

/// Downloads a Whisper GGML model asset into `~/Library/Application Support/Sidekick/models/`
pub async fn download_model<F>(
    model_name: &str,
    progress_callback: Option<F>,
) -> Result<PathBuf, String>
where
    F: Fn(u64, u64) + Send + 'static,
{
    let dir = ensure_models_dir()?;
    let filename = normalize_model_filename(model_name);
    let target_path = dir.join(filename);
    let temp_path = dir.join(format!("{filename}.part"));

    let url = get_model_download_url(model_name);
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(300))
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {e}"))?;

    let mut response = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("Failed to connect to model download URL: {e}"))?;

    if !response.status().is_success() {
        return Err(format!(
            "Model download failed with HTTP status {}",
            response.status()
        ));
    }

    let total_size = response.content_length().unwrap_or(0);
    let mut file = fs::File::create(&temp_path)
        .map_err(|e| format!("Failed to create temporary model file: {e}"))?;

    let mut downloaded: u64 = 0;
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|e| format!("Network error while streaming model: {e}"))?
    {
        file.write_all(&chunk)
            .map_err(|e| format!("Failed to write model chunk: {e}"))?;
        downloaded += chunk.len() as u64;
        if let Some(ref cb) = progress_callback {
            cb(downloaded, total_size);
        }
    }

    file.flush()
        .map_err(|e| format!("Failed to flush model file: {e}"))?;
    drop(file);

    fs::rename(&temp_path, &target_path)
        .map_err(|e| format!("Failed to commit model file: {e}"))?;

    Ok(target_path)
}

/// Metadata description of a local Whisper model asset
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ModelAssetInfo {
    pub name: String,
    pub filename: String,
    pub path: Option<String>,
    pub size_bytes: u64,
    pub is_available: bool,
    pub download_url: String,
}

/// Lists all supported local models and their disk availability
pub fn list_available_models() -> Vec<ModelAssetInfo> {
    let models = [
        ("tiny.en", DEFAULT_TINY_MODEL, 77800000u64),
        ("base.en", DEFAULT_BASE_MODEL, 148000000u64),
    ];

    let dir = get_models_dir();

    models
        .iter()
        .map(|(name, filename, default_size)| {
            let path = dir.join(filename);
            let (is_available, size) = if path.exists() {
                let size = fs::metadata(&path).map(|m| m.len()).unwrap_or(*default_size);
                (true, size)
            } else {
                (false, *default_size)
            };

            ModelAssetInfo {
                name: name.to_string(),
                filename: filename.to_string(),
                path: if is_available {
                    Some(path.to_string_lossy().to_string())
                } else {
                    None
                },
                size_bytes: size,
                is_available,
                download_url: format!("{}/{}", WHISPER_HF_REPO, filename),
            }
        })
        .collect()
}

/// Checks if Apple Metal hardware acceleration is supported on current host
pub fn is_metal_supported() -> bool {
    #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
    {
        true
    }
    #[cfg(not(all(target_os = "macos", target_arch = "aarch64")))]
    {
        false
    }
}

/// Configuration parameters for local Whisper inference
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct WhisperConfig {
    /// Model name or filename (e.g. "tiny.en", "base.en")
    pub model_name: String,
    /// Explicit model path override (optional)
    pub model_path: Option<PathBuf>,
    /// Offload compute to Apple Metal GPU shaders
    pub use_metal: bool,
    /// Number of CPU threads to utilize for pre/post processing
    pub n_threads: u32,
    /// Spoken language: "auto" to detect, or an ISO-639-1 code (default: "en")
    pub language: String,
    /// Translate to English if audio is in another language
    pub translate: bool,
    /// Sampling temperature (0.0 for greedy deterministic decoding)
    pub temperature: f32,
}

impl Default for WhisperConfig {
    fn default() -> Self {
        Self {
            model_name: "tiny.en".to_string(),
            model_path: None,
            use_metal: is_metal_supported(),
            n_threads: 4,
            language: "en".to_string(),
            translate: false,
            temperature: 0.0,
        }
    }
}

/// Result returned from local or fallback transcription
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TranscriptionResult {
    /// Decoded transcript text
    pub text: String,
    /// Processing duration in milliseconds
    pub latency_ms: u64,
    /// Model identifier utilized
    pub model: String,
    /// Whether Apple Metal GPU acceleration was utilized
    pub metal_accelerated: bool,
    /// Confidence estimate (0.0 to 1.0)
    pub confidence: f32,
    /// Whether this result came from a canned test reply rather than a loaded model
    pub is_mock_or_fallback: bool,
}

/// Returned by `transcribe` when no model weights are loaded
pub const NO_MODEL_ERROR: &str = "No local speech model is loaded";

/// Local Whisper Engine interface
pub trait WhisperEngine: Send + Sync {
    /// Transcribe 16kHz mono PCM float32 samples
    fn transcribe(&self, samples: &[f32], sample_rate: u32) -> Result<TranscriptionResult, String>;
    /// Check if model is loaded and ready
    fn is_ready(&self) -> bool;
    /// Retrieve active model name
    fn model_name(&self) -> String;
}

/// Helper function to instantiate a real WhisperContext with Metal acceleration
fn create_whisper_context(path: &Path, use_metal: bool) -> Result<WhisperContext, String> {
    let mut params = WhisperContextParameters::default();
    params.use_gpu = use_metal;
    WhisperContext::new_with_params(&path.to_string_lossy(), params)
        .map_err(|e| format!("Failed to create WhisperContext: {e:?}"))
}

/// Helper to execute real whisper.cpp transcription on 16kHz float32 samples
fn run_real_whisper_transcription(
    ctx: &WhisperContext,
    samples: &[f32],
    n_threads: u32,
    lang: &str,
    translate: bool,
) -> Result<String, String> {
    let mut state = ctx
        .create_state()
        .map_err(|e| format!("Failed to create WhisperState: {e:?}"))?;

    let mut params = FullParams::new(SamplingStrategy::Greedy { best_of: 1 });
    params.set_n_threads(n_threads as i32);
    params.set_language(Some(lang));
    params.set_translate(translate);
    params.set_print_special(false);
    params.set_print_progress(false);
    params.set_print_realtime(false);
    params.set_print_timestamps(false);

    state
        .full(params, samples)
        .map_err(|e| format!("Whisper inference error: {e:?}"))?;

    let num_segments = state
        .full_n_segments()
        .map_err(|e| format!("Whisper segments error: {e:?}"))?;

    let mut full_text = String::new();
    for i in 0..num_segments {
        if let Ok(segment) = state.full_get_segment_text(i) {
            full_text.push_str(&segment);
        }
    }

    Ok(full_text.trim().to_string())
}

/// Embedded Local Whisper Engine
///
/// Implements native Metal-accelerated inference using `whisper-rs` when weights are present on disk,
/// with robust zero-crash mock/fallback for tests and headless CI environments.
pub struct LocalWhisperEngine {
    config: RwLock<WhisperConfig>,
    resolved_path: RwLock<Option<PathBuf>>,
    context: Arc<Mutex<Option<WhisperContext>>>,
    mock_response: Arc<RwLock<Option<String>>>,
    is_mock_mode: RwLock<bool>,
}

impl LocalWhisperEngine {
    /// Creates a new LocalWhisperEngine from configuration
    pub fn new(config: WhisperConfig) -> Self {
        let resolved_path = config
            .model_path
            .clone()
            .or_else(|| resolve_model_path(&config.model_name));

        let (context, is_mock) = if let Some(ref path) = resolved_path {
            match create_whisper_context(path, config.use_metal) {
                Ok(ctx) => {
                    println!(
                        "[Sidekick STT] Loaded whisper model '{}' with Metal={}",
                        path.display(),
                        config.use_metal
                    );
                    (Some(ctx), false)
                }
                Err(e) => {
                    eprintln!(
                        "[Sidekick STT] Failed to initialize whisper model at {}: {e}. Falling back to mock engine.",
                        path.display()
                    );
                    (None, true)
                }
            }
        } else {
            (None, true)
        };

        Self {
            config: RwLock::new(config),
            resolved_path: RwLock::new(resolved_path),
            context: Arc::new(Mutex::new(context)),
            mock_response: Arc::new(RwLock::new(None)),
            is_mock_mode: RwLock::new(is_mock),
        }
    }

    /// Creates an engine explicitly configured for deterministic testing
    pub fn new_mock(canned_text: Option<&str>) -> Self {
        let mut config = WhisperConfig::default();
        config.use_metal = false;

        Self {
            config: RwLock::new(config),
            resolved_path: RwLock::new(None),
            context: Arc::new(Mutex::new(None)),
            mock_response: Arc::new(RwLock::new(canned_text.map(|s| s.to_string()))),
            is_mock_mode: RwLock::new(true),
        }
    }

    /// Dynamically loads or reloads model weights from disk
    pub fn load_model(&self, model_name: &str) -> Result<PathBuf, String> {
        let path = resolve_model_path(model_name)
            .ok_or_else(|| format!("Model '{model_name}' not found in {}", get_models_dir().display()))?;

        let use_metal = self.config.read().map(|c| c.use_metal).unwrap_or(true);
        let ctx = create_whisper_context(&path, use_metal)?;

        if let Ok(mut guard) = self.context.lock() {
            *guard = Some(ctx);
        }
        if let Ok(mut guard) = self.resolved_path.write() {
            *guard = Some(path.clone());
        }
        if let Ok(mut guard) = self.is_mock_mode.write() {
            *guard = false;
        }
        if let Ok(mut guard) = self.config.write() {
            guard.model_name = model_name.to_string();
            guard.model_path = Some(path.clone());
        }

        Ok(path)
    }

    /// Sets the spoken language used by the next transcription ("auto" or an ISO-639-1 code)
    pub fn set_language(&self, language: &str) {
        if let Ok(mut guard) = self.config.write() {
            guard.language = language.to_string();
        }
    }

    /// The spoken language used for transcription ("auto" or an ISO-639-1 code)
    pub fn language(&self) -> String {
        self.config.read().map(|c| c.language.clone()).unwrap_or_else(|_| "en".to_string())
    }

    /// Sets or clears a canned mock response for testing
    pub fn set_mock_response(&self, text: Option<&str>) {
        if let Ok(mut guard) = self.mock_response.write() {
            *guard = text.map(|s| s.to_string());
        }
    }

    /// Returns the resolved path to the model file if present
    pub fn resolved_path(&self) -> Option<PathBuf> {
        self.resolved_path.read().ok().and_then(|g| g.clone())
    }

    /// True when real model weights are loaded (false for the canned test engine)
    pub fn has_model(&self) -> bool {
        !self.is_mock_mode.read().map(|g| *g).unwrap_or(true)
    }

    /// Helper to compute Root-Mean-Square energy of a slice
    fn compute_rms(samples: &[f32]) -> f32 {
        if samples.is_empty() {
            return 0.0;
        }
        let sum_sq: f32 = samples.iter().map(|&s| s * s).sum();
        (sum_sq / samples.len() as f32).sqrt()
    }
}

impl WhisperEngine for LocalWhisperEngine {
    fn transcribe(&self, samples: &[f32], sample_rate: u32) -> Result<TranscriptionResult, String> {
        let start = Instant::now();

        // Validate sample rate (Whisper requires 16000 Hz)
        if sample_rate != 16000 {
            return Err(format!(
                "Whisper requires 16,000 Hz audio input, but received {sample_rate} Hz"
            ));
        }

        let rms = Self::compute_rms(samples);
        let model_name = self.config.read().map(|c| c.model_name.clone()).unwrap_or_else(|_| "tiny.en".to_string());
        let use_metal = self.config.read().map(|c| c.use_metal).unwrap_or(false);
        let n_threads = self.config.read().map(|c| c.n_threads).unwrap_or(4);
        let lang = self.config.read().map(|c| c.language.clone()).unwrap_or_else(|_| "en".to_string());
        let translate = self.config.read().map(|c| c.translate).unwrap_or(false);

        // Quick return on silence
        if rms < 0.005 || samples.is_empty() {
            return Ok(TranscriptionResult {
                text: String::new(),
                latency_ms: start.elapsed().as_millis() as u64,
                model: model_name,
                metal_accelerated: use_metal && is_metal_supported(),
                confidence: 1.0,
                is_mock_or_fallback: false,
            });
        }

        let is_mock = self.is_mock_mode.read().map(|g| *g).unwrap_or(true);
        if is_mock {
            // Without weights, only a canned test reply is allowed; production has none and must not invent text
            let canned = self.mock_response.read().ok().and_then(|g| g.clone());
            return canned
                .map(|text| TranscriptionResult {
                    text,
                    latency_ms: start.elapsed().as_millis() as u64,
                    model: model_name,
                    metal_accelerated: false,
                    confidence: 0.99,
                    is_mock_or_fallback: true,
                })
                .ok_or_else(|| NO_MODEL_ERROR.to_string());
        }

        let guard = self.context.lock().map_err(|e| e.to_string())?;
        let ctx = guard.as_ref().ok_or_else(|| NO_MODEL_ERROR.to_string())?;
        let text = run_real_whisper_transcription(ctx, samples, n_threads, &lang, translate)?;
        Ok(TranscriptionResult {
            text,
            latency_ms: start.elapsed().as_millis() as u64,
            model: model_name,
            metal_accelerated: use_metal && is_metal_supported(),
            confidence: 0.98,
            is_mock_or_fallback: false,
        })
    }

    fn is_ready(&self) -> bool {
        let is_mock = self.is_mock_mode.read().map(|g| *g).unwrap_or(true);
        if is_mock {
            true
        } else {
            self.context.lock().map(|g| g.is_some()).unwrap_or(false)
        }
    }

    fn model_name(&self) -> String {
        self.config.read().map(|c| c.model_name.clone()).unwrap_or_else(|_| "tiny.en".to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_normalize_model_filename() {
        assert_eq!(normalize_model_filename("tiny"), "ggml-tiny.en.bin");
        assert_eq!(normalize_model_filename("tiny.en"), "ggml-tiny.en.bin");
        assert_eq!(normalize_model_filename("ggml-tiny.en.bin"), "ggml-tiny.en.bin");
        assert_eq!(normalize_model_filename("base"), "ggml-base.en.bin");
        assert_eq!(normalize_model_filename("base.en"), "ggml-base.en.bin");
        assert_eq!(normalize_model_filename("ggml-base.en.bin"), "ggml-base.en.bin");
        assert_eq!(normalize_model_filename("unknown"), "ggml-tiny.en.bin");
    }

    #[test]
    fn test_models_dir_path() {
        let dir = get_models_dir();
        assert!(dir.to_string_lossy().contains("Sidekick/models") || dir.to_string_lossy().contains("sidekick_models"));
    }

    #[test]
    fn test_model_download_url() {
        let url_tiny = get_model_download_url("tiny.en");
        assert!(url_tiny.ends_with("ggml-tiny.en.bin"));
        assert!(url_tiny.starts_with("https://huggingface.co/"));

        let url_base = get_model_download_url("base.en");
        assert!(url_base.ends_with("ggml-base.en.bin"));
    }

    #[test]
    fn test_list_available_models() {
        let models = list_available_models();
        assert_eq!(models.len(), 2);
        assert_eq!(models[0].name, "tiny.en");
        assert_eq!(models[0].filename, "ggml-tiny.en.bin");
        assert_eq!(models[1].name, "base.en");
        assert_eq!(models[1].filename, "ggml-base.en.bin");
    }

    #[test]
    fn test_whisper_config_defaults() {
        let config = WhisperConfig::default();
        assert_eq!(config.model_name, "tiny.en");
        assert_eq!(config.n_threads, 4);
        assert_eq!(config.language, "en");
        assert!(!config.translate);
        assert_eq!(config.temperature, 0.0);
    }

    #[test]
    fn test_engine_transcribe_silence_returns_empty() {
        let engine = LocalWhisperEngine::new_mock(None);
        let silent_samples = vec![0.0f32; 16000]; // 1 second of silence
        let result = engine.transcribe(&silent_samples, 16000).expect("transcription succeeded");
        assert_eq!(result.text, "");
    }

    #[test]
    fn test_engine_speech_without_model_returns_no_text() {
        let engine = LocalWhisperEngine::new_mock(None);
        assert!(!engine.has_model());
        // Create 1.5 seconds of non-silent 440Hz sine wave samples
        let samples: Vec<f32> = (0..24000)
            .map(|i| ((i as f32 * 440.0 * 2.0 * std::f32::consts::PI / 16000.0).sin()) * 0.5)
            .collect();

        let err = engine.transcribe(&samples, 16000).expect_err("no model must not yield text");
        assert_eq!(err, NO_MODEL_ERROR);
    }

    #[test]
    fn test_engine_transcribe_canned_mock() {
        let engine = LocalWhisperEngine::new_mock(Some("Could you explain how to optimize a binary search tree?"));
        let samples = vec![0.1f32; 16000];
        let result = engine.transcribe(&samples, 16000).expect("transcription succeeded");
        assert_eq!(result.text, "Could you explain how to optimize a binary search tree?");
        assert_eq!(result.confidence, 0.99);

        // Dynamically change mock response
        engine.set_mock_response(Some("What is the time complexity of quicksort?"));
        let result2 = engine.transcribe(&samples, 16000).expect("transcription succeeded");
        assert_eq!(result2.text, "What is the time complexity of quicksort?");
    }

    #[test]
    fn test_metal_support_detection() {
        let supported = is_metal_supported();
        #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
        assert!(supported);
        #[cfg(not(all(target_os = "macos", target_arch = "aarch64")))]
        assert!(!supported);
    }
}
