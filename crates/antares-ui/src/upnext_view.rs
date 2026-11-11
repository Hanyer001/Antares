use leptos::{mount::mount_to, prelude::*};
use serde::Deserialize;
use wasm_bindgen::prelude::*;
use web_sys::HtmlElement;

#[derive(Deserialize)]
struct Row {
    title: Option<String>,
    uploader: Option<String>,
    thumbnail: Option<String>,
}

#[wasm_bindgen]
pub struct UpNextView(Option<Box<dyn FnOnce()>>);

#[wasm_bindgen]
impl UpNextView {
    #[wasm_bindgen(constructor)]
    pub fn new() -> Self {
        Self(None)
    }

    pub fn render(
        &mut self,
        list: HtmlElement,
        input: &str,
        queued: usize,
        context: Option<String>,
        empty: String,
    ) -> Result<(), JsValue> {
        let rows: Vec<Row> =
            serde_json::from_str(input).map_err(|err| JsError::new(&err.to_string()))?;
        if let Some(unmount) = self.0.take() {
            unmount();
        }
        let handle = mount_to(list, move || {
            if rows.is_empty() {
                return view! { <li class="upnext__empty">{empty}</li> }.into_any();
            }
            let after = context
                .filter(|text| !text.is_empty())
                .map_or_else(|| "Después".into(), |text| format!("Siguiente de «{text}»"));
            rows.into_iter().enumerate().map(|(i, row)| {
                let heading = if queued > 0 && i == 0 { Some("Siguiente en la cola") }
                    else if queued > 0 && i == queued { Some(after.as_str()) } else { None };
                let title = row.title.unwrap_or_default();
                let name = if title.is_empty() { "Sin título".into() } else { title.clone() };
                view! {
                    {heading.map(|heading| view! { <li class="upnext__heading">{heading.to_owned()}</li> })}
                    <li>
                        <button type="button" class="upnext__item" title=title>
                            <img class="upnext__art" alt="" loading="lazy" decoding="async" src=row.thumbnail />
                            <span class="upnext__text">
                                <span class="upnext__name">{name}</span>
                                <span class="upnext__by">{row.uploader.unwrap_or_default()}</span>
                            </span>
                        </button>
                    </li>
                }
            }).collect_view().into_any()
        });
        self.0 = Some(Box::new(move || drop(handle)));
        Ok(())
    }
}
