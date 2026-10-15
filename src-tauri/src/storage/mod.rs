//! Sidekick Storage Subsystem (SEC-001, SEC-002, SEC-003, REQ-017)
//!
//! Provides:
//! - macOS Keychain credential vault (`keychain`) for zero-plain-text API key storage (SEC-001)
//! - Ephemeral SQLite session database (`db`) for in-memory / local session turns and solutions,
//!   with instant atomic data burn capability (SEC-003, REQ-017).

pub mod db;
pub mod keychain;
