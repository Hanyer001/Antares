// Adaptador de la interfaz existente. Rust mantiene el estado y el orden.
import { QueueEngine } from "./rust-core.js";

const engine = new QueueEngine();
let view = JSON.parse(engine.view());
const listeners = [];

export function onChange(callback) {
  listeners.push(callback);
}

function apply(op, args) {
  const { changed, result } = JSON.parse(engine.apply(JSON.stringify({ op, args })));
  if (changed) {
    view = JSON.parse(engine.view());
    for (const callback of listeners) callback();
  }
  return result;
}

export function load(tracks, startIndex = 0, { ordered = false, auto = false, artistOnly = false } = {}) {
  const start = Number.isFinite(startIndex) ? Math.max(0, Math.min(Math.trunc(startIndex), 2147483647)) : 0;
  apply("load", [(tracks ?? []).filter(track => typeof track?.id === "string"), start, {
    ordered: Boolean(ordered), auto: Boolean(auto), artistOnly: Boolean(artistOnly),
  }]);
}
export const pointAt = id => typeof id === "string" && apply("pointAt", id);
export const add = track => Boolean(track?.id) && apply("add", track);
export const playNext = track => Boolean(track?.id) && apply("playNext", track);
export function clearQueued() { apply("clearQueued"); }
export function playNow(track) { if (track?.id) apply("playNow", track); }
const validTracks = tracks => (tracks ?? []).filter(track => typeof track?.id === "string");
export const appendAuto = tracks => apply("appendAuto", validTracks(tracks));
export const replaceUpcomingAuto = tracks => apply("replaceUpcomingAuto", validTracks(tracks));
export function remove(id) { if (typeof id === "string") apply("remove", id); }
export const move = (from, to) => [from, to].every(n => Number.isInteger(n) && n >= 0 && n < all().length)
  && apply("move", [from, to]);
export const removeUpcoming = id => typeof id === "string" ? apply("removeUpcoming", id) : null;
export function undoRemove(receipt) {
  if (!receipt || receipt.used || !apply("undoRemove", receipt)) return false;
  receipt.used = true;
  return true;
}
export function clear() { apply("clear"); }
export const restore = state => apply("restore", state ?? null);

export const all = () => view.queue.items;
export const currentIndex = () => view.queue.index;
export const current = () => all()[currentIndex()] ?? null;
export const snapshot = () => ({ ...view.queue, items: [...all()], original: [...view.queue.original] });
export const isArtistOnly = () => view.queue.artistOnly;
export const upNext = limit => JSON.parse(engine.up_next(limit));
export const upcomingCount = () => all().length - currentIndex() - 1;
export const queuedCount = () => view.queuedCount;
export const upcomingQueued = () => all().slice(currentIndex() + 1, currentIndex() + 1 + queuedCount());
export const firstUpcomingAuto = () => view.firstUpcomingAuto ?? -1;
export const isShuffled = () => view.queue.shuffled;
export function setShuffle(on) { apply("setShuffle", Boolean(on)); }
export const repeatMode = () => view.repeat;
export function setRepeat(mode) { apply("setRepeat", typeof mode === "string" ? mode : "off"); }
export const cycleRepeat = () => apply("cycleRepeat");
export const hasNext = () => view.hasNext;
export const hasPrev = () => view.hasPrev;
export const peekNext = () => view.peekNext;
export const next = () => apply("next");
export const prev = () => apply("prev");
