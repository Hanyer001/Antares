export { isPlaylistLink, importSummary } from './import-policy.js';
let pending;
export function initImportList() { /* La vista se cablea cuando se abre por primera vez. */ }
export async function ask(initial = '') {
  const module = await (pending ??= import('./importlist.js').then(module => {
    module.initImportList(); return module;
  }).catch(error => { pending = null; throw error; }));
  return module.ask(initial);
}
