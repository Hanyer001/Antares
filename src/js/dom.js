// Referencias compartidas a los elementos de index.html.
// El módulo se carga después de analizar el documento.

const $ = (selector) => document.querySelector(selector);

export const els = {
  // Búsqueda
  form: $("#search-form"),
  input: $("#search-input"),
  button: $("#search-button"),

  // Cabecera y estado
  engine: $("#engine"),
  title: $("#track-title"),
  by: $("#track-by"),
  artwork: $("#artwork"),
  artImg: $("#artwork-img"),

  // Ajustes
  settings: $("#settings"),
  engineVersion: $("#engine-version"),
  updateButton: $("#update-button"),
  historyCount: $("#history-count"),
  clearHistoryButton: $("#clear-history-button"),
  fullscreenButton: $("#fullscreen-button"),
  settingsSearchBox: $("#settings-search-box"),
  settingsSearch: $("#settings-search"),
  settingsNone: $("#settings-none"),
  exportTheme: $("#export-theme"),
  exportSettings: $("#export-settings"),
  importInput: $("#import-input"),
  resetAll: $("#reset-all"),

  // Diseño, Inicio, Reproducción y Atajos (en Ajustes)
  resetWidths: $("#reset-widths"),
  tryMini: $("#try-mini"),
  tabOrder: $("#tab-order"),
  shelfOrder: $("#shelf-order"),
  genreChips: $("#genre-chips"),
  genresHint: $("#genres-hint"),
  incognitoToggle: $("#incognito-toggle"),
  lyricsOffsetSetting: $("#lyrics-offset-setting"),
  localKeys: $("#local-keys"),
  globalKeys: $("#global-keys"),

  // Inicio
  home: $("#home"),

  // Artista, álbum o lista de YouTube
  artist: $("#artist"),
  artistTop: $("#artist-top"),
  artistSongs: $("#artist-songs"),
  artistShelves: $("#artist-shelves"),

  // Avisos breves
  toasts: $("#toasts"),

  // Apariencia (en Ajustes)
  themePicker: $("#theme-picker"),
  accentSwatches: $("#accent-swatches"),
  accentHint: $("#accent-hint"),
  contrastWarning: $("#contrast-warning"),
  wallpaperState: $("#wallpaper-state"),
  wallpaperPick: $("#wallpaper-pick"),
  wallpaperClear: $("#wallpaper-clear"),
  wallpaperInput: $("#wallpaper-input"),

  // Sonido (en Ajustes)
  levelToggle: $("#level-toggle"),
  eqPreset: $("#eq-preset"),
  eqBands: $("#eq-bands"),
  eqSave: $("#eq-save"),
  eqDelete: $("#eq-delete"),

  // Recomendaciones (en Ajustes)
  excludeWords: $("#exclude-words"),
  blockedChannels: $("#blocked-channels"),
  freshHoursValue: $("#fresh-hours-value"),
  minSecondsValue: $("#min-seconds-value"),

  // Perfiles y usuarios
  profileNew: $("#profile-new"),
  profileList: $("#profile-list"),
  userNew: $("#user-new"),
  userList: $("#user-list"),
  peopleButton: $("#people-button"),
  peopleAvatar: $("#people-avatar"),
  peopleName: $("#people-name"),
  peopleProfile: $("#people-profile"),
  crossfade: $("#crossfade"),
  crossfadeValue: $("#crossfade-value"),

  // Resumen
  summary: $("#summary"),
  metrics: $("#metrics"),
  artists: $("#artists"),

  // Barra lateral
  sidebarLists: $("#sidebar-lists"),
  newListButton: $("#new-list-button"),

  // Cabecera de la vista central
  viewTitle: $("#view-title"),
  viewMeta: $("#view-meta"),

  // Descubrir
  discover: $("#discover"),
  adventure: $("#adventure"),
  adventureValue: $("#adventure-value"),
  autoplay: $("#autoplay"),

  // Columna de lo que suena
  radioButton: $("#radio-button"),
  sleepButton: $("#sleep-button"),
  sleepLabel: $("#sleep-label"),
  upnextTab: $("#upnext-tab"),
  lyricsTab: $("#lyrics-tab"),
  upnextList: $("#upnext-list"),
  upnextMore: $("#upnext-more"),
  lyrics: $("#lyrics"),
  lyricsSync: $("#lyrics-sync"),
  lyricsOffset: $("#lyrics-offset"),
  lyricsEarlier: $("#lyrics-earlier"),
  lyricsLater: $("#lyrics-later"),
  incognitoChip: $("#incognito-chip"),
  focusButton: $("#focus-button"),
  miniButton: $("#mini-button"),
  modeExit: $("#mode-exit"),

  // Línea de tiempo
  scrub: $("#scrub"),
  timeCurrent: $("#time-current"),
  timeTotal: $("#time-total"),

  // Transporte
  play: $("#play-button"),
  prev: $("#prev-button"),
  next: $("#next-button"),
  mute: $("#mute-button"),
  volume: $("#volume"),
  volumeValue: $("#volume-value"),

  // Modos de la cola y valoración
  shuffle: $("#shuffle-button"),
  repeat: $("#repeat-button"),
  like: $("#like-button"),
  dislike: $("#dislike-button"),

  // Panel de listas
  results: $("#results"),
  tabs: $("#tabs"),
  queueCount: $("#queue-count"),
  panelHead: $("#panel-head"),
  resultsList: $("#results-list"),

  // Diálogo
  dialog: $("#dialog"),
  dialogForm: $("#dialog-form"),
  dialogTitle: $("#dialog-title"),
  dialogText: $("#dialog-text"),
  dialogInput: $("#dialog-input"),
  dialogCancel: $("#dialog-cancel"),
  dialogOk: $("#dialog-ok"),

  // Motor de audio e iconos que alternan
  audio: $("#reproductor-audio"),
  audioB: $("#reproductor-audio-b"),
  iconPlay: $(".icon-play"),
  iconPause: $(".icon-pause"),
  iconVol: $(".icon-vol"),
  iconMute: $(".icon-mute"),
};
