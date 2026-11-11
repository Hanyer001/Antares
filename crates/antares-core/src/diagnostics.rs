//! Muestras numéricas acotadas. El informe no acepta consultas ni URLs.
use serde::Serialize;
use std::collections::{BTreeMap, VecDeque};

pub const LIMIT: usize = 100;

#[derive(Default)]
pub struct Measurements(BTreeMap<String, VecDeque<f64>>);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Summary {
    pub count: usize,
    pub median_ms: f64,
    pub p95_ms: f64,
}

pub fn summary(values: impl IntoIterator<Item = f64>) -> Option<Summary> {
    let mut values: Vec<_> = values
        .into_iter()
        .filter(|n| n.is_finite() && *n >= 0.0)
        .collect();
    values.sort_by(f64::total_cmp);
    let count = values.len();
    if count == 0 {
        return None;
    }
    let median = if count % 2 == 0 {
        (values[count / 2 - 1] + values[count / 2]) / 2.0
    } else {
        values[count / 2]
    };
    Some(Summary {
        count,
        median_ms: median,
        p95_ms: values[(count * 95).div_ceil(100) - 1],
    })
}

impl Measurements {
    pub fn record(&mut self, name: &str, elapsed: f64) {
        if !matches!(
            name,
            "startup" | "search" | "resolution" | "firstByte" | "audioStart" | "libraryRender" | "libraryFilter"
        ) || !elapsed.is_finite()
            || elapsed < 0.0
        {
            return;
        }
        let samples = self.0.entry(name.into()).or_default();
        if samples.len() == LIMIT {
            samples.pop_front();
        }
        samples.push_back(elapsed);
    }

    pub fn summaries(&self) -> BTreeMap<String, Summary> {
        self.0
            .iter()
            .filter_map(|(name, values)| Some((name.clone(), summary(values.iter().copied())?)))
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn report_is_bounded_and_discards_unknown_names_and_bad_numbers() {
        let mut samples = Measurements::default();
        for value in 0..120 {
            samples.record("search", value as f64);
        }
        samples.record("https://example.test/?token=secret", 1.0);
        samples.record("search", f64::NAN);
        samples.record("search", -1.0);
        let result = samples.summaries();
        assert_eq!(result.len(), 1);
        assert_eq!(result["search"].count, LIMIT);
        assert_eq!(result["search"].median_ms, 69.5);
        assert_eq!(result["search"].p95_ms, 114.0);
        assert!(summary([]).is_none());
    }
}
