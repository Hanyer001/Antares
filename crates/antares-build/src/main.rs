//! Genera el motor WebAssembly para Tauri, la PWA y las pruebas.
use std::{
    env, fs,
    path::Path,
    process::{Command, ExitCode},
};

mod release;
mod benchmark;

const BINDGEN_VERSION: &str = "0.2.130";

fn main() -> ExitCode {
    let args: Vec<String> = env::args().skip(1).collect();
    let result = if args.is_empty() {
        build_engine()
    } else if args.first().is_some_and(|arg| arg == "benchmark-startup") {
        benchmark::run(&args[1..])
    } else {
        release::run(&Path::new(env!("CARGO_MANIFEST_DIR")).join("../.."), &args)
    };
    match result {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("{error}");
            ExitCode::FAILURE
        }
    }
}

fn build_engine() -> Result<(), Box<dyn std::error::Error>> {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
    let target =
        root.join(env::var_os("CARGO_TARGET_DIR").unwrap_or_else(|| "src-tauri/target".into()));
    let output = root.join("src/engine");
    let bindgen = Command::new("wasm-bindgen").arg("--version").output();
    let expected = format!("wasm-bindgen {BINDGEN_VERSION}");
    if !bindgen.is_ok_and(|value| {
        value.status.success() && String::from_utf8_lossy(&value.stdout).trim() == expected
    }) {
        return Err(format!(
            "Instala {expected} con cargo install wasm-bindgen-cli --version {BINDGEN_VERSION} --locked"
        ).into());
    }

    let cargo = env::var_os("CARGO").unwrap_or_else(|| "cargo".into());
    run(
        Command::new(cargo)
            .current_dir(&root)
            .args([
                "build",
                "--locked",
                "--release",
                "-p",
                "antares-ui",
                "--target",
                "wasm32-unknown-unknown",
            ])
            .arg("--target-dir")
            .arg(&target),
        "compilar antares-ui para WebAssembly",
    )?;

    fs::create_dir_all(&output)?;
    run(
        Command::new("wasm-bindgen")
            .args(["--target", "web", "--no-typescript", "--out-dir"])
            .arg(output)
            .args(["--out-name", "antares_core"])
            .arg(target.join("wasm32-unknown-unknown/release/antares_ui.wasm")),
        "generar el módulo del navegador",
    )
}

fn run(command: &mut Command, step: &str) -> Result<(), Box<dyn std::error::Error>> {
    let status = command.status()?;
    if status.success() {
        Ok(())
    } else {
        Err(format!("No se pudo {step}: {status}.").into())
    }
}
