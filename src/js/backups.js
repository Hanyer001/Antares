import { key } from "./user.js";
import * as session from "./session.js";
import * as moments from "./moments.js";
import * as dialog from "./dialog.js";
import { toast } from "./toast.js";
import { cleanSession } from "./session-model.js";
const { invoke } = window.__TAURI__.core;
let callbacks, busy=false, restoring=false, timer;
function message(error){toast(String(error?.message||error),{tone:"error"});}
export async function restoreWorkspace(){
  try{
    const local=await invoke("restored_workspace");if(!local)return;
    const restored=cleanSession(local.session);
    if(restored)localStorage.setItem(key("antares.session"),JSON.stringify(restored));
    else localStorage.removeItem(key("antares.session"));
    moments.importState(local.moments);
    await invoke("acknowledge_restored_workspace");
  }catch(error){message(`No se pudo restaurar la sesión: ${error}`);}
}
async function snapshot(){
  await callbacks.beforeBackup();
  return invoke("create_backup",{local:{session:session.load(),moments:moments.exportState()}});
}
async function refresh(){
  const select=document.getElementById("backup-list");
  const copies=await invoke("list_backups");select.replaceChildren();
  for(const copy of copies){const o=document.createElement("option");o.value=copy.name;o.textContent=(copy.name==="before-restore.json"?"Antes de restaurar · ":"")+new Date(copy.created_at*1000).toLocaleString();select.append(o);}
  document.getElementById("restore-auto").disabled=!copies.length;
  document.getElementById("backup-status").textContent=copies.length?`Última copia: ${new Date(copies[0].created_at*1000).toLocaleString()}. Se conservan 7 días con copias.`:"Las copias automáticas se guardan mientras usas Antares.";
}
async function run(action){if(busy||restoring)return;busy=true;try{await action();}catch(e){message(e);}finally{busy=false;}}
async function restore(contents){
  const info=await invoke("inspect_backup",{contents});
  if(!await dialog.confirmAction({title:"Restaurar copia completa",text:`Esta copia del ${new Date(info.created_at*1000).toLocaleString()} contiene ${info.lists} listas, ${info.liked} favoritos y estadísticas de ${info.tracks} canciones. Sustituirá los datos del usuario actual y reiniciará Antares. Guardaremos una copia de lo que tienes ahora.`,confirmLabel:"Restaurar y reiniciar",danger:true}))return;
  await callbacks.beforeRestore();
  const previous=JSON.stringify(await snapshot());
  await invoke("restore_backup",{contents,previous});
  restoring=true;clearInterval(timer);
  const notice=document.createElement("dialog");notice.className="library-editor";
  const text=document.createElement("p");text.textContent="La copia está lista para restaurarse. Antares necesita reiniciarse para aplicarla.";
  const restart=document.createElement("button");restart.type="button";restart.className="btn";restart.textContent="Reiniciar Antares";
  restart.addEventListener("click",()=>invoke("restart_after_restore").catch(message));notice.append(text,restart);document.body.append(notice);notice.addEventListener("cancel",e=>e.preventDefault());notice.showModal();
  await invoke("restart_after_restore");
}
export function init(options){
  callbacks=options;
  document.getElementById("export-backup").addEventListener("click",()=>run(async()=>{
    const copy=await snapshot();
    const path=await invoke("export_file",{name:`antares-copia-${new Date().toISOString().slice(0,10)}.json`,contents:JSON.stringify(copy)});
    toast(`Copia completa guardada: ${path}`);await refresh();
  }));
  document.getElementById("backup-now").addEventListener("click",()=>run(async()=>{await snapshot();await refresh();toast("Copia completa guardada en este dispositivo.");}));
  const input=document.getElementById("backup-input");
  document.getElementById("import-backup").addEventListener("click",()=>input.click());
  input.addEventListener("change",()=>run(async()=>{
    const file=input.files?.[0];input.value="";if(!file)return;
    if(file.size>64*1024*1024)throw Error("La copia supera el límite de 64 MB.");
    await restore(await file.text());
  }));
  document.getElementById("restore-auto").addEventListener("click",()=>run(async()=>{
    const name=document.getElementById("backup-list").value;if(name)await restore(await invoke("read_backup",{name}));
  }));
  refresh().catch(message);
  setTimeout(()=>run(async()=>{await snapshot();await refresh();}),30000);
  timer=setInterval(()=>run(async()=>{await snapshot();await refresh();}),15*60*1000);
}
