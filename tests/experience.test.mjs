import {test} from 'node:test';
import assert from 'node:assert/strict';
import {motionTiming,lyricScrollBehavior} from '../src/js/motion-policy.js';
import {delayedFlag,playbackPhase,PHASE_TEXT} from '../src/js/loading-policy.js';
import {prepareLyrics,lyricIndex} from '../src/js/lyrics-policy.js';
import {spectrumTap,frequencyRanges,spectrumLevels,shouldDrawSpectrum} from '../src/js/spectrum.js';

test('movimiento reducido interno o del sistema detiene roles y scroll suave',()=>{
  for(const mode of ['none','reduced']) assert.deepEqual(motionTiming(mode),{feedback:0,navigation:0,panel:0});
  assert.equal(motionTiming('full',true).panel,0);
  assert.equal(motionTiming('full',false).panel,260);
  assert.equal(lyricScrollBehavior('full',false,30,200),'smooth');
  assert.equal(lyricScrollBehavior('full',false,-500,200),'auto');
  assert.equal(lyricScrollBehavior('full',true,30,200),'auto');
});
test('una carga rápida no muestra skeleton, ni callbacks tardíos lo recuperan',()=>{
  const jobs=[],events=[];
  const busy=delayedFlag(v=>events.push(v),{schedule:fn=>(jobs.push(fn),jobs.length),cancel:()=>{}});
  busy(true);busy(false);jobs[0]();
  assert.deepEqual(events,[false,false]);
});
test('una búsqueda nueva invalida el skeleton pendiente anterior',()=>{
  const jobs=[],events=[];
  const busy=delayedFlag(v=>events.push(v),{schedule:fn=>(jobs.push(fn),jobs.length),cancel:()=>{}});
  busy(true);busy(true);jobs[0]();assert.deepEqual(events,[false,false]);
  jobs[1]();assert.equal(events.at(-1),true);busy(false);assert.equal(events.at(-1),false);
});
test('preparación, buffering, desconexión y error tienen estados distintos',()=>{
  assert.equal(playbackPhase('busy'),'preparing');
  assert.equal(playbackPhase('busy','buffering'),'buffering');
  assert.equal(playbackPhase('busy','reconnecting'),'reconnecting');
  assert.equal(playbackPhase('error','buffering'),'error');
  assert.equal(playbackPhase('playing','buffering'),'playing');
  assert.notEqual(PHASE_TEXT.preparing,PHASE_TEXT.buffering);
});
test('letras inválidas se filtran y las marcas válidas quedan ordenadas sin mutar la respuesta',()=>{
  const source=[{time:8,text:'B'},{time:NaN,text:'X'},null,{time:-1},{time:2,text:'A'}];
  assert.deepEqual(prepareLyrics(source),[{time:2,text:'A'},{time:8,text:'B'}]);
  assert.equal(source[0].time,8);assert.deepEqual(prepareLyrics(null),[]);
});
test('letras admiten retroceso, silencio inicial, offset y marcas duplicadas',()=>{
  const lines=prepareLyrics([{time:5,text:'a'},{time:10,text:'b'},{time:10,text:'c'},{time:20,text:'d'}]);
  assert.equal(lyricIndex(lines,0),-1);assert.equal(lyricIndex(lines,10),2);
  assert.equal(lyricIndex(lines,8,2),2);assert.equal(lyricIndex(lines,8,-2),0);
  assert.equal(lyricIndex(lines,100),3);assert.equal(lyricIndex(lines,NaN),-1);
});
test('el espectro usa una única rama de lectura y la desconecta de forma específica',()=>{
  const connected=[],disconnected=[];let reads=0,closed=0;
  const analyser={frequencyBinCount:512,getByteFrequencyData:data=>{reads++;data[4]=128;},disconnect:()=>closed++};
  const output={connect:node=>connected.push(node),disconnect:node=>disconnected.push(node)};
  const tap=spectrumTap({sampleRate:48000,createAnalyser:()=>analyser},output);
  assert.deepEqual(connected,[analyser]);assert.equal(tap.read()[4],128);assert.equal(reads,1);
  tap.close();tap.close();assert.deepEqual(disconnected,[analyser]);assert.equal(closed,1);assert.equal(tap.read(),null);
});
test('rangos de espectro quedan dentro del FFT para frecuencias de muestreo distintas',()=>{
  for(const rate of [8000,44100,48000,96000]){
    const ranges=frequencyRanges(rate,1024);assert.equal(ranges.length,32);
    for(const [start,end] of ranges) assert.ok(start>=1&&end<=512&&start<end);
  }
  assert.deepEqual(frequencyRanges(NaN,1024),[]);
});
test('silencio produce niveles cero y el volumen máximo no desborda el dibujo',()=>{
  const ranges=frequencyRanges(48000,1024),data=new Uint8Array(512);
  assert.ok([...spectrumLevels(data,ranges)].every(v=>v===0));
  data.fill(255);assert.ok([...spectrumLevels(data,ranges)].every(v=>v===1));
});
test('el visualizador se detiene al ocultar, pausar, cargar, salir o reducir movimiento',()=>{
  const state={enabled:true,focus:true,visible:true,playing:true,loading:false,motion:true,available:true};
  assert.equal(shouldDrawSpectrum(state),true);
  for(const key of ['enabled','focus','visible','playing','motion','available']) assert.equal(shouldDrawSpectrum({...state,[key]:false}),false);
  assert.equal(shouldDrawSpectrum({...state,loading:true}),false);
});
