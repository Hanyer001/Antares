import { pendingOperations, queueOperation, removeOperation } from "./web-storage.js";

export const libraryWrites = new Set(["create_playlist", "add_to_playlist", "remove_from_playlist", "set_rating"]);

function asTrack(track) {
  return { ...track, watch_url: `https://www.youtube.com/watch?v=${track.id}` };
}

export function overlayLibrary(lists, operations) {
  const result = structuredClone(lists ?? []);
  for (const { command, args, key } of operations) {
    if (command === "create_playlist") {
      const id = `sync-${args.operationId}`;
      if (!result.some(list => list.id === id)) {
        const tracks = [...new Map((args.tracks ?? []).map(track => [track.id, asTrack(track)])).values()];
        const time = Math.floor((key?.[1] ?? 0) / 1000);
        result.splice(result[0]?.system ? 1 : 0, 0, {
          id, name: args.name, tracks, created_at: time, updated_at: time,
          pinned: false, folder: "", description: "", cover: null, rules: null, system: false,
        });
      }
      continue;
    }

    const id = command === "set_rating" ? "likes" : args.id;
    let list = result.find(candidate => candidate.id === id);
    if (!list && id === "likes") {
      list = { id, name: "Me gusta", tracks: [], system: true, pinned: true, folder: "" };
      result.unshift(list);
    }
    if (!list || list.rules) continue;
    const track = args.track;
    const trackId = track?.id ?? args.trackId;
    const present = list.tracks.some(item => item.id === trackId);
    const add = command === "add_to_playlist" || (command === "set_rating" && args.rating === "like");
    if (add && !present) list.tracks.push(asTrack(track));
    if (!add && present) list.tracks = list.tracks.filter(item => item.id !== trackId);
  }
  return result;
}

export function pendingRating(id, operations) {
  for (const { command, args } of [...operations].reverse()) {
    if (command === "set_rating" && args.track.id === id) return args.rating;
    if (args.id !== "likes") continue;
    if (command === "add_to_playlist" && args.track.id === id) return "like";
    if (command === "remove_from_playlist" && args.trackId === id) return "none";
  }
}

export const transient = error => error instanceof TypeError || error?.name === "TimeoutError" || error?.status >= 500;

export function createLibrarySync({ rpc, scope, available, update, accept }) {
  let tail = Promise.resolve();
  const run = callback => {
    const task = tail.then(callback);
    tail = task.catch(() => {});
    return task;
  };

  async function drain(targetScope) {
    const operations = await pendingOperations(targetScope);
    const results = new Map();
    let blocked = null;
    for (const op of operations) {
      if (!available() || targetScope !== scope()) break;
      try {
        const value = await rpc(op.command, op.args);
        await accept(op, targetScope);
        results.set(op.args.operationId, value);
      } catch (error) {
        if (!transient(error)) blocked = { key: op.key, message: error.message };
        break;
      }
    }
    update({ pending: operations.length - results.size, sent: results.size, blocked });
    return results;
  }

  return {
    pending: () => pendingOperations(scope()),
    flush: () => run(() => drain(scope())),
    discard: key => run(async () => {
      if (key[0] !== scope()) return;
      await removeOperation(key);
      await drain(scope());
    }),
    save: (command, args) => run(async () => {
      if (command === "create_playlist") {
        args = { ...args, name: args.name.trim().replace(/\s+/g, " ") };
        if (!args.name || [...args.name].length > 80) throw new Error("Escribe un nombre de hasta 80 caracteres.");
      }
      const targetScope = scope();
      const id = [...crypto.getRandomValues(new Uint8Array(16))].map(byte => byte.toString(16).padStart(2, "0")).join("");
      const op = { command, args: { ...args, operationId: id } };
      try {
        await queueOperation(targetScope, op);
      } catch (error) {
        if (!available()) throw error;
        return rpc(command, op.args);
      }
      const results = await drain(targetScope);
      if (results.has(id)) return results.get(id);
      if (command === "create_playlist") return `sync-${id}`;
      return command === "add_to_playlist" ? true : null;
    }),
  };
}
