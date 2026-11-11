use regex::Regex;
use serde::{Deserialize, Serialize};
use std::{cmp::Reverse, collections::HashSet, sync::LazyLock};
use unicode_normalization::UnicodeNormalization;

#[derive(Deserialize)]
pub struct Artist {
    name: String,
}

#[derive(Deserialize)]
pub struct SearchTrack {
    id: Option<String>,
    title: Option<String>,
    uploader: Option<String>,
    artists: Option<Vec<Artist>>,
}

impl SearchTrack {
    fn title(&self) -> &str {
        self.title.as_deref().unwrap_or_default()
    }

    fn uploader(&self) -> &str {
        self.uploader.as_deref().unwrap_or_default()
    }

    fn artists(&self) -> &[Artist] {
        self.artists.as_deref().unwrap_or_default()
    }

    fn look(&self) -> (Vec<String>, String) {
        (words(self.title()), artist_key(self.uploader()))
    }
}

#[derive(Serialize)]
pub struct RankedSearch {
    // Índices en la concatenación de vídeos y canciones. Así se preservan
    // todos los datos de la pista original en el adaptador.
    pub order: Vec<usize>,
    pub artist: Option<String>,
    pub split: isize,
}

static CHANNEL_SUFFIX: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)(?:\s-\sTopic|VEVO)$").unwrap());
static ARTIST_SUFFIX: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?:\s-\stopic|vevo)$").unwrap());
static OFFICIAL_SUFFIX: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"\s(?:official|oficial)$").unwrap());
static TITLE_SEPARATOR: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\s[-–—]\s").unwrap());

fn fold(text: &str) -> String {
    text.to_lowercase()
        .nfd()
        .filter(|ch| !matches!(ch, '\u{0300}'..='\u{036f}'))
        .collect()
}

fn words(text: &str) -> Vec<String> {
    fold(text)
        .replace('&', " and ")
        .split(|ch: char| !ch.is_ascii_alphanumeric())
        .filter(|word| !word.is_empty())
        .map(str::to_owned)
        .collect()
}

fn artist_key(name: &str) -> String {
    let folded = fold(name);
    let stripped = ARTIST_SUFFIX.replace(&folded, "");
    words(&OFFICIAL_SUFFIX.replace(&stripped, ""))
        .into_iter()
        .filter(|word| {
            !matches!(
                word.as_str(),
                "and" | "y" | "e" | "x" | "feat" | "ft" | "featuring" | "con" | "with" | "the"
            )
        })
        .collect()
}

pub fn matches_query(title: &str, query: &str) -> bool {
    let have: HashSet<_> = words(title).into_iter().filter(|w| w.len() >= 2).collect();
    let wanted: HashSet<_> = words(query).into_iter().filter(|w| w.len() >= 2).collect();
    !have.is_empty() && !wanted.is_empty() && (wanted.is_subset(&have) || have.is_subset(&wanted))
}

fn song_query(query: &str, artist: &str) -> Option<String> {
    let wanted = words(query);
    let key = artist_key(artist);
    if key.is_empty() {
        return None;
    }
    for split in 1..wanted.len() {
        let left = wanted[..split].join(" ");
        let right = wanted[split..].join(" ");
        if artist_key(&left) == key {
            return Some(right);
        }
        if artist_key(&right) == key {
            return Some(left);
        }
    }
    None
}

fn named_song(track: &SearchTrack, query: &str) -> bool {
    track.artists().iter().any(|artist| {
        song_query(query, &artist.name).is_some_and(|title| matches_query(track.title(), &title))
    })
}

fn video_from_artist(track: &SearchTrack, query: &str) -> bool {
    let key = artist_key(track.uploader());
    if key.is_empty() {
        return false;
    }
    if let Some(title) = song_query(query, track.uploader()) {
        return matches_query(track.title(), &title);
    }
    let channel_in_title = TITLE_SEPARATOR.is_match(track.title())
        && TITLE_SEPARATOR
            .split(track.title())
            .flat_map(|part| part.split(','))
            .any(|part| artist_key(part.trim()) == key);
    (channel_in_title || CHANNEL_SUFFIX.is_match(track.uploader()))
        && matches_query(track.title(), query)
}

pub fn rank_search(videos: &[SearchTrack], songs: &[SearchTrack], query: &str) -> RankedSearch {
    let tracks: Vec<_> = videos.iter().chain(songs).collect();
    let all = 0..videos.len();
    let mut looks = HashSet::new();
    let official: Vec<_> = (videos.len()..tracks.len())
        .filter(|&i| {
            let track = tracks[i];
            (matches_query(track.title(), query) || named_song(track, query))
                && looks.insert(track.look())
        })
        .collect();

    let named_video = all.clone().find(|&i| {
        song_query(query, tracks[i].uploader()).is_some() && video_from_artist(tracks[i], query)
    });
    let main = official
        .iter()
        .copied()
        .find(|&i| named_song(tracks[i], query))
        .or_else(|| {
            if named_video.is_some() {
                return None;
            }
            official
                .iter()
                .copied()
                .find(|&i| !tracks[i].artists().is_empty())
        });
    let by_title = |order: &mut Vec<usize>, title: &str| {
        order.sort_by_cached_key(|&i| Reverse(matches_query(tracks[i].title(), title)));
    };

    let Some(main) = main.map(|i| tracks[i]) else {
        let first =
            named_video.or_else(|| all.clone().find(|&i| video_from_artist(tracks[i], query)));
        let Some(first) = first.map(|i| tracks[i]) else {
            return RankedSearch {
                order: all.collect(),
                artist: None,
                split: -1,
            };
        };
        let key = artist_key(first.uploader());
        let (mine, mut others): (Vec<_>, Vec<_>) = all.partition(|&i| {
            artist_key(tracks[i].uploader()) == key && video_from_artist(tracks[i], query)
        });
        let title = song_query(query, first.uploader());
        by_title(&mut others, title.as_deref().unwrap_or(query));
        return combine(mine, others, first.uploader().to_owned());
    };

    let keys: HashSet<_> = main
        .artists()
        .iter()
        .map(|a| artist_key(&a.name))
        .filter(|key| !key.is_empty())
        .collect();
    let is_mine = |i: usize| {
        tracks[i]
            .artists()
            .iter()
            .any(|a| keys.contains(&artist_key(&a.name)))
    };
    let title = main
        .artists()
        .iter()
        .find_map(|a| song_query(query, &a.name));
    let title = title.as_deref().unwrap_or(query);
    let mut seen = HashSet::new();
    let mut take = |&i: &usize| {
        let track = tracks[i];
        track
            .id
            .as_deref()
            .filter(|id| !id.is_empty())
            .is_some_and(|id| {
                (i >= videos.len() || !looks.contains(&track.look())) && seen.insert(id)
            })
    };
    let mine = official
        .iter()
        .copied()
        .filter(|&i| is_mine(i))
        .chain(all.clone().filter(|&i| {
            keys.contains(&artist_key(tracks[i].uploader()))
                && matches_query(tracks[i].title(), title)
        }))
        .filter(&mut take)
        .collect();
    let mut others: Vec<_> = all
        .chain(official.iter().copied().filter(|&i| !is_mine(i)))
        .collect();
    by_title(&mut others, title);
    others.retain(take);
    let artist = main.uploader.clone().unwrap_or_else(|| {
        main.artists()
            .iter()
            .map(|a| a.name.as_str())
            .collect::<Vec<_>>()
            .join(", ")
    });
    combine(mine, others, artist)
}

fn combine(mut mine: Vec<usize>, others: Vec<usize>, artist: String) -> RankedSearch {
    let split = if others.is_empty() {
        -1
    } else {
        mine.len() as isize
    };
    mine.extend(others);
    RankedSearch {
        order: mine,
        artist: Some(artist),
        split,
    }
}
