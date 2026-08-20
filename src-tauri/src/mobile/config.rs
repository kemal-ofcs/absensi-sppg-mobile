use std::path::PathBuf;

use reqwest::Client;
use tauri::{AppHandle, Manager};
use url::Url;

use super::{
    models::{CommandError, MobileSession},
    secrets, storage,
    turso::{normalize_turso_url, TursoClient, TursoConfig},
};

const BUILD_OFFLINE_MAX_AGE_HOURS: Option<&str> = option_env!("SPPG_OFFLINE_AUTH_MAX_AGE_HOURS");
const BUILD_TURSO_DATABASE_URL: Option<&str> = option_env!("TURSO_DATABASE_URL");
const BUILD_TURSO_AUTH_TOKEN: Option<&str> = option_env!("TURSO_AUTH_TOKEN");
const MOBILE_HTTP_TIMEOUT_SECONDS: u64 = 60;
const DEFAULT_FALLBACK_URL: &str = "https://absensi-sppg-seven.vercel.app";

pub struct MobileState {
    pub server_origin: std::sync::RwLock<String>,
    pub offline_max_age_hours: u64,
    pub data_dir: PathBuf,
    pub http: Client,
    pub turso_config: std::sync::RwLock<Option<TursoConfig>>,
    pub session: std::sync::Mutex<Option<MobileSession>>,
    pub vault_lock: std::sync::Mutex<()>,
}

fn parse_offline_hours_value(configured: Option<&str>, debug_build: bool) -> Result<u64, String> {
    let raw = configured.unwrap_or(if debug_build { "720" } else { "" });
    let hours = raw
        .parse::<u64>()
        .map_err(|_| "SPPG_OFFLINE_AUTH_MAX_AGE_HOURS harus berupa angka.")?;
    if !(1..=720).contains(&hours) {
        return Err("Masa login offline harus berada pada rentang 1-720 jam.".into());
    }
    Ok(hours)
}

fn parse_offline_hours() -> Result<u64, String> {
    parse_offline_hours_value(BUILD_OFFLINE_MAX_AGE_HOURS, cfg!(debug_assertions))
}

impl MobileState {
    pub fn initialize(app: &AppHandle) -> Result<Self, String> {
        let offline_max_age_hours = parse_offline_hours()?;
        let data_dir = app
            .path()
            .app_local_data_dir()
            .map_err(|_| "Folder data lokal aplikasi tidak tersedia.")?;
        std::fs::create_dir_all(&data_dir)
            .map_err(|_| "Folder data lokal aplikasi tidak dapat dibuat.")?;
        storage::initialize(&data_dir)?;

        let mut root_store = rustls::RootCertStore::empty();
        root_store.extend(webpki_roots::TLS_SERVER_ROOTS.iter().cloned());
        let tls_config = rustls::ClientConfig::builder_with_provider(std::sync::Arc::new(
            rustls::crypto::ring::default_provider(),
        ))
        .with_safe_default_protocol_versions()
        .map_err(|_| "Versi protokol TLS tidak valid.")?
        .with_root_certificates(root_store)
        .with_no_client_auth();

        let http = Client::builder()
            .use_preconfigured_tls(tls_config)
            .connect_timeout(std::time::Duration::from_secs(15))
            .timeout(std::time::Duration::from_secs(MOBILE_HTTP_TIMEOUT_SECONDS))
            .user_agent("Absensi-SPPG-Mobile/0.1")
            .build()
            .map_err(|_| "HTTP client Mobile tidak dapat dibuat.")?;

        let temp_state = Self {
            server_origin: std::sync::RwLock::new(DEFAULT_FALLBACK_URL.into()),
            offline_max_age_hours,
            data_dir: data_dir.clone(),
            http: http.clone(),
            turso_config: std::sync::RwLock::new(None),
            session: std::sync::Mutex::new(None),
            vault_lock: std::sync::Mutex::new(()),
        };

        // 1. Cek vault terenkripsi
        let vault_config = secrets::load_turso_config(&temp_state).ok().flatten();

        // 2. Cek database setting lokal
        let db_turso_url = storage::get_system_setting(&data_dir, "turso_database_url").ok().flatten();
        let db_turso_token = storage::get_system_setting(&data_dir, "turso_auth_token").ok().flatten();

        let resolved_config = vault_config.or_else(|| {
            if let (Some(u), Some(t)) = (db_turso_url, db_turso_token) {
                if !u.trim().is_empty() {
                    return Some(TursoConfig {
                        database_url: u.trim().to_owned(),
                        auth_token: t.trim().to_owned(),
                    });
                }
            }
            if let (Some(u), Some(t)) = (BUILD_TURSO_DATABASE_URL, BUILD_TURSO_AUTH_TOKEN) {
                if !u.trim().is_empty() {
                    return Some(TursoConfig {
                        database_url: u.trim().to_owned(),
                        auth_token: t.trim().to_owned(),
                    });
                }
            }
            None
        });

        let server_origin = if let Some(ref cfg) = resolved_config {
            normalize_turso_url(&cfg.database_url)
                .map(|u| u.origin().ascii_serialization())
                .unwrap_or_else(|_| DEFAULT_FALLBACK_URL.into())
        } else {
            let saved_url = storage::get_system_setting(&data_dir, "server_api_base_url").ok().flatten();
            saved_url.unwrap_or_else(|| DEFAULT_FALLBACK_URL.into())
        };

        Ok(Self {
            server_origin: std::sync::RwLock::new(server_origin),
            offline_max_age_hours,
            data_dir,
            http,
            turso_config: std::sync::RwLock::new(resolved_config),
            session: std::sync::Mutex::new(None),
            vault_lock: std::sync::Mutex::new(()),
        })
    }

    pub fn server_origin(&self) -> String {
        self.server_origin.read().unwrap().clone()
    }

    pub fn api_base_url(&self) -> Url {
        Url::parse(&self.server_origin())
            .unwrap_or_else(|_| Url::parse(DEFAULT_FALLBACK_URL).unwrap())
    }

    pub fn get_turso_client(&self) -> Result<TursoClient, CommandError> {
        let config_guard = self.turso_config.read().unwrap();
        if let Some(config) = config_guard.as_ref() {
            TursoClient::from_config(config, self.http.clone())
        } else {
            Err(CommandError::new(
                "TURSO_NOT_CONFIGURED",
                "Database Cloud Turso belum dikonfigurasi. Silakan tambahkan URL dan Auth Token di Pengaturan.",
            ))
        }
    }

    pub fn turso_config(&self) -> Option<TursoConfig> {
        self.turso_config.read().unwrap().clone()
    }

    pub fn set_turso_config(
        &self,
        raw_url: &str,
        auth_token: &str,
    ) -> Result<String, CommandError> {
        let normalized = normalize_turso_url(raw_url)?;
        let origin = normalized.origin().ascii_serialization();

        let resolved_token = if auth_token.trim().is_empty() {
            self.turso_config()
                .map(|c| c.auth_token)
                .unwrap_or_default()
        } else {
            auth_token.trim().to_owned()
        };

        let config = TursoConfig {
            database_url: raw_url.trim().to_owned(),
            auth_token: resolved_token,
        };

        // Simpan ke vault terenkripsi
        secrets::save_turso_config(self, &config)?;

        // Simpan juga ke setting lokal sebagai fallback
        storage::set_system_setting(&self.data_dir, "turso_database_url", &config.database_url)?;
        storage::set_system_setting(&self.data_dir, "turso_auth_token", &config.auth_token)?;

        *self.turso_config.write().unwrap() = Some(config);
        *self.server_origin.write().unwrap() = origin.clone();

        Ok(origin)
    }

    pub fn set_server_url(&self, raw_url: &str) -> Result<String, CommandError> {
        self.set_turso_config(raw_url, "")
    }
}

#[cfg(test)]
mod tests {
    use super::{normalize_turso_url, parse_offline_hours_value};

    #[test]
    fn turso_endpoint_normalization() {
        assert!(normalize_turso_url("libsql://customer.turso.io").is_ok());
        assert!(normalize_turso_url("https://customer.turso.io").is_ok());
        assert!(normalize_turso_url("http://localhost:8080").is_ok());
        assert!(normalize_turso_url("").is_err());
    }

    #[test]
    fn offline_window_is_bounded_and_required_in_release() {
        assert_eq!(parse_offline_hours_value(Some("720"), false), Ok(720));
        assert!(parse_offline_hours_value(None, false).is_err());
        assert!(parse_offline_hours_value(Some("0"), false).is_err());
        assert!(parse_offline_hours_value(Some("721"), false).is_err());
    }
}

