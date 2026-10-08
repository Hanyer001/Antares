import assert from 'node:assert/strict';
import {test} from 'node:test';
import * as queue from '../src/js/queue.js';
import {defaults,sanitize} from '../src/js/prefs-schema.js';
import {swipeDirection,dropPosition,orderedShelves,undoAddedValue} from '../src/js/interaction-policy.js';
import {tuningFrom} from '../src/js/filters.js';

test('gestos: umbral, dirección y predominio horizontal evitan saltos accidentales',()=>{
  assert.equal(swipeDirection(-90,8,360),'next');
  assert.equal(swipeDirection(90,8,360),'previous');
  for(const [dx,dy,width] of [[20,0,360],[80,70,360],[60,0,500],[NaN,0,360],[100,0,0]])assert.equal(swipeDirection(dx,dy,width),null);
});
test('soltar antes o después compensa la fila que sale y acota índices',()=>{
  assert.equal(dropPosition(0,2,true,4),2);
  assert.equal(dropPosition(3,1,false,4),1);
  assert.equal(dropPosition(1,2,false,4),1);
  assert.equal(dropPosition(2,0,true,4),1);
  assert.equal(dropPosition(2,10,true,4),2);
});
test('fijar secciones conserva el orden dentro de cada grupo',()=>{
  assert.deepEqual(orderedShelves(['a','b','c','d'],['c','a']),['a','c','b','d']);
});
test('preferencias nuevas migran sin vibración ni cambios en audio y se serializan',()=>{
  const d=sanitize({sound:{crossfade:3},discovery:{lessArtists:['radiohead'],knownTracks:['XFkzRNyygfk']},home:{pinnedShelves:['again']}});
  assert.equal(d.mobile.haptics,false);assert.equal(d.sound.crossfade,3);
  assert.deepEqual(tuningFrom(d.discovery).lessChannels,['radiohead']);
  assert.deepEqual(sanitize(JSON.parse(JSON.stringify(d))),d);
  assert.deepEqual(defaults().discovery.knownTracks,[]);
});
test('deshacer feedback mantiene las preferencias posteriores y las que ya existían',()=>{
  assert.deepEqual(undoAddedValue(['radiohead','psy'],'radiohead',false),['psy']);
  assert.deepEqual(undoAddedValue(['radiohead','psy'],'radiohead',true),['radiohead','psy']);
});
test('reordenar la cola conserva la pista y fija lo pendiente frente a recomendaciones',()=>{
  queue.setShuffle(false);queue.clear();queue.load(['a','b','c','d'].map(id=>({id})),1);
  assert.equal(queue.move(3,2),true);
  assert.equal(queue.current().id,'b');assert.equal(queue.currentIndex(),1);
  assert.deepEqual(queue.all().map(t=>t.id),['a','b','d','c']);
  assert.equal(queue.move(1,2),false);assert.equal(queue.move(2,0),false);
  assert.equal(queue.move(NaN,2),false);
  queue.replaceUpcomingAuto([{id:'e'}]);
  assert.deepEqual(queue.all().map(t=>t.id),['a','b','d','c','e']);
});
test('deshacer eliminación conserva nuevas entradas y el avance de reproducción',()=>{
  queue.clear();queue.load(['a','b','c','d'].map(id=>({id})),0);
  const receipt=queue.removeUpcoming('b');queue.next();queue.add({id:'e'});
  const current=queue.current().id,at=queue.currentIndex();
  assert.equal(queue.undoRemove(receipt),true);assert.equal(queue.current().id,current);assert.equal(queue.currentIndex(),at);
  assert.equal(queue.all().some(t=>t.id==='e'),true);assert.equal(queue.all().some(t=>t.id==='b'),true);
  assert.equal(queue.undoRemove(receipt),false);assert.equal(queue.removeUpcoming(current),null);
});
test('deshacer nunca restaura una cola anterior ni duplica una canción añadida después',()=>{
  queue.clear();queue.load([{id:'a'},{id:'b'}],0);const old=queue.removeUpcoming('b');
  queue.load([{id:'x'},{id:'y'}],0);assert.equal(queue.undoRemove(old),false);
  const current=queue.removeUpcoming('y');queue.add({id:'y'});assert.equal(queue.undoRemove(current),false);
  assert.deepEqual(queue.all().map(t=>t.id),['x','y']);
});
test('reordenar y deshacer con aleatorio conservan la pista también al desactivarlo',()=>{
  queue.setShuffle(false);queue.clear();queue.load(['a','b','c','d'].map(id=>({id})),0);queue.setShuffle(true);
  const track=queue.all()[3].id;assert.equal(queue.move(3,1),true);
  const removed=queue.all()[2].id,receipt=queue.removeUpcoming(removed);
  assert.equal(queue.undoRemove(receipt),true);queue.setShuffle(false);
  assert.equal(queue.current().id,'a');assert.equal(queue.peekNext().id,track);
  assert.equal(new Set(queue.all().map(t=>t.id)).size,4);queue.clear();
});
