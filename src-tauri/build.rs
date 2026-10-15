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
            .flag("-mmacosx-version-min=13.0")
            .flag("-Wno-unguarded-availability-new")
            .compile("sck_audio_bridge");
    }

    tauri_build::build();
}
