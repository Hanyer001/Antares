const { invoke } = window.__TAURI__.core;
export async function saveDocument({name,contents}) {
  if (document.documentElement.dataset.platform !== "android") return invoke("export_file",{name,contents});
  const result = await invoke("plugin:documents|save",{name,contents});
  return result.cancelled ? null : result.name;
}
