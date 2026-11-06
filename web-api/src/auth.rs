//! Cuentas del servidor. Las claves de biblioteca permanecen en SQLite y nunca
//! se entregan al navegador; una sesión opaca autoriza el acceso a su biblioteca.
use std::{env, path::Path, sync::{Arc, Mutex}, time::{Duration, SystemTime, UNIX_EPOCH}};
use argon2::{Argon2, PasswordHash, PasswordHasher, PasswordVerifier, password_hash::SaltString};
use axum::{extract::{Request, State}, http::{header, HeaderMap, HeaderValue, Method, StatusCode}, middleware::Next, response::{IntoResponse, Response}, Json};
use rand::{rngs::OsRng, RngCore};
use rusqlite::{params, Connection, OptionalExtension};
use serde::Deserialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use crate::{error, ApiError};

const SESSION_SECONDS: i64 = 30 * 24 * 60 * 60;
const BAD_LOGIN: &str = "Usuario o contraseña incorrectos.";
const COOKIE: &str = "__Host-antares-session";
const DEV_COOKIE: &str = "antares-dev-session";
type Db = Arc<Mutex<Connection>>;

#[derive(Clone)]
pub struct Auth {
    db: Db,
    pub enabled: bool,
    origin: String,
    secure: bool,
    // Límite global, deliberadamente independiente del nombre solicitado:
    // evita crear entradas sin límite y protege el coste de Argon2.
    attempts: Arc<Mutex<Vec<i64>>>,
    dummy_hash: Arc<String>,
}

fn now() -> i64 { SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_secs() as i64 }
fn hash(value: &str) -> String { format!("{:x}", Sha256::digest(value.as_bytes())) }
fn random_key() -> String {
    let mut bytes = [0u8; 32];
    OsRng.fill_bytes(&mut bytes);
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}
fn password_hash(password: &str) -> Result<String, String> {
    let salt = SaltString::generate(&mut OsRng);
    Argon2::default().hash_password(password.as_bytes(), &salt).map(|h| h.to_string()).map_err(|_| "No se pudo proteger la contraseña.".into())
}
fn username(input: &str) -> Option<String> {
    let name = input.trim().to_ascii_lowercase();
    (name.len() >= 3 && name.len() <= 64 && name.bytes().all(|b| b.is_ascii_alphanumeric() || b"._-".contains(&b))).then_some(name)
}
fn internal() -> ApiError { error(StatusCode::SERVICE_UNAVAILABLE, "El acceso a cuentas no está disponible. Inténtalo de nuevo.") }

impl Auth {
    fn open(path: &Path, enabled: bool, origin: String, secure: bool) -> Result<Self, Box<dyn std::error::Error>> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
            #[cfg(unix)] {
                use std::os::unix::fs::PermissionsExt;
                std::fs::set_permissions(parent, std::fs::Permissions::from_mode(0o700))?;
            }
        }
        let conn = Connection::open(path)?;
        conn.busy_timeout(Duration::from_secs(5))?;
        conn.execute_batch("PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
            CREATE TABLE IF NOT EXISTS accounts (
                username TEXT PRIMARY KEY, password_hash TEXT NOT NULL,
                library_key TEXT NOT NULL UNIQUE, created_at INTEGER NOT NULL);
            CREATE TABLE IF NOT EXISTS sessions (
                token_hash TEXT PRIMARY KEY, username TEXT NOT NULL REFERENCES accounts(username) ON DELETE CASCADE,
                expires_at INTEGER NOT NULL);
            CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at);")?;
        #[cfg(unix)] {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600))?;
        }
        Ok(Self { db: Arc::new(Mutex::new(conn)), enabled, origin, secure,
            attempts: Arc::new(Mutex::new(Vec::new())), dummy_hash: Arc::new(password_hash(&random_key())?) })
    }
    pub fn from_env(root: &Path) -> Result<Self, Box<dyn std::error::Error>> {
        let enabled = env::var("ANTARES_AUTH_REQUIRED").is_ok_and(|v| v == "true");
        let origin = env::var("ANTARES_AUTH_ORIGIN").unwrap_or_default();
        let secure = !env::var("ANTARES_AUTH_INSECURE_HTTP").is_ok_and(|v| v == "true");
        if enabled {
            let url = reqwest::Url::parse(&origin)?;
            let local_http = !secure && url.scheme() == "http" && matches!(url.host_str(), Some("127.0.0.1" | "localhost"));
            if (url.scheme() != "https" && !local_http) || !url.username().is_empty() || url.password().is_some()
                || url.query().is_some() || url.fragment().is_some() || url.path() != "/" || origin != url.origin().ascii_serialization() {
                return Err("ANTARES_AUTH_ORIGIN debe ser el origen HTTPS exacto, sin barra final ni ruta. HTTP de prueba sólo admite localhost/127.0.0.1.".into());
            }
            if !secure && !local_http { return Err("No se permiten cookies inseguras fuera de una prueba HTTP local.".into()); }
        }
        Self::open(&root.join("auth/accounts.sqlite"), enabled, origin, secure)
    }
    fn cookie_name(&self) -> &'static str { if self.secure { COOKIE } else { DEV_COOKIE } }
    fn cookie_value<'a>(&self, headers: &'a HeaderMap) -> Option<&'a str> {
        headers.get_all(header::COOKIE).iter().filter_map(|v| v.to_str().ok())
            .flat_map(|v| v.split(';')).filter_map(|part| part.trim().split_once('='))
            .find(|(name, _)| *name == self.cookie_name()).map(|(_, value)| value)
            .filter(|v| v.len() == 64 && v.bytes().all(|b| b.is_ascii_hexdigit()))
    }
    fn session(&self, headers: &HeaderMap) -> Result<Option<(String, String)>, ApiError> {
        let Some(token) = self.cookie_value(headers) else { return Ok(None); };
        self.db.lock().map_err(|_| internal())?.query_row(
            "SELECT a.username,a.library_key FROM sessions s JOIN accounts a ON a.username=s.username WHERE s.token_hash=?1 AND s.expires_at>?2",
            params![hash(token), now()], |row| Ok((row.get(0)?, row.get(1)?))).optional().map_err(|_| internal())
    }
    fn allowed_origin(&self, headers: &HeaderMap) -> bool {
        headers.get(header::ORIGIN).and_then(|v| v.to_str().ok()) == Some(self.origin.as_str())
            && headers.get("sec-fetch-site").and_then(|v| v.to_str().ok()) != Some("cross-site")
    }
    fn cookie(&self, value: &str, seconds: i64) -> HeaderValue {
        HeaderValue::from_str(&format!("{}={value}; Path=/; HttpOnly; SameSite=Lax; Max-Age={seconds}{}",
            self.cookie_name(), if self.secure { "; Secure" } else { "" })).expect("cookie interna")
    }
    fn identity(name: &str, key: &str) -> Value { json!({"enabled":true,"user":name,"scope":hash(key)}) }
}

/// Administración local: no hay endpoint de registro ni contraseña en argumentos.
pub fn administer(root: &Path, args: &[String]) -> Result<(), Box<dyn std::error::Error>> {
    if args.len() != 2 || !matches!(args[0].as_str(), "create" | "password") {
        return Err("Uso: antares-web-api account create|password USUARIO".into());
    }
    let name = username(&args[1]).ok_or("Usuario: 3–64 letras ASCII, números, puntos, guiones o guiones bajos.")?;
    let password = rpassword::prompt_password("Contraseña (mínimo 15 caracteres): ")?;
    if password.chars().count() < 15 || password.len() > 1024 { return Err("Usa una contraseña de 15 caracteres como mínimo (máximo 1024 bytes).".into()); }
    if password != rpassword::prompt_password("Repite la contraseña: ")? { return Err("Las contraseñas no coinciden.".into()); }
    let auth = Auth::open(&root.join("auth/accounts.sqlite"), true, String::new(), true)?;
    let encoded = password_hash(&password)?;
    let mut db = auth.db.lock().map_err(|_| "Base de cuentas ocupada")?;
    let tx = db.transaction()?;
    if args[0] == "create" {
        tx.execute("INSERT INTO accounts(username,password_hash,library_key,created_at) VALUES(?1,?2,?3,?4)", params![name, encoded, random_key(), now()])?;
    } else {
        if tx.execute("UPDATE accounts SET password_hash=?1 WHERE username=?2", params![encoded, name])? != 1 { return Err("No existe esa cuenta.".into()); }
        tx.execute("DELETE FROM sessions WHERE username=?1", [&name])?;
    }
    tx.commit()?;
    println!("Cuenta {name}: operación completada.");
    Ok(())
}

pub async fn me(State(auth): State<Auth>, headers: HeaderMap) -> Result<Response, ApiError> {
    let body = if !auth.enabled { json!({"enabled":false}) }
        else if let Some((name, key)) = auth.session(&headers)? { Auth::identity(&name, &key) }
        else { json!({"enabled":true,"user":null}) };
    Ok(([(header::CACHE_CONTROL, "no-store")], Json(body)).into_response())
}
#[derive(Deserialize)]
pub struct Credentials { username: String, password: String }
pub async fn login(State(auth): State<Auth>, headers: HeaderMap, Json(input): Json<Credentials>) -> Result<Response, ApiError> {
    if !auth.enabled { return Err(error(StatusCode::NOT_FOUND, "Cuentas deshabilitadas.")); }
    if !auth.allowed_origin(&headers) { return Err(error(StatusCode::FORBIDDEN, "Abre Antares desde su dirección autorizada.")); }
    {
        let mut attempts = auth.attempts.lock().map_err(|_| internal())?;
        attempts.retain(|at| *at > now() - 60);
        if attempts.len() >= 10 { return Err(error(StatusCode::TOO_MANY_REQUESTS, "Espera un minuto antes de volver a entrar.")); }
        attempts.push(now());
    }
    let name = username(&input.username).unwrap_or_default();
    let found: Option<(String, String)> = auth.db.lock().map_err(|_| internal())?.query_row(
        "SELECT password_hash,library_key FROM accounts WHERE username=?1", [&name], |row| Ok((row.get(0)?, row.get(1)?)))
        .optional().map_err(|_| internal())?;
    let encoded = found.as_ref().map(|row| row.0.clone()).unwrap_or_else(|| (*auth.dummy_hash).clone());
    let verified = tokio::task::spawn_blocking(move || {
        input.password.len() <= 1024 && PasswordHash::new(&encoded).ok().is_some_and(|hash| Argon2::default().verify_password(input.password.as_bytes(), &hash).is_ok())
    }).await.map_err(|_| internal())?;
    let Some((_, key)) = found.filter(|_| verified) else { return Err(error(StatusCode::UNAUTHORIZED, BAD_LOGIN)); };
    let token = random_key();
    {
        let mut db = auth.db.lock().map_err(|_| internal())?;
        let tx = db.transaction().map_err(|_| internal())?;
        tx.execute("DELETE FROM sessions WHERE expires_at<=?1", [now()]).map_err(|_| internal())?;
        if let Some(old) = auth.cookie_value(&headers) { tx.execute("DELETE FROM sessions WHERE token_hash=?1", [hash(old)]).map_err(|_| internal())?; }
        // Número acotado de sesiones por cuenta; se conservan las 19 más recientes.
        tx.execute("DELETE FROM sessions WHERE username=?1 AND token_hash NOT IN (SELECT token_hash FROM sessions WHERE username=?1 ORDER BY expires_at DESC LIMIT 19)", [&name]).map_err(|_| internal())?;
        tx.execute("INSERT INTO sessions VALUES(?1,?2,?3)", params![hash(&token), name, now()+SESSION_SECONDS]).map_err(|_| internal())?;
        tx.commit().map_err(|_| internal())?;
    }
    Ok(([(header::SET_COOKIE, auth.cookie(&token, SESSION_SECONDS)), (header::CACHE_CONTROL, HeaderValue::from_static("no-store"))], Json(Auth::identity(&name, &key))).into_response())
}
pub async fn logout(State(auth): State<Auth>, headers: HeaderMap) -> Result<Response, ApiError> {
    if !auth.enabled { return Err(error(StatusCode::NOT_FOUND, "Cuentas deshabilitadas.")); }
    if !auth.allowed_origin(&headers) { return Err(error(StatusCode::FORBIDDEN, "Origen no autorizado.")); }
    if let Some(token) = auth.cookie_value(&headers) {
        auth.db.lock().map_err(|_| internal())?.execute("DELETE FROM sessions WHERE token_hash=?1", [hash(token)]).map_err(|_| internal())?;
    }
    Ok(([(header::SET_COOKIE, auth.cookie("", 0)), (header::CACHE_CONTROL, HeaderValue::from_static("no-store"))], StatusCode::NO_CONTENT).into_response())
}

pub async fn gate(State(auth): State<Auth>, mut request: Request, next: Next) -> Response {
    let path = request.uri().path().trim_start_matches("/api").to_string();
    if !auth.enabled || matches!(path.as_str(), "/health" | "/auth/me" | "/auth/login" | "/auth/logout") {
        return next.run(request).await;
    }
    let result = (|| -> Result<(), ApiError> {
        if !matches!(*request.method(), Method::GET | Method::HEAD) && !auth.allowed_origin(request.headers()) {
            return Err(error(StatusCode::FORBIDDEN, "Origen no autorizado."));
        }
        let (_, key) = auth.session(request.headers())?.ok_or_else(|| error(StatusCode::UNAUTHORIZED, "Inicia sesión para abrir tu biblioteca."))?;
        // Nunca autorizar con la clave elegida por el cliente cuando hay cuentas.
        request.headers_mut().insert("x-antares-account", HeaderValue::from_str(&key).map_err(|_| internal())?);
        Ok(())
    })();
    match result {
        Ok(()) => {
            let mut response = next.run(request).await;
            response.headers_mut().insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
            response
        }
        Err(err) => err.into_response(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{body::Body, routing::{get, post}, Router};
    use tower::ServiceExt;
    fn fixture() -> (tempfile::TempDir, Auth, Router) {
        let dir = tempfile::tempdir().unwrap();
        let auth = Auth::open(&dir.path().join("accounts.sqlite"), true, "https://music.example".into(), true).unwrap();
        for name in ["hanyer", "otro"] {
            auth.db.lock().unwrap().execute("INSERT INTO accounts VALUES(?1,?2,?3,?4)", params![name, password_hash("una frase larga de prueba").unwrap(), random_key(), now()]).unwrap();
        }
        let auth_routes = Router::new().route("/auth/me", get(me)).route("/auth/login", post(login)).route("/auth/logout", post(logout)).with_state(auth.clone());
        let app = Router::new().merge(auth_routes).route("/private", post(|headers: HeaderMap| async move { headers.get("x-antares-account").unwrap().to_str().unwrap().to_string() }))
            .layer(axum::middleware::from_fn_with_state(auth.clone(), gate));
        (dir, auth, app)
    }
    async fn sign_in(app: &Router, name: &str) -> Response {
        app.clone().oneshot(axum::http::Request::builder().method("POST").uri("/auth/login").header("Origin", "https://music.example").header("Content-Type", "application/json")
            .body(Body::from(json!({"username":name,"password":"una frase larga de prueba"}).to_string())).unwrap()).await.unwrap()
    }
    #[tokio::test]
    async fn login_is_closed_and_cookie_not_library_key() {
        let (_dir, auth, app) = fixture();
        assert_eq!(sign_in(&app, "nadie").await.status(), StatusCode::UNAUTHORIZED);
        let response = sign_in(&app, "hanyer").await;
        assert_eq!(response.status(), StatusCode::OK);
        let cookie = response.headers()[header::SET_COOKIE].to_str().unwrap();
        assert!(cookie.contains("HttpOnly") && cookie.contains("Secure") && cookie.contains("SameSite=Lax"));
        let key: String = auth.db.lock().unwrap().query_row("SELECT library_key FROM accounts WHERE username='hanyer'", [], |row| row.get(0)).unwrap();
        assert!(!cookie.contains(&key));
        let bytes = axum::body::to_bytes(response.into_body(), 4096).await.unwrap();
        assert!(!String::from_utf8_lossy(&bytes).contains(&key));
    }
    #[tokio::test]
    async fn sessions_isolate_accounts_override_headers_and_revoke_on_logout() {
        let (_dir, _auth, app) = fixture();
        let a = sign_in(&app, "hanyer").await;
        let cookie = a.headers()[header::SET_COOKIE].to_str().unwrap().split(';').next().unwrap().to_string();
        let b = sign_in(&app, "otro").await;
        let other = b.headers()[header::SET_COOKIE].to_str().unwrap().split(';').next().unwrap().to_string();
        let private = |cookie: String, origin: &'static str| axum::http::Request::builder().method("POST").uri("/private").header("Cookie", cookie).header("Origin", origin).header("x-antares-account", "f".repeat(64)).body(Body::empty()).unwrap();
        let a = app.clone().oneshot(private(cookie.clone(), "https://music.example")).await.unwrap();
        let a = axum::body::to_bytes(a.into_body(),4096).await.unwrap();
        let b = app.clone().oneshot(private(other,"https://music.example")).await.unwrap();
        let b = axum::body::to_bytes(b.into_body(),4096).await.unwrap();
        assert_ne!(a,b); assert_ne!(a, "f".repeat(64).as_bytes());
        assert_eq!(app.clone().oneshot(private(cookie.clone(),"https://evil.example")).await.unwrap().status(),StatusCode::FORBIDDEN);
        let response = app.clone().oneshot(axum::http::Request::builder().method("POST").uri("/auth/logout").header("Cookie",&cookie).header("Origin","https://music.example").body(Body::empty()).unwrap()).await.unwrap();
        assert_eq!(response.status(),StatusCode::NO_CONTENT);
        assert_eq!(app.oneshot(private(cookie,"https://music.example")).await.unwrap().status(),StatusCode::UNAUTHORIZED);
    }
    #[tokio::test]
    async fn login_rejects_cross_site_and_rate_limits() {
        let (_dir, _auth, app) = fixture();
        let cross = app.clone().oneshot(axum::http::Request::builder().method("POST").uri("/auth/login").header("Origin","https://evil.example").header("Content-Type","application/json").body(Body::from(r#"{"username":"hanyer","password":"x"}"#)).unwrap()).await.unwrap();
        assert_eq!(cross.status(),StatusCode::FORBIDDEN);
        for _ in 0..10 { assert_eq!(sign_in(&app,"nadie").await.status(),StatusCode::UNAUTHORIZED); }
        assert_eq!(sign_in(&app,"hanyer").await.status(),StatusCode::TOO_MANY_REQUESTS);
    }
    #[tokio::test]
    async fn same_user_shares_library_after_restart_and_sessions_expire() {
        let (dir, auth, app) = fixture();
        let first = sign_in(&app,"hanyer").await;
        let cookie = first.headers()[header::SET_COOKIE].to_str().unwrap().split(';').next().unwrap().to_string();
        let mut headers = HeaderMap::new(); headers.insert(header::COOKIE,HeaderValue::from_str(&cookie).unwrap());
        let first_identity = auth.session(&headers).unwrap().unwrap();
        let second = sign_in(&app,"hanyer").await;
        let mut second_headers = HeaderMap::new();
        second_headers.insert(header::COOKIE,HeaderValue::from_str(second.headers()[header::SET_COOKIE].to_str().unwrap().split(';').next().unwrap()).unwrap());
        assert_eq!(first_identity,auth.session(&second_headers).unwrap().unwrap());
        let reopened = Auth::open(&dir.path().join("accounts.sqlite"),true,"https://music.example".into(),true).unwrap();
        assert_eq!(reopened.session(&headers).unwrap().unwrap(),first_identity);
        reopened.db.lock().unwrap().execute("UPDATE sessions SET expires_at=0",[]).unwrap();
        assert!(reopened.session(&headers).unwrap().is_none());
    }
}
