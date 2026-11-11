//! Arranques del paquete QA. Cada medición termina ese proceso de prueba.
use serde_json::json;
use std::{
    fs,
    io::{BufRead, BufReader},
    path::Path,
    process::{Command, Stdio},
    sync::mpsc,
    time::Duration,
};

pub fn run(args: &[String]) -> Result<(), Box<dyn std::error::Error>> {
    let [executable, output] = args else {
        return Err("benchmark-startup EJECUTABLE_QA INFORME.json".into());
    };
    // El identificador de QA se comprueba de nuevo en el proceso hijo.
    // Esta herramienta se reserva a una app fuera de las carpetas de instalación.
    let executable = Path::new(executable).canonicalize()?;
    if !executable.to_string_lossy().contains(".noindex") {
        return Err("Usa un paquete QA dentro de la carpeta de auditoría .noindex".into());
    }
    let mut samples = Vec::new();
    for _ in 0..20 {
        let mut child = Command::new(&executable)
            .env("ANTARES_MEASURE_STARTUP", "1")
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()?;
        let stdout = child.stdout.take().ok_or("El proceso no tiene salida")?;
        let (send, receive) = mpsc::channel();
        let reader = std::thread::spawn(move || {
            for line in BufReader::new(stdout).lines().map_while(Result::ok) {
                if let Some(value) = line.strip_prefix("ANTARES_BENCHMARK_READY=") {
                    let _ = send.send(value.parse::<f64>());
                    break;
                }
            }
        });
        let measurement = receive.recv_timeout(Duration::from_secs(30));
        let _ = child.kill();
        let _ = child.wait();
        let _ = reader.join();
        let value = measurement??;
        if !value.is_finite() || value < 0.0 {
            return Err("Tiempo de arranque inválido".into());
        }
        samples.push(value);
    }
    let report = json!({
        "system":std::env::consts::OS,"architecture":std::env::consts::ARCH,
        "scope":"20 arranques de proceso QA hasta completar main.js. Cachés del sistema operativo reutilizadas.",
        "milliseconds":antares_core::diagnostics::summary(samples.iter().copied()),
        "samples":samples
    });
    fs::write(output, serde_json::to_vec_pretty(&report)?)?;
    Ok(())
}
