//! Adaptador síncrono para el WebView y la PWA. La cola vive en Rust.
use antares_core::queue::{Entry, LoadOptions, Queue, Removal};
use antares_core::session;
use serde::Deserialize;
use serde_json::{json, Value};
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
extern "C" {
    #[wasm_bindgen(js_namespace = Math, js_name = random)]
    fn random() -> f64;
}

fn random_index(len: usize) -> usize {
    (random() * len as f64) as usize
}

#[derive(Deserialize)]
#[serde(tag = "op", content = "args", rename_all = "camelCase")]
enum Action {
    Load(Vec<Entry>, i32, LoadOptions),
    PointAt(String),
    Add(Entry),
    PlayNext(Entry),
    ClearQueued,
    PlayNow(Entry),
    AppendAuto(Vec<Entry>),
    ReplaceUpcomingAuto(Vec<Entry>),
    Remove(String),
    Move(usize, usize),
    RemoveUpcoming(String),
    UndoRemove(Removal),
    Clear,
    Restore(Value),
    SetShuffle(bool),
    SetRepeat(String),
    CycleRepeat,
    Next,
    Prev,
}

#[wasm_bindgen]
pub struct QueueEngine {
    queue: Queue,
}

#[wasm_bindgen]
impl QueueEngine {
    #[wasm_bindgen(constructor)]
    pub fn new() -> Self {
        Self {
            queue: Queue::default(),
        }
    }

    pub fn up_next(&self, limit: usize) -> String {
        json!(self.queue.upcoming(limit)).to_string()
    }

    pub fn view(&self) -> String {
        let queue = &self.queue;
        json!({
            "queue": queue.snapshot(),
            "repeat": queue.repeat(),
            "hasNext": queue.has_next(),
            "hasPrev": queue.has_prev(),
            "peekNext": queue.peek_next(),
            "queuedCount": queue.queued_count(),
            "firstUpcomingAuto": queue.first_upcoming_auto(),
        })
        .to_string()
    }

    pub fn apply(&mut self, input: &str) -> Result<String, JsError> {
        let action: Action =
            serde_json::from_str(input).map_err(|error| JsError::new(&error.to_string()))?;
        let queue = &mut self.queue;
        let (changed, result) = match action {
            Action::Load(items, start, options) => {
                queue.load(items, start, options, &mut random_index);
                (true, Value::Null)
            }
            Action::PointAt(id) => flag(queue.point_at(&id)),
            Action::Add(track) => flag(queue.enqueue(track, false)),
            Action::PlayNext(track) => flag(queue.enqueue(track, true)),
            Action::ClearQueued => (queue.clear_queued(), Value::Null),
            Action::PlayNow(track) => (queue.play_now(track), Value::Null),
            Action::AppendAuto(tracks) => (
                !queue.snapshot().artist_only,
                json!(queue.append_auto(tracks, false)),
            ),
            Action::ReplaceUpcomingAuto(tracks) => (
                !queue.snapshot().artist_only,
                json!(queue.append_auto(tracks, true)),
            ),
            Action::Remove(id) => (queue.remove(&id), Value::Null),
            Action::Move(from, to) => flag(queue.move_pending(from, to)),
            Action::RemoveUpcoming(id) => {
                let removed = queue.remove_upcoming(&id);
                (removed.is_some(), json!(removed))
            }
            Action::UndoRemove(receipt) => flag(queue.undo_remove(receipt)),
            Action::Clear => {
                queue.clear();
                (true, Value::Null)
            }
            Action::Restore(raw) => flag(queue.restore(&raw)),
            Action::SetShuffle(on) => (queue.set_shuffle(on, &mut random_index), Value::Null),
            Action::SetRepeat(mode) => {
                queue.set_repeat(&mode);
                (true, Value::Null)
            }
            Action::CycleRepeat => (true, json!(queue.cycle_repeat())),
            Action::Next => {
                let next = queue.next(&mut random_index);
                (next.is_some(), json!(next))
            }
            Action::Prev => {
                let prev = queue.prev();
                (prev.is_some(), json!(prev))
            }
        };
        Ok(json!({"changed": changed, "result": result}).to_string())
    }
}

fn flag(ok: bool) -> (bool, Value) {
    (ok, json!(ok))
}

#[wasm_bindgen]
pub fn read_session(input: &str) -> String {
    json!(serde_json::from_str(input)
        .ok()
        .and_then(session::read_session))
    .to_string()
}

#[wasm_bindgen]
pub fn clean_session(input: &str) -> String {
    json!(serde_json::from_str(input)
        .ok()
        .and_then(|raw| session::clean_session(&raw)))
    .to_string()
}

#[wasm_bindgen]
pub fn store_session(input: &str, saved_at: f64) -> String {
    json!(serde_json::from_str(input)
        .ok()
        .and_then(|raw| session::session_for_storage(raw, saved_at as u64)))
    .to_string()
}

#[wasm_bindgen]
pub fn matches_search_query(title: &str, query: &str) -> bool {
    antares_core::search_rank::matches_query(title, query)
}

#[wasm_bindgen]
pub fn rank_search(videos: &str, songs: &str, query: &str) -> Result<String, JsError> {
    let parse = |input: &str| {
        serde_json::from_str::<Vec<antares_core::search_rank::SearchTrack>>(input)
            .map_err(|error| JsError::new(&error.to_string()))
    };
    let ranked = antares_core::search_rank::rank_search(&parse(videos)?, &parse(songs)?, query);
    serde_json::to_string(&ranked).map_err(|error| JsError::new(&error.to_string()))
}

#[wasm_bindgen]
pub struct RecoveryEngine {
    recovery: antares_core::recovery::Recovery,
}

#[wasm_bindgen]
impl RecoveryEngine {
    #[wasm_bindgen(constructor)]
    pub fn new() -> Self {
        Self {
            recovery: antares_core::recovery::Recovery::default(),
        }
    }

    pub fn apply(&mut self, input: &str) -> Result<String, JsError> {
        let event =
            serde_json::from_str(input).map_err(|error| JsError::new(&error.to_string()))?;
        let effects = self.recovery.apply(event);
        Ok(json!({ "state": self.recovery, "effects": effects }).to_string())
    }
}

#[wasm_bindgen]
pub fn preferences_metadata() -> String {
    antares_core::preferences::metadata().to_string()
}

#[wasm_bindgen]
pub fn preferences_schema() -> String {
    antares_core::preferences::schema().to_string()
}

#[wasm_bindgen]
pub fn preferences_apply(input: &str) -> Result<String, JsError> {
    use antares_core::preferences;
    let args: Value = serde_json::from_str(input).map_err(|e| JsError::new(&e.to_string()))?;
    let value = &args["value"];
    let node = match args["path"].as_str() {
        Some("") => preferences::schema(),
        Some(path) => {
            let mut node = preferences::schema();
            for key in path.split('.') {
                node = node.get(key).ok_or_else(|| JsError::new("Preferencia desconocida"))?;
            }
            node
        }
        None => &args["node"],
    };
    let result = match args["op"].as_str() {
        Some("defaults") => preferences::defaults(node),
        Some("sanitize") => {
            let value = if args["root"] == true { preferences::migrate(value) } else { value.clone() };
            preferences::sanitize(&value, node)
        }
        Some("migrate") => preferences::migrate(value),
        Some("merge") => preferences::merge(value, &args["over"]),
        Some("legacy") => preferences::from_legacy(value),
        _ => return Err(JsError::new("Operación de preferencias desconocida")),
    };
    Ok(result.to_string())
}

#[wasm_bindgen]
#[derive(Default)]
pub struct PerformanceSamples {
    values: antares_core::diagnostics::Measurements,
}

#[wasm_bindgen]
impl PerformanceSamples {
    #[wasm_bindgen(constructor)]
    pub fn new() -> Self { Self::default() }

    pub fn record(&mut self, name: &str, elapsed: f64) { self.values.record(name, elapsed); }

    pub fn report(&self) -> String {
        serde_json::to_string(&self.values.summaries()).expect("finite measurements")
    }

    pub fn clear(&mut self) { self.values = Default::default(); }
}
