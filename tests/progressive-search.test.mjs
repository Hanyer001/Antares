import {test} from 'node:test';
import assert from 'node:assert/strict';
import {appendUniqueTracks,progressiveSearch} from '../src/js/progressive-search.js';
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return {resolve,reject,promise}};
const tick=()=>new Promise(r=>setImmediate(r));
test('muestra la fuente rápida antes de terminar la lenta y no cambia las filas ya visibles',async()=>{
 const slow=deferred(),seen=[],first={id:'official',title:'Song'};
 const done=progressiveSearch([Promise.resolve([first]),slow.promise],rows=>seen.push(rows));
 await tick();assert.deepEqual(seen,[[first]]);
 slow.resolve([{id:'video'}, {id:'official',title:'renamed'}]);await done;
 assert.deepEqual(seen[1].map(t=>t.id),['official','video']);assert.equal(seen[1][0],first);
});
test('una fuente vacía o con error no retrasa ni descarta la otra',async()=>{
 for(const second of [Promise.resolve([]),Promise.reject(Error('offline'))]){
  const seen=[];const result=await progressiveSearch([Promise.resolve([{id:'song'}]),second],x=>seen.push(x));
  assert.equal(result[0].id,'song');assert.equal(seen.length,1);
 }
 await assert.rejects(progressiveSearch([Promise.reject(Error('a')),Promise.reject(Error('b'))],()=>{}));
 assert.deepEqual(await progressiveSearch([Promise.resolve([]),Promise.resolve([])],()=>assert.fail()),[]);
});
test('deduplica las dos fuentes conservando el orden y sin mutar entradas',()=>{
 const first=[{id:'a'}],other=[{id:'b'},{id:'b'},null,{title:'missing'}];
 assert.deepEqual(appendUniqueTracks(first,other).map(t=>t.id),['a','b']);assert.equal(first.length,1);assert.equal(other.length,4);
});

test('no repite una misma fila oficial con otro ID y propaga errores de presentación',async()=>{
 const current=[{id:'official',title:'My Song',uploader:'Artist - Topic'}];
 assert.equal(appendUniqueTracks(current,[{id:'album',title:'My Song',uploader:'Artist'}]).length,1);
 await assert.rejects(progressiveSearch([Promise.resolve([{id:'song'}])],()=>{throw Error('paint failed')}),/paint failed/);
});
