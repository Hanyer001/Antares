import test from 'node:test';
import assert from 'node:assert/strict';
import {playbackQuery,assertSelectedTrack} from '../src/js/playback-policy.js';
test('el ID seleccionado prevalece sobre enlaces antiguos o nombres de búsqueda',()=>{
  const hint={id:'dQw4w9WgXcQ',watch_url:'https://youtu.be/XFkzRNyygfk'};
  assert.equal(playbackQuery(hint.watch_url,hint),'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  assert.equal(playbackQuery('otra canción',hint),playbackQuery(hint.watch_url,hint));
});
test('una búsqueda sin selección mantiene la consulta del usuario',()=>{
  assert.equal(playbackQuery('Radiohead Creep',null),'Radiohead Creep');
});
test('una respuesta diferente se rechaza en vez de sustituir la selección',()=>{
  assert.throws(()=>assertSelectedTrack({id:'XFkzRNyygfk'},{id:'dQw4w9WgXcQ'}));
  assert.doesNotThrow(()=>assertSelectedTrack({id:'dQw4w9WgXcQ'},{id:'dQw4w9WgXcQ'}));
  assert.doesNotThrow(()=>assertSelectedTrack({id:'XFkzRNyygfk'},null));
});
