function track(t){
  if(!t||typeof t.id!=="string"||!/^[-\w]{1,128}$/.test(t.id))return null;
  return {id:t.id,title:typeof t.title==="string"?t.title.slice(0,500):null,uploader:typeof t.uploader==="string"?t.uploader.slice(0,500):null,
    duration:Number.isFinite(t.duration)?Math.max(0,t.duration):null,thumbnail:typeof t.thumbnail==="string"&&t.thumbnail.startsWith("https://")?t.thumbnail:null,
    watch_url:`https://www.youtube.com/watch?v=${t.id}`,auto:Boolean(t.auto),queued:Boolean(t.queued)};
}
export function cleanSession(raw){
  if(!raw||!raw.queue||!Array.isArray(raw.queue.items))return null;
  const items=raw.queue.items.slice(0,500).map(track).filter(Boolean),original=(Array.isArray(raw.queue.original)?raw.queue.original:[]).slice(0,500).map(track).filter(Boolean);
  const current=track(raw.track),at=current?items.findIndex(t=>t.id===current.id):-1;
  return {queue:{items,original,index:at,shuffled:Boolean(raw.queue.shuffled)},track:current,time:Number.isFinite(raw.time)?Math.max(0,raw.time):0,picks:(Array.isArray(raw.picks)?raw.picks:[]).slice(0,3).map(track).filter(Boolean)};
}
