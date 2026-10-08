import test from 'node:test';
import assert from 'node:assert/strict';

const calls=[];
let intercept=null;
globalThis.window={__TAURI__:{core:{invoke:async(command,args)=>{calls.push({command,args}); if (intercept) return intercept(command,args);},addPluginListener:async()=>({})}}};
const {NativeDeck}=await import('../src/js/native-deck.js');

test('el puente espera cargar antes de seek/play y envía el ID estable',async()=>{
  calls.length=0;
  const deck=new NativeDeck();
  deck.setMetadata({id:'XFkzRNyygfk',title:'Creep',duration:200});
  deck.src='https://example.test/audio';
  deck.currentTime=42;
  await deck.play();
  assert.deepEqual(calls.map(c=>c.command),['plugin:player|load','plugin:player|seek','plugin:player|play']);
  assert.equal(calls[0].args.id,'XFkzRNyygfk');
  assert.equal(calls[1].args.seconds,42);
});
test('adoptar una transición nativa actualiza el plato sin volver a descargar',()=>{
  calls.length=0;
  const deck=new NativeDeck();
  let times=0;
  deck.addEventListener('timeupdate',()=>times++);
  deck.adopt({id:'XFkzRNyygfk',duration:200});
  deck._onTime({id:'XFkzRNyygfk',position:12,duration:200,buffered:30});
  deck._onState({id:'XFkzRNyygfk',playing:true,buffering:false,ended:false});
  assert.equal(calls.length,0);
  assert.equal(deck.currentTime,12);
  assert.equal(deck.paused,false);
  assert.equal(times,1);
});

test('no adopta el final, posición ni error de una canción anterior',async()=>{
  calls.length=0;
  const deck=new NativeDeck();
  deck.setMetadata({id:'dQw4w9WgXcQ'});
  deck.src='https://example.test/new';
  await deck.play();
  let ended=0,errors=0;
  deck.addEventListener('ended',()=>ended++);
  deck.addEventListener('error',()=>errors++);
  deck._onTime({id:'XFkzRNyygfk',position:220,duration:220,buffered:220});
  deck._onState({id:'XFkzRNyygfk',playing:false,buffering:false,ended:true});
  deck._onError({id:'XFkzRNyygfk',message:'old error'});
  assert.equal(deck.currentTime,0);
  assert.equal(ended,0);assert.equal(errors,0);
  deck._onState({id:'dQw4w9WgXcQ',playing:true,buffering:false,ended:false});
  assert.equal(deck.paused,false);
});

test('dos selecciones rápidas solo cargan y reproducen la última',async()=>{
  calls.length=0;
  const deck=new NativeDeck();
  deck.setMetadata({id:'XFkzRNyygfk'});deck.src='https://example.test/first';
  const firstPlay=deck.play();
  deck.setMetadata({id:'dQw4w9WgXcQ'});deck.src='https://example.test/last';
  const lastPlay=deck.play();
  await Promise.all([firstPlay,lastPlay]);
  assert.deepEqual(calls.map(c=>c.command),['plugin:player|load','plugin:player|play']);
  assert.equal(calls[0].args.id,'dQw4w9WgXcQ');
});

test('una carga en curso no envía play ni cola de la selección reemplazada',async()=>{
  calls.length=0;
  let finish;
  intercept=(command,args)=> command==='plugin:player|load' && args.id==='XFkzRNyygfk'
    ? new Promise(resolve=>finish=resolve) : undefined;
  try {
    const deck=new NativeDeck();
    deck.setMetadata({id:'XFkzRNyygfk'});deck.src='https://example.test/first';
    const oldPlay=deck.play();
    const oldQueue=deck.syncQueue({currentId:'XFkzRNyygfk',items:[]});
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(typeof finish,'function');
    deck.setMetadata({id:'dQw4w9WgXcQ'});deck.src='https://example.test/last';
    const latest=deck.play();
    finish();
    await Promise.all([oldPlay,oldQueue,latest]);
    assert.deepEqual(calls.map(c=>c.command),['plugin:player|load','plugin:player|load','plugin:player|play']);
    assert.equal(calls[1].args.id,'dQw4w9WgXcQ');
  } finally { intercept=null; }
});

test('un error tardío de carga no rompe la selección actual',async()=>{
  calls.length=0;
  let rejectOld;
  intercept=(command,args)=> command==='plugin:player|load' && args.id==='XFkzRNyygfk'
    ? new Promise((_,reject)=>rejectOld=reject) : undefined;
  try {
    const deck=new NativeDeck();let errors=0;deck.addEventListener('error',()=>errors++);
    deck.setMetadata({id:'XFkzRNyygfk'});deck.src='https://example.test/first';
    await Promise.resolve();await Promise.resolve();
    deck.setMetadata({id:'dQw4w9WgXcQ'});deck.src='https://example.test/last';
    const playing=deck.play();rejectOld(new Error('fallo anterior'));
    await playing;
    assert.equal(errors,0);assert.equal(deck.error,null);
  } finally { intercept=null; }
});


test('pausar durante buffering cambia el estado al instante e ignora el evento anterior',async()=>{
  let acknowledge;
  intercept=command=>command==='plugin:player|pause' ? new Promise(resolve=>acknowledge=resolve) : undefined;
  try {
    const deck=new NativeDeck();deck.adopt({id:'XFkzRNyygfk'});
    deck._onState({id:'XFkzRNyygfk',sequence:1,playWhenReady:true,playing:false,buffering:true});
    assert.equal(deck.paused,false);
    deck.pause();assert.equal(deck.paused,true);
    deck._onState({id:'XFkzRNyygfk',sequence:2,playWhenReady:true,playing:false,buffering:true});
    assert.equal(deck.paused,true);
    await Promise.resolve();
    acknowledge({id:'XFkzRNyygfk',sequence:4,playWhenReady:false,playing:false,buffering:true});
    await Promise.resolve();await Promise.resolve();
    deck._onState({id:'XFkzRNyygfk',sequence:3,playWhenReady:true,playing:false,buffering:true});
    assert.equal(deck.paused,true);
  } finally {intercept=null;}
});

test('play durante buffering muestra la intención sin esperar muestras del decodificador',async()=>{
  const deck=new NativeDeck();deck.adopt({id:'XFkzRNyygfk'});
  let waiting=0;deck.addEventListener('waiting',()=>waiting++);
  const started=deck.play();assert.equal(deck.paused,false);
  await started;
  deck._onState({id:'XFkzRNyygfk',sequence:1,playWhenReady:true,playing:false,buffering:true});
  assert.equal(deck.paused,false);assert.ok(waiting>0);
  deck._onState({id:'XFkzRNyygfk',sequence:2,playWhenReady:false,playing:false,buffering:true});
  assert.equal(deck.paused,true);
});

test('play pausa play durante una carga solo envía la última orden',async()=>{
  calls.length=0;let loaded;
  intercept=command=>command==='plugin:player|load' ? new Promise(resolve=>loaded=resolve) : undefined;
  try {
    const deck=new NativeDeck();deck.setMetadata({id:'XFkzRNyygfk'});deck.src='https://example.test/audio';
    await Promise.resolve();await Promise.resolve();
    const first=deck.play();deck.pause();const last=deck.play();
    assert.equal(deck.paused,false);loaded();await Promise.all([first,last]);
    assert.deepEqual(calls.map(c=>c.command),['plugin:player|load','plugin:player|play']);
  } finally {intercept=null;}
});

test('la notificación puede cambiar playWhenReady aunque isPlaying sea false',()=>{
  const deck=new NativeDeck();deck.adopt({id:'XFkzRNyygfk'});
  deck._onState({id:'XFkzRNyygfk',sequence:1,playWhenReady:true,playing:false,buffering:true});
  assert.equal(deck.paused,false);
  deck._onState({id:'XFkzRNyygfk',sequence:2,playWhenReady:false,playing:false,buffering:true});
  assert.equal(deck.paused,true);
  deck._onState({id:'XFkzRNyygfk',sequence:1,playWhenReady:true,playing:true,buffering:false});
  assert.equal(deck.paused,true);
});

test('si una orden falla se restaura el estado conocido de Media3',async()=>{
  intercept=command=>{if(command==='plugin:player|play')throw new Error('controller disconnected');};
  try {
    const deck=new NativeDeck();deck.adopt({id:'XFkzRNyygfk'});
    deck._onState({id:'XFkzRNyygfk',sequence:1,playWhenReady:false,playing:false,buffering:false});
    const started=deck.play();assert.equal(deck.paused,false);
    await assert.rejects(started,/controller disconnected/);assert.equal(deck.paused,true);
  } finally {intercept=null;}
});

test('la confirmación de play no confirma muestras: espera al decodificador',async()=>{
  const deck=new NativeDeck();deck.adopt({id:'XFkzRNyygfk'});
  await deck.play();
  let confirmed=false;const ready=deck.waitUntilPlaying().then(()=>confirmed=true);
  deck._onState({id:'XFkzRNyygfk',sequence:1,playWhenReady:true,playing:false,buffering:true});
  await Promise.resolve();assert.equal(confirmed,false);
  deck._onState({id:'XFkzRNyygfk',sequence:2,playWhenReady:true,playing:true,buffering:false});
  await ready;assert.equal(confirmed,true);
  await deck.waitUntilPlaying();
});

test('el error del decodificador durante la carga rechaza la recuperación',async()=>{
  const deck=new NativeDeck();deck.adopt({id:'XFkzRNyygfk'});await deck.play();
  const ready=deck.waitUntilPlaying();
  const rejected=assert.rejects(ready,/ERROR_CODE_IO_BAD_HTTP_STATUS/);
  deck._onError({id:'XFkzRNyygfk',message:'ERROR_CODE_IO_BAD_HTTP_STATUS'});
  await rejected;
  await assert.rejects(deck.waitUntilPlaying(),/ERROR_CODE_IO_BAD_HTTP_STATUS/);
});

test('cambiar de canción o pausar cancela la espera de muestras anteriores',async()=>{
  const deck=new NativeDeck();deck.adopt({id:'XFkzRNyygfk'});await deck.play();
  const old=assert.rejects(deck.waitUntilPlaying(),/cancelada/);
  deck.setMetadata({id:'dQw4w9WgXcQ'});deck.src='https://example.test/new';await old;
  await deck.play();const paused=assert.rejects(deck.waitUntilPlaying(),/cancelada/);
  deck._onState({id:'dQw4w9WgXcQ',sequence:1,playWhenReady:false,playing:false,buffering:true});
  await paused;
});

test('una orden aceptada que nunca produce audio tiene un límite',async()=>{
  const deck=new NativeDeck();deck.adopt({id:'XFkzRNyygfk'});await deck.play();
  await assert.rejects(deck.waitUntilPlaying(5),/agotó el tiempo/);
});
