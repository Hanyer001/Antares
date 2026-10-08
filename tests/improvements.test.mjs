import { test } from "node:test";
import assert from "node:assert/strict";
import { Recovery } from "../src/js/recovery.js";
import { filterTracks, groupLists } from "../src/js/library-model.js";
import { cleanSession } from "../src/js/session-model.js";
import { cleanMomentState, nextMidnight } from "../src/js/moments-model.js";

function recovery(options = {}) {
  const calls = [], scheduled = new Map(); let id=0, connected=true;
  const r = new Recovery({ retry: async p => {calls.push(["retry",p]);return false;}, waiting:()=>calls.push(["waiting"]), failed:()=>calls.push(["failed"]), recovered:()=>{}, online:()=>connected,
    timer:fn=>{scheduled.set(++id,fn);return id;}, cancel:id=>scheduled.delete(id), ...options });
  return {r,calls,scheduled,offline:()=>connected=false,online:()=>connected=true};
}
test("recovery resumes at the last position and stops after one automatic retry",async()=>{
  const {r,calls}=recovery();r.begin();r.progress(135);await r.fail();await r.fail();
  assert.deepEqual(calls,[["retry",135],["failed"]]);
});
test("offline playback waits without spending retries, then resumes",async()=>{
  const x=recovery({retry:async p=>{x.calls.push(["retry",p]);return true;}});x.r.begin(89);x.offline();await x.r.fail();
  assert.equal(x.r.attempts,0);assert.deepEqual(x.calls,[["waiting"]]);x.online();x.r.reconnect();await Promise.resolve();
  assert.deepEqual(x.calls,[["waiting"],["retry",89]]);
});
test("pausing cancels reconnection and pending timers",async()=>{
  const x=recovery();x.r.begin(20);x.offline();await x.r.fail();x.r.pause();x.online();x.r.reconnect();
  assert.deepEqual(x.calls,[["waiting"]]);assert.equal(x.scheduled.size,0);
});
test("a stale retry cannot fail the newly selected song",async()=>{
  let finish;const x=recovery({retry:()=>new Promise(resolve=>finish=resolve)});x.r.begin(10);const old=x.r.fail();
  x.r.begin(0);finish(false);await old;assert.deepEqual(x.calls,[]);assert.equal(x.r.intent,true);assert.equal(x.r.position,0);
});
test("duplicate media errors share a retry",async()=>{
  let finish,count=0;const x=recovery({retry:()=>{count++;return new Promise(resolve=>finish=resolve);}});x.r.begin();
  const first=x.r.fail();await x.r.fail();assert.equal(count,1);finish(true);await first;
});
test("buffering schedules only one watchdog",()=>{
  const x=recovery();x.r.begin();x.r.buffering();x.r.buffering();assert.equal(x.scheduled.size,1);x.r.playing();assert.equal(x.scheduled.size,0);
});
test("a retry that never starts audio also has a deadline",async()=>{
  const x=recovery({retry:()=>new Promise(()=>{})});x.r.begin();const failed=x.r.fail();
  for(const callback of x.scheduled.values())callback();await failed;
  assert.deepEqual(x.calls,[["failed"]]);assert.equal(x.r.intent,false);
});
test("library search finds accent-insensitive words across title and artist without reordering",()=>{
  const tracks=[{id:"a",title:"Canción del sur",uploader:"Álex"},{id:"b",title:"Otro",uploader:"Alex"}];
  assert.deepEqual(filterTracks(tracks,"alex cancion"),[tracks[0]]);assert.deepEqual(filterTracks(tracks,""),tracks);
});
test("library keeps favorites and pinned lists first and filters folders",()=>{
  const lists=[{id:"a",name:"Uno",folder:"Trabajo",updated_at:4},{id:"b",name:"Dos",pinned:true,updated_at:1},{id:"likes",name:"Me gusta",system:true,updated_at:0}];
  assert.deepEqual(groupLists(lists).map(l=>l.id),["likes","b","a"]);assert.deepEqual(groupLists(lists,"","Trabajo").map(l=>l.id),["a"]);
  assert.deepEqual(groupLists(lists,"","__none").map(l=>l.id),["likes","b"]);
});
test("restored sessions rebuild URLs, reject invalid tracks and preserve current item",()=>{
  const s=cleanSession({queue:{items:[{id:"a",watch_url:"https://bad.example"},{id:"?"},{id:"b",queued:true}],original:[],index:1},track:{id:"b"},time:43,picks:[]});
  assert.equal(s.queue.items.length,2);assert.equal(s.queue.index,1);assert.equal(s.queue.items[0].watch_url,"https://www.youtube.com/watch?v=a");assert.equal(s.time,43);assert.equal(s.queue.items[1].queued,true);
  assert.equal(cleanSession({}),null);
});
test("moment backup validation drops expired snoozes and dangerous keys",()=>{
  const input=JSON.parse('{"contexts":{"__proto__":[],"party":[{"id":"abc","watch_url":"bad"}]},"snoozed":{"old":1}}');
  const state=cleanMomentState(input);assert.deepEqual(state.snoozed,{});assert.equal(Object.hasOwn(state.contexts,"__proto__"),false);
  assert.equal(state.contexts.party[0].watch_url,"https://www.youtube.com/watch?v=abc");
});
test("today snooze expires at the next local midnight",()=>{
  const today=new Date(2026,8,30,23,58);const next=new Date(nextMidnight(today.getTime()));assert.equal(next.getDate(),1);assert.equal(next.getHours(),0);
});

test("un nuevo corte tras audio estable recupera la misma canción desde su nueva posición",async()=>{
  const x=recovery({retry:async p=>{x.calls.push(["retry",p]);return true;}});
  x.r.begin(161);await x.r.fail();assert.equal(x.r.attempts,1);
  x.r.progress(162);x.r.progress(172);assert.equal(x.r.attempts,0);
  await x.r.fail();assert.deepEqual(x.calls,[["retry",161],["retry",172]]);
});
test("errores seguidos sin diez segundos de audio no forman un bucle de reintentos",async()=>{
  const x=recovery({retry:async p=>{x.calls.push(["retry",p]);return true;}});
  x.r.begin(161);await x.r.fail();x.r.progress(162);x.r.progress(163);
  x.r.buffering();await x.r.fail();
  assert.deepEqual(x.calls,[["retry",161],["failed"]]);assert.equal(x.r.intent,false);
});
test("los saltos de posición hacia atrás no reinician el presupuesto",async()=>{
  const x=recovery({retry:async()=>true});x.r.begin(161);await x.r.fail();
  x.r.progress(162);x.r.progress(10);x.r.progress(11);
  assert.equal(x.r.attempts,1);
});
