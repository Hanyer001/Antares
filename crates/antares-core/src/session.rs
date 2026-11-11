//! Compatibilidad con las sesiones y copias que ya guardó Antares.
use crate::track::SearchResult;
use serde_json::{json, Value};

const MAX_ITEMS: usize = 500;
const KEEP_BEFORE: usize = 50;

fn queue_of(raw: &Value) -> Option<&Value> {
    let queue = raw.get("queue")?;
    queue.get("items")?.as_array()?;
    Some(queue)
}

pub fn read_session(raw: Value) -> Option<Value> {
    queue_of(&raw)?;
    Some(raw)
}

pub fn session_for_storage(mut raw: Value, saved_at: u64) -> Option<Value> {
    let queue = queue_of(&raw)?;
    let items = queue["items"].as_array()?;
    let index = queue["index"].as_i64().unwrap_or(-1);
    let start = if items.len() > MAX_ITEMS {
        index
            .clamp(-1, items.len() as i64 - 1)
            .saturating_sub(KEEP_BEFORE as i64)
            .max(0) as usize
    } else {
        0
    };
    let trimmed: Vec<_> = items.iter().skip(start).take(MAX_ITEMS).cloned().collect();
    let original: Vec<_> = queue["original"]
        .as_array()
        .into_iter()
        .flatten()
        .take(MAX_ITEMS)
        .cloned()
        .collect();
    raw["queue"]["items"] = json!(trimmed);
    raw["queue"]["original"] = json!(original);
    raw["queue"]["index"] = json!(index.saturating_sub(start as i64));
    raw["savedAt"] = json!(saved_at);
    Some(raw)
}

fn clean_track(track: &Value) -> Option<Value> {
    let id = track.get("id")?.as_str()?;
    if id.is_empty()
        || id.len() > 128
        || !id
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || c == b'-' || c == b'_')
    {
        return None;
    }
    let text = |field: &str| {
        track[field]
            .as_str()
            .map(|s| s.chars().take(500).collect::<String>())
    };
    let mut clean = json!({
        "id": id,
        "title": text("title"),
        "uploader": text("uploader"),
        "duration": track["duration"].as_f64().map(|n| n.max(0.0)),
        "thumbnail": track["thumbnail"].as_str().filter(|s| s.starts_with("https://")),
        "watch_url": SearchResult::watch_url_for(id),
        "auto": track["auto"].as_bool().unwrap_or(false),
        "queued": track["queued"].as_bool().unwrap_or(false)
    });
    if let Some(is_music) = track["is_music"].as_bool() {
        clean["is_music"] = json!(is_music);
    }
    Some(clean)
}

pub fn clean_session(raw: &Value) -> Option<Value> {
    let queue = queue_of(raw)?;
    let clean_list = |list: &Value, limit| -> Vec<Value> {
        list.as_array()
            .into_iter()
            .flatten()
            .take(limit)
            .filter_map(clean_track)
            .collect()
    };
    let items = clean_list(&queue["items"], MAX_ITEMS);
    let track = clean_track(&raw["track"]);
    let index = track
        .as_ref()
        .and_then(|track| items.iter().position(|item| item["id"] == track["id"]))
        .map_or(-1, |at| at as i32);
    let mut clean = json!({
        "queue": {
            "items": items,
            "original": clean_list(&queue["original"], MAX_ITEMS),
            "index": index,
            "shuffled": queue["shuffled"].as_bool().unwrap_or(false),
            "artistOnly": queue["artistOnly"].as_bool().unwrap_or(false)
        },
        "track": track,
        "time": raw["time"].as_f64().unwrap_or(0.0).max(0.0),
        "picks": clean_list(&raw["picks"], 3)
    });
    if let Some(mode @ ("off" | "all" | "one")) = raw["repeat"].as_str() {
        clean["repeat"] = json!(mode);
    }
    Some(clean)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn saves_a_window_around_the_current_track_and_keeps_the_modes() {
        let items: Vec<_> = (0..800).map(|id| json!({"id":id.to_string()})).collect();
        let raw = json!({"queue":{"items":items,"original":items,"index":600,"shuffled":true,"artistOnly":true},
            "track":{"id":"600"},"time":72.5,"repeat":"one","picks":[]});
        let saved = session_for_storage(raw, 42).unwrap();
        assert_eq!(saved["queue"]["items"][50]["id"], "600");
        assert_eq!(saved["queue"]["index"], 50);
        assert_eq!(saved["queue"]["original"].as_array().unwrap().len(), 500);
        assert_eq!(saved["savedAt"], 42);
        assert_eq!(saved["time"], 72.5);
        assert_eq!(clean_session(&saved).unwrap()["repeat"], "one");
        assert_eq!(clean_session(&saved).unwrap()["queue"]["artistOnly"], true);
    }
}
