use leptos::{mount::mount_to, prelude::*};
use serde::Deserialize;
use wasm_bindgen::{prelude::*, JsCast};
use web_sys::HtmlElement;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Shelf {
    section: String,
    title: String,
    subtitle: Option<String>,
    pinned: bool,
    mobile: bool,
    loading: bool,
    playable: bool,
    cards: Vec<Card>,
}

#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
enum Card {
    Track {
        id: String,
        title: Option<String>,
        artist: Option<String>,
        thumbnail: Option<String>,
    },
    Artist {
        name: String,
        thumbnail: Option<String>,
    },
    List {
        name: String,
        count: usize,
        system: bool,
        thumbnails: Vec<String>,
    },
}

#[derive(Deserialize)]
struct Genre {
    id: String,
    name: String,
}

#[wasm_bindgen]
pub struct HomeSection {
    element: HtmlElement,
    // Al liberar la sección también se desmonta su vista Leptos.
    _view: Box<dyn FnOnce()>,
}

impl HomeSection {
    fn mount<V: IntoView + 'static>(
        tag: &str,
        class: &str,
        render: impl FnOnce() -> V + 'static,
    ) -> Result<Self, JsValue> {
        let document = web_sys::window()
            .and_then(|window| window.document())
            .ok_or_else(|| JsError::new("Inicio requiere un documento"))?;
        let element: HtmlElement = document.create_element(tag)?.unchecked_into();
        element.set_class_name(class);
        let view = mount_to(element.clone(), render);
        Ok(Self {
            element,
            _view: Box::new(move || drop(view)),
        })
    }
}

#[wasm_bindgen]
impl HomeSection {
    pub fn element(&self) -> HtmlElement {
        self.element.clone()
    }

    pub fn shelf(input: &str) -> Result<Self, JsValue> {
        let shelf: Shelf =
            serde_json::from_str(input).map_err(|err| JsError::new(&err.to_string()))?;
        let section = shelf.section.clone();
        let busy = if shelf.loading { "true" } else { "false" };
        let mounted = Self::mount("section", "shelf", move || {
            let mobile = shelf.mobile;
            let loading = shelf.loading;
            let organize = format!("Organizar sección {}", shelf.title);
            view! {
                <header class="shelf__head">
                    <div class="shelf__text">
                        <h3 class="shelf__title">{shelf.title}</h3>
                        {shelf.pinned.then(|| view! { <span class="shelf__pinned">"Fijada"</span> })}
                        {shelf.subtitle.filter(|s| !s.is_empty()).map(|s| view! { <p class="shelf__sub">{s}</p> })}
                    </div>
                    <div class="shelf__actions">
                        {shelf.playable.then(|| view! {
                            <button type="button" class="btn btn--mini btn--with-icon" data-home-action="play" aria-label="Reproducir" title="Reproducir">
                                <HomeIcon name="play" /><span>"Reproducir"</span>
                            </button>
                        })}
                        {mobile.then(|| view! {
                            <button type="button" class="btn shelf__organize" data-home-action="organize" aria-label=organize.clone() title=organize>
                                <HomeIcon name="grip" />
                            </button>
                        })}
                        <button type="button" class="btn btn--icon shelf__arrow" data-home-action="previous" aria-label="Anteriores" title="Anteriores"><HomeIcon name="back" /></button>
                        <button type="button" class="btn btn--icon shelf__arrow shelf__arrow--next" data-home-action="next" aria-label="Siguientes" title="Siguientes"><HomeIcon name="back" /></button>
                    </div>
                </header>
                <div class="shelf__row">
                    {if loading {
                        (0..6).map(|_| view! {
                            <div class="card card--skeleton" aria-hidden="true">
                                <div class="card__cover"></div><span class="card__title"></span><span class="card__by"></span>
                            </div>
                        }).collect_view().into_any()
                    } else {
                        shelf.cards.into_iter().map(|card| render_card(card, mobile)).collect_view().into_any()
                    }}
                </div>
            }
        })?;
        mounted.element.set_attribute("data-section", &section)?;
        mounted.element.set_attribute("aria-busy", busy)?;
        Ok(mounted)
    }

    pub fn welcome(input: &str) -> Result<Self, JsValue> {
        let genres: Vec<Genre> =
            serde_json::from_str(input).map_err(|err| JsError::new(&err.to_string()))?;
        Self::mount("section", "home__welcome", move || {
            view! {
                <h3 class="shelf__title">"¿Qué música te gusta?"</h3>
                <p class="shelf__sub">"Elige uno o varios géneros y Antares te preparará estanterías con ellos. Según escuches, aprenderá tus gustos solo."</p>
                <div class="genre-chips">
                    {genres.into_iter().map(|genre| view! {
                        <button type="button" class="genre-chip" data-genre=genre.id>{genre.name}</button>
                    }).collect_view()}
                </div>
            }
        })
    }

    pub fn empty() -> Result<Self, JsValue> {
        Self::mount("p", "results__empty", || {
            "Todas las secciones de Inicio están ocultas. Actívalas en Ajustes › Inicio."
        })
    }
}

#[component]
fn HomeIcon(name: &'static str) -> impl IntoView {
    let paths: &[&str] = match name {
        "play" => &["fill:M8 5.5v13l11-6.5z"],
        "back" => &["m15 18-6-6 6-6"],
        "heart" => &["M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"],
        "more" => &[
            "fill:M6 10.4a1.6 1.6 0 1 1 0 3.2 1.6 1.6 0 0 1 0-3.2z",
            "fill:M12 10.4a1.6 1.6 0 1 1 0 3.2 1.6 1.6 0 0 1 0-3.2z",
            "fill:M18 10.4a1.6 1.6 0 1 1 0 3.2 1.6 1.6 0 0 1 0-3.2z",
        ],
        _ => &[
            "fill:M9 5.4a1.4 1.4 0 1 1 0 2.8 1.4 1.4 0 0 1 0-2.8z",
            "fill:M15 5.4a1.4 1.4 0 1 1 0 2.8 1.4 1.4 0 0 1 0-2.8z",
            "fill:M9 10.6a1.4 1.4 0 1 1 0 2.8 1.4 1.4 0 0 1 0-2.8z",
            "fill:M15 10.6a1.4 1.4 0 1 1 0 2.8 1.4 1.4 0 0 1 0-2.8z",
            "fill:M9 15.8a1.4 1.4 0 1 1 0 2.8 1.4 1.4 0 0 1 0-2.8z",
            "fill:M15 15.8a1.4 1.4 0 1 1 0 2.8 1.4 1.4 0 0 1 0-2.8z",
        ],
    };
    view! {
        <svg viewBox="0 0 24 24" aria-hidden="true">
            {paths.iter().map(|path| {
                let filled = path.strip_prefix("fill:");
                view! { <path d=filled.unwrap_or(path) class:icon-fill=filled.is_some() /> }
            }).collect_view()}
        </svg>
    }
}

#[component]
fn CardArt(src: Option<String>) -> impl IntoView {
    view! { <img class="card__art" alt="" loading="lazy" decoding="async" src=src /> }
}

#[component]
fn CardMore() -> impl IntoView {
    view! { <button type="button" class="card__more" aria-label="Más opciones" title="Más opciones"><HomeIcon name="more" /></button> }
}

fn artist_name(name: &str) -> &str {
    name.strip_suffix(" - Topic").unwrap_or(name)
}

fn render_card(card: Card, mobile: bool) -> AnyView {
    match card {
        Card::Track {
            id,
            title,
            artist,
            thumbnail,
        } => {
            let tooltip = [title.as_deref(), artist.as_deref()]
                .into_iter()
                .flatten()
                .filter(|s| !s.is_empty())
                .collect::<Vec<_>>()
                .join(" · ");
            let title = title
                .filter(|s| !s.is_empty())
                .unwrap_or_else(|| "Sin título".into());
            let by = match artist.filter(|s| !s.is_empty()) {
                Some(name) => {
                    let tooltip = format!("Ir a {}", artist_name(&name));
                    view! { <button type="button" class="card__by card__by--link" title=tooltip>{name}</button> }.into_any()
                }
                None => view! { <span class="card__by"></span> }.into_any(),
            };
            let name = view! { <span class="card__title">{title}</span> };
            view! {
                <div class="card" tabindex="0" role="button" data-id=id title=tooltip>
                    <div class="card__cover">
                        <CardArt src=thumbnail /><span class="card__play"><HomeIcon name="play" /></span>
                        {(!mobile).then(|| view! { <CardMore /> })}
                    </div>
                    {if mobile {
                        view! { <div class="mobile-card-meta"><div>{name}{by}</div><CardMore /></div> }.into_any()
                    } else { view! { {name}{by} }.into_any() }}
                </div>
            }.into_any()
        }
        Card::Artist { name, thumbnail } => {
            let name = artist_name(&name).to_owned();
            let tooltip = format!("Reproducir las canciones de {name}");
            view! {
                <button type="button" class="card card--artist" title=tooltip>
                    <div class="card__cover"><CardArt src=thumbnail /><span class="card__play"><HomeIcon name="play" /></span></div>
                    <span class="card__title">{name}</span><span class="card__by">"Reproducir artista"</span>
                </button>
            }.into_any()
        }
        Card::List {
            name,
            count,
            system,
            thumbnails,
        } => {
            let mosaic = thumbnails.len() >= 4;
            let count = if count == 1 {
                "1 canción".into()
            } else {
                format!("{count} canciones")
            };
            view! {
                <button type="button" class="card card--list">
                    <div class="card__cover" class:card__cover--likes=system class:card__cover--mosaic=(!system && mosaic)>
                        {if system { view! { <HomeIcon name="heart" /> }.into_any() } else {
                            thumbnails.into_iter().take(if mosaic { 4 } else { 1 })
                                .map(|src| view! { <CardArt src=Some(src) /> }).collect_view().into_any()
                        }}
                    </div>
                    <span class="card__title">{name}</span><span class="card__by">{count}</span>
                </button>
            }.into_any()
        }
    }
}

#[wasm_bindgen]
pub fn home_section_id(key: &str) -> String {
    let id = key.split(':').next().unwrap_or_default();
    if id == "genre" {
        "genres".into()
    } else {
        id.into()
    }
}

#[wasm_bindgen]
pub fn move_home_section(
    order: Vec<String>,
    pins: Vec<String>,
    from: &str,
    to: &str,
) -> Option<Vec<String>> {
    let pinned = pins.iter().any(|key| key == from);
    let in_group = |id: &String| pins.contains(id) == pinned;
    let mut group: Vec<_> = order.iter().filter(|&id| in_group(id)).cloned().collect();
    let old = group.iter().position(|id| id == from)?;
    let new = group.iter().position(|id| id == to)?;
    if old == new {
        return None;
    }
    let moved = group.remove(old);
    group.insert(new, moved);
    let mut group = group.into_iter();
    Some(
        order
            .into_iter()
            .map(|id| {
                if in_group(&id) {
                    group.next().unwrap_or(id)
                } else {
                    id
                }
            })
            .collect(),
    )
}
