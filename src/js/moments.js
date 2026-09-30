import { els } from "./dom.js";
import * as prefs from "./prefs.js";
import { key } from "./user.js";
import { cleanMomentState, nextMidnight } from "./moments-model.js";
import { toast } from "./toast.js";
let state={contexts:{},snoozed:{}}, current="usual", learn=true, focused=null, changed=()=>{}, select, checkbox, status;
const storage=()=>key("antares.moments");
function save(){try{localStorage.setItem(storage(),JSON.stringify(state));}catch{toast("No se pudieron guardar las preferencias de este momento.",{tone:"error"});}}
export function exportState(){return cleanMomentState(state);}
export function importState(raw){state=cleanMomentState(raw);save();}
export function shouldLearn(){return learn;}
export function exclusions(){return Object.entries(state.snoozed).filter(([,until])=>until>Date.now()).map(([id])=>id);}
export function allowed(track){return !(state.snoozed[track.id]>Date.now());}
export function seeds(){return focused?[focused]:current==="usual"?[]:state.contexts[current]||[];}
export function contextual(){return current!=="usual"||Boolean(focused);}
export function notePick(track){if(!track?.id)return;focused=null;if(current!=="usual"){state.contexts[current]=[track,...(state.contexts[current]||[]).filter(t=>t.id!==track.id)].slice(0,3);save();render();}}
export function more(track){focused=track;changed();render();toast(`Las próximas recomendaciones partirán de «${track.title||"esta canción"}».`);}
export function snooze(track){state.snoozed[track.id]=nextMidnight();save();changed();render();toast("No se recomendará esta canción durante el resto del día.",{action:{label:"Deshacer",onClick:()=>{delete state.snoozed[track.id];save();changed();render();}}});}
function change(id){current=id;learn=id==="usual";focused=null;render();changed(true);}
function render(){
  if(!select)return;
  select.replaceChildren();
  const entries=[["usual","Habitual"],["work","Trabajo"],["party","Fiesta"],["relax","Relax"],...prefs.listProfiles().map(p=>[`profile:${p.id}`,`Perfil: ${p.name}`])];
  for(const [value,text] of entries){const o=document.createElement("option");o.value=value;o.textContent=text;select.append(o);}
  select.value=current;checkbox.checked=learn;
  status.textContent=focused?`Más como: ${focused.title||"esta canción"}`:current!=="usual"?`${(state.contexts[current]||[]).length} canciones de referencia. Elige música para enseñar a este momento.`:"Tus gustos habituales.";
}
export function init(onChange){
  try{state=cleanMomentState(JSON.parse(localStorage.getItem(storage())||"{}"));}catch{state=cleanMomentState();}
  changed=onChange;
  const panel=document.createElement("div");panel.className="moment-controls";
  const label=document.createElement("label");label.textContent="Momento ";select=document.createElement("select");select.setAttribute("aria-label","Momento");label.append(select);
  const learning=document.createElement("label");checkbox=document.createElement("input");checkbox.type="checkbox";learning.append(checkbox," Aprender para mis gustos habituales");
  status=document.createElement("span");status.className="moment-controls__status";status.setAttribute("aria-live","polite");
  const reset=document.createElement("button");reset.type="button";reset.className="btn btn--mini";reset.textContent="Quitar preferencia puntual";
  reset.addEventListener("click",()=>{focused=null;changed();render();});
  const unblock=document.createElement("button");unblock.type="button";unblock.className="btn btn--mini";unblock.textContent="Quitar «hoy no»";
  unblock.addEventListener("click",()=>{state.snoozed={};save();changed();render();toast("Se quitaron los bloqueos de hoy.");});
  select.addEventListener("change",()=>change(select.value));checkbox.addEventListener("change",()=>{learn=checkbox.checked;changed(false);});
  panel.append(label,learning,status,reset,unblock);els.discover.prepend(panel);
  let profile=prefs.activeProfileId();
  if(profile){current=`profile:${profile}`;learn=false;}
  prefs.onProfiles(()=>{const next=prefs.activeProfileId();if(next!==profile){profile=next;change(next?`profile:${next}`:"usual");}else render();});
  render();
}
