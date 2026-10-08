import { test } from "node:test";
import assert from "node:assert/strict";
import { DESIGNS, applyDesign, matchingDesign, mobileAppearance } from "../src/js/designs.js";
import { defaults, sanitize, SCHEMA } from "../src/js/prefs-schema.js";
import { paletteFor, contrast } from "../src/js/themes.js";

test("los cuatro diseños se guardan sin perder tamaño de texto, movimiento ni ajustes de fondo propios",()=>{
  const before={...defaults().appearance,scale:1.4,motion:"none",backgroundDim:85};
  for(const design of DESIGNS){
    const next=applyDesign(before,design.id);
    assert.deepEqual(sanitize(next,SCHEMA.appearance),next);
    assert.equal(next.scale,1.4);assert.equal(next.motion,"none");assert.equal(next.backgroundDim,85);
    assert.equal(next.background,"plain");assert.equal(next.accentMode,"fixed");
    assert.equal(matchingDesign(next),design.id);
    const palette=paletteFor(next);
    assert.ok(contrast(palette.text,palette.surface)>=4.5);
    assert.ok(contrast(palette.text,palette.bg)>=4.5);
  }
  assert.equal(before.background,"plain");assert.equal(before.accentMode,"artwork");
});
test("retocar un diseño deja de marcarlo como predefinido y permite conservarlo en un perfil",()=>{
  const next=applyDesign(defaults().appearance,"mint");
  next.custom.bg="#112233";assert.equal(matchingDesign(next),null);
  const restored=sanitize({appearance:next});assert.deepEqual(restored.appearance,next);
  const reapplied=applyDesign(next,"mint");assert.equal(matchingDesign(reapplied),"mint");
  reapplied.custom.bg="#998877";assert.equal(DESIGNS.find(d=>d.id==="mint").appearance.custom.bg,"#0b1714");
});
test("los perfiles Android antiguos migran solo los usos visuales de carátula",()=>{
  const before={...defaults().appearance,theme:"artwork",background:"artwork",artTint:"strong",accentColor:"#123456"};
  const clean=mobileAppearance(before);
  assert.equal(clean.theme,"dark");assert.equal(clean.accentMode,"fixed");assert.equal(clean.background,"plain");
  assert.equal(clean.accentColor,"#123456");assert.equal(before.theme,"artwork");
  const own=applyDesign(before,"light");own.background="image";own.accentMode="mono";
  assert.deepEqual(mobileAppearance(own),own);
  assert.deepEqual(mobileAppearance(clean),clean);
});
test("un diseño desconocido conserva el aspecto y no comparte objetos mutables",()=>{
  const before=defaults().appearance;const next=applyDesign(before,"unknown");
  assert.deepEqual(next,before);next.custom.bg="#abcdef";assert.notEqual(next.custom.bg,before.custom.bg);
});
