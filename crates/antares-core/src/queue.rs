//! Estado de la cola, independiente del reproductor y del almacenamiento.
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::collections::HashSet;

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Entry {
    pub id: String,
    #[serde(default)]
    pub auto: bool,
    #[serde(default)]
    pub queued: bool,
    #[serde(flatten)]
    metadata: Map<String, Value>,
}

impl Entry {
    fn mark(mut self, auto: bool, queued: bool) -> Self {
        self.auto = auto;
        self.queued = queued;
        self
    }
}

#[derive(Clone, Copy, Default, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Repeat {
    #[default]
    Off,
    All,
    One,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub items: Vec<Entry>,
    pub original: Vec<Entry>,
    pub index: i32,
    pub shuffled: bool,
    pub artist_only: bool,
}

impl Default for Snapshot {
    fn default() -> Self {
        Self {
            items: Vec::new(),
            original: Vec::new(),
            index: -1,
            shuffled: false,
            artist_only: false,
        }
    }
}

#[derive(Default, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct LoadOptions {
    ordered: bool,
    auto: bool,
    artist_only: bool,
}

#[derive(Clone, Serialize, Deserialize)]
struct Anchor {
    before: Option<String>,
    after: Option<String>,
    position: usize,
}

impl Anchor {
    fn at(list: &[Entry], position: Option<usize>) -> Self {
        Self {
            before: position
                .and_then(|i| i.checked_sub(1))
                .and_then(|i| list.get(i))
                .map(|t| t.id.clone()),
            after: list
                .get(position.map_or(0, |i| i + 1))
                .map(|t| t.id.clone()),
            position: position.unwrap_or(0),
        }
    }

    fn insert(&self, list: &mut Vec<Entry>, entry: Entry, min: usize) {
        let at = self
            .after
            .as_ref()
            .and_then(|id| position(list, id))
            .or_else(|| {
                self.before
                    .as_ref()
                    .and_then(|id| position(list, id))
                    .map(|i| i + 1)
            })
            .unwrap_or(self.position);
        list.insert(at.clamp(min, list.len()), entry);
    }
}

#[derive(Clone, Serialize, Deserialize)]
pub struct Removal {
    generation: u64,
    track: Entry,
    #[serde(flatten)]
    active: Anchor,
    original: Anchor,
    #[serde(default)]
    used: bool,
}

#[derive(Default)]
pub struct Queue {
    state: Snapshot,
    repeat: Repeat,
    generation: u64,
}

fn position(list: &[Entry], id: &str) -> Option<usize> {
    list.iter().position(|track| track.id == id)
}

fn pending_end(list: &[Entry], start: usize) -> usize {
    start
        + list[start..]
            .iter()
            .take_while(|track| track.queued)
            .count()
}

fn shuffle(list: &mut [Entry], random_index: &mut impl FnMut(usize) -> usize) {
    for i in (1..list.len()).rev() {
        list.swap(i, random_index(i + 1));
    }
}

fn shuffle_around(
    mut list: Vec<Entry>,
    first: Option<&Entry>,
    random_index: &mut impl FnMut(usize) -> usize,
) -> Vec<Entry> {
    if let Some(first) = first {
        list.retain(|track| track.id != first.id);
        shuffle(&mut list, random_index);
        list.insert(0, first.clone());
    } else {
        shuffle(&mut list, random_index);
    }
    list
}

impl Queue {
    pub fn snapshot(&self) -> &Snapshot {
        &self.state
    }

    fn next_index(&self) -> usize {
        (self.state.index + 1) as usize
    }

    fn pending(&self) -> &[Entry] {
        let start = self.next_index();
        &self.state.items[start..pending_end(&self.state.items, start)]
    }

    fn settle(&mut self) {
        if let Some(track) = self.state.items.get_mut(self.state.index as usize) {
            if track.queued {
                track.queued = false;
                if let Some(at) = position(&self.state.original, &track.id) {
                    self.state.original[at].queued = false;
                }
            }
        }
    }

    fn detach(&mut self, id: &str) {
        if let Some(at) = position(&self.state.items, id) {
            self.state.items.remove(at);
            if at as i32 <= self.state.index {
                self.state.index -= 1;
            }
        }
        self.state.original.retain(|track| track.id != id);
    }

    pub fn load(
        &mut self,
        tracks: Vec<Entry>,
        start: i32,
        options: LoadOptions,
        random_index: &mut impl FnMut(usize) -> usize,
    ) {
        self.generation += 1;
        let pending: Vec<_> = if options.artist_only {
            Vec::new()
        } else {
            let incoming: HashSet<_> = tracks.iter().map(|track| track.id.as_str()).collect();
            self.pending()
                .iter()
                .filter(|track| !incoming.contains(track.id.as_str()))
                .cloned()
                .collect()
        };
        let list: Vec<_> = tracks
            .into_iter()
            .map(|track| track.mark(options.auto, false))
            .collect();
        let start = if list.is_empty() {
            -1
        } else {
            start.clamp(0, list.len() as i32 - 1)
        };
        self.state.artist_only = options.artist_only;
        self.state.index = start;
        if self.state.shuffled {
            self.state.original = list.clone();
            self.state
                .original
                .splice((start + 1) as usize..(start + 1) as usize, pending.clone());
        }
        self.state.items = if self.state.shuffled && !options.ordered {
            let first = list.get(start as usize).cloned();
            self.state.index = if first.is_some() { 0 } else { -1 };
            shuffle_around(list, first.as_ref(), random_index)
        } else {
            list
        };
        let at = self.next_index();
        self.state.items.splice(at..at, pending);
        self.settle();
    }

    pub fn point_at(&mut self, id: &str) -> bool {
        let Some(at) = position(&self.state.items, id) else {
            return false;
        };
        self.state.index = at as i32;
        self.settle();
        true
    }

    pub fn enqueue(&mut self, track: Entry, first: bool) -> bool {
        if track.id.is_empty() || self.current().is_some_and(|current| current.id == track.id) {
            return false;
        }
        self.detach(&track.id);
        self.insert_pending(track.mark(false, true), first);
        true
    }

    fn insert_pending(&mut self, track: Entry, first: bool) {
        let start = self.next_index();
        let at = if first {
            start
        } else {
            pending_end(&self.state.items, start)
        };
        self.state.items.insert(at, track.clone());
        if self.state.shuffled {
            let start = self
                .current()
                .and_then(|current| position(&self.state.original, &current.id))
                .map_or(0, |i| i + 1);
            let at = if first {
                start
            } else {
                pending_end(&self.state.original, start)
            };
            self.state.original.insert(at, track);
        }
    }

    pub fn clear_queued(&mut self) -> bool {
        let gone: HashSet<_> = self
            .pending()
            .iter()
            .map(|track| track.id.clone())
            .collect();
        if gone.is_empty() {
            return false;
        }
        let start = self.next_index();
        let current = self.current().map(|track| track.id.clone());
        let mut at = 0;
        self.state.items.retain(|track| {
            let keep = at < start || !gone.contains(&track.id);
            at += 1;
            keep
        });
        self.state
            .original
            .retain(|track| !gone.contains(&track.id) || current.as_ref() == Some(&track.id));
        true
    }

    pub fn play_now(&mut self, track: Entry) -> bool {
        if track.id.is_empty() {
            return false;
        }
        let was_artist_only = std::mem::take(&mut self.state.artist_only);
        if self.current().is_some_and(|current| current.id == track.id) {
            return was_artist_only;
        }
        self.detach(&track.id);
        self.insert_pending(track.mark(false, false), true);
        self.state.index += 1;
        self.settle();
        true
    }

    pub fn append_auto(&mut self, tracks: Vec<Entry>, replace: bool) -> usize {
        if self.state.artist_only {
            return 0;
        }
        if replace {
            let start = self.next_index();
            let mut at = 0;
            self.state.items.retain(|track| {
                let keep = at < start || !track.auto;
                at += 1;
                keep
            });
            let present: HashSet<_> = self
                .state
                .items
                .iter()
                .map(|track| track.id.as_str())
                .collect();
            self.state
                .original
                .retain(|track| !track.auto || present.contains(track.id.as_str()));
        }
        let mut present: HashSet<_> = self
            .state
            .items
            .iter()
            .map(|track| track.id.clone())
            .collect();
        let fresh: Vec<_> = tracks
            .into_iter()
            .filter(|track| !track.id.is_empty() && present.insert(track.id.clone()))
            .map(|track| track.mark(true, false))
            .collect();
        let added = fresh.len();
        if self.state.shuffled {
            self.state.original.extend(fresh.iter().cloned());
        }
        self.state.items.extend(fresh);
        added
    }

    pub fn remove(&mut self, id: &str) -> bool {
        let Some(at) = position(&self.state.items, id) else {
            return false;
        };
        self.state.items.remove(at);
        self.state.original.retain(|track| track.id != id);
        if (at as i32) < self.state.index {
            self.state.index -= 1;
        }
        self.state.index = self.state.index.min(self.state.items.len() as i32 - 1);
        true
    }

    pub fn move_pending(&mut self, from: usize, to: usize) -> bool {
        let start = self.next_index();
        let list = &mut self.state.items;
        if from == to || from < start || to < start || from >= list.len() || to >= list.len() {
            return false;
        }
        let track = list.remove(from);
        if self.state.shuffled {
            let original = &mut self.state.original;
            original.retain(|entry| entry.id != track.id);
            // Tras quitar 'from', las posiciones a ambos lados del destino
            // son las que rodearán a la pista cuando se inserte.
            let next = list.get(to).and_then(|entry| position(original, &entry.id));
            let previous = to
                .checked_sub(1)
                .and_then(|at| list.get(at))
                .and_then(|entry| position(original, &entry.id));
            original.insert(
                next.or(previous.map(|i| i + 1)).unwrap_or(original.len()),
                track.clone(),
            );
        }
        list.insert(to, track);
        let pending: HashSet<_> = list[start..].iter().map(|entry| entry.id.clone()).collect();
        for entry in list.iter_mut().chain(self.state.original.iter_mut()) {
            if pending.contains(&entry.id) {
                entry.queued = true;
                entry.auto = false;
            }
        }
        true
    }

    pub fn remove_upcoming(&mut self, id: &str) -> Option<Removal> {
        let at = position(&self.state.items, id)?;
        if at < self.next_index() {
            return None;
        }
        let removal = Removal {
            generation: self.generation,
            track: self.state.items[at].clone(),
            active: Anchor::at(&self.state.items, Some(at)),
            original: Anchor::at(&self.state.original, position(&self.state.original, id)),
            used: false,
        };
        self.remove(id);
        Some(removal)
    }

    pub fn undo_remove(&mut self, removal: Removal) -> bool {
        if removal.used
            || removal.generation != self.generation
            || position(&self.state.items, &removal.track.id).is_some()
        {
            return false;
        }
        let start = self.next_index();
        removal
            .active
            .insert(&mut self.state.items, removal.track.clone(), start);
        if self.state.shuffled {
            removal
                .original
                .insert(&mut self.state.original, removal.track, 0);
        }
        true
    }

    pub fn clear(&mut self) {
        self.generation += 1;
        self.state = Snapshot {
            shuffled: self.state.shuffled,
            ..Snapshot::default()
        };
    }

    pub fn restore(&mut self, value: &Value) -> bool {
        let Some(items) = value.get("items").and_then(Value::as_array) else {
            return false;
        };
        self.generation += 1;
        let valid = |list: &[Value]| -> Vec<Entry> {
            list.iter()
                .filter_map(|track| serde_json::from_value::<Entry>(track.clone()).ok())
                .filter(|track| !track.id.is_empty())
                .collect()
        };
        let items = valid(items);
        let mut original = value
            .get("original")
            .and_then(Value::as_array)
            .map_or_else(Vec::new, |list| valid(list));
        let shuffled =
            value.get("shuffled").and_then(Value::as_bool) == Some(true) && !original.is_empty();
        if !shuffled {
            original.clear();
        }
        let index = value
            .get("index")
            .and_then(Value::as_i64)
            .unwrap_or(-1)
            .clamp(-1, items.len() as i64 - 1) as i32;
        let artist_only = value.get("artistOnly").and_then(Value::as_bool) == Some(true);
        self.state = Snapshot {
            items,
            original,
            index,
            shuffled,
            artist_only,
        };
        true
    }

    pub fn set_shuffle(
        &mut self,
        enabled: bool,
        random_index: &mut impl FnMut(usize) -> usize,
    ) -> bool {
        if enabled == self.state.shuffled {
            return false;
        }
        let playing = self.current().cloned();
        let pending = self.pending().to_vec();
        let ids: HashSet<_> = pending.iter().map(|track| track.id.as_str()).collect();
        self.state.shuffled = enabled;
        if enabled {
            self.state.original = self.state.items.clone();
            let mut list = std::mem::take(&mut self.state.items);
            list.retain(|track| !ids.contains(track.id.as_str()));
            self.state.items = shuffle_around(list, playing.as_ref(), random_index);
            self.state.index = if playing.is_some() { 0 } else { -1 };
        } else {
            self.state.items = std::mem::take(&mut self.state.original);
            self.state
                .items
                .retain(|track| !ids.contains(track.id.as_str()));
            self.state.index = playing
                .as_ref()
                .and_then(|track| position(&self.state.items, &track.id))
                .map_or(-1, |at| at as i32);
        }
        let at = self.next_index();
        self.state.items.splice(at..at, pending);
        true
    }

    pub fn repeat(&self) -> Repeat {
        self.repeat
    }

    pub fn set_repeat(&mut self, mode: &str) {
        self.repeat = match mode {
            "all" => Repeat::All,
            "one" => Repeat::One,
            _ => Repeat::Off,
        };
    }

    pub fn cycle_repeat(&mut self) -> Repeat {
        self.repeat = match self.repeat {
            Repeat::Off => Repeat::All,
            Repeat::All => Repeat::One,
            Repeat::One => Repeat::Off,
        };
        self.repeat
    }

    fn current(&self) -> Option<&Entry> {
        self.state.items.get(self.state.index as usize)
    }

    pub fn has_next(&self) -> bool {
        self.next_index() < self.state.items.len()
            || (self.repeat == Repeat::All && self.state.index >= 0)
    }

    pub fn has_prev(&self) -> bool {
        self.state.index > 0 || (self.repeat == Repeat::All && self.state.items.len() > 1)
    }

    pub fn peek_next(&self) -> Option<&Entry> {
        self.state.items.get(self.next_index()).or_else(|| {
            if self.repeat == Repeat::All && !self.state.shuffled && self.state.index >= 0 {
                self.state.items.first()
            } else {
                None
            }
        })
    }

    pub fn next(&mut self, random_index: &mut impl FnMut(usize) -> usize) -> Option<Entry> {
        if !self.has_next() {
            return None;
        }
        if self.next_index() < self.state.items.len() {
            self.state.index += 1;
        } else {
            if self.state.shuffled {
                let last = self.current().map(|entry| entry.id.clone());
                let list = &mut self.state.items;
                shuffle(list, random_index);
                if list.len() > 1 && last.as_ref() == Some(&list[0].id) {
                    let at = 1 + random_index(list.len() - 1);
                    list.swap(0, at);
                }
            }
            self.state.index = 0;
        }
        self.settle();
        self.current().cloned()
    }

    pub fn prev(&mut self) -> Option<Entry> {
        if !self.has_prev() {
            return None;
        }
        self.state.index = if self.state.index > 0 {
            self.state.index - 1
        } else {
            self.state.items.len() as i32 - 1
        };
        self.settle();
        self.current().cloned()
    }

    pub fn upcoming(&self, limit: usize) -> &[Entry] {
        let start = self.next_index().min(self.state.items.len());
        let end = start.saturating_add(limit).min(self.state.items.len());
        &self.state.items[start..end]
    }

    pub fn queued_count(&self) -> usize {
        self.pending().len()
    }

    pub fn first_upcoming_auto(&self) -> Option<usize> {
        let start = self.next_index();
        self.state.items[start..]
            .iter()
            .position(|track| track.auto)
            .map(|at| start + at)
    }
}
