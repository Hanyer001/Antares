export function prepareLyrics(lines) {
  return (Array.isArray(lines) ? lines : []).filter(line => line && Number.isFinite(line.time) && line.time >= 0)
    .map(line => ({time:line.time,text:typeof line.text === 'string' ? line.text : ''})).sort((a,b) => a.time-b.time);
}
export function lyricIndex(lines, time, offset = 0) {
  if (!Number.isFinite(time) || !Number.isFinite(offset)) return -1;
  let lo = 0, hi = lines.length-1, found = -1;
  while (lo <= hi) {
    const mid = (lo+hi) >> 1;
    if (lines[mid].time <= time + offset + .15) { found = mid; lo = mid+1; } else hi = mid-1;
  }
  return found;
}
