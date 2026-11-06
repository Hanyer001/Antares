import { runtime } from "./platform.js";
import * as prefs from "./prefs.js";

/** Solo tras una acción confirmada; Android decide si el sistema permite vibrar. */
export function haptic() {
  if (document.documentElement.dataset.platform !== 'android' || document.hidden || !prefs.get('mobile.haptics')) return;
  runtime.core.invoke('plugin:player|haptic').catch(() => {});
}
