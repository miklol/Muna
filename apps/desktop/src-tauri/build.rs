fn main() {
    // tauri-build embeds the Windows application manifest (Common Controls v6) into the main
    // binary only. Test executables link the same Tauri code, which imports comctl32 v6 entry
    // points such as `TaskDialogIndirect`; without the manifest the loader picks comctl32 v5
    // and every test binary aborts with STATUS_ENTRYPOINT_NOT_FOUND before running a test.
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows") {
        println!("cargo:rustc-link-arg-tests=/MANIFEST:EMBED");
        println!(
            "cargo:rustc-link-arg-tests=/MANIFESTDEPENDENCY:type='win32' \
             name='Microsoft.Windows.Common-Controls' version='6.0.0.0' \
             processorArchitecture='*' publicKeyToken='6595b64144ccf1df' language='*'"
        );
    }

    tauri_build::build();
}
