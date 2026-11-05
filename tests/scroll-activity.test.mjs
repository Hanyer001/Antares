import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHoverPrefetch} from '../src/js/scroll-activity.js';
function fixture() {
  const document = new EventTarget();
  document.documentElement={dataset:{platform:'linux'}};
  document.defaultView=new EventTarget();
  const tasks=new Map();let next=0,calls=0;
  const prefetch=createHoverPrefetch({document,setTimer:f=>{tasks.set(++next,f);return next},clearTimer:id=>tasks.delete(id)});
  const card=new EventTarget();card.isConnected=true;card.closest=()=>null;
  prefetch.bind(card,()=>calls++);
  const flush=()=>{const current=[...tasks.values()];tasks.clear();current.forEach(f=>f())};
  return {document,card,flush,tasks,prefetch,get calls(){return calls}};
}
test('las tarjetas que cruzan el puntero al bajar no preparan canciones',()=>{
  const f=fixture();f.card.dispatchEvent(new Event('pointerenter'));f.flush();assert.equal(f.calls,0);
  f.card.dispatchEvent(new Event('pointermove'));assert.equal(f.tasks.size,1);
  f.document.dispatchEvent(new Event('wheel'));f.flush();assert.equal(f.calls,0);
  f.card.dispatchEvent(new Event('pointermove'));f.document.dispatchEvent(new Event('scroll'));f.flush();assert.equal(f.calls,0);
  f.flush();assert.equal(f.calls,0); // No se reactiva sola al terminar el scroll.
  f.card.dispatchEvent(new Event('pointermove'));f.flush();assert.equal(f.calls,1);
});
test('salir, perder el foco u ocultar/desconectar la tarjeta cancela la preparación',()=>{
  const f=fixture();
  for(const cancel of [()=>f.card.dispatchEvent(new Event('pointerleave')),()=>f.document.defaultView.dispatchEvent(new Event('blur')),()=>{f.document.hidden=true},()=>{f.card.isConnected=false}]){
    f.document.hidden=false;f.card.isConnected=true;f.card.dispatchEvent(new Event('pointermove'));cancel();f.flush();
  }
  assert.equal(f.calls,0);
});
test('durante el desplazamiento y en pantallas táctiles no se arma un temporizador',()=>{
  const f=fixture();f.card.closest=()=>({});f.card.dispatchEvent(new Event('pointermove'));assert.equal(f.tasks.size,0);
  f.card.closest=()=>null;const touch=new Event('pointermove');touch.pointerType='touch';f.card.dispatchEvent(touch);assert.equal(f.tasks.size,0);
  f.document.documentElement.dataset.platform='android';f.card.dispatchEvent(new Event('pointermove'));assert.equal(f.tasks.size,0);
});
