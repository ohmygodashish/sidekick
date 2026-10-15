fn main() {
    #[cfg(target_os = "macos")]
    {
        println!("cargo:rustc-link-lib=framework=ScreenCaptureKit");
        println!("cargo:rustc-link-lib=framework=CoreMedia");
        println!("cargo:rustc-link-lib=framework=AVFoundation");
        println!("cargo:rustc-link-lib=framework=CoreAudio");
        println!("cargo:rustc-link-lib=framework=CoreGraphics");

        cc::Build::new()
            .file("src/audio/sck_audio_bridge.m")
            .flag("-fobjc-arc")
            .compile("sck_audio_bridge");
    }

    tauri_build::build();
}
