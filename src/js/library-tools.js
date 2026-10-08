import { els } from "./dom.js";
import * as results from "./results.js";
import * as lists from "./lists.js";
import * as dialog from "./dialog.js";
import { toast } from "./toast.js";
import { filterTracks, groupLists } from "./library-model.js";

const { invoke } = window.__TAURI__.core;
let handlers, currentId, query = "", folder = "", selecting = false, selected = new Set();
let currentList, allLists = [], bar, rows, bulkBar;
const node = (tag, text = "", className = "") => Object.assign(document.createElement(tag), { textContent: text, className });
const button = (label, action) => {
  const b = node("button", label, "btn btn--mini"); b.type = "button"; b.addEventListener("click", action); return b;
};
const option = (value, label) => Object.assign(node("option", label), { value });
function report(error) { toast(String(error?.message || error), { tone: "error" }); }
export function init(callbacks) {
  handlers = callbacks;
  bar = node("div", "", "library-tools"); bar.hidden = true; els.resultsList.before(bar);
}
export function hide() { if (bar) bar.hidden = true; }
export function visibleTracks(pl) { return filterTracks(pl.tracks, pl.id === currentId ? query : ""); }
export function show(pl, collection) {
  allLists = collection; currentList = pl;
  const id = pl?.id ?? "overview";
  if (currentId !== id) { currentId = id; query = ""; selected.clear(); selecting = false; }
  if (pl) selected = new Set([...selected].filter(id => pl.tracks.some(t => t.id === id)));
  bar.hidden = false; bar.replaceChildren();
  if (pl?.description) bar.append(node("p", pl.description, "library-description"));
  if (pl?.cover) {
    const image = node("img", "", "library-cover"); image.src = pl.cover; image.alt = `Portada de ${pl.name}`; bar.append(image);
  }
  rows = node("div", "", "library-tools__row"); bar.append(rows);
  const search = node("input"); search.type = "search"; search.value = query;
  search.placeholder = pl ? "Buscar en esta lista…" : "Buscar listas…";
  search.setAttribute("aria-label", search.placeholder); rows.append(search);
  search.addEventListener("input", () => { query = search.value; renderRows(); });
  if (!pl) {
    const folders = node("select"); folders.setAttribute("aria-label", "Carpeta");
    folders.append(option("", "Todas las carpetas"), option("__none", "Sin carpeta"));
    const names = [...new Set(collection.map(l => l.folder).filter(Boolean))].sort((a,b)=>a.localeCompare(b));
    for (const name of names) folders.append(option(name, name));
    if (folder !== "__none" && !names.includes(folder)) folder = "";
    folders.value = folder; folders.addEventListener("change", () => { folder = folders.value; renderRows(); });
    rows.append(folders, button("Lista inteligente…", () => editPlaylist(null, true)));
  } else {
    rows.append(button(selecting ? "Terminar selección" : "Seleccionar canciones", () => {
      selecting = !selecting; selected.clear(); show(currentList, allLists);
    }));
    if (!pl.system) rows.append(button(pl.rules ? "Editar reglas y detalles…" : "Editar detalles…", () => editPlaylist(pl)));
  }
  bulkBar = node("div", "", "library-tools__row"); bar.append(bulkBar);
  renderRows();
}
function renderRows() {
  const pl = currentList;
  if (!pl) {
    const filtered = groupLists(allLists, query, folder);
    lists.renderOverview(filtered);
    if (!filtered.length) results.renderEmpty("No hay listas que coincidan.");
    return;
  }
  const tracks = visibleTracks(pl);
  if (!tracks.length && !query && document.documentElement.dataset.platform === "android") {
    results.renderEmpty("Busca una canción, abre ⋯ y elige Añadir a una lista. También puedes importar una playlist desde Playlists.");
    return;
  }
  const editable = !pl.system && !pl.rules;
  results.render(tracks, { removeLabel: pl.rules ? null : pl.system ? "Quitar de Me gusta" : "Quitar de la lista", reorderable: editable && !query && !selecting });
  if (!tracks.length) results.renderEmpty(pl.rules ? "Ninguna canción cumple las reglas todavía. Puedes editarlas." : query ? "No hay canciones que coincidan." : "Esta lista está vacía.");
  if (selecting) {
    for (const row of els.resultsList.querySelectorAll(".result[data-id]")) {
      const box = node("input"); box.type = "checkbox"; box.checked = selected.has(row.dataset.id);
      box.setAttribute("aria-label", `Seleccionar ${tracks.find(t=>t.id===row.dataset.id)?.title || "canción"}`);
      box.addEventListener("click", e => e.stopPropagation());
      box.addEventListener("change", () => {
        if (box.checked) selected.add(row.dataset.id); else selected.delete(row.dataset.id);
        row.classList.toggle("is-selected", box.checked); renderBulk();
      });
      row.classList.add("result--selectable"); row.classList.toggle("is-selected", box.checked); row.prepend(box);
    }
  }
  renderBulk();
}
function renderBulk() {
  bulkBar.replaceChildren(); bulkBar.hidden = !selecting;
  if (!selecting) return;
  const tracks = visibleTracks(currentList);
  const count = node("span", `${selected.size} seleccionadas`, "library-count"); count.setAttribute("aria-live", "polite");
  bulkBar.append(count, button("Seleccionar visibles", () => { tracks.forEach(t=>selected.add(t.id)); renderRows(); }), button("Limpiar selección", () => { selected.clear(); renderRows(); }));
  const target = node("select"); target.setAttribute("aria-label", "Lista de destino"); target.append(option("", "Elegir destino…"));
  for (const list of allLists.filter(l => !l.system && !l.rules && l.id !== currentList.id)) target.append(option(list.id, list.name));
  bulkBar.append(target);
  for (const [action,label] of [["copy","Copiar"], ["move","Mover"], ["remove","Quitar"]]) {
    if (currentList.rules && action !== "copy") continue;
    if (currentList.system && action === "move") continue;
    const b = button(label, async () => {
      if (!selected.size) return;
      if (action !== "remove" && !target.value) { toast("Elige una lista de destino.", { tone:"info" }); return; }
      const ids = [...selected], source = currentList.id;
      if (action === "remove" && !await dialog.confirmAction({ title:"Quitar canciones", text:`Se quitarán ${ids.length} canciones de «${currentList.name}».`, confirmLabel:"Quitar", danger:true })) return;
      b.disabled = true;
      try {
        await invoke("bulk_playlist", { source, target:target.value || null, ids, action });
        selected.clear(); await handlers.refresh(); toast(`${ids.length} ${ids.length === 1 ? "canción" : "canciones"} ${action === "copy" ? (ids.length === 1 ? "copiada" : "copiadas") : action === "move" ? (ids.length === 1 ? "movida" : "movidas") : (ids.length === 1 ? "quitada" : "quitadas")}.`);
      } catch (e) { report(e); } finally { b.disabled = false; }
    });
    b.disabled = !selected.size; bulkBar.append(b);
  }
}

function field(form, label, type, value, { min, max, placeholder = "" } = {}) {
  const wrap = node("label", "", "library-field"); wrap.append(node("span",label));
  const input = node(type === "textarea" ? "textarea" : "input");
  if (type !== "textarea") input.type = type;
  if (type === "checkbox") input.checked = Boolean(value); else input.value = value ?? "";
  if (min != null) input.min = min; if (max != null) { if (type === "number") input.max=max; else input.maxLength=max; }
  input.placeholder=placeholder; wrap.append(input); form.append(wrap); return input;
}
const presets = {
  dormant: { liked_only:true, not_played_days:30, discovered_days:0, min_plays:0, max_skip_percent:100, artist:"", limit:100 },
  discoveries: { liked_only:false, not_played_days:0, discovered_days:7, min_plays:1, max_skip_percent:100, artist:"", limit:100 },
  reliable: { liked_only:false, not_played_days:0, discovered_days:0, min_plays:3, max_skip_percent:10, artist:"", limit:100 },
};
export async function editPlaylist(pl = null, smart = false) {
  smart ||= Boolean(pl?.rules);
  const modal = node("dialog", "", "library-editor");
  modal.setAttribute("aria-label", pl ? "Editar lista" : "Nueva lista inteligente");
  const form = node("form"); form.append(node("h2", pl ? "Editar lista" : "Nueva lista inteligente"));
  const name=field(form,"Nombre","text",pl?.name || "",{max:80}); name.required=true;
  const folderField=field(form,"Carpeta (vacío: sin carpeta)","text",pl?.folder,{max:80,placeholder:"Por ejemplo: Trabajo"});
  const description=field(form,"Descripción","textarea",pl?.description,{max:1000});
  const pinned=field(form,"Fijar en la biblioteca","checkbox",pl?.pinned);
  let cover=pl?.cover || null;
  const file=field(form,"Portada propia (JPEG, PNG o WebP)","file",""); file.accept="image/jpeg,image/png,image/webp";
  const preview=node("img","","library-cover"); preview.hidden=!cover; if(cover)preview.src=cover; form.append(preview);
  form.append(button("Quitar portada",()=>{cover=null;preview.hidden=true;file.value="";}));
  const error=node("p","","library-error"); error.setAttribute("role","alert");
  let imageLoading=false;
  file.addEventListener("change", async()=>{
    const f=file.files?.[0]; if(!f)return;
    if(!["image/jpeg","image/png","image/webp"].includes(f.type)||f.size>12*1024*1024){error.textContent="Elige una imagen JPEG, PNG o WebP de menos de 12 MB.";return;}
    imageLoading=true;
    let url;
    try{
      url=URL.createObjectURL(f); const img=new Image(); img.src=url; await img.decode();
      const canvas=document.createElement("canvas");canvas.width=canvas.height=640;
      const size=Math.min(img.width,img.height);canvas.getContext("2d").drawImage(img,(img.width-size)/2,(img.height-size)/2,size,size,0,0,640,640);
      cover=canvas.toDataURL("image/jpeg",0.85);preview.src=cover;preview.hidden=false;error.textContent="";
    }catch{error.textContent="No se pudo abrir esa imagen.";}finally{if(url)URL.revokeObjectURL(url);imageLoading=false;}
  });
  const controls={};
  if(smart){
    form.append(node("p","Todas las reglas se cumplen a la vez. La lista se actualiza al abrirla y cuando cambian tus escuchas."));
    const preset=node("select");preset.setAttribute("aria-label","Reglas iniciales");
    preset.append(option("","Elegir ejemplo…"),option("dormant","Favoritas olvidadas"),option("discoveries","Descubrimientos de la semana"),option("reliable","Canciones que casi nunca salto")); form.append(preset);
    const rules=pl?.rules||presets.dormant;
    controls.liked_only=field(form,"Solo favoritas","checkbox",rules.liked_only);
    controls.not_played_days=field(form,"Sin escuchar al menos estos días (0: cualquiera)","number",rules.not_played_days,{min:0,max:3650});
    controls.discovered_days=field(form,"Descubiertas en los últimos días (0: cualquiera)","number",rules.discovered_days,{min:0,max:3650});
    controls.min_plays=field(form,"Mínimo de escuchas","number",rules.min_plays,{min:0,max:10000});
    controls.max_skip_percent=field(form,"Porcentaje máximo de saltos","number",rules.max_skip_percent,{min:0,max:100});
    controls.artist=field(form,"Artista contiene (opcional)","text",rules.artist,{max:200});
    controls.limit=field(form,"Máximo de canciones","number",rules.limit,{min:1,max:2000});
    for(const control of Object.values(controls)){if(control.type==="number"){control.required=true;control.step="1";}}
    preset.addEventListener("change",()=>{const p=presets[preset.value];if(!p)return;for(const [k,v] of Object.entries(p)){if(controls[k].type==="checkbox")controls[k].checked=v;else controls[k].value=v;}});
  }
  form.append(error);
  const actions=node("div","","library-tools__row");const save=button("Guardar",()=>{});save.type="submit";
  actions.append(button("Cancelar",()=>modal.close()),save);form.append(actions);modal.append(form);document.body.append(modal);
  modal.addEventListener("close",()=>modal.remove(),{once:true});modal.showModal();name.focus();
  form.addEventListener("submit",async event=>{
    event.preventDefault();if(imageLoading){error.textContent="Espera a que termine de preparar la portada.";return;}
    save.disabled=true;
    const rules=smart?Object.fromEntries(Object.entries(controls).map(([k,input])=>[k,input.type==="checkbox"?input.checked:input.type==="number"?Number(input.value):input.value.trim()])):null;
    const details={pinned:pinned.checked,folder:folderField.value.trim(),description:description.value.trim(),cover,rules};
    try{
      if(pl){await invoke("update_playlist_details",{id:pl.id,details,name:name.value.trim()});}
      else{const id=await invoke("create_smart_playlist",{name:name.value.trim(),details});await handlers.refresh();handlers.open(id);}
      await handlers.refresh();modal.close();toast("Lista guardada.");
    }catch(e){error.textContent=String(e);}finally{save.disabled=false;}
  });
}
