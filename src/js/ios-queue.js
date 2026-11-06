// A short look-ahead lets AVQueuePlayer continue while the webview is suspended.
export function iosQueueWindow(items, index, repeat, shuffled, limit = 3) {
  if (!items[index] || repeat === "one") return [];
  const upcoming = items.slice(index + 1, index + 1 + limit);
  if (repeat === "all" && !shuffled && upcoming.length < limit) {
    upcoming.push(...items.slice(0, Math.min(index + 1, limit - upcoming.length)));
  }
  return upcoming;
}

export async function resolveIOSQueue(tracks, resolve, isCurrent, publish) {
  const prepared = [];
  for (const track of tracks) {
    if (!isCurrent()) return;
    let result;
    try { result = await resolve(track); }
    catch { return; }
    // Stopping at a failed item keeps the prepared native order identical to the UI.
    if (!isCurrent() || result?.id !== track.id || !result.url) return;
    prepared.push({
      id: track.id, url: result.url, title: result.title ?? track.title,
      artist: result.uploader ?? track.uploader, duration: result.duration ?? track.duration,
      artwork: `https://i.ytimg.com/vi/${track.id}/hqdefault.jpg`,
    });
    await publish([...prepared]);
  }
}
