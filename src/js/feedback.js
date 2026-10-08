import * as prefs from "./prefs.js";
import { artistKey } from "./filters.js";
import { toast } from "./toast.js";
import { undoAddedValue } from "./interaction-policy.js";

/** Las preferencias se guardan junto a los ajustes y solo se cambian al tocar. */
export function feedback(track,kind) {
  const path=kind==='less'?'discovery.lessArtists':'discovery.knownTracks';
  const value=kind==='less'?artistKey(track.uploader):track.id;
  if(!value)return;
  const before=prefs.get(path),present=before.includes(value);
  if(!present){
    prefs.set(path,[...before,value]);
    if(!prefs.get(path).includes(value)){toast('Alcanzaste el límite de preferencias. Puedes revisarlas en Ajustes.',{tone:'warn'});return;}
  }
  toast(kind==='less'?`Aparecerá con menos frecuencia «${track.uploader.replace(/ - Topic$/,'')}».`:`«${track.title||'Esta canción'}» ya no se presentará como descubrimiento.`,{
    key:'discovery-feedback',action:{label:'Deshacer',onClick:()=>{
      prefs.set(path,undoAddedValue(prefs.get(path),value,present));
      toast('Preferencia deshecha.');
    }}
  });
}

/** Revisar estas señales sin borrar gustos, listas ni las otras recomendaciones. */
export function initFeedbackSettings() {
  const group=document.querySelector('[data-group="discovery"] .settings__card');
  if(!group)return;
  const row=document.createElement('div');row.className='setting setting--column';row.dataset.keywords='descubrimiento conocida menos artista preferencias';
  const label=document.createElement('span');label.className='setting__label';label.textContent='Tus señales de descubrimiento';
  const status=document.createElement('span');status.className='setting__value';
  const less=document.createElement('details'),summary=document.createElement('summary'),artists=document.createElement('div');
  less.className='feedback-artists';summary.textContent='Revisar artistas con menos frecuencia';less.append(summary,artists);
  const known=document.createElement('button');known.type='button';known.className='btn btn--mini';known.textContent='Volver a mostrar canciones conocidas';
  known.addEventListener('click',()=>{
    const before=prefs.get('discovery.knownTracks');prefs.set('discovery.knownTracks',[]);
    toast('Las canciones conocidas pueden volver a aparecer en descubrimientos.',{action:{label:'Deshacer',onClick:()=>prefs.set('discovery.knownTracks',[...new Set([...before,...prefs.get('discovery.knownTracks')])])}});
  });
  const renderArtists=()=>{
    artists.replaceChildren();if(!less.open)return;
    for(const artist of prefs.get('discovery.lessArtists')){
      const button=document.createElement('button');button.type='button';button.className='btn btn--mini';button.textContent=`Quitar preferencia: ${artist}`;
      button.addEventListener('click',()=>{
        prefs.set('discovery.lessArtists',prefs.get('discovery.lessArtists').filter(value=>value!==artist));
        toast('Preferencia de artista quitada.',{action:{label:'Deshacer',onClick:()=>prefs.set('discovery.lessArtists',[...new Set([...prefs.get('discovery.lessArtists'),artist])])}});
      });artists.append(button);
    }
  };
  function render(){
    const a=prefs.get('discovery.lessArtists').length,k=prefs.get('discovery.knownTracks').length;
    status.textContent=`${a} artistas con menos frecuencia · ${k} canciones ya conocidas`;
    known.disabled=k===0;less.hidden=a===0;renderArtists();
  }
  less.addEventListener('toggle',renderArtists);row.append(label,status,less,known);group.append(row);
  prefs.on('discovery',render);render();
}
