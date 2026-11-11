//! Verificar y preparar una entrega firmada sin publicarla.
use base64::{engine::general_purpose::STANDARD, Engine};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    fs,
    path::{Path, PathBuf},
    process::Command,
};

type Result<T> = std::result::Result<T, Box<dyn std::error::Error>>;

fn read_json(path: &Path) -> Result<Value> {
    Ok(serde_json::from_slice(&fs::read(path)?)?)
}
fn hash(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

pub fn check(root: &Path) -> Result<String> {
    let config = read_json(&root.join("src-tauri/tauri.conf.json"))?;
    let package = read_json(&root.join("package.json"))?;
    let npm_lock = read_json(&root.join("package-lock.json"))?;
    let cargo: toml::Value =
        toml::from_str(&fs::read_to_string(root.join("src-tauri/Cargo.toml"))?)?;
    let lock: toml::Value = toml::from_str(&fs::read_to_string(root.join("Cargo.lock"))?)?;
    let version = config["version"]
        .as_str()
        .ok_or("Falta la versión de Tauri")?;
    semver::Version::parse(version)?;
    let rust_lock_version = lock["package"]
        .as_array()
        .ok_or("Cargo.lock sin paquetes")?
        .iter()
        .find(|p| p["name"].as_str() == Some("antares"))
        .and_then(|p| p["version"].as_str());
    for (name, other) in [
        ("package.json", package["version"].as_str()),
        ("package-lock.json", npm_lock["version"].as_str()),
        (
            "package-lock.json raíz",
            npm_lock["packages"][""]["version"].as_str(),
        ),
        ("Cargo.toml", cargo["package"]["version"].as_str()),
        ("Cargo.lock", rust_lock_version),
    ] {
        if other != Some(version) {
            return Err(format!("La versión de {name} difiere de {version}").into());
        }
    }
    if config["identifier"] != "com.hanyer.antares" || config["productName"] != "Antares" {
        return Err("La entrega debe conservar el identificador y nombre de Antares".into());
    }
    Ok(version.into())
}

fn decode(value: &str) -> Result<String> {
    Ok(String::from_utf8(STANDARD.decode(value.trim())?)?)
}

fn verify(bytes: &[u8], public: &str, signature: &str) -> Result<()> {
    let key = minisign_verify::PublicKey::decode(&decode(public)?)?;
    let signature = minisign_verify::Signature::decode(&decode(signature)?)?;
    key.verify(bytes, &signature, true)?;
    Ok(())
}

fn git(root: &Path, args: &[&str]) -> Result<String> {
    let output = Command::new("git").current_dir(root).args(args).output()?;
    if !output.status.success() {
        return Err("No se pudo identificar la revisión de Git".into());
    }
    Ok(String::from_utf8(output.stdout)?.trim().into())
}

fn stage(
    root: &Path,
    target: &str,
    artifact: &Path,
    destination: &Path,
    notes: &Path,
) -> Result<()> {
    let version = check(root)?;
    let filename = match target {
        "windows-x86_64" => format!("Antares_{version}_x64-setup.exe"),
        "darwin-aarch64" => "Antares.app.tar.gz".into(),
        _ => return Err("Destino no admitido. Usa windows-x86_64 o darwin-aarch64".into()),
    };
    if artifact.file_name().and_then(|s| s.to_str()) != Some(&filename) {
        return Err(format!("El paquete esperado para {target} es {filename}").into());
    }
    let bytes = fs::read(artifact)?;
    let signature = fs::read_to_string(PathBuf::from(format!("{}.sig", artifact.display())))?;
    let config = read_json(&root.join("src-tauri/tauri.conf.json"))?;
    verify(
        &bytes,
        config["plugins"]["updater"]["pubkey"]
            .as_str()
            .ok_or("Falta clave pública")?,
        &signature,
    )?;
    if !git(root, &["status", "--porcelain"])?.is_empty() {
        return Err("Guarda la revisión en Git antes de preparar una entrega".into());
    }
    let revision = git(root, &["rev-parse", "HEAD"])?;
    let lock_hash = hash(&fs::read(root.join("Cargo.lock"))?);
    let notes = fs::read_to_string(notes)?;
    let manifest = json!({
        "version":version, "notes":notes,
        "platforms":{target:{
            "signature":signature.trim(),
            "url":format!("https://github.com/Hanyer001/antares-actualizaciones/releases/download/v{version}/{filename}")
        }}
    });
    // Un destino nuevo evita dejar una entrega anterior mezclada con un intento fallido.
    let parent = destination.parent().ok_or("Elige una carpeta de destino")?;
    fs::create_dir_all(parent)?;
    let staging = destination.with_extension("pending");
    fs::create_dir(&staging)?;
    let result = (|| -> Result<()> {
        fs::write(staging.join(&filename), &bytes)?;
        fs::write(staging.join(format!("{filename}.sig")), signature)?;
        fs::write(
            staging.join("latest.json"),
            serde_json::to_vec_pretty(&manifest)?,
        )?;
        fs::write(
            staging.join("SHA256SUMS"),
            format!("{}  {filename}\n", hash(&bytes)),
        )?;
        fs::write(staging.join("notes.md"), notes)?;
        fs::write(
            staging.join("revision.json"),
            serde_json::to_vec_pretty(&json!({
                "version":version,"revision":revision,"target":target,"cargoLockSha256":lock_hash,
                "artifactSha256":hash(&bytes),"signatureVerified":true
            }))?,
        )?;
        if destination.exists() {
            return Err("El destino ya existe".into());
        }
        fs::rename(&staging, destination)?;
        Ok(())
    })();
    if result.is_err() {
        let _ = fs::remove_dir_all(&staging);
    }
    result
}

fn merge_manifests(root: &Path, destination: &Path, directories: &[String]) -> Result<()> {
    let version = check(root)?;
    let config = read_json(&root.join("src-tauri/tauri.conf.json"))?;
    let public = config["plugins"]["updater"]["pubkey"]
        .as_str()
        .ok_or("Falta clave pública")?;
    let mut platforms = serde_json::Map::new();
    let mut identity = None;
    let mut notes = None;
    for directory in directories {
        let directory = Path::new(directory);
        let manifest = read_json(&directory.join("latest.json"))?;
        let revision = read_json(&directory.join("revision.json"))?;
        let current = (
            revision["revision"].clone(),
            revision["cargoLockSha256"].clone(),
        );
        if manifest["version"] != version || revision["version"] != version {
            return Err("Los manifiestos corresponden a versiones distintas".into());
        }
        if identity
            .as_ref()
            .is_some_and(|previous| previous != &current)
        {
            return Err("Los paquetes corresponden a revisiones o Cargo.lock distintos".into());
        }
        identity = Some(current);
        if notes
            .as_ref()
            .is_some_and(|previous| previous != &manifest["notes"])
        {
            return Err("Las notas de los paquetes difieren".into());
        }
        notes = Some(manifest["notes"].clone());
        let entries = manifest["platforms"]
            .as_object()
            .ok_or("Manifiesto sin plataformas")?;
        if entries.len() != 1 {
            return Err("Cada carpeta debe contener una sola plataforma verificada".into());
        }
        for (target, entry) in entries {
            let filename = match target.as_str() {
                "windows-x86_64" => format!("Antares_{version}_x64-setup.exe"),
                "darwin-aarch64" => "Antares.app.tar.gz".into(),
                _ => return Err("Plataforma no admitida".into()),
            };
            if platforms.contains_key(target) {
                return Err("Plataforma repetida".into());
            }
            let expected = format!("https://github.com/Hanyer001/antares-actualizaciones/releases/download/v{version}/{filename}");
            if entry["url"] != expected {
                return Err("La URL del paquete no corresponde a esta entrega".into());
            }
            let bytes = fs::read(directory.join(&filename))?;
            verify(
                &bytes,
                public,
                entry["signature"].as_str().ok_or("Paquete sin firma")?,
            )?;
            if revision["artifactSha256"] != hash(&bytes) || revision["target"] != *target {
                return Err("El paquete difiere de su registro".into());
            }
            platforms.insert(target.clone(), entry.clone());
        }
    }
    if platforms.is_empty() {
        return Err("Indica las carpetas de entrega".into());
    }
    let file = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(destination)?;
    serde_json::to_writer_pretty(
        file,
        &json!({"version":version,"notes":notes,"platforms":platforms}),
    )?;
    Ok(())
}

pub fn run(root: &Path, args: &[String]) -> Result<()> {
    match args {
        [command] if command == "release-check" => {
            println!("Antares {} · versiones coherentes", check(root)?);
            Ok(())
        }
        [command, output, directories @ ..] if command == "release-merge" =>
            merge_manifests(root, Path::new(output), directories),
        [command, target, artifact, output, notes] if command == "release-stage" =>
            stage(root, target, Path::new(artifact), Path::new(output), Path::new(notes)),
        _ => Err("Usa release-check, release-stage DESTINO PAQUETE CARPETA NOTAS.md o release-merge SALIDA.json CARPETAS…".into()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_modified_or_wrongly_signed_payloads() {
        let public = include_str!("fixtures/update.pub");
        let signature = include_str!("fixtures/update.signature");
        let bytes = include_bytes!("fixtures/update.payload");
        verify(bytes, public, signature).unwrap();
        let mut altered = bytes.to_vec();
        altered[0] ^= 1;
        assert!(verify(&altered, public, signature).is_err());
        assert!(verify(bytes, public, "incomplete").is_err());
    }
    #[test]
    fn stages_both_targets_and_merges_only_matching_verified_packages() {
        use std::sync::atomic::{AtomicU64, Ordering};
        static SEQUENCE: AtomicU64 = AtomicU64::new(0);
        let root = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../src-tauri/target/release-qa-tests")
            .join(format!(
                "{}-{}",
                std::process::id(),
                SEQUENCE.fetch_add(1, Ordering::Relaxed)
            ));
        fs::create_dir_all(root.join("src-tauri")).unwrap();
        let public = include_str!("fixtures/update.pub");
        fs::write(
            root.join("src-tauri/tauri.conf.json"),
            json!({
                "version":"0.3.3","identifier":"com.hanyer.antares","productName":"Antares",
                "plugins":{"updater":{"pubkey":public}}
            })
            .to_string(),
        )
        .unwrap();
        fs::write(root.join("package.json"), r#"{"version":"0.3.3"}"#).unwrap();
        fs::write(
            root.join("package-lock.json"),
            r#"{"version":"0.3.3","packages":{"":{"version":"0.3.3"}}}"#,
        )
        .unwrap();
        fs::write(
            root.join("src-tauri/Cargo.toml"),
            "[package]\nname='antares'\nversion='0.3.3'\n",
        )
        .unwrap();
        fs::write(
            root.join("Cargo.lock"),
            "[[package]]\nname='antares'\nversion='0.3.3'\n",
        )
        .unwrap();
        fs::write(root.join(".gitignore"), "/bundles/\n/outputs/\n").unwrap();
        fs::write(root.join("notes.md"), "Prueba de entrega").unwrap();
        git(&root, &["init", "--quiet"]).unwrap();
        git(&root, &["add", "."]).unwrap();
        git(
            &root,
            &[
                "-c",
                "user.name=Antares QA",
                "-c",
                "user.email=qa@localhost",
                "commit",
                "--quiet",
                "-m",
                "fixture",
            ],
        )
        .unwrap();
        fs::create_dir(root.join("bundles")).unwrap();
        fs::create_dir(root.join("outputs")).unwrap();

        let mut directories = Vec::new();
        for (target, name) in [
            ("windows-x86_64", "Antares_0.3.3_x64-setup.exe"),
            ("darwin-aarch64", "Antares.app.tar.gz"),
        ] {
            let artifact = root.join("bundles").join(name);
            fs::write(&artifact, include_bytes!("fixtures/update.payload")).unwrap();
            fs::write(
                root.join("bundles").join(format!("{name}.sig")),
                include_str!("fixtures/update.signature"),
            )
            .unwrap();
            let output = root.join("outputs").join(target);
            stage(&root, target, &artifact, &output, &root.join("notes.md")).unwrap();
            assert!(stage(&root, target, &artifact, &output, &root.join("notes.md")).is_err());
            let manifest = read_json(&output.join("latest.json")).unwrap();
            assert!(manifest["platforms"].get(target).is_some());
            directories.push(output.to_string_lossy().into_owned());
        }
        let merged = root.join("outputs/latest.json");
        merge_manifests(&root, &merged, &directories).unwrap();
        assert_eq!(
            read_json(&merged).unwrap()["platforms"]
                .as_object()
                .unwrap()
                .len(),
            2
        );
        fs::write(
            Path::new(&directories[0]).join("Antares_0.3.3_x64-setup.exe"),
            b"altered",
        )
        .unwrap();
        let rejected = root.join("outputs/rejected.json");
        assert!(merge_manifests(&root, &rejected, &directories).is_err());
        assert!(!rejected.exists());
        fs::write(root.join("package.json"), r#"{"version":"0.3.4"}"#).unwrap();
        assert!(check(&root).is_err());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn package_versions_match_the_lockfiles() {
        check(&Path::new(env!("CARGO_MANIFEST_DIR")).join("../..")).unwrap();
    }
}
