// Catálogo de géneros y detección por artista y título, ponderada por escuchas.
// La selección manual de Ajustes permite corregir la detección.

export const GENRES = [
  {
    id: "reggaeton",
    name: "Reggaetón",
    query: "reggaeton éxitos",
    artists: [
      "bad bunny", "daddy yankee", "j balvin", "karol g", "ozuna", "anuel", "farruko",
      "maluma", "rauw alejandro", "myke towers", "feid", "sech", "nicky jam", "wisin",
      "yandel", "don omar", "arcangel", "arcángel", "de la ghetto", "ñengo flow",
      "almighty", "lunay", "justin quiles", "dalex", "zion", "tempo", "blessd",
      "ryan castro", "jhayco", "jhay cortez", "manuel turizo", "kevvo", "chencho corleone",
      "plan b", "tito el bambino", "cosculluela", "la factoria", "omega", "el alfa",
      "pepe quintana", "bryant myers", "mora", "brray", "young miko", "dei v",
    ],
    keywords: ["reggaeton", "reggaetón", "perreo", "dembow"],
  },
  {
    id: "trap-latino",
    name: "Trap latino",
    query: "trap latino nuevo",
    artists: [
      "eladio carrion", "eladio carrión", "yan block", "milo j", "duki", "trueno",
      "paulo londra", "noriel", "aleman", "alemán", "lary over", "ysy a", "nicki nicole",
      "tiago pzk", "khea", "bizarrap", "polimá", "pablo chill-e", "young cister", "tobal mj",
      "rari", "808 sick", "neo pistea", "cazzu", "lit killah", "c.r.o", "rusherking",
      "bryant myers", "anuel", "almighty", "hades66", "de la rose", "quevedo", "jere klein",
    ],
    keywords: ["trap", "drill"],
  },
  {
    id: "pop-latino",
    name: "Pop latino",
    query: "pop latino éxitos",
    artists: [
      "shakira", "camilo", "sebastian yatra", "sebastián yatra", "morat", "reik",
      "carlos vives", "enrique iglesias", "ricky martin", "juanes", "tini", "aitana",
      "danna paola", "mau y ricky", "cnco", "piso 21", "greeicy", "emilia", "lali",
    ],
    keywords: [],
  },
  {
    id: "cumbia",
    name: "Cumbia y RKT",
    query: "cumbia éxitos",
    artists: [
      "los palmeras", "damas gratis", "l-gante", "la liga", "ke personajes", "los angeles azules",
      "los ángeles azules", "grupo 5", "agua marina", "karina", "la k'onga", "rodrigo",
      "gilda", "los wachiturros", "el polaco", "mala fama", "ráfaga", "rafaga",
    ],
    keywords: ["cumbia", "rkt", "cuarteto"],
  },
  {
    id: "bachata",
    name: "Bachata",
    query: "bachata éxitos",
    artists: ["romeo santos", "aventura", "prince royce", "juan luis guerra", "frank reyes", "anthony santos", "grupo extra"],
    keywords: ["bachata"],
  },
  {
    id: "salsa",
    name: "Salsa",
    query: "salsa clásicos",
    artists: [
      "marc anthony", "hector lavoe", "héctor lavoe", "grupo niche", "willie colon",
      "willie colón", "celia cruz", "gilberto santa rosa", "victor manuelle",
      "víctor manuelle", "oscar d'leon", "joe arroyo", "ruben blades", "rubén blades",
      "frankie ruiz", "el gran combo",
    ],
    keywords: ["salsa"],
  },
  {
    id: "regional-mexicano",
    name: "Regional mexicano",
    query: "corridos tumbados nuevos",
    artists: [
      "peso pluma", "natanael cano", "junior h", "fuerza regida", "grupo frontera",
      "christian nodal", "eslabon armado", "eslabón armado", "gabito ballesteros",
      "xavi", "carin leon", "carín león", "banda ms", "los tigres del norte",
      "julion alvarez", "julión álvarez", "calibre 50", "grupo firme", "tito double p",
    ],
    keywords: ["corrido", "corridos", "banda", "norteño", "norteña", "mariachi", "sierreño"],
  },
  {
    id: "rock",
    name: "Rock",
    query: "rock clásicos",
    artists: [
      "nirvana", "radiohead", "queen", "ac/dc", "metallica", "foo fighters", "arctic monkeys",
      "the beatles", "led zeppelin", "pink floyd", "guns n' roses", "red hot chili peppers",
      "linkin park", "the strokes", "pearl jam", "oasis", "muse", "green day", "the killers",
      "coldplay", "blink-182", "the rolling stones", "system of a down", "rage against the machine",
    ],
    keywords: ["rock", "grunge", "metal", "punk"],
  },
  {
    id: "rock-espanol",
    name: "Rock en español",
    query: "rock en español clásicos",
    artists: [
      "soda stereo", "heroes del silencio", "héroes del silencio", "mana", "maná", "caifanes",
      "enanitos verdes", "los prisioneros", "cafe tacvba", "café tacvba", "gustavo cerati",
      "la ley", "los fabulosos cadillacs", "el tri", "zoé", "zoe", "fito paez", "fito páez",
      "andres calamaro", "andrés calamaro", "los bunkers", "vilma palma",
    ],
    keywords: [],
  },
  {
    id: "pop",
    name: "Pop",
    query: "pop hits",
    artists: [
      "taylor swift", "dua lipa", "ariana grande", "ed sheeran", "billie eilish", "harry styles",
      "olivia rodrigo", "justin bieber", "katy perry", "lady gaga", "rihanna", "adele",
      "sabrina carpenter", "miley cyrus", "selena gomez", "shawn mendes", "sia", "charli xcx",
    ],
    keywords: [],
  },
  {
    id: "hip-hop",
    name: "Hip hop",
    query: "hip hop hits",
    artists: [
      "eminem", "kendrick lamar", "drake", "travis scott", "kanye west", "j. cole", "j cole",
      "50 cent", "2pac", "tupac", "the notorious b.i.g", "snoop dogg", "dr. dre", "lil wayne",
      "future", "21 savage", "post malone", "a$ap rocky", "tyler, the creator", "nicki minaj",
      "cardi b", "doja cat", "lil baby", "playboi carti",
    ],
    keywords: ["rap", "hip hop", "hip-hop", "freestyle"],
  },
  {
    id: "rnb",
    name: "R&B",
    query: "r&b hits",
    artists: ["the weeknd", "sza", "frank ocean", "bruno mars", "beyonce", "beyoncé", "usher", "chris brown", "daniel caesar", "h.e.r.", "brent faiyaz", "summer walker"],
    keywords: ["r&b", "rnb"],
  },
  {
    id: "electronica",
    name: "Electrónica",
    query: "electronic dance hits",
    artists: [
      "avicii", "david guetta", "calvin harris", "martin garrix", "skrillex", "daft punk",
      "fred again", "tiesto", "tiësto", "marshmello", "kygo", "deadmau5", "swedish house mafia",
      "alan walker", "zedd", "diplo", "major lazer", "peggy gou", "fisher",
    ],
    // Sin "remix": un remix de reggaetón sigue siendo reggaetón.
    keywords: ["edm", "house", "techno", "electronic", "trance"],
  },
  {
    id: "baladas",
    name: "Baladas",
    query: "baladas románticas",
    artists: [
      "luis miguel", "jose jose", "josé josé", "camilo sesto", "ricardo arjona", "alejandro sanz",
      "laura pausini", "rocio durcal", "rocío dúrcal", "juan gabriel", "julio iglesias",
      "cristian castro", "franco de vita", "ricardo montaner", "marco antonio solis",
      "marco antonio solís", "chayanne",
    ],
    keywords: ["balada", "baladas"],
  },
  {
    id: "lofi",
    name: "Lo-fi y chill",
    query: "lofi hip hop chill",
    artists: ["lofi girl", "chillhop", "nujabes", "joji"],
    keywords: ["lofi", "lo-fi", "chill", "relax", "study"],
  },
  {
    id: "clasica",
    name: "Clásica",
    query: "música clásica",
    artists: ["mozart", "beethoven", "bach", "chopin", "vivaldi", "tchaikovsky", "debussy", "ludovico einaudi", "hans zimmer"],
    keywords: ["symphony", "sinfonía", "concerto", "concierto", "sonata", "piano"],
  },
];

export const GENRE_IDS = GENRES.map((g) => g.id);

export function genreById(id) {
  return GENRES.find((g) => g.id === id) ?? null;
}

/** Sin tildes, en minúsculas y con los separadores como espacios. */
export function normalize(text) {
  return ` ${String(text ?? "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}&$'!.-]+/gu, " ")
    .trim()} `;
}

/** Si `needle` aparece en `haystack` como palabra(s) entera(s). */
function contains(haystack, needle) {
  return haystack.includes(normalize(needle));
}

/** Los géneros de una pista (puede ser más de uno, o ninguno). */
export function genresOf(track) {
  const who = normalize(track.uploader);
  const all = normalize(`${track.uploader ?? ""} ${track.title ?? ""}`);
  const title = normalize(track.title);

  return GENRES.filter(
    (genre) =>
      genre.artists.some((artist) => contains(all, artist) || contains(who, artist)) ||
      genre.keywords.some((word) => contains(title, word)),
  ).map((genre) => genre.id);
}

/** Las pistas de la biblioteca de un género, en el orden en que vengan. */
export function tracksOfGenre(library, id) {
  return library.filter((track) => genresOf(track).includes(id));
}

/** Por debajo de esta parte de lo escuchado, un género no se da por tuyo. */
const MIN_SHARE = 0.12;

/**
 * Tus géneros, del que más al que menos, con las pistas de cada uno.
 *
 * @param {Array<{listened_secs:number}>} library  pistas con lo escuchado
 * @returns {Array<{ id, name, share, tracks }>}  `tracks` de la más escuchada a la menos
 */
export function detectGenres(library, { max = 3 } = {}) {
  const weight = new Map();
  const tracks = new Map();
  let total = 0;

  for (const track of library) {
    const ids = genresOf(track);
    if (ids.length === 0) continue;

    const w = Math.max(Number(track.listened_secs) || 0, 1);
    total += w;
    for (const id of ids) {
      weight.set(id, (weight.get(id) ?? 0) + w / ids.length);
      if (!tracks.has(id)) tracks.set(id, []);
      tracks.get(id).push(track);
    }
  }

  if (total === 0) return [];

  return [...weight]
    .map(([id, w]) => ({
      id,
      name: genreById(id).name,
      share: w / total,
      tracks: tracks.get(id).sort((a, b) => (b.listened_secs ?? 0) - (a.listened_secs ?? 0)),
    }))
    .filter((g) => g.share >= MIN_SHARE)
    .sort((a, b) => b.share - a.share)
    .slice(0, max);
}
