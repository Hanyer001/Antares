//! Medición explícita con servicios reales. No se ejecuta en la suite normal.
use crate::{cache::AppCache, commands, source, ytmusic};
use antares_core::diagnostics::Measurements;
use std::{
    collections::BTreeMap,
    time::{Duration, Instant},
};

#[tokio::test]
#[ignore = "20 búsquedas y descargas reales; configura ANTARES_BENCHMARK_OUTPUT"]
async fn desktop_latency_twenty_samples() {
    let path = std::env::var("ANTARES_BENCHMARK_OUTPUT").expect("ANTARES_BENCHMARK_OUTPUT");
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(15))
        .build()
        .unwrap();
    let mut timings: BTreeMap<&str, Measurements> = BTreeMap::new();
    let mut failures = 0;
    for _ in 0..20 {
        let started = Instant::now();
        let (music, video) = tokio::join!(
            ytmusic::search_songs("Talento Yan Block", 8),
            source::search("Talento Yan Block", 5)
        );
        let (Ok(music), Ok(video)) = (music, video) else {
            failures += 1;
            continue;
        };
        if music.is_empty() || video.is_empty() {
            failures += 1;
            continue;
        }
        timings
            .entry("network")
            .or_default()
            .record("search", started.elapsed().as_secs_f64() * 1000.0);
        let cache = AppCache::default();
        let query = &music[0].track.watch_url;
        let started = Instant::now();
        let Ok((track, cached)) = commands::resolve(query, &cache, false).await else {
            failures += 1;
            continue;
        };
        assert!(!cached);
        timings
            .entry("coldAppCache")
            .or_default()
            .record("resolution", started.elapsed().as_secs_f64() * 1000.0);
        let started = Instant::now();
        let Ok(mut response) = client
            .get(&track.url)
            .header("Range", "bytes=0-1023")
            .send()
            .await
        else {
            failures += 1;
            continue;
        };
        if response.status() != reqwest::StatusCode::PARTIAL_CONTENT
            || !matches!(response.chunk().await, Ok(Some(bytes)) if !bytes.is_empty())
        {
            failures += 1;
            continue;
        }
        timings
            .entry("network")
            .or_default()
            .record("firstByte", started.elapsed().as_secs_f64() * 1000.0);
        let started = Instant::now();
        let (_, cached) = commands::resolve(query, &cache, false).await.unwrap();
        assert!(cached);
        timings
            .entry("warmAppCache")
            .or_default()
            .record("resolution", started.elapsed().as_secs_f64() * 1000.0);
    }
    let summaries: BTreeMap<_, _> = timings
        .iter()
        .map(|(key, values)| (key, values.summaries()))
        .collect();
    let report = serde_json::json!({
        "system":std::env::consts::OS,"architecture":std::env::consts::ARCH,
        "revision":env!("ANTARES_REVISION"),"samplesRequested":20,"failures":failures,
        "scope":"Backend. Cache fría de aplicación, conexiones reutilizadas. No mide clic a audio ni WebView.",
        "milliseconds":summaries
    });
    std::fs::write(path, serde_json::to_vec_pretty(&report).unwrap()).unwrap();
    assert_eq!(
        failures, 0,
        "Hay muestras fallidas; no aprobar una comparación incompleta"
    );
}
