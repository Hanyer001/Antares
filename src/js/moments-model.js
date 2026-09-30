export function nextMidnight(now = Date.now()) { const d = new Date(now); d.setHours(24,0,0,0); return d.getTime(); }
export function cleanMomentState(raw = {}) {
  const contexts = {};
  for (const [name, tracks] of Object.entries(raw?.contexts || {}).slice(0,30)) {
    if (!Array.isArray(tracks) || name.length > 100 || ["__proto__","constructor","prototype"].includes(name)) continue;
    contexts[name] = tracks.filter(t => t && typeof t.id === "string" && /^[\w-]{1,128}$/.test(t.id)).slice(0,3).map(t => ({
      id:t.id, title: typeof t.title === "string" ? t.title.slice(0,500) : null,
      uploader: typeof t.uploader === "string" ? t.uploader.slice(0,500) : null,
      duration: Number.isFinite(t.duration) ? t.duration : null, thumbnail:null,
      watch_url:`https://www.youtube.com/watch?v=${t.id}`,
    }));
  }
  const snoozed = Object.fromEntries(Object.entries(raw?.snoozed || {}).filter(([id,until]) => /^[\w-]{1,128}$/.test(id) && Number.isFinite(until) && until > Date.now()).slice(0,2000));
  return {contexts, snoozed};
}
