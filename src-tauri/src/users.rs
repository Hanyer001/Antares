//! Usuarios y separación de sus datos. users.json guarda el usuario activo.
//! El principal usa el directorio raíz; los demás, users/<id>/.
//! Cambiar de usuario reinicia la app. La caché de Mix y yt-dlp son compartidos.

use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::store::{now_secs, read_json, write_json_atomic};

const USERS_FILE: &str = "users.json";
const USERS_DIR: &str = "users";

/// El usuario de siempre: sus datos viven en la raiz.
pub const MAIN_ID: &str = "main";
const MAIN_NAME: &str = "Principal";

const MAX_NAME_CHARS: usize = 40;
const MAX_USERS: usize = 12;

#[derive(Clone, Serialize, Deserialize)]
pub struct User {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub created_at: u64,
}

#[derive(Clone, Serialize, Deserialize)]
pub struct Users {
    pub current: String,
    pub users: Vec<User>,
}

impl Default for Users {
    fn default() -> Self {
        Self {
            current: MAIN_ID.to_string(),
            users: vec![User { id: MAIN_ID.to_string(), name: MAIN_NAME.to_string(), created_at: 0 }],
        }
    }
}

impl Users {
    /// Lee `users.json` y lo deja coherente: siempre esta el principal, sin ids
    /// raros, y el actual existe.
    pub fn load(base: &Path) -> Self {
        let mut users: Users = read_json(&base.join(USERS_FILE)).unwrap_or_default();

        users.users.retain(|u| valid_id(&u.id));
        if !users.users.iter().any(|u| u.id == MAIN_ID) {
            users.users.insert(0, Users::default().users.remove(0));
        }
        if !users.users.iter().any(|u| u.id == users.current) {
            users.current = MAIN_ID.to_string();
        }
        users
    }

    pub fn save(&self, base: &Path) -> Result<(), String> {
        write_json_atomic(&base.join(USERS_FILE), self).map_err(|e| format!("No se pudo guardar: {e}"))
    }

    /// La carpeta de datos del usuario actual.
    pub fn data_dir(&self, base: &Path) -> PathBuf {
        user_dir(base, &self.current)
    }

    pub fn create(&mut self, name: &str) -> Result<String, String> {
        if self.users.len() >= MAX_USERS {
            return Err(format!("Como mucho {MAX_USERS} usuarios."));
        }
        let name = clean_name(name)?;
        if self.users.iter().any(|u| u.name.eq_ignore_ascii_case(&name)) {
            return Err(format!("Ya hay un usuario «{name}»."));
        }

        let now = now_secs();
        // Un id que no dependa del nombre: renombrar no mueve carpetas.
        let mut id = format!("u{now}");
        let mut n = 2;
        while self.users.iter().any(|u| u.id == id) {
            id = format!("u{now}_{n}");
            n += 1;
        }

        self.users.push(User { id: id.clone(), name, created_at: now });
        Ok(id)
    }

    pub fn rename(&mut self, id: &str, name: &str) -> Result<(), String> {
        let name = clean_name(name)?;
        let user = self
            .users
            .iter_mut()
            .find(|u| u.id == id)
            .ok_or_else(|| "Ese usuario no existe.".to_string())?;
        user.name = name;
        Ok(())
    }

    /// Quita un usuario de la lista. Sus datos los borra `delete_data`.
    pub fn remove(&mut self, id: &str) -> Result<(), String> {
        if id == MAIN_ID {
            return Err("El usuario principal no se puede borrar.".to_string());
        }
        if id == self.current {
            return Err("No se puede borrar el usuario que está usando la app.".to_string());
        }
        let before = self.users.len();
        self.users.retain(|u| u.id != id);
        if self.users.len() == before {
            return Err("Ese usuario no existe.".to_string());
        }
        Ok(())
    }

    pub fn switch(&mut self, id: &str) -> Result<(), String> {
        if !self.users.iter().any(|u| u.id == id) {
            return Err("Ese usuario no existe.".to_string());
        }
        self.current = id.to_string();
        Ok(())
    }
}

/// Solo letras, cifras y `_`: el id acaba en una ruta, y nada de `..` ni
/// separadores puede colarse ahi.
fn valid_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 40 && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '_')
}

fn clean_name(name: &str) -> Result<String, String> {
    let name = name.split_whitespace().collect::<Vec<_>>().join(" ");
    if name.is_empty() {
        return Err("Ponle un nombre.".to_string());
    }
    Ok(name.chars().take(MAX_NAME_CHARS).collect())
}

pub fn user_dir(base: &Path, id: &str) -> PathBuf {
    if id == MAIN_ID || !valid_id(id) {
        base.to_path_buf()
    } else {
        base.join(USERS_DIR).join(id)
    }
}

/// Borra la carpeta de un usuario (nunca la raiz: la del principal).
pub fn delete_data(base: &Path, id: &str) -> Result<(), String> {
    if id == MAIN_ID || !valid_id(id) {
        return Err("Ese usuario no se puede borrar.".to_string());
    }
    let dir = user_dir(base, id);
    if dir.exists() {
        fs::remove_dir_all(&dir).map_err(|e| format!("No se pudieron borrar sus datos: {e}"))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(nombre: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("antares-users-{nombre}-{}", now_secs()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn sin_fichero_solo_esta_el_principal_en_la_raiz() {
        let base = temp_dir("vacio");
        let users = Users::load(&base);
        assert_eq!(users.current, MAIN_ID);
        assert_eq!(users.users.len(), 1);
        assert_eq!(users.data_dir(&base), base);
    }

    #[test]
    fn crear_cambiar_y_guardar() {
        let base = temp_dir("crear");
        let mut users = Users::load(&base);
        let id = users.create("  Ana   María ").unwrap();
        assert_eq!(users.users[1].name, "Ana María");
        assert!(users.create("ana maría").is_err(), "nombre repetido");
        assert!(users.create("   ").is_err());

        users.switch(&id).unwrap();
        users.save(&base).unwrap();

        let again = Users::load(&base);
        assert_eq!(again.current, id);
        assert_eq!(again.data_dir(&base), base.join("users").join(&id));
    }

    #[test]
    fn no_se_borra_el_principal_ni_el_actual() {
        let base = temp_dir("borrar");
        let mut users = Users::load(&base);
        let id = users.create("Luis").unwrap();

        assert!(users.remove(MAIN_ID).is_err());
        users.switch(&id).unwrap();
        assert!(users.remove(&id).is_err());
        users.switch(MAIN_ID).unwrap();
        users.remove(&id).unwrap();
        assert_eq!(users.users.len(), 1);
    }

    #[test]
    fn borrar_datos_solo_toca_su_carpeta() {
        let base = temp_dir("datos");
        fs::write(base.join("stats.json"), "{}").unwrap();
        let dir = user_dir(&base, "u1");
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("stats.json"), "{}").unwrap();

        delete_data(&base, "u1").unwrap();
        assert!(!dir.exists());
        assert!(base.join("stats.json").exists(), "lo del principal sigue");

        assert!(delete_data(&base, MAIN_ID).is_err());
        assert!(delete_data(&base, "..").is_err());
        assert_eq!(user_dir(&base, "../fuera"), base, "un id raro no sale de la raiz");
    }

    #[test]
    fn un_fichero_incoherente_se_arregla() {
        let base = temp_dir("roto");
        fs::write(
            base.join(USERS_FILE),
            r#"{"current":"nadie","users":[{"id":"../x","name":"Malo"},{"id":"u2","name":"Bien"}]}"#,
        )
        .unwrap();

        let users = Users::load(&base);
        assert_eq!(users.current, MAIN_ID);
        let ids: Vec<&str> = users.users.iter().map(|u| u.id.as_str()).collect();
        assert_eq!(ids, [MAIN_ID, "u2"]);
    }
}
