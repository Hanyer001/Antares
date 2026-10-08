import test from 'node:test';
import assert from 'node:assert/strict';
import {queuePayload,primaryTabs} from '../src/js/mobile-policy.js';
import {defaults,sanitize} from '../src/js/prefs-schema.js';

test('cola nativa conserva orden, elimina IDs inválidos y duplicados sin enviar URLs firmadas',()=>{
  const a={id:'XFkzRNyygfk',title:'Creep',url:'private-stream'};
  const b={id:'dQw4w9WgXcQ',title:'Next'};
  const payload=queuePayload([a,{id:'bad'},b,a],a.id,'all');
  assert.deepEqual(payload.items.map(t=>t.id),[a.id,b.id]);
  assert.equal(payload.items[0].url,undefined);
  assert.equal(payload.repeat,'all');
});
test('no reemplaza la cola nativa si la selección ya no pertenece a ella',()=>{
  assert.equal(queuePayload([{id:'XFkzRNyygfk'}],'different'),null);
});
test('navegación respeta pestañas ocultas y hace visible la sección activa',()=>{
  const order=['home','results','discover','queue','history','lists','summary'];
  assert.deepEqual(primaryTabs(order,['results'],'lists'),['home','discover','queue','lists']);
  assert.deepEqual(primaryTabs(order,[],'settings'),order.slice(0,4));
});
test('instalaciones y copias anteriores adoptan ahorro sin activar precarga',()=>{
  assert.deepEqual(defaults().mobile,{energySaver:true,haptics:false,prefetch:false});
  assert.deepEqual(sanitize({}).mobile,{energySaver:true,haptics:false,prefetch:false});
});
