//! Candidate Microphone Audio Ingestion via cpal / CoreAudio (REQ-007, REQ-008)
//!
//! Ingests candidate speech from the default macOS microphone device (Channel 1: Candidate).
//! Normalizes incoming audio samples into standard float32 PCM and routes to the dual-channel mixer.
//! Uses a dedicated worker thread so CoreAudio stream handles remain isolated.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{channel, Sender};
use std::sync::Arc;
use std::thread;
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::SampleFormat;
use serde::Serialize;

/// Error returned when macOS denies or restricts the microphone (matched by the friendly warning in `mod.rs`)
pub const MIC_ACCESS_DENIED: &str = "Microphone access is denied";

/// A microphone the user can pick in Settings → Audio
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct InputDevice {
    pub name: String,
    pub is_default: bool,
}

/// Lists the connected input devices, marking the system default
pub fn list_input_devices() -> Result<Vec<InputDevice>, String> {
    let host = cpal::default_host();
    let default_name = host.default_input_device().and_then(|d| d.name().ok());
    let devices = host.input_devices().map_err(|e| format!("Failed to list microphones: {e}"))?;
    Ok(devices
        .filter_map(|d| d.name().ok())
        .map(|name| InputDevice { is_default: Some(&name) == default_name.as_ref(), name })
        .collect())
}

/// The connected input device with exactly this name, if there is one
fn named_input_device(host: &cpal::Host, name: &str) -> Option<cpal::Device> {
    host.input_devices().ok()?.find(|device| device.name().ok().as_deref() == Some(name))
}

/// True when a microphone with this name is connected right now
pub fn input_device_present(name: &str) -> bool {
    named_input_device(&cpal::default_host(), name).is_some()
}

#[cfg(target_os = "macos")]
#[link(name = "AVFoundation", kind = "framework")]
#[allow(deprecated)]
extern "C" {
    #[allow(non_upper_case_globals)]
    static AVMediaTypeAudio: cocoa::base::id;
}

/// AVAuthorizationStatus for audio: 0 not determined, 1 restricted, 2 denied, 3 authorized
#[cfg(target_os = "macos")]
#[allow(unexpected_cfgs)]
fn authorization_status() -> isize {
    use objc::{class, msg_send, sel, sel_impl};
    unsafe {
        let status: isize = msg_send![class!(AVCaptureDevice), authorizationStatusForMediaType: AVMediaTypeAudio];
        status
    }
}

#[cfg(not(target_os = "macos"))]
fn authorization_status() -> isize {
    3
}

/// True when the microphone is blocked. Opening it then still succeeds, but delivers silence.
/// A not-determined status is allowed, since opening the stream is what triggers macOS's prompt.
pub fn mic_status_blocks(status: isize) -> bool {
    matches!(status, 1 | 2)
}

/// Safe sample conversion from i16 PCM to normalized -1.0..1.0 float32
pub fn convert_i16_to_f32(samples: &[i16]) -> Vec<f32> {
    samples
        .iter()
        .map(|&s| (s as f32) / 32768.0)
        .collect()
}

/// Safe sample conversion from u16 PCM to normalized -1.0..1.0 float32
pub fn convert_u16_to_f32(samples: &[u16]) -> Vec<f32> {
    samples
        .iter()
        .map(|&s| ((s as f32) - 32768.0) / 32768.0)
        .collect()
}

/// Converts a linear amplitude to dBFS, floored at -100 dB (silence reads -100, full scale 0)
pub fn to_dbfs(amplitude: f32) -> f32 {
    if amplitude <= 1e-5 {
        return -100.0;
    }
    (20.0 * amplitude.log10()).clamp(-100.0, 0.0)
}

/// Length of one level-meter window: about 30 updates a second
const METER_WINDOW_MS: u32 = 33;

/// Accumulates mic samples into ~33 ms windows and reports each window as (RMS dBFS, peak dBFS)
#[derive(Default)]
pub struct MicLevelWindow {
    count: u32,
    sum_sq: f64,
    peak: f32,
}

impl MicLevelWindow {
    /// Adds one callback's interleaved samples. Returns a reading when a window completes.
    /// A callback that spans several windows reports only its last one.
    pub fn push(&mut self, samples: &[f32], sample_rate: u32, channels: u16) -> Option<(f32, f32)> {
        let window = (sample_rate * channels as u32 * METER_WINDOW_MS / 1000).max(1);
        let mut reading = None;
        for &sample in samples {
            self.sum_sq += f64::from(sample) * f64::from(sample);
            self.peak = self.peak.max(sample.abs());
            self.count += 1;
            if self.count >= window {
                let rms = (self.sum_sq / f64::from(self.count)).sqrt() as f32;
                reading = Some((to_dbfs(rms), to_dbfs(self.peak)));
                *self = Self::default();
            }
        }
        reading
    }
}

/// Microphone capture session handle
pub struct MicAudioCapture {
    stop_tx: Option<Sender<()>>,
    is_running: Arc<AtomicBool>,
}

impl MicAudioCapture {
    /// Starts capturing microphone audio on a dedicated worker thread.
    ///
    /// `name` picks a connected input device; `None` uses the system default. The callback receives
    /// chunks of normalized float32 samples, along with the device's native sample rate and channel count.
    pub fn start<F>(name: Option<&str>, on_audio: F) -> Result<Self, String>
    where
        F: Fn(&[f32], u32, u16) + Send + Sync + 'static,
    {
        if mic_status_blocks(authorization_status()) {
            return Err(MIC_ACCESS_DENIED.to_string());
        }

        let host = cpal::default_host();
        let device = match name {
            Some(name) => named_input_device(&host, name)
                .ok_or_else(|| format!("Microphone '{name}' wasn't found"))?,
            None => host
                .default_input_device()
                .ok_or_else(|| "No default microphone input device found on the system".to_string())?,
        };

        let device_name = device.name().unwrap_or_else(|_| "Default Microphone".to_string());
        let default_config = device
            .default_input_config()
            .map_err(|e| format!("Failed to query input configuration for '{device_name}': {e}"))?;

        let sample_format = default_config.sample_format();
        let stream_config: cpal::StreamConfig = default_config.clone().into();
        let sample_rate = stream_config.sample_rate.0;
        let channels = stream_config.channels;

        let on_audio_arc = Arc::new(on_audio);
        let is_running = Arc::new(AtomicBool::new(true));
        let is_running_worker = is_running.clone();

        let (stop_tx, stop_rx) = channel::<()>();
        let (init_tx, init_rx) = channel::<Result<(), String>>();

        thread::Builder::new()
            .name("sidekick-mic-stream".to_string())
            .spawn(move || {
                let err_callback = |err: cpal::StreamError| {
                    eprintln!("[Sidekick Mic Audio] Stream error occurred: {err}");
                };

                let stream_res = match sample_format {
                    SampleFormat::F32 => {
                        let cb = on_audio_arc.clone();
                        device.build_input_stream(
                            &stream_config,
                            move |data: &[f32], _: &cpal::InputCallbackInfo| {
                                cb(data, sample_rate, channels);
                            },
                            err_callback,
                            None,
                        )
                    }
                    SampleFormat::I16 => {
                        let cb = on_audio_arc.clone();
                        device.build_input_stream(
                            &stream_config,
                            move |data: &[i16], _: &cpal::InputCallbackInfo| {
                                let f32_samples = convert_i16_to_f32(data);
                                cb(&f32_samples, sample_rate, channels);
                            },
                            err_callback,
                            None,
                        )
                    }
                    SampleFormat::U16 => {
                        let cb = on_audio_arc.clone();
                        device.build_input_stream(
                            &stream_config,
                            move |data: &[u16], _: &cpal::InputCallbackInfo| {
                                let f32_samples = convert_u16_to_f32(data);
                                cb(&f32_samples, sample_rate, channels);
                            },
                            err_callback,
                            None,
                        )
                    }
                    _ => {
                        let _ = init_tx.send(Err(format!(
                            "Unsupported microphone sample format: {sample_format:?}"
                        )));
                        is_running_worker.store(false, Ordering::SeqCst);
                        return;
                    }
                };

                match stream_res {
                    Ok(stream) => {
                        if let Err(e) = stream.play() {
                            let _ = init_tx.send(Err(format!("Failed to play microphone stream: {e}")));
                            is_running_worker.store(false, Ordering::SeqCst);
                            return;
                        }

                        let _ = init_tx.send(Ok(()));

                        // Block worker thread until stop signal is sent
                        let _ = stop_rx.recv();
                        let _ = stream.pause();
                        drop(stream);
                        is_running_worker.store(false, Ordering::SeqCst);
                    }
                    Err(e) => {
                        let _ = init_tx.send(Err(format!("Failed to build microphone stream: {e}")));
                        is_running_worker.store(false, Ordering::SeqCst);
                    }
                }
            })
            .map_err(|e| format!("Failed to spawn microphone stream thread: {e}"))?;

        // Wait for worker initialization
        init_rx
            .recv()
            .map_err(|e| format!("Microphone stream worker initialization failed: {e}"))??;

        Ok(Self {
            stop_tx: Some(stop_tx),
            is_running,
        })
    }

    /// Stops the microphone stream immediately
    pub fn stop(&mut self) {
        self.is_running.store(false, Ordering::SeqCst);
        if let Some(tx) = self.stop_tx.take() {
            let _ = tx.send(());
        }
    }

    /// Returns whether the microphone capture is active
    pub fn is_running(&self) -> bool {
        self.is_running.load(Ordering::SeqCst)
    }
}

impl Drop for MicAudioCapture {
    fn drop(&mut self) {
        self.stop();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_convert_i16_to_f32() {
        let i16_samples = vec![0, 32767, -32768, 16384];
        let f32_samples = convert_i16_to_f32(&i16_samples);
        assert_eq!(f32_samples.len(), 4);
        assert_eq!(f32_samples[0], 0.0);
        assert!((f32_samples[1] - 1.0).abs() < 0.001);
        assert!((f32_samples[2] - (-1.0)).abs() < 0.001);
        assert!((f32_samples[3] - 0.5).abs() < 0.001);
    }

    #[test]
    fn test_convert_u16_to_f32() {
        let u16_samples = vec![32768, 65535, 0];
        let f32_samples = convert_u16_to_f32(&u16_samples);
        assert_eq!(f32_samples.len(), 3);
        assert_eq!(f32_samples[0], 0.0);
        assert!((f32_samples[1] - 1.0).abs() < 0.001);
        assert!((f32_samples[2] - (-1.0)).abs() < 0.001);
    }

    #[test]
    fn test_cpal_host_and_device_query() {
        // Querying default host and input device must not panic
        let host = cpal::default_host();
        let _maybe_device = host.default_input_device();
    }

    #[test]
    fn test_to_dbfs_levels() {
        assert_eq!(to_dbfs(0.0), -100.0, "silence");
        assert_eq!(to_dbfs(1.0), 0.0, "full scale");
        assert!((to_dbfs(0.5) - (-6.02)).abs() < 0.01, "half amplitude is about -6 dB");
        assert_eq!(to_dbfs(2.0), 0.0, "over full scale clamps to 0");
    }

    #[test]
    fn test_mic_level_window_emits_once_per_33ms() {
        // Stereo at 48 kHz: one 33 ms window is 3168 interleaved samples
        let mut window = MicLevelWindow::default();
        let callback = vec![0.1f32; 512];
        let emitted = (0..(48000 * 2 / 512)).filter(|_| window.push(&callback, 48000, 2).is_some()).count();
        assert_eq!(emitted, 30, "one second of audio gives about 30 readings");
    }

    #[test]
    fn test_mic_level_window_reports_rms_and_peak() {
        // Mono at 16 kHz: a window is 528 samples. A single full-scale sample has peak 0 dB but low RMS.
        let mut window = MicLevelWindow::default();
        let mut samples = vec![0.0f32; 527];
        samples.push(1.0);
        let (rms_db, peak_db) = window.push(&samples, 16000, 1).expect("window completes");
        assert_eq!(peak_db, 0.0);
        assert!((rms_db - (-27.2)).abs() < 0.1, "one spike in 528 samples is about -27 dB RMS, got {rms_db}");

        let silence = vec![0.0f32; 528];
        assert_eq!(window.push(&silence, 16000, 1), Some((-100.0, -100.0)));
    }
}
