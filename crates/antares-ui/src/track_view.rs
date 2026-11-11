use leptos::{mount::mount_to, prelude::*};
use serde::Deserialize;
use wasm_bindgen::prelude::*;
use web_sys::HtmlElement;

#[wasm_bindgen]
pub fn mount_search_controls(form: HtmlElement) {
    mount_to(form, || {
        view! {
            <div class="field">
                <svg class="field__icon" viewBox="0 0 24 24" aria-hidden="true">
                    <circle cx="11" cy="11" r="7" />
                    <path d="M20 20l-3.5-3.5" />
                </svg>
                <input
                    class="field__input" id="search-input" type="text"
                    placeholder="Buscar una canción o pegar un enlace de música"
                    aria-label="Buscar canción" spellcheck="false"
                />
            </div>
            <button class="btn btn--search" id="search-button" type="submit">
                <span class="btn__label">"Buscar"</span>
                <span class="btn__spinner" aria-hidden="true"></span>
            </button>
        }
    })
    .forget();
}

#[derive(Deserialize)]
struct Row {
    id: String,
    title: String,
    duration: String,
    selected: Option<bool>,
}

#[derive(Deserialize)]
struct ViewModel {
    rows: Vec<Row>,
    split: Option<usize>,
    artist: Option<String>,
    empty: String,
}

#[wasm_bindgen]
pub struct SearchView {
    unmount: Vec<Box<dyn FnOnce()>>,
}

#[wasm_bindgen]
impl SearchView {
    #[wasm_bindgen(constructor)]
    pub fn new() -> Self {
        Self {
            unmount: Vec::new(),
        }
    }

    pub fn clear(&mut self) {
        for unmount in self.unmount.drain(..).rev() {
            unmount();
        }
    }

    pub fn render(&mut self, list: HtmlElement, input: &str) -> Result<(), JsError> {
        let model: ViewModel =
            serde_json::from_str(input).map_err(|error| JsError::new(&error.to_string()))?;
        self.clear();
        self.mount(list, model, 0);
        Ok(())
    }

    pub fn append(&mut self, list: HtmlElement, input: &str, start: usize) -> Result<(), JsError> {
        let model =
            serde_json::from_str(input).map_err(|error| JsError::new(&error.to_string()))?;
        self.mount(list, model, start);
        Ok(())
    }

    fn mount(&mut self, list: HtmlElement, model: ViewModel, start: usize) {
        let handle = mount_to(list, move || {
            if model.rows.is_empty() {
                return view! { <li class="results__empty">{model.empty}</li> }.into_any();
            }
            let artist = model.artist.as_ref().map(|name| format!("De {name}"));
            model.rows.into_iter().enumerate().map(|(position, row)| {
                let position = start + position;
                let divider = match model.split {
                    Some(split) if position == split => Some("Otros resultados".to_owned()),
                    Some(_) if position == 0 => artist.clone(),
                    _ => None,
                };
                let tooltip = row.title.clone();
                let selectable = row.selected.is_some();
                let selected = row.selected.unwrap_or_default();
                let label = format!("Seleccionar {}", row.title);
                view! {
                    {divider.map(|label| view! { <li class="results__divider"><span>{label}</span></li> })}
                    <li
                        class="result result--track" data-id=row.id data-position=position.to_string()
                        tabindex="0" role="button" class:result--selectable=selectable class:is-selected=selected
                    >
                        {selectable.then(|| view! {
                            <input type="checkbox" prop:checked=selected aria-label=label />
                        })}
                        <div class="result__text">
                            <span class="result__title" title=tooltip>{row.title}</span>
                        </div>
                        <span class="result__time">{row.duration}</span>
                    </li>
                }
            }).collect_view().into_any()
        });
        self.unmount.push(Box::new(move || drop(handle)));
    }
}
