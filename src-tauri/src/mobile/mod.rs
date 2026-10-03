mod administration;
pub mod commands;
pub mod config;
// Lisensi offline Ed25519: SALINAN `desktop/license.rs` oleh sync-rust-modules.ts.
pub mod license;
pub mod models;
mod operational;
mod payroll_seed;
mod scanner;
pub mod secrets;
pub mod sql_backend;
pub mod storage;
pub mod sync;
mod time_policy;
pub mod turso;

pub mod portability;
pub mod payroll;
// Administrasi payroll: SALINAN modul Desktop oleh scripts/sync-rust-modules.ts.
pub mod payroll_admin;
pub mod share;
pub use config::MobileState;
