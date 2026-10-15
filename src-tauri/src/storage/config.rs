//! Plain JSON app config at `$XDG_CONFIG_HOME/sidekick/config.json` (or `~/.config/sidekick/config.json`).
//!
//! Holds third-party API keys (`apiKeys`) and the frontend settings blob (`settings`).
//! Keys are stored in plain text. The only protection is file permissions:
//! the directory is 0700 and the file is 0600.

use serde_json::{Map, Value};
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard};
use std::time::{SystemTime, UNIX_EPOCH};

/// Serializes every read-modify-write so key and settings saves cannot lose each other's writes.
static CONFIG_LOCK: Mutex<()> = Mutex::new(());

fn lock_config() -> MutexGuard<'static, ()> {
    CONFIG_LOCK.lock().unwrap_or_else(|e| e.into_inner())
}

/// Resolves the config file path. Refuses to guess a location when `HOME` is unset.
pub fn config_path() -> Result<PathBuf, String> {
    let base = match std::env::var_os("XDG_CONFIG_HOME") {
        Some(xdg) if Path::new(&xdg).is_absolute() => PathBuf::from(xdg),
        _ => {
            let home = std::env::var_os("HOME")
                .filter(|h| !h.is_empty())
                .ok_or("HOME is not set; cannot locate the Sidekick config file")?;
            PathBuf::from(home).join(".config")
        }
    };
    Ok(base.join("sidekick").join("config.json"))
}

fn validate_provider(provider: &str) -> Result<(), String> {
    let valid = (1..=32).contains(&provider.len())
        && provider
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'_' || b == b'-');
    if valid {
        Ok(())
    } else {
        Err(format!("invalid provider name {provider:?}: use 1-32 chars of [a-z0-9_-]"))
    }
}

fn io_err(action: &str, path: &Path, e: std::io::Error) -> String {
    format!("failed to {action} {}: {e}", path.display())
}

#[cfg(unix)]
fn restrict_mode(path: &Path, mode: u32) -> Result<(), String> {
    use std::os::unix::fs::PermissionsExt;
    fs::set_permissions(path, fs::Permissions::from_mode(mode))
        .map_err(|e| io_err("chmod", path, e))
}

#[cfg(not(unix))]
fn restrict_mode(_path: &Path, _mode: u32) -> Result<(), String> {
    Ok(())
}

fn ensure_private_dir(dir: &Path) -> Result<(), String> {
    if let Some(parent) = dir.parent() {
        fs::create_dir_all(parent).map_err(|e| io_err("create", parent, e))?;
    }
    #[cfg(unix)]
    let builder = {
        use std::os::unix::fs::DirBuilderExt;
        let mut b = fs::DirBuilder::new();
        b.mode(0o700);
        b
    };
    #[cfg(not(unix))]
    let builder = fs::DirBuilder::new();

    match builder.create(dir) {
        Ok(()) => {}
        Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {}
        Err(e) => return Err(io_err("create", dir, e)),
    }
    // Re-apply: an existing directory may have been created with wider permissions.
    restrict_mode(dir, 0o700)
}

/// Reads the config. A missing file is `{}`. A file that is not a JSON object is moved aside
/// to `config.json.corrupt-<unix seconds>` so nothing the user wrote is lost.
fn read_config(path: &Path) -> Result<Map<String, Value>, String> {
    let bytes = match fs::read(path) {
        Ok(b) => b,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Map::new()),
        Err(e) => return Err(io_err("read", path, e)),
    };
    match serde_json::from_slice::<Value>(&bytes) {
        Ok(Value::Object(map)) => Ok(map),
        _ => {
            quarantine(path)?;
            Ok(Map::new())
        }
    }
}

fn quarantine(path: &Path) -> Result<(), String> {
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let mut dest = path.with_file_name(format!("config.json.corrupt-{secs}"));
    let mut n = 1;
    while dest.exists() {
        dest = path.with_file_name(format!("config.json.corrupt-{secs}-{n}"));
        n += 1;
    }
    fs::rename(path, &dest).map_err(|e| io_err("move corrupt config to", &dest, e))?;
    eprintln!(
        "[Sidekick config] {} is not a valid JSON object; moved it to {}",
        path.display(),
        dest.display()
    );
    Ok(())
}

/// Writes the config atomically: temp file (0600), fsync, then rename over the target.
fn write_config(path: &Path, config: &Map<String, Value>) -> Result<(), String> {
    let dir = path
        .parent()
        .ok_or_else(|| "config path has no parent directory".to_string())?;
    ensure_private_dir(dir)?;

    let mut text = serde_json::to_string_pretty(config)
        .map_err(|e| format!("failed to serialize config: {e}"))?;
    text.push('\n');

    let tmp = dir.join("config.json.tmp");
    {
        let mut opts = fs::OpenOptions::new();
        opts.write(true).create(true).truncate(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            opts.mode(0o600);
        }
        let mut file = opts.open(&tmp).map_err(|e| io_err("open", &tmp, e))?;
        file.write_all(text.as_bytes())
            .map_err(|e| io_err("write", &tmp, e))?;
        file.sync_all().map_err(|e| io_err("sync", &tmp, e))?;
    }
    // A stale temp file may already exist with wider permissions; the mode flag does not apply to it.
    restrict_mode(&tmp, 0o600)?;
    fs::rename(&tmp, path).map_err(|e| io_err("replace", path, e))
}

pub fn store_api_key(provider: &str, key: &str) -> Result<(), String> {
    store_api_key_at(&config_path()?, provider, key)
}

/// Stores an API key. An empty or whitespace-only key removes the entry.
pub fn store_api_key_at(path: &Path, provider: &str, key: &str) -> Result<(), String> {
    validate_provider(provider)?;
    let key = key.trim();
    let _guard = lock_config();
    let mut config = read_config(path)?;
    let keys = config
        .entry("apiKeys")
        .or_insert_with(|| Value::Object(Map::new()))
        .as_object_mut()
        .ok_or("config.json: \"apiKeys\" is not an object")?;
    if key.is_empty() {
        keys.remove(provider);
    } else {
        keys.insert(provider.to_string(), Value::String(key.to_string()));
    }
    write_config(path, &config)
}

pub fn retrieve_api_key(provider: &str) -> Result<String, String> {
    retrieve_api_key_at(&config_path()?, provider)
}

/// Returns the stored key, or `""` when absent.
pub fn retrieve_api_key_at(path: &Path, provider: &str) -> Result<String, String> {
    validate_provider(provider)?;
    let _guard = lock_config();
    let config = read_config(path)?;
    Ok(config
        .get("apiKeys")
        .and_then(|keys| keys.get(provider))
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string())
}

pub fn load_settings() -> Result<Option<String>, String> {
    load_settings_at(&config_path()?)
}

/// Returns the `settings` value serialized as JSON, or `None` when absent or null.
pub fn load_settings_at(path: &Path) -> Result<Option<String>, String> {
    let _guard = lock_config();
    let config = read_config(path)?;
    match config.get("settings") {
        None | Some(Value::Null) => Ok(None),
        Some(value) => serde_json::to_string(value)
            .map(Some)
            .map_err(|e| format!("failed to serialize settings: {e}")),
    }
}

pub fn save_settings(settings_json: &str) -> Result<(), String> {
    save_settings_at(&config_path()?, settings_json)
}

/// Stores the settings JSON. The literal `null` removes the `settings` key.
pub fn save_settings_at(path: &Path, settings_json: &str) -> Result<(), String> {
    let parsed: Value = serde_json::from_str(settings_json)
        .map_err(|e| format!("settings is not valid JSON: {e}"))?;
    let _guard = lock_config();
    let mut config = read_config(path)?;
    if parsed.is_null() {
        config.remove("settings");
    } else {
        config.insert("settings".to_string(), parsed);
    }
    write_config(path, &config)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    static NEXT_DIR: AtomicUsize = AtomicUsize::new(0);

    /// Unique temp root; the config lives at `<root>/sidekick/config.json`. Deleted on drop.
    struct TempRoot(PathBuf);

    impl TempRoot {
        fn new() -> Self {
            let n = NEXT_DIR.fetch_add(1, Ordering::SeqCst);
            let root = std::env::temp_dir()
                .join(format!("sidekick-config-test-{}-{}", std::process::id(), n));
            let _ = fs::remove_dir_all(&root);
            TempRoot(root)
        }

        fn config(&self) -> PathBuf {
            self.0.join("sidekick").join("config.json")
        }
    }

    impl Drop for TempRoot {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn read_json(path: &Path) -> Value {
        serde_json::from_str(&fs::read_to_string(path).unwrap()).unwrap()
    }

    #[test]
    fn store_then_retrieve_trims_key() {
        let td = TempRoot::new();
        let path = td.config();
        store_api_key_at(&path, "openrouter", "  sk-or-v1-abc \n").unwrap();
        assert_eq!(retrieve_api_key_at(&path, "openrouter").unwrap(), "sk-or-v1-abc");
    }

    #[test]
    fn empty_or_whitespace_key_removes_entry() {
        let td = TempRoot::new();
        let path = td.config();
        store_api_key_at(&path, "groq", "gsk_1").unwrap();
        store_api_key_at(&path, "groq", "   ").unwrap();
        assert_eq!(retrieve_api_key_at(&path, "groq").unwrap(), "");

        store_api_key_at(&path, "groq", "gsk_2").unwrap();
        store_api_key_at(&path, "groq", "").unwrap();
        assert_eq!(retrieve_api_key_at(&path, "groq").unwrap(), "");
    }

    #[test]
    fn missing_provider_and_missing_file_return_empty() {
        let td = TempRoot::new();
        let path = td.config();
        assert_eq!(retrieve_api_key_at(&path, "deepgram").unwrap(), "");
        store_api_key_at(&path, "groq", "gsk_1").unwrap();
        assert_eq!(retrieve_api_key_at(&path, "deepgram").unwrap(), "");
    }

    #[test]
    fn invalid_provider_names_are_rejected() {
        let td = TempRoot::new();
        let path = td.config();
        for bad in ["", "Groq", "a b", "../x", "a/b", "é", &"a".repeat(33)] {
            assert!(store_api_key_at(&path, bad, "k").is_err(), "accepted {bad:?}");
            assert!(retrieve_api_key_at(&path, bad).is_err(), "accepted {bad:?}");
        }
        assert!(!path.exists(), "rejected names must not touch the file");
        store_api_key_at(&path, &"a".repeat(32), "k").unwrap();
    }

    #[test]
    fn settings_round_trip() {
        let td = TempRoot::new();
        let path = td.config();
        assert_eq!(load_settings_at(&path).unwrap(), None);

        let original = r#"{"state":{"layout":"notch","opacity":0.8},"version":0}"#;
        save_settings_at(&path, original).unwrap();
        let loaded = load_settings_at(&path).unwrap().unwrap();
        assert_eq!(
            serde_json::from_str::<Value>(&loaded).unwrap(),
            serde_json::from_str::<Value>(original).unwrap()
        );
    }

    #[test]
    fn null_settings_removes_key() {
        let td = TempRoot::new();
        let path = td.config();
        save_settings_at(&path, r#"{"version":0}"#).unwrap();
        save_settings_at(&path, "null").unwrap();
        assert_eq!(load_settings_at(&path).unwrap(), None);
        assert!(read_json(&path).get("settings").is_none());
    }

    #[test]
    fn invalid_settings_json_is_rejected() {
        let td = TempRoot::new();
        let path = td.config();
        assert!(save_settings_at(&path, "{nope").is_err());
        assert_eq!(load_settings_at(&path).unwrap(), None);
    }

    #[test]
    fn keys_and_settings_do_not_clobber_each_other() {
        let td = TempRoot::new();
        let path = td.config();
        store_api_key_at(&path, "openrouter", "sk-or-1").unwrap();
        save_settings_at(&path, r#"{"version":0}"#).unwrap();
        store_api_key_at(&path, "groq", "gsk_1").unwrap();

        let json = read_json(&path);
        assert_eq!(json["apiKeys"]["openrouter"], "sk-or-1");
        assert_eq!(json["apiKeys"]["groq"], "gsk_1");
        assert_eq!(json["settings"]["version"], 0);
    }

    #[test]
    fn unknown_top_level_keys_survive_writes() {
        let td = TempRoot::new();
        let path = td.config();
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(&path, r#"{"future":{"x":[1,2]},"apiKeys":{}}"#).unwrap();

        store_api_key_at(&path, "groq", "gsk_1").unwrap();
        save_settings_at(&path, r#"{"version":0}"#).unwrap();

        let json = read_json(&path);
        assert_eq!(json["future"]["x"], serde_json::json!([1, 2]));
        assert_eq!(json["apiKeys"]["groq"], "gsk_1");
    }

    #[test]
    fn corrupt_file_is_moved_aside_and_write_succeeds() {
        let td = TempRoot::new();
        let path = td.config();
        let dir = path.parent().unwrap().to_path_buf();
        fs::create_dir_all(&dir).unwrap();
        fs::write(&path, "this is not json").unwrap();

        assert_eq!(retrieve_api_key_at(&path, "groq").unwrap(), "");
        store_api_key_at(&path, "groq", "gsk_1").unwrap();
        assert_eq!(retrieve_api_key_at(&path, "groq").unwrap(), "gsk_1");

        let quarantined: Vec<PathBuf> = fs::read_dir(&dir)
            .unwrap()
            .map(|e| e.unwrap().path())
            .filter(|p| {
                p.file_name()
                    .unwrap()
                    .to_string_lossy()
                    .starts_with("config.json.corrupt-")
            })
            .collect();
        assert_eq!(quarantined.len(), 1);
        assert_eq!(fs::read_to_string(&quarantined[0]).unwrap(), "this is not json");
    }

    #[cfg(unix)]
    #[test]
    fn write_enforces_private_permissions_on_existing_files() {
        use std::os::unix::fs::PermissionsExt;

        let td = TempRoot::new();
        let path = td.config();
        let dir = path.parent().unwrap().to_path_buf();
        fs::create_dir_all(&dir).unwrap();
        fs::set_permissions(&dir, fs::Permissions::from_mode(0o755)).unwrap();
        fs::write(&path, "{}").unwrap();
        fs::set_permissions(&path, fs::Permissions::from_mode(0o644)).unwrap();

        store_api_key_at(&path, "groq", "gsk_1").unwrap();

        let dir_mode = fs::metadata(&dir).unwrap().permissions().mode() & 0o777;
        let file_mode = fs::metadata(&path).unwrap().permissions().mode() & 0o777;
        assert_eq!(dir_mode, 0o700);
        assert_eq!(file_mode, 0o600);
    }
}
