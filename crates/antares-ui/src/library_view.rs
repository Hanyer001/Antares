use leptos::{mount::mount_to, prelude::*};
use serde::Deserialize;
use wasm_bindgen::prelude::*;
use web_sys::HtmlElement;

#[derive(Deserialize)]
struct Playlist {
    id: String,
    name: String,
    count: usize,
    pinned: bool,
    system: bool,
    smart: bool,
    folder: Option<String>,
    description: Option<String>,
}

#[wasm_bindgen]
pub fn playlist_count_label(count: usize) -> String {
    match count {
        0 => "Vacía".into(),
        1 => "1 canción".into(),
        _ => format!("{count} canciones"),
    }
}

fn overview_row(list: Playlist) -> impl IntoView {
    let labels = [
        Some(playlist_count_label(list.count)),
        list.pinned.then(|| "Fijada".into()),
        list.folder,
        list.smart.then(|| "Inteligente".into()),
        list.description,
    ];
    let description = labels
        .into_iter()
        .flatten()
        .filter(|s| !s.is_empty())
        .collect::<Vec<_>>()
        .join(" · ");
    view! {
        <li class="result result--list" data-id=list.id tabindex="0" role="button">
            <div class="result__text">
                <span class="result__title">{list.name}</span>
                <span class="result__by">{description}</span>
            </div>
            <span class="result__chevron"></span>
        </li>
    }
}

fn sidebar_row(list: Playlist, active: Option<&str>) -> impl IntoView {
    let current = (Some(list.id.as_str()) == active).to_string();
    let title = list.folder.filter(|s| !s.is_empty()).map_or_else(
        || list.name.clone(),
        |folder| format!("{folder} / {}", list.name),
    );
    let name = if list.pinned {
        format!("★ {}", list.name)
    } else {
        list.name
    };
    let class = if list.system {
        "side-list side-list--likes"
    } else {
        "side-list"
    };
    view! {
        <li>
            <button type="button" class=class data-id=list.id aria-current=current title=title>
                <span class="side-list__name">{name}</span>
                <span class="side-list__count">{list.count.to_string()}</span>
            </button>
        </li>
    }
}

#[wasm_bindgen]
pub struct LibraryView(Option<Box<dyn FnOnce()>>);

#[wasm_bindgen]
impl LibraryView {
    #[wasm_bindgen(constructor)]
    pub fn new() -> Self {
        Self(None)
    }

    pub fn clear(&mut self) {
        if let Some(unmount) = self.0.take() {
            unmount();
        }
    }

    pub fn render(
        &mut self,
        target: HtmlElement,
        input: &str,
        sidebar: bool,
        active: Option<String>,
    ) -> Result<(), JsError> {
        let lists: Vec<Playlist> =
            serde_json::from_str(input).map_err(|error| JsError::new(&error.to_string()))?;
        self.clear();
        let handle = mount_to(target, move || {
            if sidebar {
                lists
                    .into_iter()
                    .map(|list| sidebar_row(list, active.as_deref()))
                    .collect_view()
                    .into_any()
            } else if lists.is_empty() {
                view! { <li class="results__empty">"No hay listas que coincidan."</li> }.into_any()
            } else {
                lists
                    .into_iter()
                    .map(overview_row)
                    .collect_view()
                    .into_any()
            }
        });
        self.0 = Some(Box::new(move || drop(handle)));
        Ok(())
    }
}

fn normalize(text: &str) -> String {
    use unicode_normalization::UnicodeNormalization;

    let plain: String = text
        .nfd()
        .filter(|c| !('\u{0300}'..='\u{036f}').contains(c))
        .collect();
    js_sys::JsString::from(plain)
        .to_locale_lower_case(None)
        .as_string()
        .unwrap_or_default()
}

#[derive(Deserialize)]
struct TrackText {
    title: Option<String>,
    uploader: Option<String>,
}

#[wasm_bindgen]
pub fn filter_track_indices(input: &str, query: &str) -> Result<Vec<u32>, JsError> {
    let tracks: Vec<TrackText> =
        serde_json::from_str(input).map_err(|error| JsError::new(&error.to_string()))?;
    let query = normalize(query);
    let words: Vec<_> = query.split_whitespace().collect();
    Ok(tracks
        .into_iter()
        .enumerate()
        .filter_map(|(index, track)| {
            let matches = words.is_empty() || {
                let text = normalize(&format!(
                    "{} {}",
                    track.title.unwrap_or_default(),
                    track.uploader.unwrap_or_default()
                ));
                words.iter().all(|word| text.contains(word))
            };
            matches.then_some(index as u32)
        })
        .collect())
}

/// Un índice por colección evita volver a normalizar mil títulos en cada tecla.
/// La entrada completa se compara para detectar cambios de orden o metadatos.
#[wasm_bindgen]
#[derive(Default)]
pub struct TrackFilter {
    source: String,
    texts: Vec<String>,
}

#[wasm_bindgen]
impl TrackFilter {
    #[wasm_bindgen(constructor)]
    pub fn new() -> Self { Self::default() }

    pub fn filter(&mut self, input: &str, query: &str) -> Result<Vec<u32>, JsError> {
        if self.source != input {
            let tracks: Vec<TrackText> = serde_json::from_str(input)
                .map_err(|error| JsError::new(&error.to_string()))?;
            self.texts = tracks.into_iter().map(|track| {
                normalize(&format!("{} {}", track.title.unwrap_or_default(), track.uploader.unwrap_or_default()))
            }).collect();
            self.source = input.into();
        }
        let query = normalize(query);
        let words: Vec<_> = query.split_whitespace().collect();
        Ok(self.texts.iter().enumerate().filter_map(|(index, text)| {
            words.iter().all(|word| text.contains(word)).then_some(index as u32)
        }).collect())
    }
}

#[derive(Deserialize)]
struct ListOrder {
    name: String,
    folder: Option<String>,
    description: Option<String>,
    pinned: bool,
    system: bool,
    updated_at: Option<f64>,
}

#[wasm_bindgen]
pub fn group_list_indices(input: &str, query: &str, folder: &str) -> Result<Vec<u32>, JsError> {
    use std::cmp::Ordering;

    let lists: Vec<ListOrder> =
        serde_json::from_str(input).map_err(|error| JsError::new(&error.to_string()))?;
    let query = normalize(query);
    let query = query.trim();
    let mut matches: Vec<_> = lists
        .iter()
        .enumerate()
        .filter(|(_, list)| {
            let list_folder = list.folder.as_deref().unwrap_or_default();
            let folder_matches = folder.is_empty()
                || if folder == "__none" {
                    list_folder.is_empty()
                } else {
                    list_folder == folder
                };
            folder_matches
                && (query.is_empty()
                    || normalize(&format!(
                        "{} {} {list_folder}",
                        list.name,
                        list.description.as_deref().unwrap_or_default()
                    ))
                    .contains(query))
        })
        .collect();
    let locales = js_sys::Array::new();
    let options = js_sys::Object::new();
    matches.sort_by(|(_, a), (_, b)| {
        b.system
            .cmp(&a.system)
            .then_with(|| b.pinned.cmp(&a.pinned))
            .then_with(|| {
                js_sys::JsString::from(a.folder.as_deref().unwrap_or_default())
                    .locale_compare(b.folder.as_deref().unwrap_or_default(), &locales, &options)
                    .cmp(&0)
            })
            .then_with(|| match (a.updated_at, b.updated_at) {
                (Some(a), Some(b)) => b.partial_cmp(&a).unwrap_or(Ordering::Equal),
                _ => Ordering::Equal,
            })
    });
    Ok(matches.into_iter().map(|(index, _)| index as u32).collect())
}
