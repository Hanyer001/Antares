import test from 'node:test';
import assert from 'node:assert/strict';
import { createSearchCache } from '../src/js/search-cache.js';
import { isMusic } from '../src/js/filters.js';

test('simultaneous/repeated normalized queries share one request, results remain isolated', async () => {
  let calls = 0;
  const search = createSearchCache(async () => { calls++; return [{id:'song'}]; });
  const [a,b] = await Promise.all([search('  Creep  ',20), search('creep',20)]);
  a[0].id = 'mutated'; assert.equal(b[0].id, 'song');
  assert.equal((await search('CREEP',20))[0].id,'song'); assert.equal(calls,1);
  await search('Creep',5); assert.equal(calls,2);
});
test('expired results, empty responses and failures can be retried', async () => {
  let time=0, calls=0;
  const search=createSearchCache(async()=>{calls++;if(calls===1)throw Error('offline');return calls===2?[]:[{id:'a'}];},{now:()=>time,ttl:10});
  await assert.rejects(search('q')); assert.deepEqual(await search('q'),[]);
  await search('q');await search('q');assert.equal(calls,3);
  time=11;await search('q');assert.equal(calls,4);
});
test('music provenance rejects unknown videos and explicit podcast labels even on topic channels',()=>{
  assert.equal(isMusic({is_music:false,uploader:'Artist - Topic'}),false);
  assert.equal(isMusic({title:'Tutorial',uploader:'Official channel'}),false);
  assert.equal(isMusic({title:'Podcast',uploader:'Radio news'}),false);
  assert.equal(isMusic({is_music:true,title:'Breaking News',uploader:'Michael Jackson'}),true);
  assert.equal(isMusic({uploader:'Radiohead - Topic'}),true);
  assert.equal(isMusic({uploader:'RadioheadVEVO'}),true);
});
