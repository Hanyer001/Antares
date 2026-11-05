import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createVoiceHandler} from '../src/js/voice-bridge.js';
test('play request searches, starts audio, then confirms the matching track',async()=>{
 let playing=false;
 const handle=createVoiceHandler({search:async q=>{assert.equal(q,'Esclava Remix');return [{id:'abc',watch_url:'https://www.youtube.com/watch?v=abc'}];},play:async t=>{playing=true;return true;},status:()=>({playing,id:'abc'}),control:()=>{throw Error('wrong path');}});
 assert.equal((await handle({command:'play_query',query:'Esclava Remix'})).ok,true);
});
test('search alone, wrong track and rejected playback never report success',async()=>{
 for(const [started,state] of [[false,{playing:false,id:'abc'}],[true,{playing:false,id:'abc'}],[true,{playing:true,id:'other'}]]){
 const handle=createVoiceHandler({search:async()=>[{id:'abc',watch_url:'url'}],play:async()=>started,status:()=>state});
 await assert.rejects(handle({command:'play_query',query:'Esclava Remix'}));
 }
});
test('arbitrary commands and missing song cannot dispatch a control',async()=>{
 const handle=createVoiceHandler({control:()=>{throw Error('dispatched');}});
 for(const input of [{command:'shell',query:'evil'},{command:'play_query',query:''},{command:'pause',query:'evil'}])await assert.rejects(handle(input));
});
test('cancelling during search never starts playback when the result arrives late',async()=>{
 let resolveSearch,cancelled=false,plays=0;
 const handle=createVoiceHandler({search:()=>new Promise(r=>{resolveSearch=r;}),play:()=>{plays++;return true;},status:()=>({playing:true,id:'abc'})});
 const pending=handle({id:'one',command:'play_query',query:'Esclava Remix'},{cancelled:()=>cancelled});
 cancelled=true;resolveSearch([{id:'abc',watch_url:'url'}]);
 await assert.rejects(pending,/cancelada/);assert.equal(plays,0);
});
test('a request already cancelled cannot send a media control',async()=>{
 let calls=0;
 const handle=createVoiceHandler({control:()=>{calls++;return true;}});
 await assert.rejects(handle({command:'pause'},{cancelled:()=>true}),/cancelada/);assert.equal(calls,0);
});
