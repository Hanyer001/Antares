fn group_metadata(name: &str, android: bool) -> (&'static str, Option<&'static str>) {
    match name {
        "mobile" => (if android { "Batería, precarga y respuesta táctil" } else { "Batería y controles táctiles" }, Some("M8 3h8v18H8zM11 18h2")),
        "appearance" => (if android { "Diseños, colores y tipografías" } else { "Tema, colores, fondo, tamaño y tipografía" }, Some("M12 3a9 9 0 1 0 0 18c1.1 0 1.5-.8 1.5-1.6 0-1.2-1-1.6-1-2.6 0-.9.7-1.3 1.6-1.3H16a5 5 0 0 0 5-5C21 6.4 17 3 12 3zM7.5 12.5h.01M9.5 8h.01M14.5 8h.01")),
        "layout" => (if android { "Navegación y controles" } else { "Columnas, pestañas, carátula y botones de la consola" }, Some("M3.5 4.5h17v15h-17zM9 4.5v15M15 4.5v15")),
        "player" => ("La barra de reproducción y el mini reproductor", Some("M3.5 15.5h17v4h-17zM6.5 17.5h.01M10 12l4.5-3L10 6z")),
        "home" => (if android { "Secciones, orden y géneros" } else { "Qué secciones salen en Inicio y tus géneros" }, Some("M4 11l8-7 8 7M6 9.5V20h12V9.5")),
        "behavior" => (if android { "Calidad, cola, privacidad y letras" } else { "Clics, saltos, volumen, al abrir, avisos y letra" }, Some("M4 7h10M18 7h2M4 17h4M12 17h8M14 5v4M8 15v4")),
        "discovery" => (if android { "Solo música y tus preferencias" } else { "Cómo se eligen las canciones que no pediste" }, Some("M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z")),
        "shortcuts" => ("Las teclas de la app y las de todo el sistema", Some("M3.5 6.5h17v11h-17zM7 10h.01M11 10h.01M15 10h.01M7.5 14h9")),
        "sound" => (if android { "Ecualizador y volumen" } else { "Nivelar el volumen, ecualizador y transiciones" }, Some("M6 20V10M6 6V4M12 20v-4M12 12V4M18 20v-8M18 8V4M4 8h4M10 14h4M16 10h4")),
        "system" => ("Bandeja, inicio de sesión y el motor de reproducción", Some("M3.5 4.5h17v12h-17zM9 20.5h6M12 16.5v4")),
        "people" => (if android { "Tus perfiles de personalización" } else { "Perfiles de ajustes y varias personas en el mismo equipo" }, Some("M16 20v-1.5a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4V20M9.5 10.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM21 20v-1.5a4 4 0 0 0-3-3.9M15.5 3.6a3.5 3.5 0 0 1 0 6.8")),
        "data" => (if android { "Biblioteca, copias e historial" } else { "Copias de seguridad, historial y restablecer" }, Some("M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3zM4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3")),
        _ => ("", None),
    }
}

use js_sys::Function;
use leptos::{mount::mount_to, prelude::*};
use regex::Regex;
use std::sync::LazyLock;
use unicode_normalization::UnicodeNormalization;
use wasm_bindgen::{prelude::*, JsCast};
use web_sys::{
    Element, HtmlElement, HtmlInputElement, HtmlSelectElement, HtmlTextAreaElement, ScrollBehavior,
    ScrollIntoViewOptions, ScrollLogicalPosition, Storage,
};

const OPEN_KEY: &str = "antares.settingsOpen";
const GROUP: &str = ".settings__group";
const TOGGLE: &str = ".settings__toggle";
const SUBBOX: &str = ".settings__subbox";
const SUBTOGGLE: &str = ".settings__subtoggle";

fn elements(root: &Element, selector: &str) -> impl Iterator<Item = Element> {
    let nodes = root
        .query_selector_all(selector)
        .expect("selector estático válido");
    (0..nodes.length()).filter_map(move |i| nodes.item(i)?.dyn_into().ok())
}

fn find(root: &Element, selector: &str) -> Option<Element> {
    root.query_selector(selector).ok().flatten()
}

fn text(root: &Element, selector: &str) -> String {
    find(root, selector)
        .and_then(|element| element.text_content())
        .unwrap_or_default()
}

fn mark_open(box_element: &Element, button: &Element, open: bool) -> Result<(), JsValue> {
    box_element
        .class_list()
        .toggle_with_force("is-open", open)?;
    button.set_attribute("aria-expanded", if open { "true" } else { "false" })
}

#[component]
fn Chevron() -> impl IntoView {
    view! {
        <svg class="settings__chevron" viewBox="0 0 24 24" aria-hidden="true">
            <path d="m6 9 6 6 6-6" />
        </svg>
    }
}

#[wasm_bindgen]
pub struct SettingsView {
    root: HtmlElement,
    empty: HtmlElement,
    android: bool,
    storage: Option<Storage>,
    opened: Vec<String>,
}

#[wasm_bindgen]
impl SettingsView {
    #[wasm_bindgen(constructor)]
    pub fn new(
        root: HtmlElement,
        empty: HtmlElement,
        android: bool,
    ) -> Result<SettingsView, JsValue> {
        let storage = web_sys::window().and_then(|window| window.local_storage().ok().flatten());
        let opened = storage
            .as_ref()
            .and_then(|storage| storage.get_item(OPEN_KEY).ok().flatten())
            .and_then(|raw| serde_json::from_str(&raw).ok())
            .unwrap_or_default();
        let mut view = Self {
            root,
            empty,
            android,
            storage,
            opened,
        };
        view.build()?;
        Ok(view)
    }

    pub fn toggle(&mut self, button: Element) -> Result<(), JsValue> {
        let Some(box_element) = button.closest(".settings__group, .settings__subbox")? else {
            return Ok(());
        };
        let open = !box_element.class_list().contains("is-open");
        self.set_open(&box_element, &button, open)
    }

    pub fn open_group(&mut self, name: &str) -> Result<(), JsValue> {
        let group = elements(&self.root, GROUP)
            .find(|group| group.get_attribute("data-group").as_deref() == Some(name));
        if let Some(group) = group {
            if let Some(button) = find(&group, TOGGLE) {
                self.set_open(&group, &button, true)?;
                let options = ScrollIntoViewOptions::new();
                options.set_behavior(ScrollBehavior::Smooth);
                options.set_block(ScrollLogicalPosition::Start);
                group.scroll_into_view_with_scroll_into_view_options(&options);
            }
        }
        Ok(())
    }

    pub fn sync_preferences(&self, read: &Function) -> Result<(), JsValue> {
        let read = |path: &str| {
            read.call1(&JsValue::UNDEFINED, &JsValue::from_str(path))
                .map(|value| value.as_string().unwrap_or_default())
        };
        for control in elements(&self.root, "[data-pref]") {
            let value = read(&control.get_attribute("data-pref").unwrap_or_default())?;
            if let Some(input) = control.dyn_ref::<HtmlInputElement>() {
                match input.type_().as_str() {
                    "radio" => input.set_checked(input.value() == value),
                    "checkbox" => input.set_checked(value == "true"),
                    "range" => {
                        if input.value() != value {
                            input.set_value(&value);
                        }
                        if let (Ok(value), Ok(min), Ok(max)) = (
                            value.parse::<f64>(),
                            input.min().parse::<f64>(),
                            input.max().parse::<f64>(),
                        ) {
                            let percent = ((value - min) / (max - min)) * 100.0;
                            HtmlElement::style(input.unchecked_ref())
                                .set_property("--level", &format!("{percent}%"))?;
                        }
                    }
                    _ if input.value() != value => input.set_value(&value),
                    _ => {}
                }
            } else if let Some(select) = control.dyn_ref::<HtmlSelectElement>() {
                if select.value() != value {
                    select.set_value(&value);
                }
            } else if let Some(input) = control.dyn_ref::<HtmlTextAreaElement>() {
                if input.value() != value {
                    input.set_value(&value);
                }
            }
        }
        for label in elements(&self.root, "[data-pref-value]") {
            let value = read(&label.get_attribute("data-pref-value").unwrap_or_default())?;
            let unit = label.get_attribute("data-unit").unwrap_or_default();
            label.set_text_content(Some(&format!("{value}{unit}")));
        }
        for row in elements(&self.root, "[data-when]") {
            let condition = row.get_attribute("data-when").unwrap_or_default();
            let hidden = if let Some((path, expected)) = condition.split_once("==") {
                read(path)? != expected
            } else if let Some((path, expected)) = condition.split_once("!=") {
                read(path)? == expected
            } else {
                false
            };
            row.toggle_attribute_with_force("hidden", hidden)?;
        }
        Ok(())
    }

    pub fn filter(&self, query: &str) -> Result<(), JsValue> {
        let query_normalized = normalize(query);
        let words: Vec<_> = query_normalized.split_whitespace().collect();
        let searching = !words.is_empty();
        self.root
            .class_list()
            .toggle_with_force("is-searching", searching)?;
        let unavailable_selector = if self.android {
            ".desktop-only"
        } else {
            ".android-only"
        };
        let mut any_visible = false;
        for group in elements(&self.root, GROUP) {
            let title = find(&group, ".settings__name")
                .and_then(|node| node.text_content())
                .unwrap_or_else(|| text(&group, ".settings__title"));
            let mut visible = false;
            for row in elements(&group, ".setting") {
                let available = row.closest(unavailable_selector)?.is_none();
                let matches = available
                    && (!searching || {
                        let sub = row
                            .closest(SUBBOX)?
                            .map_or_else(String::new, |box_element| text(&box_element, SUBTOGGLE));
                        let haystack = normalize(&format!(
                            "{title} {sub} {} {}",
                            row.text_content().unwrap_or_default(),
                            row.get_attribute("data-keywords").unwrap_or_default()
                        ));
                        words.iter().all(|word| haystack.contains(word))
                    });
                row.class_list()
                    .toggle_with_force("is-filtered", !matches)?;
                visible |= matches && !row.has_attribute("hidden");
            }
            for box_element in elements(&group, SUBBOX) {
                let any = find(&box_element, ".setting:not(.is-filtered):not([hidden])").is_some();
                box_element
                    .class_list()
                    .toggle_with_force("is-filtered", searching && !any)?;
            }
            group.toggle_attribute_with_force("hidden", !visible)?;
            if let Some(button) = find(&group, TOGGLE) {
                let expanded = if searching {
                    visible
                } else {
                    group.class_list().contains("is-open")
                };
                button.set_attribute("aria-expanded", if expanded { "true" } else { "false" })?;
            }
            any_visible |= visible;
        }
        self.empty.set_hidden(any_visible);
        self.empty.set_text_content(Some(&format!(
            "Ningún ajuste coincide con «{}».",
            query.trim()
        )));
        Ok(())
    }
}

impl SettingsView {
    fn build(&mut self) -> Result<(), JsValue> {
        for group in elements(&self.root, GROUP) {
            let name = group.get_attribute("data-group").unwrap_or_default();
            let (Some(title), Some(card)) = (
                find(&group, ".settings__title"),
                find(&group, ".settings__card"),
            ) else {
                continue;
            };
            let card_id = format!("settings-card-{name}");
            card.set_id(&card_id);
            let label = title.text_content().unwrap_or_default().trim().to_owned();
            let (summary, icon) = group_metadata(&name, self.android);
            title.set_text_content(None);
            mount_to(title.unchecked_into(), move || {
                view! {
                    <button type="button" class="settings__toggle" aria-controls=card_id>
                        <span class="settings__icon">
                            {icon.map(|path| view! {
                                <svg viewBox="0 0 24 24" aria-hidden="true"><path d=path /></svg>
                            })}
                        </span>
                        <span class="settings__names">
                            <span class="settings__name">{label}</span>
                            <span class="settings__summary">{summary}</span>
                        </span>
                        <Chevron />
                    </button>
                }
            })
            .forget();
            if let Some(button) = find(&group, TOGGLE) {
                self.set_open(&group, &button, self.opened.contains(&name))?;
            }
            for (index, subhead) in elements(&group, ".settings__subhead").enumerate() {
                self.build_sub(subhead, format!("{name}:{index}"))?;
            }
        }
        Ok(())
    }

    fn build_sub(&mut self, head: Element, key: String) -> Result<(), JsValue> {
        let document = self
            .root
            .owner_document()
            .ok_or_else(|| JsError::new("Ajustes requiere un documento"))?;
        let sub = document.create_element("div")?;
        sub.set_class_name("settings__sub");
        while let Some(row) = head.next_element_sibling() {
            if row.class_list().contains("settings__subhead") {
                break;
            }
            sub.append_child(&row)?;
        }
        let label = head.text_content().unwrap_or_default().trim().to_owned();
        head.set_text_content(None);
        mount_to(head.clone().unchecked_into(), move || {
            view! {
                <button type="button" class="settings__subtoggle">{label}<Chevron /></button>
            }
        })
        .forget();
        let box_element = document.create_element("div")?;
        box_element.set_class_name("settings__subbox");
        box_element.set_attribute("data-settings-key", &key)?;
        head.before_with_node_1(&box_element)?;
        box_element.append_child(&head)?;
        box_element.append_child(&sub)?;
        if let Some(button) = find(&head, SUBTOGGLE) {
            self.set_open(&box_element, &button, self.opened.contains(&key))?;
        }
        Ok(())
    }

    fn set_open(
        &mut self,
        box_element: &Element,
        button: &Element,
        open: bool,
    ) -> Result<(), JsValue> {
        if self.android && open && box_element.class_list().contains("settings__group") {
            for other in elements(&self.root, ".settings__group.is-open")
                .filter(|other| other != box_element)
            {
                if let Some(other_button) = find(&other, TOGGLE) {
                    mark_open(&other, &other_button, false)?;
                }
                if let Some(key) = other.get_attribute("data-group") {
                    self.opened.retain(|item| item != &key);
                }
            }
        }
        mark_open(box_element, button, open)?;
        if let Some(key) = box_element
            .get_attribute("data-group")
            .or_else(|| box_element.get_attribute("data-settings-key"))
        {
            if open {
                if !self.opened.contains(&key) {
                    self.opened.push(key);
                }
            } else {
                self.opened.retain(|item| item != &key);
            }
        }
        if let (Some(storage), Ok(json)) = (&self.storage, serde_json::to_string(&self.opened)) {
            let _ = storage.set_item(OPEN_KEY, &json);
        }
        Ok(())
    }
}

fn normalize(text: &str) -> String {
    static DIACRITIC: LazyLock<Regex> =
        LazyLock::new(|| Regex::new(r"\p{Diacritic}").expect("propiedad Unicode"));
    let decomposed: String = text.nfd().collect();
    DIACRITIC.replace_all(&decomposed, "").to_lowercase()
}
