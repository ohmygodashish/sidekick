//! Sidekick Storage Subsystem (SEC-001, SEC-002, SEC-003, REQ-017)
//!
//! Provides:
//! - Plain JSON app config (`config`) at `~/.config/sidekick/config.json` holding API keys and
//!   app settings (SEC-001). Keys are stored as plain text; protection is file permissions only
//!   (directory 0700, file 0600).
//! - Ephemeral SQLite session database (`db`) for in-memory / local session turns and solutions,
//!   with instant atomic data burn capability (SEC-003, REQ-017).

pub mod config;
pub mod db;
