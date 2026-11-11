//! Preferencias compartidas. El navegador aporta almacenamiento y eventos.
use regex::Regex;
use serde_json::{json, Map, Value};
use std::sync::LazyLock;

pub use crate::preferences_schema::{metadata, schema};

pub fn defaults(node: &Value) -> Value {
    if node["kind"].is_string() {
        return node["def"].clone();
    }
    node.as_object()
        .map(|children| {
            Value::Object(
                children
                    .iter()
                    .map(|(key, child)| (key.clone(), defaults(child)))
                    .collect(),
            )
        })
        .unwrap_or(Value::Null)
}

fn bounded(value: &Value, node: &Value) -> Value {
    value
        .as_f64()
        .filter(|n| n.is_finite())
        .map(|n| json!(n.clamp(node["min"].as_f64().unwrap(), node["max"].as_f64().unwrap())))
        .unwrap_or_else(|| node["def"].clone())
}

fn unique_allowed(value: &Value, allowed: &Value) -> Vec<Value> {
    let mut result = Vec::new();
    if let (Some(given), Some(allowed)) = (value.as_array(), allowed.as_array()) {
        for item in given {
            if allowed.contains(item) && !result.contains(item) {
                result.push(item.clone());
            }
        }
    }
    result
}

fn truncate(text: &str, maximum: usize) -> String {
    let mut units = 0;
    text.chars()
        .take_while(|c| {
            units += c.len_utf16();
            units <= maximum
        })
        .collect()
}

pub fn sanitize(value: &Value, node: &Value) -> Value {
    let fallback = || node["def"].clone();
    match node["kind"].as_str() {
        Some("bool") => {
            if value.is_boolean() {
                value.clone()
            } else {
                fallback()
            }
        }
        Some("num") => bounded(value, node),
        Some("enum") => {
            if node["values"]
                .as_array()
                .is_some_and(|items| items.contains(value))
            {
                value.clone()
            } else {
                fallback()
            }
        }
        Some("color") => {
            static COLOR: LazyLock<Regex> =
                LazyLock::new(|| Regex::new(r"^#[0-9a-fA-F]{6}$").unwrap());
            value
                .as_str()
                .filter(|s| COLOR.is_match(s))
                .map(|s| json!(s.to_lowercase()))
                .unwrap_or_else(fallback)
        }
        Some("combo") => {
            static COMBO: LazyLock<Regex> = LazyLock::new(|| {
                Regex::new(
                r"^(?:(?:Ctrl|Alt|Shift|Super)\+)*(?:Key[A-Z]|Digit[0-9]|F[0-9]{1,2}|Arrow(?:Up|Down|Left|Right)|Space|Enter|Tab|Backspace|Delete|Home|End|PageUp|PageDown|Insert|Minus|Equal|Comma|Period|Slash|Semicolon|Quote|Backquote|BracketLeft|BracketRight|Backslash|Numpad[A-Za-z0-9_]+|Media[A-Za-z0-9_]+|AudioVolume[A-Za-z0-9_]+)$"
            ).unwrap()
            });
            value
                .as_str()
                .filter(|s| s.is_empty() || COMBO.is_match(s))
                .map(|s| json!(s))
                .unwrap_or_else(fallback)
        }
        Some("text") => value
            .as_str()
            .map(|s| json!(truncate(s, node["max"].as_u64().unwrap() as usize)))
            .unwrap_or_else(fallback),
        Some("order") => {
            let mut items = unique_allowed(value, &node["values"]);
            for item in node["values"].as_array().unwrap() {
                if !items.contains(item) {
                    items.push(item.clone());
                }
            }
            json!(items)
        }
        Some("subset") => {
            if value.is_array() {
                json!(unique_allowed(value, &node["values"]))
            } else {
                fallback()
            }
        }
        Some("numList") => {
            let count = node["len"].as_u64().unwrap() as usize;
            let limits = json!({"min":node["min"],"max":node["max"],"def":0});
            Value::Array((0..count).map(|i| bounded(&value[i], &limits)).collect())
        }
        Some("list") => {
            let mut result = Vec::new();
            let mut seen = std::collections::HashSet::new();
            for item in value.as_array().into_iter().flatten() {
                let mut clean = sanitize(item, &node["item"]);
                let name = clean
                    .as_str()
                    .or_else(|| clean["name"].as_str())
                    .unwrap_or("")
                    .trim()
                    .to_owned();
                if name.is_empty() || !seen.insert(name.to_lowercase()) {
                    continue;
                }
                if clean.is_string() {
                    clean = json!(name);
                } else {
                    clean["name"] = json!(name);
                }
                result.push(clean);
                if result.len() >= node["max"].as_u64().unwrap() as usize {
                    break;
                }
            }
            json!(result)
        }
        Some(_) => fallback(),
        None => Value::Object(
            node.as_object()
                .into_iter()
                .flatten()
                .map(|(key, child)| (key.clone(), sanitize(&value[key], child)))
                .collect(),
        ),
    }
}

pub fn migrate(value: &Value) -> Value {
    let mut result = value.clone();
    if let Some(eq) = value
        .pointer("/sound/eq")
        .filter(|eq| eq.is_object() || eq.is_array())
    {
        let number = |key: &str| eq[key].as_f64().unwrap_or(0.0);
        let (low, mid, high) = (number("low"), number("mid"), number("high"));
        if let Some(sound) = result["sound"].as_object_mut() {
            sound.remove("eq");
            sound.insert(
                "bands".into(),
                json!([low, low, low, low, mid, mid, mid, high, high, high]),
            );
        }
    }
    result
}

pub fn merge(base: &Value, over: &Value) -> Value {
    let definition = schema();
    let mut merged = Map::new();
    for section in definition.as_object().unwrap().keys() {
        let mut values = base[section].as_object().cloned().unwrap_or_default();
        values.extend(over[section].as_object().cloned().unwrap_or_default());
        merged.insert(section.clone(), Value::Object(values));
    }
    sanitize(&migrate(&Value::Object(merged)), &definition)
}

pub const LEGACY_KEYS: [&str; 6] = [
    "antares.sound",
    "antares.volume",
    "antares.modes",
    "antares.discovery",
    "antares.sidetab",
    "antares.tray",
];

fn legacy_truthy(value: &Value) -> bool {
    match value {
        Value::Null => false,
        Value::Bool(value) => *value,
        Value::Number(value) => value.as_f64().is_some_and(|value| value != 0.0),
        Value::String(value) => !value.is_empty(),
        _ => true,
    }
}

pub fn from_legacy(values: &Value) -> Value {
    let read = |key: &str| {
        values[key]
            .as_str()
            .and_then(|s| serde_json::from_str::<Value>(s).ok())
            .unwrap_or(Value::Null)
    };
    let mut found = Map::new();
    for (key, section) in [
        ("antares.sound", "sound"),
        ("antares.discovery", "discovery"),
    ] {
        let value = read(key);
        if legacy_truthy(&value) {
            found.insert(section.into(), value);
        }
    }
    let volume = read("antares.volume");
    let modes = read("antares.modes");
    if legacy_truthy(&volume) || legacy_truthy(&modes) {
        let mut playback = volume.as_object().cloned().unwrap_or_default();
        playback.extend(modes.as_object().cloned().unwrap_or_default());
        found.insert("playback".into(), Value::Object(playback));
    }
    if let Some(side @ ("lyrics" | "upnext")) = values["antares.sidetab"].as_str() {
        found.insert("interface".into(), json!({"sideTab":side}));
    }
    if let Some(tray @ ("on" | "off")) = values["antares.tray"].as_str() {
        found.insert("system".into(), json!({"closeToTray":tray == "on"}));
    }
    Value::Object(found)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn old_equalizer_and_invalid_imports_use_the_shared_schema() {
        let clean = merge(
            &json!({"sound":{"eq":{"low":18,"mid":-3,"high":2}}}),
            &Value::Null,
        );
        assert_eq!(
            clean["sound"]["bands"],
            json!([12.0, 12.0, 12.0, 12.0, -3.0, -3.0, -3.0, 2.0, 2.0, 2.0])
        );
        assert_eq!(
            merge(&json!({"playback":{"volume":"0.5"}}), &Value::Null)["playback"]["volume"],
            0.8
        );
    }
    #[test]
    fn presets_and_orders_are_deduplicated_and_unknown_keys_discarded() {
        let value = json!({"sound":{"userPresets":[{"name":" Rock "},{"name":"rock"},{"name":""}]},"layout":{"tabOrder":["queue","queue","bogus"]},"unknown":true});
        let clean = merge(&value, &Value::Null);
        assert_eq!(clean["sound"]["userPresets"].as_array().unwrap().len(), 1);
        assert_eq!(clean["layout"]["tabOrder"][0], "queue");
        assert!(clean.get("unknown").is_none());
    }
}
