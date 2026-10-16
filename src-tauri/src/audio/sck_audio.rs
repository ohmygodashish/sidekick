//! Driverless System Audio Ingestion via Apple ScreenCaptureKit (REQ-007, CON-001)
//!
//! Captures system sound and meeting audio (Channel 0: Interviewer) without requiring
//! third-party virtual audio kernel extensions (BlackHole, Loopback, Soundflower).
//!
//! Configuration:
//! - `capturesAudio = true`
//! - `excludesCurrentProcessAudio = true` (excludes Sidekick UI sounds from meeting transcript)
//! - Linear PCM sample delivery to Channel 0 (Interviewer).

use std::ffi::CStr;
use std::os::raw::c_char;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

#[repr(C)]
struct SCKAudioBridgeHandle {
    _private: [u8; 0],
}

type SckAudioCallback = unsafe extern "C" fn(
    samples: *const f32,
    count: u32,
    sample_rate: u32,
    channels: u32,
    context: *mut std::ffi::c_void,
);

extern "C" {
    fn sck_audio_is_supported() -> bool;
    fn sck_audio_has_permission() -> bool;
    fn sck_audio_start(
        sample_rate: u32,
        callback: SckAudioCallback,
        context: *mut std::ffi::c_void,
        err_buf: *mut c_char,
        err_buf_len: usize,
    ) -> *mut SCKAudioBridgeHandle;
    fn sck_audio_stop(handle: *mut SCKAudioBridgeHandle);
    fn CGRequestScreenCaptureAccess() -> bool;
}

/// Error returned when Screen Recording is not allowed (matched by the friendly warning in `mod.rs`)
pub const SCREEN_RECORDING_DENIED: &str = "Screen Recording permission not granted. Please enable Screen Recording for Sidekick in macOS System Settings > Privacy & Security > Screen Recording.";

/// Asks macOS for Screen Recording access once per process, which shows its prompt or lists the app
fn request_screen_capture_access_once() {
    static REQUESTED: AtomicBool = AtomicBool::new(false);
    if !REQUESTED.swap(true, Ordering::SeqCst) {
        unsafe {
            CGRequestScreenCaptureAccess();
        }
    }
}

/// Trampoline function converting C audio buffer callbacks to Rust closures
unsafe extern "C" fn sck_audio_c_trampoline(
    samples: *const f32,
    count: u32,
    sample_rate: u32,
    channels: u32,
    context: *mut std::ffi::c_void,
) {
    if samples.is_null() || count == 0 || context.is_null() {
        return;
    }
    let slice = std::slice::from_raw_parts(samples, count as usize);
    let handler = &*(context as *const Box<dyn Fn(&[f32], u32, u16) + Send + Sync>);
    handler(slice, sample_rate, channels as u16);
}

/// ScreenCaptureKit system audio capture handle
pub struct SckAudioCapture {
    handle: Option<*mut SCKAudioBridgeHandle>,
    is_running: Arc<AtomicBool>,
    // Heap-allocated callback context kept alive for the duration of the stream
    _callback_box: Box<Box<dyn Fn(&[f32], u32, u16) + Send + Sync>>,
}

// Raw pointer handle is thread-safe to send across threads and drop
unsafe impl Send for SckAudioCapture {}
unsafe impl Sync for SckAudioCapture {}

impl SckAudioCapture {
    /// Returns true if the host OS supports ScreenCaptureKit audio capture (macOS 13.0+)
    pub fn is_supported() -> bool {
        unsafe { sck_audio_is_supported() }
    }

    /// Checks if macOS Screen Recording permission has been granted
    pub fn has_permission() -> bool {
        unsafe { sck_audio_has_permission() }
    }

    /// Starts capturing system meeting audio via ScreenCaptureKit.
    ///
    /// The provided callback receives chunks of raw PCM samples with their sample rate and channel count.
    /// If ScreenCaptureKit is unsupported or permission is not granted, returns an informative `Err`.
    pub fn start<F>(sample_rate: u32, on_audio: F) -> Result<Self, String>
    where
        F: Fn(&[f32], u32, u16) + Send + Sync + 'static,
    {
        if !Self::is_supported() {
            return Err("ScreenCaptureKit system audio requires macOS 13.0 (Ventura) or later".to_string());
        }

        if !Self::has_permission() {
            request_screen_capture_access_once();
            return Err(SCREEN_RECORDING_DENIED.to_string());
        }

        let is_running = Arc::new(AtomicBool::new(true));
        let boxed_cb: Box<dyn Fn(&[f32], u32, u16) + Send + Sync> = Box::new(on_audio);
        let callback_container = Box::new(boxed_cb);
        let ctx_ptr = &*callback_container as *const _ as *mut std::ffi::c_void;

        let mut err_buf = [0 as c_char; 512];
        let handle = unsafe {
            sck_audio_start(
                sample_rate,
                sck_audio_c_trampoline,
                ctx_ptr,
                err_buf.as_mut_ptr(),
                err_buf.len(),
            )
        };

        if handle.is_null() {
            let err_msg = unsafe { CStr::from_ptr(err_buf.as_ptr()) }
                .to_string_lossy()
                .into_owned();
            let final_err = if err_msg.trim().is_empty() {
                "Failed to initialize ScreenCaptureKit audio stream".to_string()
            } else {
                err_msg
            };
            return Err(final_err);
        }

        Ok(Self {
            handle: Some(handle),
            is_running,
            _callback_box: callback_container,
        })
    }

    /// Stops the ScreenCaptureKit audio stream immediately
    pub fn stop(&mut self) {
        if let Some(h) = self.handle.take() {
            self.is_running.store(false, Ordering::SeqCst);
            unsafe {
                sck_audio_stop(h);
            }
        }
    }

    /// Returns whether the audio stream is currently active
    pub fn is_running(&self) -> bool {
        self.is_running.load(Ordering::SeqCst)
    }
}

impl Drop for SckAudioCapture {
    fn drop(&mut self) {
        self.stop();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_sck_audio_support_check() {
        // Must report true on macOS 13+ (Ventura, Sonoma, Sequoia)
        let supported = SckAudioCapture::is_supported();
        assert!(supported, "Host macOS system should support ScreenCaptureKit");
    }

    #[test]
    fn test_sck_permission_check_does_not_crash() {
        // Safe check without crashing or hanging
        let _has_perm = SckAudioCapture::has_permission();
    }

    #[test]
    fn test_sck_trampoline_null_safety() {
        // Passing null pointers to C trampoline must safely return without segfaulting
        unsafe {
            sck_audio_c_trampoline(std::ptr::null(), 0, 16000, 1, std::ptr::null_mut());
        }
    }

    #[test]
    fn test_sck_trampoline_invokes_closure() {
        use std::sync::atomic::AtomicUsize;

        let sample_count = Arc::new(AtomicUsize::new(0));
        let count_clone = sample_count.clone();

        let closure: Box<dyn Fn(&[f32], u32, u16) + Send + Sync> = Box::new(move |samples, rate, channels| {
            assert_eq!(rate, 16000);
            assert_eq!(channels, 1);
            count_clone.fetch_add(samples.len(), Ordering::SeqCst);
        });

        let boxed_closure = Box::new(closure);
        let ctx = &*boxed_closure as *const _ as *mut std::ffi::c_void;

        let dummy_samples = vec![0.1f32, 0.2, 0.3, 0.4];
        unsafe {
            sck_audio_c_trampoline(
                dummy_samples.as_ptr(),
                dummy_samples.len() as u32,
                16000,
                1,
                ctx,
            );
        }

        assert_eq!(sample_count.load(Ordering::SeqCst), 4);
    }
}
