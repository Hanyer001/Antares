import { API } from '../config.js';

const endpoint = path => new URL(path, new URL(API, location.href));
let account;
export const serverAccount = () => account;

async function authRequest(path, body) {
  const response = await fetch(endpoint(`auth/${path}`), {
    method: body === undefined ? 'GET' : 'POST', credentials: 'same-origin', cache: 'no-store',
    ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(15000),
  });
  const data = response.status === 204 ? {} : await response.json();
  if (!response.ok) {
    const error = new Error(data.error || 'No se pudo acceder a tu cuenta.');
    error.status = response.status;
    throw error;
  }
  return data;
}

export function selectServerAccount(identity) {
  if (!identity?.user || !/^[a-f0-9]{64}$/.test(identity.scope ?? '')) throw new Error('La cuenta del servidor no es válida.');
  // El scope identifica la caché: no es una clave que autorice acceso al servidor.
  // La autorización viaja exclusivamente en una cookie HttpOnly.
  const previous = localStorage.getItem('antares.web.account');
  if (previous !== identity.scope) {
    if (previous && !localStorage.getItem('antares.web.deviceOwner')) localStorage.setItem('antares.web.deviceOwner', previous.slice(0,24));
    if (!localStorage.getItem('antares.web.deviceOwner')) localStorage.setItem('antares.web.deviceOwner', 'legacy');
    localStorage.removeItem('antares.web.profile');
    localStorage.removeItem('antares.web.legacyPlayback');
    localStorage.setItem('antares.web.account', identity.scope);
  }
  account = identity;
}

export async function ensureAccountSession() {
  let identity;
  try { identity = await authRequest('me'); }
  catch (error) {
    // Compatibilidad con servidores antiguos. Nunca saltar el acceso por una
    // caída de red ni después de haber usado cuentas en este origen.
    if (error.status === 404 && localStorage.getItem('antares.auth.required') !== 'true') return;
    throw new Error('No se pudo verificar tu sesión. Comprueba la conexión al servidor y Tailscale, si lo utilizas.');
  }
  if (!identity.enabled) {
    if (localStorage.getItem('antares.auth.required') === 'true') throw new Error('Este servidor dejó de exigir cuentas. Revisa su configuración antes de continuar.');
    return;
  }
  if (localStorage.getItem('antares.auth.required') !== 'true') {
    const legacy = localStorage.getItem('antares.web.account');
    if (/^[a-f0-9]{64}$/.test(legacy ?? '')) localStorage.setItem('antares.web.legacyAccountBackup', legacy);
  }
  localStorage.setItem('antares.auth.required', 'true');
  if (endpoint('auth/me').origin !== location.origin) throw new Error('El acceso con cuenta requiere alojar Antares y su API en la misma dirección HTTPS.');
  if (!identity.user) identity = await loginScreen();
  selectServerAccount(identity);
  window.addEventListener('antares-auth-required', () => location.reload(), { once: true });
}

function loginScreen() {
  document.documentElement.dataset.antaresAuth = 'locked';
  const screen = document.createElement('main');
  screen.id = 'antares-login';
  const form = document.createElement('form');
  const title = document.createElement('h1'); title.textContent = 'Entra a Antares';
  const description = document.createElement('p'); description.textContent = 'Usa tu misma cuenta en el computador y el celular para compartir tu biblioteca.';
  const usernameLabel = document.createElement('label'); usernameLabel.textContent = 'Usuario';
  const username = document.createElement('input');
  username.name = 'username'; username.autocomplete = 'username'; username.required = true; username.maxLength = 64;
  username.autocapitalize = 'none'; username.spellcheck = false;
  usernameLabel.append(username);
  const passwordLabel = document.createElement('label'); passwordLabel.textContent = 'Contraseña';
  const password = document.createElement('input');
  password.name = 'password'; password.type = 'password'; password.autocomplete = 'current-password'; password.required = true; password.maxLength = 1024;
  passwordLabel.append(password);
  const status = document.createElement('p'); status.setAttribute('role','status'); status.setAttribute('aria-live','polite');
  const submit = document.createElement('button'); submit.type = 'submit'; submit.textContent = 'Entrar';
  const closed = document.createElement('p'); closed.className = 'auth-help'; closed.textContent = 'El registro está cerrado. Si olvidaste la contraseña, el administrador puede restablecerla desde el servidor.';
  form.append(title,description,usernameLabel,passwordLabel,submit,status,closed);
  screen.append(form); document.body.append(screen); username.focus();
  return new Promise(resolve => {
    form.addEventListener('submit', async event => {
      event.preventDefault();
      submit.disabled = true; status.textContent = 'Verificando tu cuenta…';
      try {
        const identity = await authRequest('login', { username: username.value.trim(), password: password.value });
        password.value = '';
        screen.remove(); delete document.documentElement.dataset.antaresAuth;
        resolve(identity);
      } catch (error) {
        status.textContent = error.message; password.value = ''; password.focus();
      } finally { submit.disabled = false; }
    });
  });
}

export async function logoutServerAccount() {
  await authRequest('logout', {});
  localStorage.removeItem('antares.web.account');
  localStorage.removeItem('antares.web.profile');
  location.reload();
}
