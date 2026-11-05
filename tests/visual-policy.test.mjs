import {test} from 'node:test';
import assert from 'node:assert/strict';
import {shouldPaintProgress} from '../src/js/visual-policy.js';
import {displayThumbnail} from '../src/js/thumbnails.js';
test('sin foco reduce el progreso a 1 Hz sin depender de document.hidden en Wayland',()=>{
  for(const elapsed of [0,16,250,999]) assert.equal(shouldPaintProgress({hidden:false,focused:false,time:elapsed,last:0}),false);
  assert.equal(shouldPaintProgress({hidden:false,focused:false,time:1000,last:0}),true);
  assert.equal(shouldPaintProgress({hidden:false,focused:true,time:16,last:0}),true);
  assert.equal(shouldPaintProgress({hidden:true,focused:true,time:10000,last:0}),false);
});
test('YouTube usa miniaturas pequeñas en tarjetas y filas, conservando resolución para pantallas densas',()=>{
  const url='https://i.ytimg.com/vi/dQw4w9WgXcQ/hq720.jpg?sqp=test';
  const small='https://i.ytimg.com/vi/dQw4w9WgXcQ/mqdefault.jpg';
  assert.equal(displayThumbnail(url,160,1),small);
  assert.equal(displayThumbnail(url,44,2),small);
  assert.equal(displayThumbnail(url,160,2),url);
  assert.equal(displayThumbnail('https://i.ytimg.com/vi_webp/dQw4w9WgXcQ/maxresdefault.webp',40,1),'https://i.ytimg.com/vi_webp/dQw4w9WgXcQ/mqdefault.webp');
});
test('no cambia portadas propias, de otros servidores ni valores ausentes',()=>{
  for(const url of [null,undefined,'','https://lh3.googleusercontent.com/custom=w540-h540','https://example.com/vi/dQw4w9WgXcQ/hq720.jpg','data:image/png;base64,AAAA','broken'])assert.equal(displayThumbnail(url,40,1),url);
});
