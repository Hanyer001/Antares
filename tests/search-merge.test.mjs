import {test} from 'node:test';
import assert from 'node:assert/strict';
import {appendUniqueTracks} from '../src/js/search-merge.js';

test('deduplica las dos fuentes conservando el orden y sin mutar entradas',()=>{
 const first=[{id:'a'}],other=[{id:'b'},{id:'b'},null,{title:'missing'}];
 assert.deepEqual(appendUniqueTracks(first,other).map(t=>t.id),['a','b']);assert.equal(first.length,1);assert.equal(other.length,4);
});

test('no repite una misma fila oficial con otro ID',()=>{
 const current=[{id:'official',title:'My Song',uploader:'Artist - Topic'}];
 assert.equal(appendUniqueTracks(current,[{id:'album',title:'My Song',uploader:'Artist'}]).length,1);
});
