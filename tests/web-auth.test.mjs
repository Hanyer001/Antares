import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const source = (await readFile(new URL('../src/js/web-auth.js',import.meta.url),'utf8'))
  .replace("import { API } from '../config.js';", "const API = './api/';");
let serial = 0;
async function fixture(initial = {}) {
  const values = new Map(Object.entries(initial));
  globalThis.localStorage = { getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k) };
  globalThis.location = { href:'https://music.example/', origin:'https://music.example' };
  globalThis.window = new EventTarget();
  const module = await import('data:text/javascript;base64,'+Buffer.from(source+`\n// ${serial++}`).toString('base64'));
  return {...module,values};
}
test('una sesión del servidor comparte scope y conserva separada la biblioteca local anterior',async()=>{
  const old = 'a'.repeat(64), next='b'.repeat(64);
  const f=await fixture({'antares.web.account':old,'antares.web.profile':'u1'});
  globalThis.fetch=async(_url,options)=>{
    assert.equal(options.credentials,'same-origin');
    return new Response(JSON.stringify({enabled:true,user:'hanyer',scope:next}));
  };
  await f.ensureAccountSession();
  assert.equal(f.values.get('antares.web.legacyAccountBackup'),old);
  assert.equal(f.values.get('antares.web.account'),next);
  assert.equal(f.values.get('antares.web.deviceOwner'),old.slice(0,24));
  assert.equal(f.values.has('antares.web.profile'),false);
  assert.equal(f.serverAccount().user,'hanyer');
});
test('una sesión de la misma cuenta mantiene su perfil al volver a abrir',async()=>{
  const scope='c'.repeat(64);
  const f=await fixture({'antares.web.account':scope,'antares.web.profile':'u2'});
  f.selectServerAccount({user:'hanyer',scope});
  assert.equal(f.values.get('antares.web.profile'),'u2');
});
test('una caída de red nunca se convierte en un acceso sin cuenta',async()=>{
  const f=await fixture();
  globalThis.fetch=async()=>{throw new TypeError('offline');};
  await assert.rejects(f.ensureAccountSession(),/No se pudo verificar/);
  assert.equal(f.serverAccount(),undefined);
});
test('un origen que ya usa cuentas no admite una degradación a claves antiguas',async()=>{
  const f=await fixture({'antares.auth.required':'true'});
  globalThis.fetch=async()=>new Response(JSON.stringify({enabled:false}));
  await assert.rejects(f.ensureAccountSession(),/dejó de exigir cuentas/);
});
