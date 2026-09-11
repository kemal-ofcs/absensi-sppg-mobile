mod administration;
pub mod commands;
pub mod config;
pub mod models;
mod operational;
mod payroll_seed;
pub mod remote;
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
