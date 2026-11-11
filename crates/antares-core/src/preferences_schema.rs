// Definición compartida de las preferencias y sus límites.
use serde_json::{json, Value};
use std::sync::LazyLock;

pub fn schema() -> &'static Value {
    static SCHEMA: LazyLock<Value> = LazyLock::new(|| {
        json!({
          "appearance": {
            "theme": {
              "kind": "enum",
              "def": "dark",
              "values": [
                "dark",
                "oled",
                "midnight",
                "contrast",
                "light",
                "paper",
                "artwork",
                "system",
                "custom"
              ]
            },
            "custom": {
              "bg": {
                "kind": "color",
                "def": "#0b0d12"
              },
              "surface": {
                "kind": "color",
                "def": "#141824"
              },
              "text": {
                "kind": "color",
                "def": "#e8eaf0"
              }
            },
            "accentMode": {
              "kind": "enum",
              "def": "artwork",
              "values": [
                "artwork",
                "fixed",
                "mono"
              ]
            },
            "accentColor": {
              "kind": "color",
              "def": "#8aabd6"
            },
            "background": {
              "kind": "enum",
              "def": "plain",
              "values": [
                "plain",
                "artwork",
                "image"
              ]
            },
            "backgroundDim": {
              "kind": "num",
              "def": 70,
              "min": 0,
              "max": 95
            },
            "backgroundBlur": {
              "kind": "num",
              "def": 40,
              "min": 0,
              "max": 80
            },
            "scale": {
              "kind": "enum",
              "def": 1,
              "values": [
                0.9,
                1,
                1.1,
                1.25,
                1.4
              ]
            },
            "density": {
              "kind": "enum",
              "def": "normal",
              "values": [
                "compact",
                "normal",
                "comfortable"
              ]
            },
            "corners": {
              "kind": "enum",
              "def": "soft",
              "values": [
                "sharp",
                "soft",
                "round"
              ]
            },
            "motion": {
              "kind": "enum",
              "def": "full",
              "values": [
                "full",
                "reduced",
                "none"
              ]
            },
            "font": {
              "kind": "enum",
              "def": "inter",
              "values": [
                "inter",
                "system",
                "modern",
                "humanist",
                "soft",
                "classic",
                "serif",
                "editorial",
                "elegant",
                "mono",
                "typewriter",
                "handwritten"
              ]
            },
            "artTint": {
              "kind": "enum",
              "def": "medium",
              "values": [
                "soft",
                "medium",
                "strong"
              ]
            }
          },
          "sound": {
            "level": {
              "kind": "bool",
              "def": true
            },
            "preset": {
              "kind": "text",
              "def": "flat",
              "max": 60
            },
            "bands": {
              "kind": "numList",
              "def": [
                0,
                0,
                0,
                0,
                0,
                0,
                0,
                0,
                0,
                0
              ],
              "len": 10,
              "min": -12,
              "max": 12
            },
            "userPresets": {
              "kind": "list",
              "def": [],
              "item": {
                "name": {
                  "kind": "text",
                  "def": "",
                  "max": 40
                },
                "bands": {
                  "kind": "numList",
                  "def": [
                    0,
                    0,
                    0,
                    0,
                    0,
                    0,
                    0,
                    0,
                    0,
                    0
                  ],
                  "len": 10,
                  "min": -12,
                  "max": 12
                }
              },
              "max": 20
            },
            "crossfade": {
              "kind": "num",
              "def": 0,
              "min": 0,
              "max": 12
            }
          },
          "playback": {
            "volume": {
              "kind": "num",
              "def": 0.8,
              "min": 0,
              "max": 1
            },
            "muted": {
              "kind": "bool",
              "def": false
            },
            "shuffle": {
              "kind": "bool",
              "def": false
            },
            "repeat": {
              "kind": "enum",
              "def": "off",
              "values": [
                "off",
                "all",
                "one"
              ]
            },
            "quality": {
              "kind": "enum",
              "def": "high",
              "values": [
                "high",
                "saver"
              ]
            }
          },
          "discovery": {
            "adventure": {
              "kind": "num",
              "def": 0.3,
              "min": 0,
              "max": 1
            },
            "autoplay": {
              "kind": "bool",
              "def": true
            },
            "variety": {
              "kind": "enum",
              "def": "normal",
              "values": [
                "low",
                "normal",
                "high"
              ]
            },
            "freshHours": {
              "kind": "num",
              "def": 24,
              "min": 1,
              "max": 168
            },
            "minSeconds": {
              "kind": "num",
              "def": 60,
              "min": 0,
              "max": 300
            },
            "maxMinutes": {
              "kind": "num",
              "def": 12,
              "min": 3,
              "max": 60
            },
            "excludeWords": {
              "kind": "list",
              "def": [],
              "item": {
                "kind": "text",
                "def": "",
                "max": 40
              },
              "max": 100
            },
            "blockedChannels": {
              "kind": "list",
              "def": [],
              "item": {
                "kind": "text",
                "def": "",
                "max": 80
              },
              "max": 200
            },
            "lessArtists": {
              "kind": "list",
              "def": [],
              "item": {
                "kind": "text",
                "def": "",
                "max": 80
              },
              "max": 200
            },
            "knownTracks": {
              "kind": "list",
              "def": [],
              "item": {
                "kind": "text",
                "def": "",
                "max": 40
              },
              "max": 500
            }
          },
          "interface": {
            "sideTab": {
              "kind": "enum",
              "def": "upnext",
              "values": [
                "upnext",
                "lyrics"
              ]
            },
            "lastTab": {
              "kind": "enum",
              "def": "home",
              "values": [
                "home",
                "results",
                "discover",
                "queue",
                "history",
                "lists",
                "summary"
              ]
            }
          },
          "layout": {
            "sidebar": {
              "kind": "enum",
              "def": "full",
              "values": [
                "full",
                "icons"
              ]
            },
            "mirrored": {
              "kind": "bool",
              "def": false
            },
            "sidebarWidth": {
              "kind": "num",
              "def": 236,
              "min": 180,
              "max": 360
            },
            "nowplayingWidth": {
              "kind": "num",
              "def": 360,
              "min": 300,
              "max": 560
            },
            "tabOrder": {
              "kind": "order",
              "def": [
                "home",
                "results",
                "discover",
                "queue",
                "history",
                "lists",
                "summary"
              ],
              "values": [
                "home",
                "results",
                "discover",
                "queue",
                "history",
                "lists",
                "summary"
              ]
            },
            "hiddenTabs": {
              "kind": "subset",
              "def": [],
              "values": [
                "home",
                "results",
                "discover",
                "queue",
                "history",
                "lists",
                "summary"
              ]
            },
            "startTab": {
              "kind": "enum",
              "def": "home",
              "values": [
                "last",
                "home",
                "results",
                "discover",
                "queue",
                "history",
                "lists",
                "summary"
              ]
            },
            "artwork": {
              "kind": "enum",
              "def": "medium",
              "values": [
                "hidden",
                "small",
                "medium",
                "large"
              ]
            },
            "upnext": {
              "kind": "bool",
              "def": true
            },
            "showRate": {
              "kind": "bool",
              "def": true
            },
            "showRadio": {
              "kind": "bool",
              "def": true
            },
            "showSleep": {
              "kind": "bool",
              "def": true
            },
            "showModes": {
              "kind": "bool",
              "def": true
            },
            "showVolume": {
              "kind": "bool",
              "def": true
            },
            "miniOnTop": {
              "kind": "bool",
              "def": true
            }
          },
          "player": {
            "focusVisualizer": {
              "kind": "bool",
              "def": false
            },
            "bar": {
              "kind": "bool",
              "def": true
            },
            "barPosition": {
              "kind": "enum",
              "def": "bottom",
              "values": [
                "bottom",
                "top"
              ]
            },
            "barProgress": {
              "kind": "enum",
              "def": "edge",
              "values": [
                "edge",
                "inline"
              ]
            },
            "barSize": {
              "kind": "enum",
              "def": "normal",
              "values": [
                "compact",
                "normal",
                "large"
              ]
            },
            "barStyle": {
              "kind": "enum",
              "def": "solid",
              "values": [
                "solid",
                "glass",
                "artwork"
              ]
            },
            "barShape": {
              "kind": "enum",
              "def": "full",
              "values": [
                "full",
                "floating"
              ]
            },
            "barPlay": {
              "kind": "enum",
              "def": "auto",
              "values": [
                "auto",
                "circle",
                "plain"
              ]
            },
            "barAccent": {
              "kind": "enum",
              "def": "artwork",
              "values": [
                "artwork",
                "neutral"
              ]
            },
            "barArtwork": {
              "kind": "bool",
              "def": true
            },
            "barAlbum": {
              "kind": "bool",
              "def": true
            },
            "barRate": {
              "kind": "bool",
              "def": true
            },
            "barVolume": {
              "kind": "bool",
              "def": true
            },
            "barModes": {
              "kind": "bool",
              "def": true
            },
            "barExtras": {
              "kind": "bool",
              "def": true
            },
            "consoleControls": {
              "kind": "bool",
              "def": false
            },
            "miniStyle": {
              "kind": "enum",
              "def": "artwork",
              "values": [
                "artwork",
                "compact"
              ]
            },
            "miniSize": {
              "kind": "enum",
              "def": "medium",
              "values": [
                "small",
                "medium",
                "large"
              ]
            },
            "miniControls": {
              "kind": "enum",
              "def": "hover",
              "values": [
                "hover",
                "always"
              ]
            },
            "miniLyrics": {
              "kind": "bool",
              "def": false
            },
            "miniAlign": {
              "kind": "enum",
              "def": "center",
              "values": [
                "center",
                "left"
              ]
            },
            "miniShade": {
              "kind": "enum",
              "def": "soft",
              "values": [
                "soft",
                "strong"
              ]
            }
          },
          "home": {
            "shelfOrder": {
              "kind": "order",
              "def": [
                "mix",
                "again",
                "genres",
                "because",
                "top",
                "discoveries",
                "artists",
                "lists",
                "explore"
              ],
              "values": [
                "mix",
                "again",
                "genres",
                "because",
                "top",
                "discoveries",
                "artists",
                "lists",
                "explore"
              ]
            },
            "hiddenShelves": {
              "kind": "subset",
              "def": [],
              "values": [
                "mix",
                "again",
                "genres",
                "because",
                "top",
                "discoveries",
                "artists",
                "lists",
                "explore"
              ]
            },
            "pinnedShelves": {
              "kind": "subset",
              "def": [],
              "values": [
                "mix",
                "again",
                "genres",
                "because",
                "top",
                "discoveries",
                "artists",
                "lists",
                "explore"
              ]
            },
            "genres": {
              "kind": "subset",
              "def": [],
              "values": [
                "reggaeton",
                "trap-latino",
                "pop-latino",
                "cumbia",
                "bachata",
                "salsa",
                "regional-mexicano",
                "rock",
                "rock-espanol",
                "pop",
                "hip-hop",
                "rnb",
                "electronica",
                "baladas",
                "lofi",
                "clasica"
              ]
            }
          },
          "behavior": {
            "rowClick": {
              "kind": "enum",
              "def": "now",
              "values": [
                "now",
                "next",
                "add"
              ]
            },
            "skipSeconds": {
              "kind": "num",
              "def": 10,
              "min": 5,
              "max": 30
            },
            "volumeStep": {
              "kind": "num",
              "def": 5,
              "min": 1,
              "max": 20
            },
            "startup": {
              "kind": "enum",
              "def": "resume",
              "values": [
                "resume",
                "empty",
                "mix"
              ]
            },
            "notify": {
              "kind": "bool",
              "def": false
            }
          },
          "shortcuts": {
            "local": {
              "playPause": {
                "kind": "combo",
                "def": "Space"
              },
              "next": {
                "kind": "combo",
                "def": "Shift+ArrowRight"
              },
              "prev": {
                "kind": "combo",
                "def": "Shift+ArrowLeft"
              },
              "seekForward": {
                "kind": "combo",
                "def": "ArrowRight"
              },
              "seekBack": {
                "kind": "combo",
                "def": "ArrowLeft"
              },
              "volumeUp": {
                "kind": "combo",
                "def": "ArrowUp"
              },
              "volumeDown": {
                "kind": "combo",
                "def": "ArrowDown"
              },
              "mute": {
                "kind": "combo",
                "def": "KeyM"
              },
              "shuffle": {
                "kind": "combo",
                "def": "KeyS"
              },
              "repeat": {
                "kind": "combo",
                "def": "KeyR"
              },
              "like": {
                "kind": "combo",
                "def": "KeyL"
              },
              "search": {
                "kind": "combo",
                "def": "Slash"
              },
              "focus": {
                "kind": "combo",
                "def": "KeyF"
              },
              "mini": {
                "kind": "combo",
                "def": "Ctrl+KeyM"
              },
              "fullscreen": {
                "kind": "combo",
                "def": "F11"
              }
            },
            "globalEnabled": {
              "kind": "bool",
              "def": false
            },
            "global": {
              "playPause": {
                "kind": "combo",
                "def": "Ctrl+Alt+KeyP"
              },
              "next": {
                "kind": "combo",
                "def": "Ctrl+Alt+ArrowRight"
              },
              "prev": {
                "kind": "combo",
                "def": "Ctrl+Alt+ArrowLeft"
              },
              "volumeUp": {
                "kind": "combo",
                "def": "Ctrl+Alt+ArrowUp"
              },
              "volumeDown": {
                "kind": "combo",
                "def": "Ctrl+Alt+ArrowDown"
              },
              "like": {
                "kind": "combo",
                "def": "Ctrl+Alt+KeyL"
              },
              "show": {
                "kind": "combo",
                "def": "Ctrl+Alt+KeyA"
              }
            }
          },
          "lyrics": {
            "size": {
              "kind": "enum",
              "def": "medium",
              "values": [
                "small",
                "medium",
                "large"
              ]
            },
            "align": {
              "kind": "enum",
              "def": "left",
              "values": [
                "left",
                "center"
              ]
            },
            "offset": {
              "kind": "num",
              "def": 0,
              "min": -5,
              "max": 5
            }
          },
          "mobile": {
            "energySaver": {
              "kind": "bool",
              "def": true
            },
            "haptics": {
              "kind": "bool",
              "def": false
            },
            "prefetch": {
              "kind": "bool",
              "def": false
            }
          },
          "system": {
            "closeToTray": {
              "kind": "bool",
              "def": true
            },
            "autostart": {
              "kind": "bool",
              "def": false
            },
            "startHidden": {
              "kind": "bool",
              "def": false
            },
            "updateCheck": {
              "kind": "bool",
              "def": true
            }
          }
        })
    });
    &SCHEMA
}

pub fn metadata() -> Value {
    json!({
      "EQ_BANDS": [
        31,
        62,
        125,
        250,
        500,
        1000,
        2000,
        4000,
        8000,
        16000
      ],
      "FONT_IDS": [
        "inter",
        "system",
        "modern",
        "humanist",
        "soft",
        "classic",
        "serif",
        "editorial",
        "elegant",
        "mono",
        "typewriter",
        "handwritten"
      ],
      "GLOBAL_SHORTCUTS": {
        "playPause": "Ctrl+Alt+KeyP",
        "next": "Ctrl+Alt+ArrowRight",
        "prev": "Ctrl+Alt+ArrowLeft",
        "volumeUp": "Ctrl+Alt+ArrowUp",
        "volumeDown": "Ctrl+Alt+ArrowDown",
        "like": "Ctrl+Alt+KeyL",
        "show": "Ctrl+Alt+KeyA"
      },
      "LOCAL_SHORTCUTS": {
        "playPause": "Space",
        "next": "Shift+ArrowRight",
        "prev": "Shift+ArrowLeft",
        "seekForward": "ArrowRight",
        "seekBack": "ArrowLeft",
        "volumeUp": "ArrowUp",
        "volumeDown": "ArrowDown",
        "mute": "KeyM",
        "shuffle": "KeyS",
        "repeat": "KeyR",
        "like": "KeyL",
        "search": "Slash",
        "focus": "KeyF",
        "mini": "Ctrl+KeyM",
        "fullscreen": "F11"
      },
      "SHELF_IDS": [
        "mix",
        "again",
        "genres",
        "because",
        "top",
        "discoveries",
        "artists",
        "lists",
        "explore"
      ],
      "TAB_IDS": [
        "home",
        "results",
        "discover",
        "queue",
        "history",
        "lists",
        "summary"
      ],
      "THEME_IDS": [
        "dark",
        "oled",
        "midnight",
        "contrast",
        "light",
        "paper",
        "artwork",
        "system",
        "custom"
      ],
      "VERSION": 2
    })
}
