use leptos::{mount::mount_to, prelude::*};
use wasm_bindgen::{prelude::*, JsCast};
use web_sys::{HtmlButtonElement, HtmlElement};

#[wasm_bindgen]
pub fn mount_navigation(nav: HtmlElement) {
    mount_to(nav, || view! {
        <button class="tab" data-tab="home" type="button" title="Inicio">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 10.5 12 3l9 7.5" /><path d="M5 9v11h5v-6h4v6h5V9" /></svg>
            <span>"Inicio"</span>
        </button>
        <button class="tab" data-tab="results" type="button">
            <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>
            <span>"Buscar"</span>
        </button>
        <button class="tab" data-tab="discover" type="button">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z" /><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z" /></svg>
            <span>"Descubrir"</span>
        </button>
        <button class="tab" data-tab="queue" type="button">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h13M3 12h13M3 18h9" /><path d="M17 15v6l4-3z" /></svg>
            <span>"Cola"</span><span class="tab__count" id="queue-count"></span>
        </button>
        <button class="tab" data-tab="history" type="button">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5" /><path d="M12 7v5l3 2" /></svg>
            <span>"Reciente"</span>
        </button>
        <button class="tab" data-tab="lists" type="button">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" /></svg>
            <span>"Listas"</span>
        </button>
        <button class="tab" data-tab="summary" type="button">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /></svg>
            <span>"Resumen"</span>
        </button>
    }).forget();
}

#[wasm_bindgen]
pub fn arrange_navigation(
    nav: &HtmlElement,
    order: Vec<String>,
    hidden: Vec<String>,
) -> Result<(), JsValue> {
    let buttons = nav.query_selector_all(".tab[data-tab]")?;
    for id in order {
        let button = (0..buttons.length())
            .filter_map(|i| buttons.item(i)?.dyn_into::<HtmlButtonElement>().ok())
            .find(|button| button.get_attribute("data-tab").as_deref() == Some(&id));
        if let Some(button) = button {
            nav.append_child(&button)?;
            button.set_hidden(hidden.contains(&id));
            button.set_title(button.text_content().unwrap_or_default().trim());
        }
    }
    Ok(())
}

#[wasm_bindgen]
pub fn mark_navigation(root: &HtmlElement, active: &str, detail: bool) -> Result<(), JsValue> {
    let buttons = root.query_selector_all(".tab[data-tab]")?;
    let mut section = "detail";
    for button in
        (0..buttons.length()).filter_map(|i| buttons.item(i)?.dyn_into::<HtmlButtonElement>().ok())
    {
        let selected = !detail && button.get_attribute("data-tab").as_deref() == Some(active);
        if selected {
            section = active;
        }
        let current = if selected { "page" } else { "false" };
        if button.get_attribute("aria-current").as_deref() != Some(current) {
            button.set_attribute("aria-current", current)?;
        }
    }
    if let Some(html) = root.owner_document().and_then(|doc| doc.document_element()) {
        if html.get_attribute("data-platform").as_deref() == Some("android") {
            // La búsqueda debe estar visible antes de que el botón le dé el foco.
            html.set_attribute("data-mobile-tab", section)?;
        }
    }
    Ok(())
}

#[wasm_bindgen]
pub fn queue_badge(label: &HtmlElement, count: u32) {
    if count == 0 {
        label.set_text_content(None);
    } else {
        label.set_text_content(Some(&count.to_string()));
    }
}

#[wasm_bindgen]
pub fn start_section(wanted: &str, order: Vec<String>, hidden: Vec<String>) -> Option<String> {
    if hidden.iter().any(|id| id == wanted) {
        order.into_iter().find(|id| !hidden.contains(id))
    } else {
        Some(wanted.into())
    }
}
