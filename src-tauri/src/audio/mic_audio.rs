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

/// Microphone capture session handle
pub struct MicAudioCapture {
    stop_tx: Option<Sender<()>>,
    is_running: Arc<AtomicBool>,
}

impl MicAudioCapture {
    /// Starts capturing microphone audio from the default input device on a dedicated worker thread.
    ///
    /// The callback receives chunks of normalized float32 samples, along with the device's
    /// native sample rate and channel count.
    pub fn start<F>(on_audio: F) -> Result<Self, String>
    where
        F: Fn(&[f32], u32, u16) + Send + Sync + 'static,
    {
        let host = cpal::default_host();
        let device = host
            .default_input_device()
            .ok_or_else(|| "No default microphone input device found on the system".to_string())?;

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
}
