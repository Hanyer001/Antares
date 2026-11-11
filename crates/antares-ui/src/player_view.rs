use serde::Deserialize;
use wasm_bindgen::{prelude::*, JsCast};
use web_sys::{Document, Element, HtmlElement, HtmlImageElement, HtmlInputElement};

const STEPS: f64 = 1000.0;

fn document(root: &HtmlElement) -> Result<Document, JsValue> {
    root.owner_document()
        .ok_or_else(|| JsError::new("El reproductor requiere un documento").into())
}

fn by_id<T: JsCast>(document: &Document, id: &str) -> Result<T, JsValue> {
    document
        .get_element_by_id(id)
        .and_then(|el| el.dyn_into().ok())
        .ok_or_else(|| JsError::new(&format!("Falta el control {id}")).into())
}

#[wasm_bindgen]
pub fn format_clock(seconds: f64) -> String {
    if !seconds.is_finite() || seconds < 0.0 {
        return "--:--".into();
    }
    let total = seconds as u64;
    let (hours, minutes, seconds) = (total / 3600, total / 60 % 60, total % 60);
    if hours > 0 {
        format!("{hours}:{minutes:02}:{seconds:02}")
    } else {
        format!("{minutes}:{seconds:02}")
    }
}

fn ratio(value: f64) -> f64 {
    if value.is_finite() {
        value.clamp(0.0, 1.0)
    } else {
        0.0
    }
}

fn label(el: &Element, label: &str, title: bool) -> Result<(), JsValue> {
    el.set_attribute("aria-label", label)?;
    if title {
        el.set_attribute("title", label)?;
    }
    Ok(())
}

fn pressed(el: &Element, on: bool) -> Result<(), JsValue> {
    el.set_attribute("aria-pressed", if on { "true" } else { "false" })
}

fn class(el: &Element, name: &str, on: bool) -> Result<(), JsValue> {
    el.class_list().toggle_with_force(name, on).map(|_| ())
}

fn play_label(playing: bool) -> &'static str {
    if playing {
        "Pausar"
    } else {
        "Reproducir"
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Playback {
    title: String,
    artist: String,
    artwork: Option<String>,
    has_track: bool,
    playing: bool,
    loading: bool,
    liked: bool,
    disliked: bool,
    can_rate: bool,
    has_prev: bool,
    has_next: bool,
    shuffle: bool,
    repeat: String,
    volume: f64,
    muted: bool,
}

#[wasm_bindgen]
pub struct PlayerView {
    root: HtmlElement,
    doc: Document,
    title: HtmlElement,
    artist: HtmlElement,
    art: HtmlImageElement,
    mini_bg: Option<HtmlElement>,
    volume: HtmlInputElement,
    scrub: HtmlInputElement,
    current: HtmlElement,
    remaining: HtmlElement,
    mini: bool,
    duration: f64,
    position: f64,
    preview: f64,
    scrubbing: bool,
    cancelled: bool,
    track: String,
    gesture: String,
}

#[wasm_bindgen]
impl PlayerView {
    #[wasm_bindgen(constructor)]
    pub fn new(root: HtmlElement, mini: bool) -> Result<PlayerView, JsValue> {
        let doc = document(&root)?;
        let prefix = if mini { "mini" } else { "pbar" };
        let art = by_id(&doc, &format!("{prefix}-art"))?;
        Ok(Self {
            title: by_id(&doc, &format!("{prefix}-title"))?,
            artist: by_id(&doc, &format!("{prefix}-artist"))?,
            art,
            mini_bg: if mini {
                Some(by_id(&doc, "mini-bg")?)
            } else {
                None
            },
            volume: by_id(&doc, if mini { "mini-vol" } else { "pbar-volume" })?,
            scrub: by_id(&doc, &format!("{prefix}-scrub"))?,
            current: by_id(&doc, &format!("{prefix}-current"))?,
            remaining: by_id(&doc, if mini { "mini-remaining" } else { "pbar-total" })?,
            root,
            doc,
            mini,
            duration: 0.0,
            position: 0.0,
            preview: 0.0,
            scrubbing: false,
            cancelled: false,
            track: String::new(),
            gesture: String::new(),
        })
    }

    pub fn render(&mut self, input: &str, identity: &str) -> Result<bool, JsValue> {
        let state: Playback =
            serde_json::from_str(input).map_err(|err| JsError::new(&err.to_string()))?;
        let track_changed = self.track != identity;
        if track_changed {
            self.cancelled |= self.scrubbing;
            self.scrubbing = false;
            self.track = identity.into();
        }

        class(&self.root, "is-playing", state.playing)?;
        class(&self.root, "is-loading", state.loading)?;
        class(&self.root, "is-muted", state.muted)?;
        if !self.mini {
            class(&self.root, "is-empty", !state.has_track)?;
        }
        self.title.set_text_content(Some(if state.title.is_empty() {
            "Sin reproducción"
        } else {
            &state.title
        }));
        self.title.set_title(&state.title);
        self.artist.set_text_content(Some(&state.artist));
        if !self.mini {
            self.artist.set_hidden(state.artist.is_empty());
        }

        if self.art.get_attribute("src") != state.artwork {
            class(&self.root, "has-art", self.mini && state.artwork.is_some())?;
            if let Some(source) = &state.artwork {
                self.art.set_src(source);
            } else {
                self.art.remove_attribute("src")?;
            }
            if let Some(bg) = &self.mini_bg {
                let url = state
                    .artwork
                    .as_ref()
                    .map(|src| {
                        format!(
                            "url(\"{}\")",
                            src.replace('\\', "\\\\").replace('"', "\\\"")
                        )
                    })
                    .unwrap_or_else(|| "none".into());
                bg.style().set_property("background-image", &url)?;
            } else if self.art.complete() && self.art.natural_width() > 0 {
                class(&self.root, "has-art", true)?;
            }
        }

        let buttons = self.root.query_selector_all("[data-act]")?;
        for button in
            (0..buttons.length()).filter_map(|i| buttons.item(i)?.dyn_into::<Element>().ok())
        {
            let disabled = match button.get_attribute("data-act").as_deref() {
                Some("toggle") => {
                    label(&button, play_label(state.playing), true)?;
                    !state.has_track
                }
                Some("prev") => !state.has_prev,
                Some("next") => !state.has_next,
                Some("more" | "expand" | "artist") => !state.has_track,
                Some("like") => {
                    class(&button, "is-on", state.liked)?;
                    label(
                        &button,
                        if state.liked {
                            "Quitar de Me gusta"
                        } else {
                            "Me gusta"
                        },
                        true,
                    )?;
                    pressed(&button, state.liked)?;
                    !state.can_rate
                }
                Some("dislike") => {
                    class(&button, "is-on", state.disliked)?;
                    label(
                        &button,
                        if state.disliked {
                            "Quitar «No me gusta»"
                        } else {
                            "No me gusta"
                        },
                        false,
                    )?;
                    pressed(&button, state.disliked)?;
                    !state.can_rate
                }
                Some("shuffle") => {
                    class(&button, "is-on", state.shuffle)?;
                    pressed(&button, state.shuffle)?;
                    continue;
                }
                Some("repeat") => {
                    let (on, one, text) = match state.repeat.as_str() {
                        "one" => (true, true, "Repetir: esta canción"),
                        "all" => (true, false, "Repetir: toda la cola"),
                        _ => (false, false, "Repetir: no"),
                    };
                    class(&button, "is-on", on)?;
                    class(&button, "is-one", one)?;
                    label(&button, text, true)?;
                    pressed(&button, on)?;
                    continue;
                }
                Some("mute") => {
                    label(
                        &button,
                        if state.muted {
                            "Activar sonido"
                        } else {
                            "Silenciar"
                        },
                        true,
                    )?;
                    pressed(&button, state.muted)?;
                    continue;
                }
                _ => continue,
            };
            button.toggle_attribute_with_force("disabled", disabled)?;
        }
        let volume = ratio(state.volume) * 100.0;
        let percent = volume.round().to_string();
        if self.doc.active_element().as_ref() != Some(self.volume.unchecked_ref()) {
            self.volume.set_value(&percent);
        }
        self.volume.style().set_property(
            "--level",
            &format!("{}%", if state.muted { 0.0 } else { volume }),
        )?;
        if !self.mini {
            let text = if state.muted {
                "Silenciado".into()
            } else {
                format!("{percent} %")
            };
            self.volume.set_attribute("aria-valuetext", &text)?;
        }
        Ok(track_changed)
    }

    pub fn update_time(&mut self, current: f64, duration: f64) -> Result<(), JsValue> {
        self.duration = if duration.is_finite() && duration > 0.0 {
            duration
        } else {
            0.0
        };
        self.position = if self.duration > 0.0 {
            ratio(current / self.duration)
        } else {
            0.0
        };
        self.scrub.set_disabled(self.duration == 0.0);
        if self.duration == 0.0 && self.scrubbing {
            self.cancel();
        }
        if self.mini {
            self.current.set_text_content(Some(&format_clock(current)));
            let text = if self.duration > 0.0 {
                format!("-{}", format_clock((self.duration - current).max(0.0)))
            } else {
                "-0:00".into()
            };
            self.remaining.set_text_content(Some(&text));
        } else {
            self.remaining
                .set_text_content(Some(&format_clock(duration)));
        }
        if !self.scrubbing {
            self.paint(self.position)?;
        }
        Ok(())
    }

    pub fn begin(&mut self, track: &str) {
        self.cancelled = false;
        self.scrubbing = true;
        self.gesture = track.into();
    }

    pub fn input(&mut self, track: &str) -> Result<(), JsValue> {
        if self.cancelled {
            return Ok(());
        }
        if !self.scrubbing {
            self.begin(track);
        }
        self.paint(self.scrub.value_as_number() / STEPS)
    }

    pub fn commit(&mut self, track: &str) -> Option<f64> {
        self.scrubbing = false;
        if self.cancelled || self.gesture != track || self.duration == 0.0 {
            return None;
        }
        Some(ratio(self.scrub.value_as_number() / STEPS))
    }

    pub fn end(&mut self) {
        self.scrubbing = false;
    }

    pub fn cancel(&mut self) {
        self.scrubbing = false;
        self.cancelled = true;
    }

    pub fn reset(&mut self, cancelled: bool) -> Result<(), JsValue> {
        self.scrubbing = false;
        self.cancelled = cancelled;
        self.paint(self.position)
    }

    pub fn seek_key(&mut self, key: &str) -> Result<Option<f64>, JsValue> {
        if self.duration == 0.0 {
            return Ok(None);
        }
        let next = match key {
            "Home" => 0.0,
            "End" => 1.0,
            "ArrowLeft" | "ArrowDown" => (self.preview - 5.0) / self.duration,
            "ArrowRight" | "ArrowUp" => (self.preview + 5.0) / self.duration,
            "PageDown" => (self.preview - 10.0) / self.duration,
            "PageUp" => (self.preview + 10.0) / self.duration,
            _ => return Ok(None),
        };
        self.reset(false)?;
        self.paint(next)?;
        Ok(Some(ratio(next)))
    }

    pub fn preview_label(&self, relative: f64) -> String {
        format_clock(ratio(relative) * self.duration)
    }

    pub fn preview_ratio(&self) -> Option<f64> {
        self.scrubbing
            .then(|| ratio(self.scrub.value_as_number() / STEPS))
    }
}

impl PlayerView {
    fn paint(&mut self, relative: f64) -> Result<(), JsValue> {
        let relative = ratio(relative);
        self.scrub
            .set_value(&(relative * STEPS).round().to_string());
        self.scrub
            .style()
            .set_property("--played", &format!("{:.2}%", relative * 100.0))?;
        self.preview = relative * self.duration;
        if !self.mini {
            let time = format_clock(self.preview);
            self.current.set_text_content(Some(&time));
            let accessible = if self.duration > 0.0 {
                format!("{time} de {}", format_clock(self.duration))
            } else {
                "Duración no disponible".into()
            };
            self.scrub.set_attribute("aria-valuetext", &accessible)?;
        }
        Ok(())
    }
}

#[wasm_bindgen]
pub fn volume_action(value: f64, delta: f64) -> f64 {
    ratio(value / 100.0 + delta / 100.0)
}

#[wasm_bindgen]
pub fn console_play(
    play: &HtmlElement,
    play_icon: &Element,
    pause_icon: &Element,
    playing: bool,
    native: bool,
) -> Result<(), JsValue> {
    class(play_icon, "is-hidden", playing)?;
    class(pause_icon, "is-hidden", !playing)?;
    label(play, play_label(playing), false)?;
    if native {
        play.set_attribute("data-playback", if playing { "playing" } else { "paused" })?;
        pressed(play, playing)?;
        if !playing {
            play.class_list().remove_1("is-loading")?;
        }
    }
    if let Some(body) = document(play)?.body() {
        class(&body, "is-playing", playing)?;
    }
    Ok(())
}

#[wasm_bindgen]
pub fn console_volume(
    volume: &HtmlInputElement,
    value: &HtmlElement,
    mute: &HtmlElement,
    volume_icon: &Element,
    mute_icon: &Element,
    level: f64,
    muted: bool,
) -> Result<(), JsValue> {
    let silent = muted || level == 0.0;
    let percent = (ratio(level) * 100.0).round().to_string();
    class(volume_icon, "is-hidden", silent)?;
    class(mute_icon, "is-hidden", !silent)?;
    label(
        mute,
        if silent {
            "Activar sonido"
        } else {
            "Silenciar"
        },
        false,
    )?;
    volume.set_value(&percent);
    volume
        .style()
        .set_property("--level", &format!("{percent}%"))?;
    class(volume, "is-muted", silent)?;
    value.set_text_content(Some(if silent { "—" } else { &percent }));
    Ok(())
}

#[wasm_bindgen]
pub fn console_time(
    scrub: &HtmlInputElement,
    elapsed: &HtmlElement,
    total: &HtmlElement,
    current: f64,
    duration: f64,
    scrubbing: bool,
    catalog: bool,
) -> Result<(), JsValue> {
    let known = duration.is_finite() && duration > 0.0;
    elapsed.set_text_content(Some(&format_clock(if catalog && known {
        current.min(duration)
    } else {
        current
    })));
    total.set_text_content(Some(&format_clock(duration)));
    let position = if known {
        ratio(current / duration)
    } else {
        0.0
    };
    if known && !scrubbing {
        scrub.set_value(&(position * STEPS).round().to_string());
    }
    scrub
        .style()
        .set_property("--played", &format!("{:.2}%", position * 100.0))
}

#[wasm_bindgen]
pub fn console_queue(
    prev: &HtmlElement,
    next: &HtmlElement,
    has_prev: bool,
    has_next: bool,
) -> Result<(), JsValue> {
    prev.toggle_attribute_with_force("disabled", !has_prev)?;
    next.toggle_attribute_with_force("disabled", !has_next)?;
    Ok(())
}

#[wasm_bindgen]
pub fn side_player_tab(
    upnext: &HtmlElement,
    lyrics: &HtmlElement,
    panel: &HtmlElement,
    list: &HtmlElement,
    more: &HtmlElement,
    text: &HtmlElement,
    show_lyrics: bool,
) -> Result<(), JsValue> {
    upnext.set_attribute("aria-selected", if show_lyrics { "false" } else { "true" })?;
    lyrics.set_attribute("aria-selected", if show_lyrics { "true" } else { "false" })?;
    upnext.set_tab_index(if show_lyrics { -1 } else { 0 });
    lyrics.set_tab_index(if show_lyrics { 0 } else { -1 });
    panel.set_hidden(show_lyrics);
    list.set_hidden(show_lyrics);
    more.set_hidden(show_lyrics);
    text.set_hidden(!show_lyrics);
    Ok(())
}
