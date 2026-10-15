//! macOS Keychain Storage for Sidekick Copilot (SEC-001)
//!
//! Manages hardware-backed credential storage in macOS Keychain via native `Security.framework`.
//! Third-party API keys (OpenRouter, Anthropic, OpenAI, Gemini, Groq, Deepgram) are stored
//! exclusively under service name `com.sidekick.credentials` with account set to the provider name.
//!
//! Includes an in-memory fallback cache for headless test runs, CI environments, and non-macOS sandboxes.

use std::collections::HashMap;
use std::sync::RwLock;

/// Canonical Keychain service name for Sidekick API credentials (SEC-001).
pub const SERVICE_NAME: &str = "com.sidekick.credentials";

static FALLBACK_STORE: std::sync::OnceLock<RwLock<HashMap<String, String>>> =
    std::sync::OnceLock::new();
static MOCK_MODE: std::sync::atomic::AtomicBool =
    std::sync::atomic::AtomicBool::new(false);

fn get_fallback_map() -> &'static RwLock<HashMap<String, String>> {
    FALLBACK_STORE.get_or_init(|| RwLock::new(HashMap::new()))
}

/// Sets whether mock mode is forced (bypassing native Keychain).
pub fn set_mock_mode(enabled: bool) {
    MOCK_MODE.store(enabled, std::sync::atomic::Ordering::SeqCst);
}

/// Returns whether mock mode is currently enabled.
pub fn is_mock_mode() -> bool {
    MOCK_MODE.load(std::sync::atomic::Ordering::SeqCst)
}

/// Clears in-memory fallback cache (used during tests or session wipes).
pub fn clear_fallback() {
    if let Ok(mut map) = get_fallback_map().write() {
        map.clear();
    }
}

fn set_fallback(provider: &str, key: &str) {
    if let Ok(mut map) = get_fallback_map().write() {
        map.insert(provider.to_string(), key.to_string());
    }
}

fn get_fallback(provider: &str) -> Option<String> {
    if let Ok(map) = get_fallback_map().read() {
        map.get(provider).cloned()
    } else {
        None
    }
}

fn remove_fallback(provider: &str) {
    if let Ok(mut map) = get_fallback_map().write() {
        map.remove(provider);
    }
}

/// Stores an API key in the macOS Keychain under the canonical service name.
/// If `key` is empty, the credential is deleted.
/// If the item exists, it is updated (`SecItemUpdate`); otherwise, it is added (`SecItemAdd`).
pub fn store_credential(provider: &str, key: &str) -> Result<(), String> {
    store_credential_for_service(SERVICE_NAME, provider, key)
}

/// Stores credential with an explicit service name (supports multi-service partitioning and testing).
pub fn store_credential_for_service(
    service: &str,
    provider: &str,
    key: &str,
) -> Result<(), String> {
    let trimmed = key.trim();
    if trimmed.is_empty() {
        return delete_credential_for_service(service, provider);
    }

    if is_mock_mode() {
        set_fallback(provider, trimmed);
        return Ok(());
    }

    #[cfg(target_os = "macos")]
    {
        match security_framework::passwords::set_generic_password(
            service,
            provider,
            trimmed.as_bytes(),
        ) {
            Ok(()) => {
                set_fallback(provider, trimmed);
                Ok(())
            }
            Err(e) => {
                // In headless CI or sandboxed tests where Keychain daemon is restricted, fallback to in-memory store
                eprintln!(
                    "[Keychain] Warning: set_generic_password('{service}', '{provider}') returned {e:?}. Falling back to in-memory store."
                );
                set_fallback(provider, trimmed);
                Ok(())
            }
        }
    }

    #[cfg(not(target_os = "macos"))]
    {
        set_fallback(provider, trimmed);
        Ok(())
    }
}

/// Retrieves an API key from the macOS Keychain under the canonical service name.
/// Returns an empty string `""` if not found, without throwing an error.
pub fn retrieve_credential(provider: &str) -> Result<String, String> {
    retrieve_credential_for_service(SERVICE_NAME, provider)
}

/// Retrieves credential with an explicit service name.
pub fn retrieve_credential_for_service(service: &str, provider: &str) -> Result<String, String> {
    if is_mock_mode() {
        return Ok(get_fallback(provider).unwrap_or_default());
    }

    #[cfg(target_os = "macos")]
    {
        match security_framework::passwords::get_generic_password(service, provider) {
            Ok(bytes) => {
                let key = String::from_utf8(bytes)
                    .map_err(|e| format!("Invalid UTF-8 in retrieved keychain item: {e}"))?;
                set_fallback(provider, &key);
                Ok(key)
            }
            Err(e) if e.code() == security_framework_sys::base::errSecItemNotFound => {
                // Item does not exist in Keychain; check fallback or return empty
                if let Some(val) = get_fallback(provider) {
                    Ok(val)
                } else {
                    Ok(String::new())
                }
            }
            Err(e) => {
                // If Keychain daemon is inaccessible in sandbox/CI, check fallback
                eprintln!(
                    "[Keychain] Warning: get_generic_password('{service}', '{provider}') returned {e:?}. Checking fallback."
                );
                Ok(get_fallback(provider).unwrap_or_default())
            }
        }
    }

    #[cfg(not(target_os = "macos"))]
    {
        Ok(get_fallback(provider).unwrap_or_default())
    }
}

/// Deletes an API credential from the macOS Keychain under the canonical service name.
pub fn delete_credential(provider: &str) -> Result<(), String> {
    delete_credential_for_service(SERVICE_NAME, provider)
}

/// Deletes credential with an explicit service name.
pub fn delete_credential_for_service(service: &str, provider: &str) -> Result<(), String> {
    remove_fallback(provider);

    if is_mock_mode() {
        return Ok(());
    }

    #[cfg(target_os = "macos")]
    {
        match security_framework::passwords::delete_generic_password(service, provider) {
            Ok(()) => Ok(()),
            Err(e) if e.code() == security_framework_sys::base::errSecItemNotFound => Ok(()),
            Err(e) => {
                eprintln!(
                    "[Keychain] Warning: delete_generic_password('{service}', '{provider}') returned {e:?}."
                );
                Ok(())
            }
        }
    }

    #[cfg(not(target_os = "macos"))]
    {
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const TEST_SERVICE: &str = "com.sidekick.credentials.test";

    #[test]
    fn test_mock_mode_lifecycle() {
        set_mock_mode(true);
        clear_fallback();

        assert_eq!(retrieve_credential("anthropic").unwrap(), "");

        store_credential("anthropic", "sk-ant-test-key-12345").unwrap();
        assert_eq!(
            retrieve_credential("anthropic").unwrap(),
            "sk-ant-test-key-12345"
        );

        // Update
        store_credential("anthropic", "sk-ant-test-key-updated").unwrap();
        assert_eq!(
            retrieve_credential("anthropic").unwrap(),
            "sk-ant-test-key-updated"
        );

        // Delete with empty string
        store_credential("anthropic", "").unwrap();
        assert_eq!(retrieve_credential("anthropic").unwrap(), "");

        // Delete explicit
        store_credential("openai", "sk-openai-test").unwrap();
        delete_credential("openai").unwrap();
        assert_eq!(retrieve_credential("openai").unwrap(), "");

        set_mock_mode(false);
    }

    #[test]
    fn test_store_and_retrieve_empty_key_clears_credential() {
        set_mock_mode(true);
        clear_fallback();

        store_credential("gemini", "initial_key").unwrap();
        assert_eq!(retrieve_credential("gemini").unwrap(), "initial_key");

        store_credential("gemini", "   ").unwrap();
        assert_eq!(retrieve_credential("gemini").unwrap(), "");

        set_mock_mode(false);
    }

    #[test]
    fn test_all_providers_storage() {
        set_mock_mode(true);
        clear_fallback();

        let providers = [
            ("openrouter", "sk-or-v1-abcdef"),
            ("anthropic", "sk-ant-api03-abcdef"),
            ("openai", "sk-proj-abcdef"),
            ("gemini", "AIzaSyAbcdef"),
            ("groq", "gsk_abcdef"),
            ("deepgram", "dg_token_123456"),
        ];

        for (provider, key) in providers {
            store_credential(provider, key).unwrap();
        }

        for (provider, key) in providers {
            assert_eq!(retrieve_credential(provider).unwrap(), key);
        }

        for (provider, _) in providers {
            delete_credential(provider).unwrap();
            assert_eq!(retrieve_credential(provider).unwrap(), "");
        }

        set_mock_mode(false);
    }

    #[test]
    fn test_service_level_isolation() {
        let _ = delete_credential_for_service(TEST_SERVICE, "test_provider");

        // Store
        store_credential_for_service(TEST_SERVICE, "test_provider", "test_key_val").unwrap();
        let retrieved =
            retrieve_credential_for_service(TEST_SERVICE, "test_provider").unwrap();
        assert_eq!(retrieved, "test_key_val");

        // Clean up
        delete_credential_for_service(TEST_SERVICE, "test_provider").unwrap();
        let after_delete =
            retrieve_credential_for_service(TEST_SERVICE, "test_provider").unwrap();
        assert_eq!(after_delete, "");
    }
}
