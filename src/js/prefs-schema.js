// El esquema, saneamiento y migraciones se ejecutan en Rust.
// Este adaptador conserva las rutas y el acceso a localStorage del cliente.
import { preferences_metadata, preferences_schema, preferences_apply } from "./rust-core.js";

export const {
  VERSION, THEME_IDS, EQ_BANDS, TAB_IDS, FONT_IDS, SHELF_IDS,
  LOCAL_SHORTCUTS, GLOBAL_SHORTCUTS,
} = JSON.parse(preferences_metadata());
export const SCHEMA = JSON.parse(preferences_schema());
export const SECTIONS = Object.keys(SCHEMA);
const apply = (op, value, extra = {}) =>
  JSON.parse(preferences_apply(JSON.stringify({ op, value, ...extra })));

const paths = new WeakMap();
function indexNodes(node, path = "") {
  paths.set(node, path);
  if (typeof node.kind === "string") return;
  for (const [key, child] of Object.entries(node)) indexNodes(child, path ? `${path}.${key}` : key);
}
indexNodes(SCHEMA);
const nodeArgs = node => paths.has(node) ? { path: paths.get(node) } : { node };

export const defaults = (node = SCHEMA) => apply("defaults", null, nodeArgs(node));
export const sanitize = (value, node = SCHEMA) =>
  apply("sanitize", value, { ...nodeArgs(node), root: node === SCHEMA });
export const migrate = value => value === undefined ? undefined : apply("migrate", value);
export const merge = (base, over) => apply("merge", base, { over });

export function nodeAt(path) {
  let node = SCHEMA;
  for (const key of path.split(".")) {
    if (!node || typeof node.kind === "string" || !Object.hasOwn(node, key)) return undefined;
    node = node[key];
  }
  return node;
}

export const getPath = (obj, path) => path.split(".").reduce((acc, key) => acc?.[key], obj);

export function withPath(obj, path, value) {
  const node = nodeAt(path);
  if (node === undefined) throw new Error(`Preferencia desconocida: ${path}`);
  const copy = { ...obj };
  const keys = path.split(".");
  const leaf = keys.pop();
  let parent = copy;
  let source = obj;
  for (const key of keys) {
    parent[key] = { ...source?.[key] };
    parent = parent[key];
    source = source?.[key];
  }
  parent[leaf] = sanitize(value, node);
  return copy;
}

export function fromLegacy(getItem) {
  const values = {};
  for (const key of [
    "antares.sound", "antares.volume", "antares.modes", "antares.discovery",
    "antares.sidetab", "antares.tray",
  ]) {
    try { values[key] = getItem(key); } catch { values[key] = null; }
  }
  return apply("legacy", values);
}
