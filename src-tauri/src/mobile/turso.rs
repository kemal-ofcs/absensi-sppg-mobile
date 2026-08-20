use std::collections::HashMap;

use argon2::PasswordVerifier;
use base64::prelude::*;
use pbkdf2::pbkdf2_hmac;
use reqwest::{header::HeaderMap, Client, StatusCode};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::Sha256;
use url::Url;
use zeroize::Zeroizing;

use super::models::{CommandError, OperatorUser};

pub fn normalize_turso_url(raw: &str) -> Result<Url, CommandError> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err(CommandError::new(
            "TURSO_URL_INVALID",
            "URL database Turso tidak boleh kosong.",
        ));
    }

    let https_url_str = if let Some(stripped) = trimmed.strip_prefix("libsql://") {
        format!("https://{stripped}")
    } else {
        trimmed.to_owned()
    };

    let mut parsed = Url::parse(&https_url_str).map_err(|_| {
        CommandError::new(
            "TURSO_URL_INVALID",
            "Format URL database Turso tidak valid (contoh: libsql://db-name.turso.io atau https://db-name.turso.io).",
        )
    })?;

    if !matches!(parsed.scheme(), "http" | "https") {
        return Err(CommandError::new(
            "TURSO_URL_INVALID",
            "URL database Turso harus menggunakan protokol libsql://, https://, atau http://.",
        ));
    }

    parsed.set_path("");
    parsed.set_query(None);
    parsed.set_fragment(None);
    Ok(parsed)
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct TursoConfig {
    pub database_url: String,
    pub auth_token: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct TursoConnectionStatus {
    pub connected: bool,
    pub url: String,
    pub latency_ms: Option<u64>,
    pub error_message: Option<String>,
}

#[derive(Clone, Debug)]
pub struct Statement {
    pub sql: String,
    pub args: Vec<Value>,
}

impl Statement {
    pub fn new(sql: impl Into<String>, args: Vec<Value>) -> Self {
        Self {
            sql: sql.into(),
            args,
        }
    }

    fn to_libsql_v2_stmt(&self) -> Value {
        let args_val: Vec<Value> = self
            .args
            .iter()
            .map(|arg| match arg {
                Value::Null => json!({ "type": "null" }),
                Value::Bool(b) => json!({ "type": "integer", "value": if *b { 1 } else { 0 } }),
                Value::Number(n) => {
                    if let Some(i) = n.as_i64() {
                        json!({ "type": "integer", "value": i.to_string() })
                    } else if let Some(f) = n.as_f64() {
                        json!({ "type": "float", "value": f })
                    } else {
                        json!({ "type": "null" })
                    }
                }
                Value::String(s) => json!({ "type": "text", "value": s }),
                _ => json!({ "type": "text", "value": arg.to_string() }),
            })
            .collect();

        json!({
            "sql": self.sql,
            "args": args_val
        })
    }
}

#[derive(Clone, Debug, Default)]
pub struct QueryResult {
    pub columns: Vec<String>,
    pub rows: Vec<Vec<Value>>,
    #[allow(dead_code)]
    pub rows_affected: u64,
    pub last_insert_rowid: Option<i64>,
}

impl QueryResult {
    pub fn to_objects(&self) -> Vec<HashMap<String, Value>> {
        self.rows
            .iter()
            .map(|row| {
                let mut map = HashMap::new();
                for (col_idx, col_name) in self.columns.iter().enumerate() {
                    let val = row.get(col_idx).cloned().unwrap_or(Value::Null);
                    map.insert(col_name.clone(), val);
                }
                map
            })
            .collect()
    }
}

pub struct TursoClient {
    base_url: Url,
    auth_token: Zeroizing<String>,
    http: Client,
}

impl TursoClient {
    pub fn new(base_url: Url, auth_token: String, http: Client) -> Self {
        Self {
            base_url,
            auth_token: Zeroizing::new(auth_token),
            http,
        }
    }

    pub fn from_config(config: &TursoConfig, http: Client) -> Result<Self, CommandError> {
        let base_url = normalize_turso_url(&config.database_url)?;
        Ok(Self::new(base_url, config.auth_token.clone(), http))
    }

    pub fn base_url(&self) -> &Url {
        &self.base_url
    }

    #[allow(dead_code)]
    pub fn auth_token(&self) -> &str {
        &self.auth_token
    }

    pub async fn execute_pipeline(
        &self,
        statements: Vec<Statement>,
    ) -> Result<Vec<QueryResult>, CommandError> {
        let mut endpoint = self.base_url.clone();
        endpoint.set_path("/v2/pipeline");

        let requests: Vec<Value> = statements
            .iter()
            .map(|stmt| {
                json!({
                    "type": "execute",
                    "stmt": stmt.to_libsql_v2_stmt()
                })
            })
            .chain(std::iter::once(json!({ "type": "close" })))
            .collect();

        let payload = json!({ "requests": requests });

        let mut headers = HeaderMap::new();
        if !self.auth_token.is_empty() {
            let auth_header_val = format!("Bearer {}", self.auth_token.as_str());
            headers.insert(
                reqwest::header::AUTHORIZATION,
                reqwest::header::HeaderValue::from_str(&auth_header_val)
                    .map_err(|_| CommandError::internal())?,
            );
        }

        let response = self
            .http
            .post(endpoint)
            .headers(headers)
            .json(&payload)
            .send()
            .await
            .map_err(|e| {
                CommandError::new(
                    "TURSO_NETWORK_ERROR",
                    format!("Gagal menghubungi database Turso: {e}"),
                )
            })?;

        let status = response.status();
        if !status.is_success() {
            let error_body = response.text().await.unwrap_or_default();
            if status == StatusCode::UNAUTHORIZED || status == StatusCode::FORBIDDEN {
                return Err(CommandError::new(
                    "TURSO_AUTH_FAILED",
                    "Auth Token database Turso tidak valid atau kedaluwarsa.",
                ));
            }
            return Err(CommandError::new(
                "TURSO_QUERY_FAILED",
                format!("Database Turso mengembalikan error ({status}): {error_body}"),
            ));
        }

        let text = response.text().await.map_err(|e| {
            CommandError::new(
                "TURSO_RESPONSE_INVALID",
                format!("Gagal membaca data respon Turso: {e}"),
            )
        })?;

        let body: Value = serde_json::from_str(&text).map_err(|e| {
            let snippet = if text.len() > 250 {
                format!("{}...", &text[..250])
            } else {
                text.clone()
            };
            CommandError::new(
                "TURSO_RESPONSE_INVALID",
                format!("Format JSON respon Turso tidak valid: {e}. Data mentah: {snippet}"),
            )
        })?;

        let results_arr = body
            .get("results")
            .and_then(Value::as_array)
            .ok_or_else(|| {
                CommandError::new("TURSO_RESPONSE_INVALID", "Format hasil pipeline kosong.")
            })?;

        let mut query_results = Vec::new();
        for (i, res) in results_arr.iter().enumerate() {
            if i >= statements.len() {
                break; // Abaikan close request
            }
            let res_type = res.get("type").and_then(Value::as_str).unwrap_or("");
            if res_type != "ok" {
                let err_msg = res
                    .get("error")
                    .and_then(|e| e.get("message"))
                    .and_then(Value::as_str)
                    .unwrap_or("Query SQL gagal dieksekusi di Turso.");
                return Err(CommandError::new("TURSO_SQL_ERROR", err_msg));
            }

            let exec_res = res
                .get("response")
                .and_then(|r| r.get("result"))
                .cloned()
                .unwrap_or(Value::Null);

            let columns: Vec<String> = exec_res
                .get("cols")
                .and_then(Value::as_array)
                .map(|cols| {
                    cols.iter()
                        .filter_map(|c| {
                            c.get("name")
                                .and_then(Value::as_str)
                                .map(|s| s.to_owned())
                        })
                        .collect()
                })
                .unwrap_or_default();

            let rows_arr = exec_res.get("rows").and_then(Value::as_array);
            let mut parsed_rows = Vec::new();

            if let Some(rows) = rows_arr {
                for row_val in rows {
                    if let Some(cells) = row_val.as_array() {
                        let parsed_cells: Vec<Value> = cells
                            .iter()
                            .map(|cell| {
                                let ctype = cell.get("type").and_then(Value::as_str).unwrap_or("");
                                match ctype {
                                    "null" => Value::Null,
                                    "integer" => {
                                        let v = cell.get("value");
                                        if let Some(s) = v.and_then(Value::as_str) {
                                            s.parse::<i64>()
                                                .map(|num| json!(num))
                                                .unwrap_or_else(|_| json!(s))
                                        } else if let Some(n) = v.and_then(Value::as_i64) {
                                            json!(n)
                                        } else {
                                            Value::Null
                                        }
                                    }
                                    "float" => cell.get("value").cloned().unwrap_or(Value::Null),
                                    "text" => cell.get("value").cloned().unwrap_or(Value::Null),
                                    "blob" => cell.get("base64").cloned().unwrap_or(Value::Null),
                                    _ => cell.clone(),
                                }
                            })
                            .collect();
                        parsed_rows.push(parsed_cells);
                    }
                }
            }

            let rows_affected = exec_res
                .get("affected_row_count")
                .and_then(Value::as_u64)
                .unwrap_or(0);
            let last_insert_rowid = exec_res
                .get("last_insert_rowid")
                .and_then(|v| {
                    if let Some(s) = v.as_str() {
                        s.parse::<i64>().ok()
                    } else {
                        v.as_i64()
                    }
                });

            query_results.push(QueryResult {
                columns,
                rows: parsed_rows,
                rows_affected,
                last_insert_rowid,
            });
        }

        Ok(query_results)
    }

    pub async fn query_one(
        &self,
        sql: impl Into<String>,
        args: Vec<Value>,
    ) -> Result<QueryResult, CommandError> {
        let stmt = Statement::new(sql, args);
        let mut results = self.execute_pipeline(vec![stmt]).await?;
        results
            .pop()
            .ok_or_else(|| CommandError::new("TURSO_QUERY_EMPTY", "Hasil query kosong."))
    }

    pub async fn ping(&self) -> Result<u64, CommandError> {
        let start = std::time::Instant::now();
        self.query_one("SELECT 1 AS ping_val;", vec![]).await?;
        let elapsed = start.elapsed().as_millis() as u64;
        let _ = self.ensure_schema().await;
        Ok(elapsed)
    }

    pub async fn ensure_schema(&self) -> Result<(), CommandError> {
        let schema_stmts = vec![
            Statement::new(
                r#"CREATE TABLE IF NOT EXISTS schema_migration (
                    version INTEGER PRIMARY KEY,
                    name TEXT NOT NULL,
                    applied_at TEXT NOT NULL
                );"#,
                vec![],
            ),
            Statement::new(
                r#"CREATE TABLE IF NOT EXISTS app_role (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    role_key TEXT UNIQUE NOT NULL,
                    nama_role TEXT UNIQUE NOT NULL,
                    deskripsi TEXT,
                    is_system INTEGER NOT NULL DEFAULT 0,
                    is_superadmin INTEGER NOT NULL DEFAULT 0,
                    status TEXT NOT NULL DEFAULT 'Aktif',
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    created_by TEXT
                );"#,
                vec![],
            ),
            Statement::new(
                r#"CREATE TABLE IF NOT EXISTS app_permission (
                    permission_key TEXT PRIMARY KEY,
                    nama TEXT NOT NULL,
                    grup TEXT NOT NULL,
                    deskripsi TEXT,
                    is_active INTEGER NOT NULL DEFAULT 1,
                    sort_order INTEGER NOT NULL DEFAULT 0
                );"#,
                vec![],
            ),
            Statement::new(
                r#"CREATE TABLE IF NOT EXISTS role_permission (
                    role_id INTEGER NOT NULL,
                    permission_key TEXT NOT NULL,
                    is_allowed INTEGER NOT NULL DEFAULT 0,
                    updated_at TEXT NOT NULL,
                    updated_by TEXT,
                    PRIMARY KEY (role_id, permission_key),
                    FOREIGN KEY (role_id) REFERENCES app_role(id) ON DELETE CASCADE,
                    FOREIGN KEY (permission_key) REFERENCES app_permission(permission_key) ON DELETE CASCADE
                );"#,
                vec![],
            ),
            Statement::new(
                r#"CREATE TABLE IF NOT EXISTS master_operator (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    kode_operator TEXT UNIQUE NOT NULL,
                    nama_operator TEXT NOT NULL,
                    username TEXT UNIQUE NOT NULL,
                    password_hash TEXT NOT NULL,
                    role TEXT NOT NULL DEFAULT 'Operator',
                    role_id INTEGER REFERENCES app_role(id),
                    status TEXT DEFAULT 'Aktif',
                    created_at TEXT,
                    updated_at TEXT
                );"#,
                vec![],
            ),
            Statement::new(
                r#"CREATE TABLE IF NOT EXISTS master_data (
                    id_unik TEXT PRIMARY KEY,
                    kode_karyawan TEXT UNIQUE,
                    nama TEXT NOT NULL,
                    divisi TEXT NOT NULL,
                    jabatan_status TEXT,
                    no_hp TEXT,
                    lp TEXT,
                    id_shift INTEGER NOT NULL,
                    status_aktif TEXT DEFAULT 'Aktif',
                    tanggal_daftar TEXT,
                    catatan TEXT,
                    token_absensi TEXT UNIQUE,
                    qr_code TEXT,
                    status_qr TEXT DEFAULT 'Belum',
                    jenis_personil TEXT,
                    tanggal_mulai_aktif TEXT,
                    tanggal_selesai_aktif TEXT,
                    status_backup TEXT DEFAULT 'NORMAL'
                );"#,
                vec![],
            ),
            Statement::new(
                r#"CREATE TABLE IF NOT EXISTS id_card (
                    id_card_id INTEGER PRIMARY KEY AUTOINCREMENT,
                    id_unik TEXT UNIQUE NOT NULL,
                    nama TEXT NOT NULL,
                    divisi TEXT NOT NULL,
                    idcard_status TEXT DEFAULT 'Belum',
                    idcard_pdf_url TEXT,
                    idcard_last_generate TEXT,
                    idcard_catatan TEXT,
                    tanggal_generate TEXT,
                    link_qr_png TEXT,
                    FOREIGN KEY (id_unik) REFERENCES master_data(id_unik) ON DELETE CASCADE
                );"#,
                vec![],
            ),
            Statement::new(
                r#"CREATE TABLE IF NOT EXISTS tbl_shift (
                    id_shift INTEGER PRIMARY KEY AUTOINCREMENT,
                    kode_shift INTEGER UNIQUE NOT NULL,
                    nama_shift TEXT NOT NULL,
                    jam_masuk TEXT NOT NULL,
                    jam_pulang TEXT NOT NULL,
                    awal_absen_menit INTEGER DEFAULT 120,
                    batas_masuk_menit INTEGER DEFAULT 60,
                    toleransi_masuk_menit INTEGER DEFAULT 0,
                    jam_kerja_normal_menit INTEGER NOT NULL,
                    istirahat_menit INTEGER DEFAULT 60,
                    batas_pulang_menit INTEGER DEFAULT 240,
                    offset_istirahat_mulai INTEGER DEFAULT 240,
                    offset_generate_alfa INTEGER DEFAULT 180,
                    buffer_shift_malam_menit INTEGER DEFAULT 120,
                    izinkan_multi_sesi INTEGER DEFAULT 0
                );"#,
                vec![],
            ),
            Statement::new(
                r#"CREATE TABLE IF NOT EXISTS setting_gex_system (
                    key TEXT PRIMARY KEY,
                    value TEXT NOT NULL
                );"#,
                vec![],
            ),
            Statement::new(
                r#"CREATE TABLE IF NOT EXISTS log_scan (
                    id_log INTEGER PRIMARY KEY AUTOINCREMENT,
                    timestamp_scan TEXT NOT NULL,
                    tanggal_kerja TEXT NOT NULL,
                    jam_scan TEXT NOT NULL,
                    id_karyawan TEXT NOT NULL,
                    nama TEXT NOT NULL,
                    divisi TEXT NOT NULL,
                    jenis_scan TEXT NOT NULL,
                    status_proses TEXT NOT NULL,
                    sumber_data TEXT NOT NULL,
                    catatan_sistem TEXT,
                    keterangan TEXT,
                    menit_terlambat INTEGER DEFAULT 0,
                    menit_datang_awal INTEGER DEFAULT 0,
                    id_referensi TEXT,
                    kode_operator TEXT
                );"#,
                vec![],
            ),
            Statement::new(
                r#"CREATE TABLE IF NOT EXISTS absensi_harian (
                    id_absensi INTEGER PRIMARY KEY AUTOINCREMENT,
                    tanggal TEXT NOT NULL,
                    id_karyawan TEXT NOT NULL,
                    nama TEXT NOT NULL,
                    kelas_divisi TEXT NOT NULL,
                    jam_masuk TEXT,
                    jam_pulang TEXT,
                    status_kehadiran TEXT NOT NULL,
                    status_absen TEXT NOT NULL,
                    keterangan TEXT,
                    sumber TEXT NOT NULL,
                    update_terakhir TEXT NOT NULL,
                    menit_terlambat INTEGER DEFAULT 0,
                    menit_datang_awal INTEGER DEFAULT 0,
                    jam_kerja INTEGER DEFAULT 0,
                    lembur INTEGER DEFAULT 0,
                    jam_kerja_kurang INTEGER DEFAULT 0,
                    id_shift INTEGER NOT NULL,
                    bulan TEXT NOT NULL,
                    tahun INTEGER NOT NULL,
                    id_sesi TEXT UNIQUE NOT NULL,
                    mode_tugas TEXT DEFAULT 'NORMAL',
                    id_backup TEXT,
                    id_karyawan_asal TEXT,
                    tanggal_tugas TEXT
                );"#,
                vec![],
            ),
            Statement::new(
                r#"CREATE TABLE IF NOT EXISTS backup_karyawan (
                    id_backup TEXT PRIMARY KEY,
                    tanggal_tugas TEXT NOT NULL,
                    id_karyawan_asal TEXT NOT NULL,
                    nama_karyawan_asal TEXT NOT NULL,
                    divisi_asal TEXT NOT NULL,
                    id_shift_asal INTEGER NOT NULL,
                    id_karyawan_pengganti TEXT NOT NULL,
                    nama_karyawan_pengganti TEXT NOT NULL,
                    divisi_pengganti TEXT NOT NULL,
                    id_shift_normal_pengganti INTEGER NOT NULL,
                    id_shift_backup INTEGER NOT NULL,
                    alasan_backup TEXT,
                    status_tugas TEXT DEFAULT 'Aktif',
                    kode_operator TEXT NOT NULL,
                    waktu_input TEXT NOT NULL,
                    catatan TEXT,
                    waktu_dibatalkan TEXT,
                    operator_pembatalan TEXT
                );"#,
                vec![],
            ),
            Statement::new(
                r#"CREATE TABLE IF NOT EXISTS koreksi_admin (
                    id_koreksi INTEGER PRIMARY KEY AUTOINCREMENT,
                    id_referensi TEXT UNIQUE NOT NULL,
                    tanggal TEXT NOT NULL,
                    id_karyawan TEXT NOT NULL,
                    nama TEXT NOT NULL,
                    divisi TEXT NOT NULL,
                    jenis_koreksi TEXT NOT NULL,
                    jam_koreksi TEXT,
                    keterangan_admin TEXT,
                    status_proses TEXT DEFAULT 'Sudah Diproses',
                    timestamp TEXT NOT NULL,
                    kode_operator TEXT NOT NULL
                );"#,
                vec![],
            ),
            Statement::new(
                r#"CREATE TABLE IF NOT EXISTS audit_absensi (
                    id_audit INTEGER PRIMARY KEY AUTOINCREMENT,
                    waktu TEXT NOT NULL,
                    jenis TEXT NOT NULL,
                    tanggal TEXT NOT NULL,
                    id_karyawan TEXT NOT NULL,
                    nama TEXT NOT NULL,
                    baris_referensi TEXT,
                    detail TEXT NOT NULL,
                    status TEXT NOT NULL
                );"#,
                vec![],
            ),
            Statement::new(
                r#"CREATE TABLE IF NOT EXISTS tbl_hari_libur (
                    id_libur INTEGER PRIMARY KEY AUTOINCREMENT,
                    tanggal TEXT UNIQUE NOT NULL,
                    nama_libur TEXT NOT NULL,
                    jenis_libur TEXT DEFAULT 'Libur Nasional',
                    keterangan TEXT,
                    status_aktif INTEGER DEFAULT 1
                );"#,
                vec![],
            ),
            Statement::new(
                r#"CREATE TABLE IF NOT EXISTS company_profile (
                    id TEXT PRIMARY KEY DEFAULT 'default_company',
                    company_name TEXT NOT NULL DEFAULT 'SPPG',
                    branch_name TEXT,
                    logo_url TEXT,
                    signature_url TEXT,
                    address TEXT,
                    phone TEXT,
                    email TEXT,
                    website TEXT,
                    leader_name TEXT,
                    leader_title TEXT,
                    leader_nip TEXT,
                    card_terms TEXT,
                    timezone TEXT DEFAULT 'Asia/Jakarta',
                    updated_at TEXT NOT NULL
                );"#,
                vec![],
            ),
            Statement::new(
                r#"CREATE TABLE IF NOT EXISTS id_card_template (
                    id TEXT PRIMARY KEY DEFAULT 'default_template',
                    name TEXT NOT NULL DEFAULT 'Template Default SPPG',
                    orientation TEXT NOT NULL DEFAULT 'landscape',
                    front_bg_url TEXT,
                    back_bg_url TEXT,
                    elements_json TEXT NOT NULL,
                    is_active INTEGER NOT NULL DEFAULT 1,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );"#,
                vec![],
            ),
            Statement::new(
                r#"CREATE TABLE IF NOT EXISTS import_offline (
                    id_import INTEGER PRIMARY KEY AUTOINCREMENT,
                    event_key TEXT UNIQUE NOT NULL,
                    timestamp_input TEXT NOT NULL DEFAULT '',
                    tanggal TEXT NOT NULL DEFAULT '',
                    id_unik TEXT NOT NULL DEFAULT '',
                    nama TEXT,
                    divisi TEXT,
                    jam_masuk TEXT,
                    jam_pulang TEXT,
                    status_kehadiran TEXT,
                    status_absen TEXT,
                    keterangan TEXT,
                    status_proses TEXT NOT NULL DEFAULT 'Belum Diproses',
                    diproses_pada TEXT,
                    pesan_error TEXT,
                    kode_operator TEXT
                );"#,
                vec![],
            ),
            Statement::new(
                r#"CREATE TABLE IF NOT EXISTS sync_changelog (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    client_id TEXT NOT NULL,
                    event_id TEXT NOT NULL UNIQUE,
                    domain TEXT NOT NULL,
                    operation TEXT NOT NULL,
                    entity_key TEXT NOT NULL,
                    payload_json TEXT NOT NULL,
                    created_at INTEGER NOT NULL
                );"#,
                vec![],
            ),
            Statement::new(
                r#"CREATE TABLE IF NOT EXISTS sync_operation_receipt (
                    event_id TEXT PRIMARY KEY,
                    client_id TEXT NOT NULL,
                    domain TEXT NOT NULL,
                    operation TEXT NOT NULL,
                    entity_key TEXT NOT NULL,
                    server_revision INTEGER NOT NULL,
                    status TEXT NOT NULL,
                    receipt_json TEXT NOT NULL,
                    created_at INTEGER NOT NULL
                );"#,
                vec![],
            ),
            Statement::new(
                r#"CREATE TABLE IF NOT EXISTS app_session (
                    session_id TEXT PRIMARY KEY,
                    operator_id INTEGER NOT NULL,
                    created_at TEXT NOT NULL,
                    expires_at TEXT NOT NULL,
                    last_activity_at TEXT NOT NULL,
                    ip_address TEXT,
                    user_agent TEXT,
                    FOREIGN KEY (operator_id) REFERENCES master_operator(id) ON DELETE CASCADE
                );"#,
                vec![],
            ),
            Statement::new(
                r#"CREATE TABLE IF NOT EXISTS auth_login_rate_limit (
                    identifier_hash TEXT PRIMARY KEY,
                    failed_attempts INTEGER NOT NULL DEFAULT 0,
                    lockout_until TEXT,
                    last_attempt_at TEXT NOT NULL
                );"#,
                vec![],
            ),
            // Indeks
            Statement::new("CREATE INDEX IF NOT EXISTS idx_log_scan_id_tanggal ON log_scan(id_karyawan, tanggal_kerja);", vec![]),
            Statement::new("CREATE INDEX IF NOT EXISTS idx_absensi_tanggal_id ON absensi_harian(tanggal, id_karyawan);", vec![]),
            Statement::new("CREATE INDEX IF NOT EXISTS idx_absensi_id_sesi ON absensi_harian(id_sesi);", vec![]),
            Statement::new("CREATE INDEX IF NOT EXISTS idx_log_scan_tanggal ON log_scan(tanggal_kerja);", vec![]),
            Statement::new("CREATE INDEX IF NOT EXISTS idx_absensi_tanggal ON absensi_harian(tanggal);", vec![]),
            Statement::new("CREATE INDEX IF NOT EXISTS idx_operator_username ON master_operator(username);", vec![]),
            // Seed Roles
            Statement::new(
                r#"INSERT OR IGNORE INTO app_role (id, role_key, nama_role, deskripsi, is_system, is_superadmin, status, created_at, updated_at) VALUES
                (1, 'superadmin', 'Superadmin', 'Pemilik akses penuh dan pengelola role aplikasi.', 1, 1, 'Aktif', datetime('now'), datetime('now')),
                (2, 'admin', 'Admin', 'Administrator operasional sesuai matriks permission.', 1, 0, 'Aktif', datetime('now'), datetime('now')),
                (3, 'operator', 'Operator', 'Operator harian sesuai matriks permission.', 1, 0, 'Aktif', datetime('now'), datetime('now')),
                (4, 'scanner', 'Scanner', 'Petugas terminal QR sesuai matriks permission.', 1, 0, 'Aktif', datetime('now'), datetime('now'));"#,
                vec![],
            ),
            // Seed Permissions Catalog
            Statement::new(
                r#"INSERT OR IGNORE INTO app_permission (permission_key, nama, grup, deskripsi, is_active, sort_order) VALUES
                ('home.view', 'Akses Beranda & Navigasi Utama', 'Navigasi', 'Melihat ringkasan operasional dan menu sistem.', 1, 10),
                ('scanner.use', 'Gunakan Scanner Terminal', 'Scanner', 'Mengoperasikan terminal scanner QR presensi.', 1, 20),
                ('dashboard.view', 'Akses Dashboard Operasional', 'Dashboard', 'Melihat statistik absensi dan grafik kehadiran.', 1, 30),
                ('dashboard.export', 'Ekspor Data Dashboard', 'Dashboard', 'Mengunduh laporan rekap absensi CSV/Excel.', 1, 40),
                ('employees.view', 'Lihat Master Karyawan', 'Karyawan', 'Melihat daftar dan profil karyawan.', 1, 50),
                ('employees.manage', 'Kelola Master Karyawan', 'Karyawan', 'Menambah, mengedit, dan menonaktifkan data karyawan.', 1, 60),
                ('shifts.view', 'Lihat Master Shift', 'Shift', 'Melihat konfigurasi shift kerja.', 1, 70),
                ('shifts.manage', 'Kelola Master Shift', 'Shift', 'Menambah dan mengubah konfigurasi jam kerja shift.', 1, 80),
                ('holidays.view', 'Lihat Hari Libur', 'Hari Libur', 'Melihat kalender hari libur dan cuti bersama.', 1, 90),
                ('holidays.manage', 'Kelola Hari Libur', 'Hari Libur', 'Menambah dan mengubah tanggal libur operasional.', 1, 100),
                ('corrections.view', 'Lihat Koreksi Admin', 'Koreksi', 'Melihat riwayat koreksi presensi manual.', 1, 110),
                ('corrections.manage', 'Kelola Koreksi Admin', 'Koreksi', 'Melakukan koreksi jam dan status presensi manual.', 1, 120),
                ('backups.view', 'Lihat Penugasan Backup', 'Backup', 'Melihat jadwal tugas pengganti personil.', 1, 130),
                ('backups.manage', 'Kelola Penugasan Backup', 'Backup', 'Menugaskan atau membatalkan backup personil.', 1, 140),
                ('alfa.trigger', 'Trigger Generate Alfa', 'Alfa', 'Menjalankan proses penandaan otomatis status Alfa.', 1, 150),
                ('attendance_audit.view', 'Lihat Audit Absensi', 'Audit', 'Melihat log audit perubahan absensi.', 1, 160),
                ('operational.edit', 'Edit Log Operasional', 'Operasional', 'Mengedit riwayat absensi dan log scan harian.', 1, 170),
                ('operational.delete', 'Hapus Log Operasional', 'Operasional', 'Menghapus riwayat absensi atau log scan yang keliru.', 1, 180),
                ('history.edit', 'Edit Riwayat Presensi', 'Riwayat', 'Mengubah data presensi lampau.', 1, 190),
                ('history.delete', 'Hapus Riwayat Presensi', 'Riwayat', 'Menghapus data presensi lampau.', 1, 200),
                ('operators.view', 'Lihat Daftar Operator', 'Operator', 'Melihat data operator dan akun pengguna.', 1, 210),
                ('operators.manage', 'Kelola Operator', 'Operator', 'Menambah dan mengubah data operator aplikasi.', 1, 220),
                ('roles.manage', 'Kelola Hak Akses & Role', 'Role', 'Mengatur permission matriks untuk setiap role.', 1, 230),
                ('settings.manage', 'Kelola Pengaturan Sistem', 'Pengaturan', 'Mengubah radius geofence, multi-scan, dan sistem.', 1, 240),
                ('branding.manage', 'Kelola Profil & Template ID Card', 'Branding', 'Mengubah logo instansi dan desain kartu.', 1, 250),
                ('sync.view', 'Lihat Status Sinkronisasi', 'Sinkronisasi', 'Melihat indikator dan status antrean sync cloud.', 1, 260),
                ('sync.retry', 'Kirim Ulang & Atasi Konflik', 'Sinkronisasi', 'Memicu sinkronisasi manual dan resolusi konflik.', 1, 270),
                ('diagnostics.view', 'Lihat Diagnostik Sistem', 'Diagnostik', 'Melihat informasi runtime dan kesehatan database.', 1, 280);"#,
                vec![],
            ),
            // Seed Default Role Permissions untuk Role Superadmin (Role 1)
            Statement::new(
                r#"INSERT OR IGNORE INTO role_permission (role_id, permission_key, is_allowed, updated_at, updated_by)
                SELECT 1, permission_key, 1, datetime('now'), 'system' FROM app_permission;"#,
                vec![],
            ),
            // Seed Default Role Permissions untuk Role Admin (Role 2)
            Statement::new(
                r#"INSERT OR IGNORE INTO role_permission (role_id, permission_key, is_allowed, updated_at, updated_by)
                SELECT 2, permission_key, 1, datetime('now'), 'system' FROM app_permission
                WHERE permission_key NOT IN ('roles.manage', 'operators.manage');"#,
                vec![],
            ),
            // Seed Shifts
            Statement::new(
                r#"INSERT OR IGNORE INTO tbl_shift (id_shift, kode_shift, nama_shift, jam_masuk, jam_pulang, awal_absen_menit, batas_masuk_menit, toleransi_masuk_menit, jam_kerja_normal_menit, istirahat_menit, batas_pulang_menit, offset_istirahat_mulai, offset_generate_alfa, buffer_shift_malam_menit, izinkan_multi_sesi) VALUES
                (1, 1, 'Shift Pagi', '07:00', '15:00', 120, 60, 15, 480, 60, 240, 240, 180, 120, 0),
                (2, 2, 'Shift Siang', '15:00', '23:00', 120, 60, 15, 480, 60, 240, 240, 180, 120, 0),
                (3, 3, 'Shift Malam', '23:00', '07:00', 120, 60, 15, 480, 60, 240, 240, 180, 120, 0),
                (4, 4, 'Shift Fleksibel', '08:00', '17:00', 120, 120, 0, 540, 60, 240, 240, 180, 120, 0),
                (5, 5, 'Shift Khusus', '06:00', '18:00', 120, 60, 15, 720, 60, 240, 240, 180, 120, 0);"#,
                vec![],
            ),
            // Seed Settings
            Statement::new(
                r#"INSERT OR IGNORE INTO setting_gex_system (key, value) VALUES
                ('geofence_enabled', '0'),
                ('office_lat', '-6.2088'),
                ('office_lng', '106.8456'),
                ('office_radius_meters', '100'),
                ('cooldown_scan_seconds', '5'),
                ('multi_scan_window_minutes', '15'),
                ('auto_alfa_enabled', '0'),
                ('auto_alfa_time', '23:59'),
                ('auto_alfa_cron_enabled', '0'),
                ('rbac_revision', '1');"#,
                vec![],
            ),
            // Seed Company Profile
            Statement::new(
                r#"INSERT OR IGNORE INTO company_profile (id, company_name, branch_name, address, timezone, updated_at) VALUES
                ('default_company', 'SPPG', 'Kantor Pusat', 'Jl. Jenderal Sudirman No. 1', 'Asia/Jakarta', datetime('now'));"#,
                vec![],
            ),
            // Seed ID Card Template
            Statement::new(
                r#"INSERT OR IGNORE INTO id_card_template (id, name, orientation, elements_json, is_active, created_at, updated_at) VALUES
                ('default_template', 'Template Default SPPG', 'landscape', ?, 1, datetime('now'), datetime('now'));"#,
                vec![json!(serde_json::to_string(&crate::mobile::operational::default_id_card_elements()).unwrap_or_else(|_| "[]".to_string()))],
            ),
            // Seed Schema Migration
            Statement::new(
                r#"INSERT OR IGNORE INTO schema_migration (version, name, applied_at) VALUES
                (8, 'initial_cloud_schema', datetime('now'));"#,
                vec![],
            ),
        ];

        self.execute_pipeline(schema_stmts).await?;

        // Idempotent column migrations for legacy databases in Turso Cloud
        let _ = self.query_one("ALTER TABLE master_operator ADD COLUMN role_id INTEGER REFERENCES app_role(id);", vec![]).await;
        let _ = self.query_one("ALTER TABLE master_operator ADD COLUMN role TEXT NOT NULL DEFAULT 'Operator';", vec![]).await;
        let _ = self.query_one("ALTER TABLE master_operator ADD COLUMN status TEXT DEFAULT 'Aktif';", vec![]).await;
        let _ = self.query_one("ALTER TABLE master_operator ADD COLUMN created_at TEXT;", vec![]).await;
        let _ = self.query_one("ALTER TABLE master_operator ADD COLUMN updated_at TEXT;", vec![]).await;
        let _ = self.query_one("ALTER TABLE tbl_shift ADD COLUMN izinkan_multi_sesi INTEGER NOT NULL DEFAULT 0;", vec![]).await;
        let _ = self.query_one("ALTER TABLE import_offline ADD COLUMN timestamp_input TEXT;", vec![]).await;
        let _ = self.query_one("ALTER TABLE import_offline ADD COLUMN id_unik TEXT;", vec![]).await;
        let _ = self.query_one("ALTER TABLE import_offline ADD COLUMN status_absen TEXT;", vec![]).await;
        let _ = self.query_one("ALTER TABLE import_offline ADD COLUMN status_proses TEXT DEFAULT 'Belum Diproses';", vec![]).await;
        let _ = self.query_one("ALTER TABLE import_offline ADD COLUMN diproses_pada TEXT;", vec![]).await;
        let _ = self.query_one("ALTER TABLE import_offline ADD COLUMN pesan_error TEXT;", vec![]).await;

        // If template in Turso Cloud has empty '[]', upgrade it with default elements
        let default_elements_str = serde_json::to_string(&crate::mobile::operational::default_id_card_elements()).unwrap_or_else(|_| "[]".to_string());
        let _ = self.query_one(
            "UPDATE id_card_template SET elements_json = ? WHERE id = 'default_template' AND (elements_json = '[]' OR elements_json IS NULL OR elements_json = '');",
            vec![json!(default_elements_str)],
        ).await;

        // Seed default superadmin jika belum ada superadmin di master_operator
        let check_ops = self.query_one("SELECT COUNT(*) AS cnt FROM master_operator WHERE username = 'superadmin' OR role_id = 1;", vec![]).await;
        let needs_superadmin = match check_ops {
            Ok(res) => {
                let cnt = res.to_objects().first()
                    .and_then(|row| row.get("cnt").and_then(|v| v.as_i64().or_else(|| v.as_str().and_then(|s| s.parse::<i64>().ok()))))
                    .unwrap_or(0);
                cnt == 0
            }
            Err(_) => true,
        };

        if needs_superadmin {
            let hash = hash_password_pbkdf2("admin123");
            let _ = self.query_one(
                r#"INSERT OR IGNORE INTO master_operator (id, kode_operator, nama_operator, username, password_hash, role, role_id, status, created_at, updated_at)
                VALUES (1, 'SPD001', 'Superadmin SPPG', 'superadmin', ?, 'Admin', 1, 'Aktif', datetime('now'), datetime('now'));"#,
                vec![json!(hash)],
            ).await;
        }

        // Seed default admin jika belum ada admin
        let check_admin = self.query_one("SELECT COUNT(*) AS cnt FROM master_operator WHERE username = 'admin';", vec![]).await;
        let needs_admin = match check_admin {
            Ok(res) => {
                let cnt = res.to_objects().first()
                    .and_then(|row| row.get("cnt").and_then(|v| v.as_i64().or_else(|| v.as_str().and_then(|s| s.parse::<i64>().ok()))))
                    .unwrap_or(0);
                cnt == 0
            }
            Err(_) => true,
        };

        if needs_admin {
            let hash = hash_password_pbkdf2("admin123");
            let _ = self.query_one(
                r#"INSERT OR IGNORE INTO master_operator (id, kode_operator, nama_operator, username, password_hash, role, role_id, status, created_at, updated_at)
                VALUES (2, 'OPR001', 'Administrator SPPG', 'admin', ?, 'Admin', 2, 'Aktif', datetime('now'), datetime('now'));"#,
                vec![json!(hash)],
            ).await;
        }

        Ok(())
    }

    pub async fn authenticate_operator(
        &self,
        identifier: &str,
        password: &str,
    ) -> Result<OperatorUser, CommandError> {
        let _ = self.ensure_schema().await;
        let id_clean = identifier.trim();
        let sql = r#"
            SELECT
                m.id, m.kode_operator, m.nama_operator, m.username, m.password_hash,
                m.role_id, r.role_key, r.nama_role, r.is_superadmin
            FROM master_operator m
            JOIN app_role r ON r.id = m.role_id
            WHERE (m.username = ? COLLATE NOCASE OR m.kode_operator = ? COLLATE NOCASE)
              AND m.status = 'Aktif' AND r.status = 'Aktif'
            LIMIT 1;
        "#;

        let result = self
            .query_one(sql, vec![json!(id_clean), json!(id_clean)])
            .await?;

        let objects = result.to_objects();
        let row = objects.first().ok_or_else(|| {
            CommandError::new(
                "LOGIN_REJECTED",
                "Username atau password tidak sesuai atau akun nonaktif.",
            )
        })?;

        let stored_hash = row
            .get("password_hash")
            .and_then(Value::as_str)
            .unwrap_or("");

        if !verify_password(password, stored_hash) {
            return Err(CommandError::new(
                "LOGIN_REJECTED",
                "Username atau password tidak sesuai.",
            ));
        }

        let op_id = row.get("id").and_then(Value::as_i64).unwrap_or(0);
        let kode_operator = row
            .get("kode_operator")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_owned();
        let nama_operator = row
            .get("nama_operator")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_owned();
        let username = row
            .get("username")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_owned();
        let role_id = row.get("role_id").and_then(Value::as_i64).unwrap_or(0);
        let role_key = row
            .get("role_key")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_owned();
        let nama_role = row
            .get("nama_role")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_owned();
        let is_superadmin = row
            .get("is_superadmin")
            .and_then(|v| v.as_i64().map(|n| n == 1).or_else(|| v.as_bool()))
            .unwrap_or(false);

        // Ambil permissions
        let permissions = if is_superadmin {
            vec![
                "home.view".into(),
                "scanner.use".into(),
                "dashboard.view".into(),
                "dashboard.export".into(),
                "employees.view".into(),
                "employees.manage".into(),
                "shifts.view".into(),
                "shifts.manage".into(),
                "holidays.view".into(),
                "holidays.manage".into(),
                "corrections.view".into(),
                "corrections.manage".into(),
                "backups.view".into(),
                "backups.manage".into(),
                "alfa.trigger".into(),
                "attendance_audit.view".into(),
                "operational.edit".into(),
                "operational.delete".into(),
                "history.edit".into(),
                "history.delete".into(),
                "operators.view".into(),
                "operators.manage".into(),
                "roles.manage".into(),
                "settings.manage".into(),
                "branding.manage".into(),
                "sync.view".into(),
                "sync.retry".into(),
                "diagnostics.view".into(),
            ]
        } else {
            let perm_query = self
                .query_one(
                    "SELECT permission_key FROM role_permission WHERE role_id = ? AND is_allowed = 1 ORDER BY permission_key;",
                    vec![json!(role_id)],
                )
                .await;
            perm_query
                .map(|res| {
                    res.to_objects()
                        .into_iter()
                        .filter_map(|row| {
                            row.get("permission_key")
                                .and_then(Value::as_str)
                                .map(str::to_owned)
                        })
                        .collect()
                })
                .unwrap_or_default()
        };

        // Query revision dari setting_gex_system
        let rev_query = self
            .query_one(
                "SELECT value FROM setting_gex_system WHERE key = 'rbac_revision';",
                vec![],
            )
            .await;
        let permission_revision = rev_query
            .ok()
            .and_then(|res| res.to_objects().into_iter().next())
            .and_then(|row| {
                row.get("value")
                    .and_then(Value::as_str)
                    .and_then(|s| s.parse::<i64>().ok())
                    .or_else(|| row.get("value").and_then(Value::as_i64))
            })
            .unwrap_or(1);

        Ok(OperatorUser {
            id: op_id,
            kode_operator,
            nama_operator,
            username,
            role: nama_role,
            role_id,
            role_key,
            is_superadmin,
            permissions,
            permission_revision,
            login_at: Some(chrono_like_now_iso()),
        })
    }

    pub async fn pull_snapshot(&self, last_revision: i64) -> Result<Value, CommandError> {
        self.ensure_schema().await?;
        let tables = [
            ("employees", "SELECT * FROM master_data;"),
            ("idCards", "SELECT * FROM id_card;"),
            ("shifts", "SELECT * FROM tbl_shift ORDER BY id_shift;"),
            ("holidays", "SELECT * FROM tbl_hari_libur ORDER BY tanggal;"),
            ("settings", "SELECT key, value FROM setting_gex_system;"),
            ("companyProfiles", "SELECT * FROM company_profile;"),
            ("idCardTemplates", "SELECT * FROM id_card_template;"),
            ("backups", "SELECT * FROM backup_karyawan;"),
            ("corrections", "SELECT * FROM koreksi_admin;"),
            ("imports", "SELECT * FROM import_offline;"),
            ("attendance", "SELECT * FROM absensi_harian;"),
            ("scanLogs", "SELECT * FROM log_scan ORDER BY timestamp_scan;"),
        ];

        let mut stmts = Vec::new();
        for (_, sql) in &tables {
            stmts.push(Statement::new(*sql, vec![]));
        }

        // Query max revision dari sync_changelog jika ada
        stmts.push(Statement::new(
            "SELECT COALESCE(MAX(id), 0) AS max_rev FROM sync_changelog;",
            vec![],
        ));

        let results = self.execute_pipeline(stmts).await?;
        let mut snapshot = json!({});

        for (idx, (key, _)) in tables.iter().enumerate() {
            if let Some(res) = results.get(idx) {
                let rows_json: Vec<Value> = res
                    .to_objects()
                    .into_iter()
                    .map(|map| json!(map))
                    .collect();
                snapshot[key] = json!(rows_json);
            } else {
                snapshot[key] = json!([]);
            }
        }

        let max_rev_idx = tables.len();
        let queried_rev = results
            .get(max_rev_idx)
            .and_then(|res| res.to_objects().into_iter().next())
            .and_then(|row| {
                row.get("max_rev")
                    .and_then(|v| v.as_i64().or_else(|| v.as_str().and_then(|s| s.parse::<i64>().ok())))
            })
            .unwrap_or(0);
        let max_rev = queried_rev.max(last_revision);

        snapshot["revision"] = json!(max_rev);
        Ok(json!({ "snapshot": snapshot }))
    }

    pub async fn push_events(&self, events: &[Value]) -> Result<Vec<Value>, CommandError> {
        self.ensure_schema().await?;
        let mut push_results = Vec::new();

        // Pastikan tabel sync_changelog ada
        let ensure_changelog_sql = r#"
            CREATE TABLE IF NOT EXISTS sync_changelog (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                client_id TEXT NOT NULL,
                event_id TEXT NOT NULL UNIQUE,
                domain TEXT NOT NULL,
                operation TEXT NOT NULL,
                entity_key TEXT NOT NULL,
                payload_json TEXT NOT NULL,
                created_at INTEGER NOT NULL
            );
        "#;
        let _ = self.query_one(ensure_changelog_sql, vec![]).await;

        for event in events {
            let event_id = event
                .get("event_id")
                .or_else(|| event.get("eventId"))
                .and_then(Value::as_str)
                .unwrap_or("");
            let client_id = event
                .get("client_id")
                .or_else(|| event.get("clientId"))
                .and_then(Value::as_str)
                .unwrap_or("desktop-client");
            let domain = event
                .get("domain")
                .and_then(Value::as_str)
                .unwrap_or("");
            let operation = event
                .get("operation")
                .and_then(Value::as_str)
                .unwrap_or("");
            let entity_key = event
                .get("entity_key")
                .or_else(|| event.get("entityKey"))
                .and_then(Value::as_str)
                .unwrap_or("");
            let payload_json = event
                .get("payload_json")
                .or_else(|| event.get("payloadJson"))
                .or_else(|| event.get("payload"))
                .map(|v| if v.is_string() { v.as_str().unwrap().to_owned() } else { v.to_string() })
                .unwrap_or_else(|| "{}".to_owned());

            if event_id.is_empty() {
                continue;
            }

            // Simpan ke changelog Turso
            let now_epoch = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_secs() as i64)
                .unwrap_or_default();

            let insert_changelog_sql = r#"
                INSERT INTO sync_changelog (client_id, event_id, domain, operation, entity_key, payload_json, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(event_id) DO UPDATE SET payload_json = excluded.payload_json;
            "#;

            let changelog_res = self
                .query_one(
                    insert_changelog_sql,
                    vec![
                        json!(client_id),
                        json!(event_id),
                        json!(domain),
                        json!(operation),
                        json!(entity_key),
                        json!(payload_json),
                        json!(now_epoch),
                    ],
                )
                .await;

            let server_revision = changelog_res
                .ok()
                .and_then(|r| r.last_insert_rowid)
                .unwrap_or(1);

            // Terapkan payload langsung ke tabel target Turso jika memungkinkan
            let apply_res = apply_event_to_turso(self, domain, operation, &payload_json).await;

            if let Err(e) = apply_res {
                push_results.push(json!({
                    "eventId": event_id,
                    "status": "conflict",
                    "reason": e.message.clone(),
                    "message": e.message,
                    "serverRevision": server_revision
                }));
            } else {
                push_results.push(json!({
                    "eventId": event_id,
                    "status": "applied",
                    "message": "Event berhasil diterapkan ke database Turso.",
                    "serverRevision": server_revision
                }));
            }
        }

        Ok(push_results)
    }

    pub async fn get_master_operators(&self) -> Result<Value, CommandError> {
        let _ = self.ensure_schema().await;
        let sql = r#"
            SELECT
                m.id, m.kode_operator, m.nama_operator, m.username,
                COALESCE(m.role_id, 2) AS role_id,
                COALESCE(m.status, 'Aktif') AS status,
                COALESCE(r.nama_role, 'Admin') AS nama_role,
                COALESCE(r.role_key, 'admin') AS role_key,
                COALESCE(r.is_superadmin, 0) AS is_superadmin,
                COALESCE(m.created_at, '') AS created_at,
                COALESCE(m.updated_at, '') AS updated_at
            FROM master_operator m
            LEFT JOIN app_role r ON r.id = m.role_id
            ORDER BY m.id ASC;
        "#;
        let res = self.query_one(sql, vec![]).await?;
        let rows: Vec<Value> = res.to_objects().into_iter().map(|m| json!(m)).collect();
        Ok(json!({ "operators": rows }))
    }

    pub async fn create_operator(&self, draft: &Value) -> Result<Value, CommandError> {
        let kode_operator = draft.get("kode_operator").and_then(Value::as_str).unwrap_or("").trim();
        let nama_operator = draft.get("nama_operator").and_then(Value::as_str).unwrap_or("").trim();
        let username = draft.get("username").and_then(Value::as_str).unwrap_or("").trim();
        let password = draft.get("password").and_then(Value::as_str).unwrap_or("").trim();
        let role_id = draft.get("role_id").and_then(Value::as_i64).unwrap_or(2);
        let status = draft.get("status").and_then(Value::as_str).unwrap_or("Aktif");

        if kode_operator.is_empty() || nama_operator.is_empty() || username.is_empty() || password.is_empty() {
            return Err(CommandError::new("VALIDATION_ERROR", "Data operator tidak lengkap."));
        }

        let password_hash = hash_password_pbkdf2(password);
        let now_epoch = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs() as i64)
            .unwrap_or_default();

        let sql = r#"
            INSERT INTO master_operator (kode_operator, nama_operator, username, password_hash, role_id, status, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?);
        "#;

        let res = self
            .query_one(
                sql,
                vec![
                    json!(kode_operator),
                    json!(nama_operator),
                    json!(username),
                    json!(password_hash),
                    json!(role_id),
                    json!(status),
                    json!(now_epoch),
                    json!(now_epoch),
                ],
            )
            .await?;

        let new_id = res.last_insert_rowid.unwrap_or(0);
        Ok(json!({
            "sukses": true,
            "operator": {
                "id": new_id,
                "kode_operator": kode_operator,
                "nama_operator": nama_operator,
                "username": username,
                "role_id": role_id,
                "status": status
            }
        }))
    }

    pub async fn update_operator(&self, id: i64, draft: &Value) -> Result<Value, CommandError> {
        let mut updates = Vec::new();
        let mut args = Vec::new();

        if let Some(nama) = draft.get("nama_operator").and_then(Value::as_str) {
            updates.push("nama_operator = ?");
            args.push(json!(nama.trim()));
        }
        if let Some(role_id) = draft.get("role_id").and_then(Value::as_i64) {
            updates.push("role_id = ?");
            args.push(json!(role_id));
        }
        if let Some(status) = draft.get("status").and_then(Value::as_str) {
            updates.push("status = ?");
            args.push(json!(status));
        }
        if let Some(password) = draft.get("password").and_then(Value::as_str) {
            if !password.trim().is_empty() {
                updates.push("password_hash = ?");
                args.push(json!(hash_password_pbkdf2(password.trim())));
            }
        }

        if updates.is_empty() {
            return Ok(json!({ "sukses": true }));
        }

        let now_epoch = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs() as i64)
            .unwrap_or_default();
        updates.push("updated_at = ?");
        args.push(json!(now_epoch));

        args.push(json!(id));
        let sql = format!(
            "UPDATE master_operator SET {} WHERE id = ?;",
            updates.join(", ")
        );

        self.query_one(&sql, args).await?;
        Ok(json!({ "sukses": true }))
    }

    pub async fn delete_operator(&self, id: i64) -> Result<Value, CommandError> {
        let check_sql = "SELECT is_superadmin FROM app_role r JOIN master_operator m ON m.role_id = r.id WHERE m.id = ?;";
        let check = self.query_one(check_sql, vec![json!(id)]).await?;
        if let Some(row) = check.to_objects().first() {
            if row.get("is_superadmin").and_then(|v| v.as_i64()).unwrap_or(0) == 1 {
                return Err(CommandError::new("FORBIDDEN", "Akun Superadmin utama tidak dapat dihapus."));
            }
        }

        self.query_one("DELETE FROM master_operator WHERE id = ?;", vec![json!(id)]).await?;
        Ok(json!({ "sukses": true }))
    }

    pub async fn get_roles(&self) -> Result<Value, CommandError> {
        self.ensure_schema().await?;
        let roles_sql = "SELECT id, role_key, nama_role, deskripsi, is_superadmin, status FROM app_role ORDER BY id ASC;";
        let perms_sql = "SELECT role_id, permission_key, is_allowed FROM role_permission;";

        let mut results = self
            .execute_pipeline(vec![
                Statement::new(roles_sql, vec![]),
                Statement::new(perms_sql, vec![]),
            ])
            .await?;

        let perms_res = results.pop().unwrap_or_default();
        let roles_res = results.pop().unwrap_or_default();

        let mut role_perms: HashMap<i64, Vec<String>> = HashMap::new();
        for p in perms_res.to_objects() {
            let r_id = p.get("role_id").and_then(Value::as_i64).unwrap_or(0);
            let is_allowed = p.get("is_allowed").and_then(Value::as_i64).unwrap_or(0) == 1;
            let key = p.get("permission_key").and_then(Value::as_str).unwrap_or("");
            if is_allowed && !key.is_empty() {
                role_perms.entry(r_id).or_default().push(key.to_owned());
            }
        }

        let mut roles = Vec::new();
        for r in roles_res.to_objects() {
            let r_id = r.get("id").and_then(Value::as_i64).unwrap_or(0);
            let mut role_obj = json!(r);
            let perms = role_perms.get(&r_id).cloned().unwrap_or_default();
            role_obj["permissions"] = json!(perms);
            roles.push(role_obj);
        }

        Ok(json!({ "roles": roles }))
    }

    pub async fn create_role(&self, draft: &Value) -> Result<Value, CommandError> {
        let role_key = draft.get("role_key").and_then(Value::as_str).unwrap_or("").trim();
        let nama_role = draft.get("nama_role").and_then(Value::as_str).unwrap_or("").trim();
        let deskripsi = draft.get("deskripsi").and_then(Value::as_str).unwrap_or("");

        if role_key.is_empty() || nama_role.is_empty() {
            return Err(CommandError::new("VALIDATION_ERROR", "Data role tidak lengkap."));
        }

        let sql = "INSERT INTO app_role (role_key, nama_role, deskripsi, is_superadmin, status) VALUES (?, ?, ?, 0, 'Aktif');";
        let res = self
            .query_one(sql, vec![json!(role_key), json!(nama_role), json!(deskripsi)])
            .await?;

        let role_id = res.last_insert_rowid.unwrap_or(0);

        if let Some(perms) = draft.get("permissions").and_then(Value::as_array) {
            let perm_stmts: Vec<Statement> = perms
                .iter()
                .filter_map(|p| p.as_str())
                .map(|p_key| {
                    Statement::new(
                        "INSERT OR REPLACE INTO role_permission (role_id, permission_key, is_allowed) VALUES (?, ?, 1);",
                        vec![json!(role_id), json!(p_key)],
                    )
                })
                .collect();
            if !perm_stmts.is_empty() {
                let _ = self.execute_pipeline(perm_stmts).await;
            }
        }

        Ok(json!({ "sukses": true, "role_id": role_id }))
    }

    pub async fn update_role(&self, role_id: i64, draft: &Value) -> Result<Value, CommandError> {
        let mut updates = Vec::new();
        let mut args = Vec::new();

        if let Some(nama) = draft.get("nama_role").and_then(Value::as_str) {
            updates.push("nama_role = ?");
            args.push(json!(nama.trim()));
        }
        if let Some(deskripsi) = draft.get("deskripsi").and_then(Value::as_str) {
            updates.push("deskripsi = ?");
            args.push(json!(deskripsi));
        }

        if !updates.is_empty() {
            args.push(json!(role_id));
            let sql = format!("UPDATE app_role SET {} WHERE id = ?;", updates.join(", "));
            self.query_one(&sql, args).await?;
        }

        Ok(json!({ "sukses": true }))
    }

    pub async fn set_role_permissions(
        &self,
        role_id: i64,
        permissions: &[String],
    ) -> Result<Value, CommandError> {
        let mut stmts = vec![Statement::new(
            "DELETE FROM role_permission WHERE role_id = ?;",
            vec![json!(role_id)],
        )];

        for p_key in permissions {
            stmts.push(Statement::new(
                "INSERT INTO role_permission (role_id, permission_key, is_allowed) VALUES (?, ?, 1);",
                vec![json!(role_id), json!(p_key)],
            ));
        }

        // Bump rbac revision
        stmts.push(Statement::new(
            "INSERT INTO setting_gex_system (key, value) VALUES ('rbac_revision', strftime('%s','now')) ON CONFLICT(key) DO UPDATE SET value = strftime('%s','now');",
            vec![],
        ));

        self.execute_pipeline(stmts).await?;
        Ok(json!({ "sukses": true }))
    }

    pub async fn delete_role(&self, role_id: i64) -> Result<Value, CommandError> {
        let check = self
            .query_one(
                "SELECT is_superadmin FROM app_role WHERE id = ?;",
                vec![json!(role_id)],
            )
            .await?;
        if let Some(row) = check.to_objects().first() {
            if row.get("is_superadmin").and_then(|v| v.as_i64()).unwrap_or(0) == 1 {
                return Err(CommandError::new("FORBIDDEN", "Role Superadmin tidak dapat dihapus."));
            }
        }

        self.execute_pipeline(vec![
            Statement::new("DELETE FROM role_permission WHERE role_id = ?;", vec![json!(role_id)]),
            Statement::new("DELETE FROM app_role WHERE id = ?;", vec![json!(role_id)]),
        ])
        .await?;

        Ok(json!({ "sukses": true }))
    }
}

fn extract_attendance_row_params(row: &Value, id_sesi: &str) -> Vec<Value> {
    let tanggal = row.get("tanggal").and_then(Value::as_str).unwrap_or("");
    let tahun = row.get("tahun")
        .and_then(|v| v.as_i64().or_else(|| v.as_str().and_then(|s| s.parse::<i64>().ok())))
        .unwrap_or_else(|| {
            tanggal.split('-').next().and_then(|s| s.parse::<i64>().ok()).unwrap_or(2026)
        });
    let bulan = row.get("bulan").and_then(Value::as_str).map(|s| s.to_string()).unwrap_or_else(|| {
        let month_num = tanggal.split('-').nth(1).and_then(|s| s.parse::<usize>().ok()).unwrap_or(1);
        const MONTHS: [&str; 12] = [
            "Januari", "Februari", "Maret", "April", "Mei", "Juni",
            "Juli", "Agustus", "September", "Oktober", "November", "Desember",
        ];
        (*MONTHS.get(month_num.saturating_sub(1)).unwrap_or(&"Januari")).to_string()
    });
    let status_absen = row.get("status_absen").and_then(Value::as_str).unwrap_or_else(|| {
        if row.get("jam_pulang").and_then(Value::as_str).map(|s| !s.is_empty()).unwrap_or(false) {
            "Pulang"
        } else {
            "Hadir"
        }
    });
    let sumber = row.get("sumber").and_then(Value::as_str).unwrap_or("Scanner");
    let update_terakhir = row.get("update_terakhir").and_then(Value::as_str).unwrap_or_else(|| {
        if !tanggal.is_empty() { tanggal } else { "2026-01-01 00:00:00" }
    });

    vec![
        json!(tanggal),
        json!(row.get("id_karyawan").and_then(Value::as_str).unwrap_or("")),
        json!(row.get("nama").and_then(Value::as_str).unwrap_or("")),
        json!(row.get("kelas_divisi").and_then(Value::as_str).unwrap_or("")),
        json!(row.get("jam_masuk").and_then(Value::as_str)),
        json!(row.get("jam_pulang").and_then(Value::as_str)),
        json!(row.get("status_kehadiran").and_then(Value::as_str).unwrap_or("Hadir")),
        json!(status_absen),
        json!(row.get("keterangan").and_then(Value::as_str)),
        json!(sumber),
        json!(update_terakhir),
        json!(row.get("menit_terlambat").and_then(Value::as_i64).unwrap_or(0)),
        json!(row.get("menit_datang_awal").and_then(Value::as_i64).unwrap_or(0)),
        json!(row.get("jam_kerja").and_then(|v| v.as_i64().or_else(|| v.as_str().and_then(|s| s.parse::<i64>().ok()))).unwrap_or(0)),
        json!(row.get("lembur").and_then(|v| v.as_i64().or_else(|| v.as_str().and_then(|s| s.parse::<i64>().ok()))).unwrap_or(0)),
        json!(row.get("jam_kerja_kurang").and_then(|v| v.as_i64().or_else(|| v.as_str().and_then(|s| s.parse::<i64>().ok()))).unwrap_or(0)),
        json!(row.get("id_shift").and_then(Value::as_i64).unwrap_or(1)),
        json!(bulan),
        json!(tahun),
        json!(id_sesi),
        json!(row.get("mode_tugas").and_then(Value::as_str).unwrap_or("NORMAL")),
        json!(row.get("id_backup").and_then(Value::as_str)),
        json!(row.get("id_karyawan_asal").and_then(Value::as_str)),
        json!(row.get("tanggal_tugas").and_then(Value::as_str)),
    ]
}

async fn apply_event_to_turso(
    turso: &TursoClient,
    domain: &str,
    operation: &str,
    payload_json: &str,
) -> Result<(), CommandError> {
    let payload: Value = serde_json::from_str(payload_json).unwrap_or(Value::Null);

    match (domain, operation) {
        ("employee", "create" | "update") => {
            let row = payload.get("employee").unwrap_or(&payload);
            let id_unik = row.get("id_unik").and_then(Value::as_str).unwrap_or("");
            let token_opt = row.get("token_absensi").and_then(Value::as_str);
            let status_qr = row.get("status_qr").and_then(Value::as_str).unwrap_or_else(|| {
                if token_opt.map(|t| !t.is_empty()).unwrap_or(false) {
                    "Generated"
                } else {
                    "Belum"
                }
            });
            if !id_unik.is_empty() {
                let sql = r#"
                    INSERT INTO master_data (
                        id_unik, kode_karyawan, nama, divisi, jabatan_status, no_hp, lp,
                        id_shift, status_aktif, tanggal_daftar, catatan, token_absensi,
                        qr_code, status_qr, jenis_personil, tanggal_mulai_aktif,
                        tanggal_selesai_aktif, status_backup
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(id_unik) DO UPDATE SET
                        kode_karyawan = excluded.kode_karyawan,
                        nama = excluded.nama,
                        divisi = excluded.divisi,
                        jabatan_status = excluded.jabatan_status,
                        no_hp = excluded.no_hp,
                        lp = excluded.lp,
                        id_shift = excluded.id_shift,
                        status_aktif = excluded.status_aktif,
                        tanggal_daftar = excluded.tanggal_daftar,
                        catatan = excluded.catatan,
                        token_absensi = excluded.token_absensi,
                        qr_code = excluded.qr_code,
                        status_qr = excluded.status_qr,
                        jenis_personil = excluded.jenis_personil,
                        tanggal_mulai_aktif = excluded.tanggal_mulai_aktif,
                        tanggal_selesai_aktif = excluded.tanggal_selesai_aktif,
                        status_backup = excluded.status_backup;
                "#;
                turso.query_one(
                    sql,
                    vec![
                        json!(id_unik),
                        json!(row.get("kode_karyawan").and_then(Value::as_str)),
                        json!(row.get("nama").and_then(Value::as_str).unwrap_or("")),
                        json!(row.get("divisi").and_then(Value::as_str).unwrap_or("")),
                        json!(row.get("jabatan_status").and_then(Value::as_str)),
                        json!(row.get("no_hp").and_then(Value::as_str)),
                        json!(row.get("lp").and_then(Value::as_str)),
                        json!(row.get("id_shift").and_then(Value::as_i64).unwrap_or(1)),
                        json!(row.get("status_aktif").and_then(Value::as_str).unwrap_or("Aktif")),
                        json!(row.get("tanggal_daftar").and_then(Value::as_str)),
                        json!(row.get("catatan").and_then(Value::as_str)),
                        json!(row.get("token_absensi").and_then(Value::as_str)),
                        json!(row.get("qr_code").and_then(Value::as_str)),
                        json!(status_qr),
                        json!(row.get("jenis_personil").and_then(Value::as_str)),
                        json!(row.get("tanggal_mulai_aktif").and_then(Value::as_str)),
                        json!(row.get("tanggal_selesai_aktif").and_then(Value::as_str)),
                        json!(row.get("status_backup").and_then(Value::as_str).unwrap_or("NORMAL")),
                    ],
                )
                .await?;
            }
        }
        ("employee", "status") => {
            let id_unik = payload.get("id_unik").and_then(Value::as_str).unwrap_or("");
            let status = payload.get("status_aktif").and_then(Value::as_str).unwrap_or("Aktif");
            if !id_unik.is_empty() {
                turso.query_one(
                    "UPDATE master_data SET status_aktif = ? WHERE id_unik = ?;",
                    vec![json!(status), json!(id_unik)],
                ).await?;
            }
        }
        ("employee", "token") => {
            let id_unik = payload.get("id_unik").and_then(Value::as_str).unwrap_or("");
            let token = payload.get("token_absensi").and_then(Value::as_str).unwrap_or("");
            let qr = payload.get("qr_code").and_then(Value::as_str).unwrap_or("");
            if !id_unik.is_empty() {
                turso.query_one(
                    "UPDATE master_data SET token_absensi = ?, qr_code = ?, status_qr = 'Generated' WHERE id_unik = ?;",
                    vec![json!(token), json!(qr), json!(id_unik)],
                ).await?;
            }
        }
        ("employee", "delete") => {
            let id_unik = payload.get("id_unik").and_then(Value::as_str).unwrap_or("");
            if !id_unik.is_empty() {
                turso.query_one("DELETE FROM master_data WHERE id_unik = ?;", vec![json!(id_unik)]).await?;
            }
        }
        ("id_card" | "idcard" | "id-card", "create" | "update" | "generate") => {
            let row = payload.get("id_card").unwrap_or(&payload);
            let id_unik = row.get("id_unik").and_then(Value::as_str).unwrap_or("");
            if !id_unik.is_empty() {
                let sql = r#"
                    INSERT INTO id_card (
                        id_unik, nama, divisi, idcard_status, idcard_pdf_url,
                        idcard_last_generate, idcard_catatan, tanggal_generate, link_qr_png
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(id_unik) DO UPDATE SET
                        nama = COALESCE(NULLIF(excluded.nama, ''), id_card.nama),
                        divisi = COALESCE(NULLIF(excluded.divisi, ''), id_card.divisi),
                        idcard_status = excluded.idcard_status,
                        idcard_pdf_url = excluded.idcard_pdf_url,
                        idcard_last_generate = excluded.idcard_last_generate,
                        idcard_catatan = excluded.idcard_catatan,
                        tanggal_generate = excluded.tanggal_generate,
                        link_qr_png = excluded.link_qr_png;
                "#;
                turso.query_one(
                    sql,
                    vec![
                        json!(id_unik),
                        json!(row.get("nama").and_then(Value::as_str).unwrap_or("")),
                        json!(row.get("divisi").and_then(Value::as_str).unwrap_or("")),
                        json!(row.get("idcard_status").and_then(Value::as_str).unwrap_or("Belum Dicetak")),
                        json!(row.get("idcard_pdf_url").and_then(Value::as_str)),
                        json!(row.get("idcard_last_generate").and_then(Value::as_str)),
                        json!(row.get("idcard_catatan").and_then(Value::as_str)),
                        json!(row.get("tanggal_generate").and_then(Value::as_str)),
                        json!(row.get("link_qr_png").and_then(Value::as_str)),
                    ],
                )
                .await?;
            }
        }
        ("id_card" | "idcard" | "id-card", "delete") => {
            let id_unik = payload.get("id_unik").and_then(Value::as_str).unwrap_or("");
            if !id_unik.is_empty() {
                turso.query_one("DELETE FROM id_card WHERE id_unik = ?;", vec![json!(id_unik)]).await?;
            }
        }
        ("shift", "create" | "update") => {
            let row = payload.get("shift").unwrap_or(&payload);
            let kode_shift = row.get("kode_shift").and_then(|v| v.as_i64().or_else(|| v.as_str().and_then(|s| s.parse::<i64>().ok()))).unwrap_or(0);
            if kode_shift > 0 {
                let sql = r#"
                    INSERT INTO tbl_shift (
                        kode_shift, nama_shift, jam_masuk, jam_pulang, awal_absen_menit,
                        batas_masuk_menit, toleransi_masuk_menit, jam_kerja_normal_menit,
                        istirahat_menit, batas_pulang_menit, offset_istirahat_mulai,
                        offset_generate_alfa, buffer_shift_malam_menit, izinkan_multi_sesi
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(kode_shift) DO UPDATE SET
                        nama_shift = excluded.nama_shift,
                        jam_masuk = excluded.jam_masuk,
                        jam_pulang = excluded.jam_pulang,
                        awal_absen_menit = excluded.awal_absen_menit,
                        batas_masuk_menit = excluded.batas_masuk_menit,
                        toleransi_masuk_menit = excluded.toleransi_masuk_menit,
                        jam_kerja_normal_menit = excluded.jam_kerja_normal_menit,
                        istirahat_menit = excluded.istirahat_menit,
                        batas_pulang_menit = excluded.batas_pulang_menit,
                        offset_istirahat_mulai = excluded.offset_istirahat_mulai,
                        offset_generate_alfa = excluded.offset_generate_alfa,
                        buffer_shift_malam_menit = excluded.buffer_shift_malam_menit,
                        izinkan_multi_sesi = excluded.izinkan_multi_sesi;
                "#;
                turso.query_one(
                    sql,
                    vec![
                        json!(kode_shift),
                        json!(row.get("nama_shift").and_then(Value::as_str).unwrap_or("")),
                        json!(row.get("jam_masuk").and_then(Value::as_str).unwrap_or("")),
                        json!(row.get("jam_pulang").and_then(Value::as_str).unwrap_or("")),
                        json!(row.get("awal_absen_menit").and_then(Value::as_i64).unwrap_or(0)),
                        json!(row.get("batas_masuk_menit").and_then(Value::as_i64).unwrap_or(0)),
                        json!(row.get("toleransi_masuk_menit").and_then(Value::as_i64).unwrap_or(0)),
                        json!(row.get("jam_kerja_normal_menit").and_then(Value::as_i64).unwrap_or(0)),
                        json!(row.get("istirahat_menit").and_then(Value::as_i64).unwrap_or(0)),
                        json!(row.get("batas_pulang_menit").and_then(Value::as_i64).unwrap_or(0)),
                        json!(row.get("offset_istirahat_mulai").and_then(Value::as_i64).unwrap_or(0)),
                        json!(row.get("offset_generate_alfa").and_then(Value::as_i64).unwrap_or(0)),
                        json!(row.get("buffer_shift_malam_menit").and_then(Value::as_i64).unwrap_or(0)),
                        json!(row.get("izinkan_multi_sesi").and_then(Value::as_i64).unwrap_or(0)),
                    ],
                )
                .await?;
            }
        }
        ("shift", "delete") => {
            let shift_id = payload.get("id_shift").and_then(Value::as_i64);
            let shift_code = payload.get("kode_shift").and_then(Value::as_i64);
            if let Some(id) = shift_id {
                turso.query_one("DELETE FROM tbl_shift WHERE id_shift = ?;", vec![json!(id)]).await?;
            } else if let Some(code) = shift_code {
                turso.query_one("DELETE FROM tbl_shift WHERE kode_shift = ?;", vec![json!(code)]).await?;
            }
        }
        ("holiday", "create" | "update") => {
            let row = payload.get("holiday").unwrap_or(&payload);
            let tanggal = row.get("tanggal").and_then(Value::as_str).unwrap_or("");
            if !tanggal.is_empty() {
                let sql = r#"
                    INSERT INTO tbl_hari_libur (tanggal, nama_libur, jenis_libur, keterangan, status_aktif)
                    VALUES (?, ?, ?, ?, ?)
                    ON CONFLICT(tanggal) DO UPDATE SET
                        nama_libur = excluded.nama_libur,
                        jenis_libur = excluded.jenis_libur,
                        keterangan = excluded.keterangan,
                        status_aktif = excluded.status_aktif;
                "#;
                turso.query_one(
                    sql,
                    vec![
                        json!(tanggal),
                        json!(row.get("nama_libur").and_then(Value::as_str).unwrap_or("")),
                        json!(row.get("jenis_libur").and_then(Value::as_str).unwrap_or("")),
                        json!(row.get("keterangan").and_then(Value::as_str)),
                        json!(row.get("status_aktif").and_then(Value::as_i64).unwrap_or(1)),
                    ],
                )
                .await?;
            }
        }
        ("holiday", "delete") => {
            let tanggal = payload.get("tanggal").and_then(Value::as_str).unwrap_or("");
            if !tanggal.is_empty() {
                turso.query_one("DELETE FROM tbl_hari_libur WHERE tanggal = ?;", vec![json!(tanggal)]).await?;
            }
        }
        ("attendance", "scan") => {
            // 1. Terapkan log_scan jika ada
            if let Some(log) = payload.get("log") {
                let timestamp_scan = log.get("timestamp_scan").and_then(Value::as_str).unwrap_or("");
                let id_karyawan = log.get("id_karyawan").and_then(Value::as_str).unwrap_or("");
                if !timestamp_scan.is_empty() && !id_karyawan.is_empty() {
                    let log_sql = r#"
                        INSERT INTO log_scan (
                            timestamp_scan, tanggal_kerja, jam_scan, id_karyawan, nama, divisi,
                            jenis_scan, status_proses, sumber_data, catatan_sistem, keterangan,
                            menit_terlambat, menit_datang_awal, id_referensi, kode_operator
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
                    "#;
                    let _ = turso.query_one(
                        log_sql,
                        vec![
                            json!(timestamp_scan),
                            json!(log.get("tanggal_kerja").and_then(Value::as_str).unwrap_or("")),
                            json!(log.get("jam_scan").and_then(Value::as_str).unwrap_or("")),
                            json!(id_karyawan),
                            json!(log.get("nama").and_then(Value::as_str).unwrap_or("")),
                            json!(log.get("divisi").and_then(Value::as_str).unwrap_or("")),
                            json!(log.get("jenis_scan").and_then(Value::as_str).unwrap_or("")),
                            json!(log.get("status_proses").and_then(Value::as_str).unwrap_or("")),
                            json!(log.get("sumber_data").and_then(Value::as_str).unwrap_or("")),
                            json!(log.get("catatan_sistem").and_then(Value::as_str)),
                            json!(log.get("keterangan").and_then(Value::as_str)),
                            json!(log.get("menit_terlambat").and_then(Value::as_i64).unwrap_or(0)),
                            json!(log.get("menit_datang_awal").and_then(Value::as_i64).unwrap_or(0)),
                            json!(log.get("id_referensi").and_then(Value::as_str)),
                            json!(log.get("kode_operator").and_then(Value::as_str)),
                        ],
                    ).await;
                }
            }

            // 2. Terapkan absensi_harian jika ada
            if let Some(att) = payload.get("attendance") {
                if !att.is_null() {
                    let id_sesi = att.get("id_sesi").and_then(Value::as_str).unwrap_or("");
                    if !id_sesi.is_empty() {
                        let att_sql = r#"
                            INSERT INTO absensi_harian (
                                tanggal, id_karyawan, nama, kelas_divisi, jam_masuk, jam_pulang,
                                status_kehadiran, status_absen, keterangan, sumber, update_terakhir,
                                menit_terlambat, menit_datang_awal, jam_kerja, lembur,
                                jam_kerja_kurang, id_shift, bulan, tahun, id_sesi, mode_tugas,
                                id_backup, id_karyawan_asal, tanggal_tugas
                            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                            ON CONFLICT(id_sesi) DO UPDATE SET
                                tanggal = excluded.tanggal,
                                id_karyawan = excluded.id_karyawan,
                                nama = excluded.nama,
                                kelas_divisi = excluded.kelas_divisi,
                                jam_masuk = excluded.jam_masuk,
                                jam_pulang = excluded.jam_pulang,
                                status_kehadiran = excluded.status_kehadiran,
                                status_absen = excluded.status_absen,
                                keterangan = excluded.keterangan,
                                sumber = excluded.sumber,
                                update_terakhir = excluded.update_terakhir,
                                menit_terlambat = excluded.menit_terlambat,
                                menit_datang_awal = excluded.menit_datang_awal,
                                jam_kerja = excluded.jam_kerja,
                                lembur = excluded.lembur,
                                jam_kerja_kurang = excluded.jam_kerja_kurang,
                                id_shift = excluded.id_shift,
                                bulan = excluded.bulan,
                                tahun = excluded.tahun,
                                mode_tugas = excluded.mode_tugas,
                                id_backup = excluded.id_backup,
                                id_karyawan_asal = excluded.id_karyawan_asal,
                                tanggal_tugas = excluded.tanggal_tugas;
                        "#;
                        let params = extract_attendance_row_params(att, id_sesi);
                        turso.query_one(att_sql, params).await?;
                    }
                }
            }
        }
        ("attendance", "create" | "update") => {
            let row = payload.get("attendance").unwrap_or(&payload);
            let id_sesi = row.get("id_sesi").and_then(Value::as_str).unwrap_or("");
            if !id_sesi.is_empty() {
                let sql = r#"
                    INSERT INTO absensi_harian (
                        tanggal, id_karyawan, nama, kelas_divisi, jam_masuk, jam_pulang,
                        status_kehadiran, status_absen, keterangan, sumber, update_terakhir,
                        menit_terlambat, menit_datang_awal, jam_kerja, lembur,
                        jam_kerja_kurang, id_shift, bulan, tahun, id_sesi, mode_tugas,
                        id_backup, id_karyawan_asal, tanggal_tugas
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(id_sesi) DO UPDATE SET
                        tanggal = COALESCE(NULLIF(excluded.tanggal, ''), absensi_harian.tanggal),
                        id_karyawan = COALESCE(NULLIF(excluded.id_karyawan, ''), absensi_harian.id_karyawan),
                        nama = COALESCE(NULLIF(excluded.nama, ''), absensi_harian.nama),
                        kelas_divisi = COALESCE(NULLIF(excluded.kelas_divisi, ''), absensi_harian.kelas_divisi),
                        jam_masuk = excluded.jam_masuk,
                        jam_pulang = excluded.jam_pulang,
                        status_kehadiran = excluded.status_kehadiran,
                        status_absen = excluded.status_absen,
                        keterangan = excluded.keterangan,
                        sumber = excluded.sumber,
                        update_terakhir = excluded.update_terakhir,
                        menit_terlambat = excluded.menit_terlambat,
                        menit_datang_awal = excluded.menit_datang_awal,
                        jam_kerja = excluded.jam_kerja,
                        lembur = excluded.lembur,
                        jam_kerja_kurang = excluded.jam_kerja_kurang,
                        id_shift = COALESCE(NULLIF(excluded.id_shift, 0), absensi_harian.id_shift),
                        bulan = COALESCE(NULLIF(excluded.bulan, ''), absensi_harian.bulan),
                        tahun = COALESCE(NULLIF(excluded.tahun, ''), absensi_harian.tahun),
                        mode_tugas = COALESCE(NULLIF(excluded.mode_tugas, ''), absensi_harian.mode_tugas),
                        id_backup = excluded.id_backup,
                        id_karyawan_asal = excluded.id_karyawan_asal,
                        tanggal_tugas = excluded.tanggal_tugas;
                "#;
                let params = extract_attendance_row_params(row, id_sesi);
                turso.query_one(sql, params).await?;
            }
        }
        ("attendance", "delete") => {
            let id_sesi = payload.get("id_sesi").and_then(Value::as_str).unwrap_or("");
            if !id_sesi.is_empty() {
                turso.query_one("DELETE FROM absensi_harian WHERE id_sesi = ?;", vec![json!(id_sesi)]).await?;
            }
        }
        ("scan-log" | "scan_log" | "log-scan" | "log_scan" | "scan", "create" | "submit") => {
            let row = payload.get("log").unwrap_or(&payload);
            let timestamp_scan = row.get("timestamp_scan").and_then(Value::as_str).unwrap_or("");
            let id_karyawan = row.get("id_karyawan").and_then(Value::as_str).unwrap_or("");
            if !timestamp_scan.is_empty() && !id_karyawan.is_empty() {
                let sql = r#"
                    INSERT INTO log_scan (
                        timestamp_scan, tanggal_kerja, jam_scan, id_karyawan, nama, divisi,
                        jenis_scan, status_proses, sumber_data, catatan_sistem, keterangan,
                        menit_terlambat, menit_datang_awal, id_referensi, kode_operator
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
                "#;
                turso.query_one(
                    sql,
                    vec![
                        json!(timestamp_scan),
                        json!(row.get("tanggal_kerja").and_then(Value::as_str).unwrap_or("")),
                        json!(row.get("jam_scan").and_then(Value::as_str).unwrap_or("")),
                        json!(id_karyawan),
                        json!(row.get("nama").and_then(Value::as_str).unwrap_or("")),
                        json!(row.get("divisi").and_then(Value::as_str).unwrap_or("")),
                        json!(row.get("jenis_scan").and_then(Value::as_str).unwrap_or("")),
                        json!(row.get("status_proses").and_then(Value::as_str).unwrap_or("")),
                        json!(row.get("sumber_data").and_then(Value::as_str).unwrap_or("")),
                        json!(row.get("catatan_sistem").and_then(Value::as_str)),
                        json!(row.get("keterangan").and_then(Value::as_str)),
                        json!(row.get("menit_terlambat").and_then(Value::as_i64).unwrap_or(0)),
                        json!(row.get("menit_datang_awal").and_then(Value::as_i64).unwrap_or(0)),
                        json!(row.get("id_referensi").and_then(Value::as_str)),
                        json!(row.get("kode_operator").and_then(Value::as_str)),
                    ],
                )
                .await?;
            }
        }
        ("scan-log" | "scan_log" | "log-scan" | "log_scan" | "scan", "delete") => {
            let id_log = payload.get("id_log").and_then(Value::as_i64);
            if let Some(id) = id_log {
                turso.query_one("DELETE FROM log_scan WHERE id_log = ?;", vec![json!(id)]).await?;
            }
        }
        ("backup" | "backup_karyawan", "create" | "update") => {
            let row = payload.get("backup").unwrap_or(&payload);
            let id_backup = row.get("id_backup").and_then(Value::as_str).unwrap_or("");
            if !id_backup.is_empty() {
                let sql = r#"
                    INSERT INTO backup_karyawan (
                        id_backup, tanggal_tugas, id_karyawan_asal, nama_karyawan_asal,
                        divisi_asal, id_shift_asal, id_karyawan_pengganti, nama_karyawan_pengganti,
                        divisi_pengganti, id_shift_normal_pengganti, id_shift_backup,
                        alasan_backup, status_tugas, kode_operator, waktu_input,
                        catatan, waktu_dibatalkan, operator_pembatalan
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(id_backup) DO UPDATE SET
                        tanggal_tugas = excluded.tanggal_tugas,
                        status_tugas = excluded.status_tugas,
                        catatan = excluded.catatan,
                        waktu_dibatalkan = excluded.waktu_dibatalkan,
                        operator_pembatalan = excluded.operator_pembatalan;
                "#;
                turso.query_one(
                    sql,
                    vec![
                        json!(id_backup),
                        json!(row.get("tanggal_tugas").and_then(Value::as_str).unwrap_or("")),
                        json!(row.get("id_karyawan_asal").and_then(Value::as_str).unwrap_or("")),
                        json!(row.get("nama_karyawan_asal").and_then(Value::as_str).unwrap_or("")),
                        json!(row.get("divisi_asal").and_then(Value::as_str).unwrap_or("")),
                        json!(row.get("id_shift_asal").and_then(Value::as_i64).unwrap_or(1)),
                        json!(row.get("id_karyawan_pengganti").and_then(Value::as_str).unwrap_or("")),
                        json!(row.get("nama_karyawan_pengganti").and_then(Value::as_str).unwrap_or("")),
                        json!(row.get("divisi_pengganti").and_then(Value::as_str).unwrap_or("")),
                        json!(row.get("id_shift_normal_pengganti").and_then(Value::as_i64).unwrap_or(1)),
                        json!(row.get("id_shift_backup").and_then(Value::as_i64).unwrap_or(1)),
                        json!(row.get("alasan_backup").and_then(Value::as_str)),
                        json!(row.get("status_tugas").and_then(Value::as_str).unwrap_or("Aktif")),
                        json!(row.get("kode_operator").and_then(Value::as_str).unwrap_or("")),
                        json!(row.get("waktu_input").and_then(Value::as_str).unwrap_or("")),
                        json!(row.get("catatan").and_then(Value::as_str)),
                        json!(row.get("waktu_dibatalkan").and_then(Value::as_str)),
                        json!(row.get("operator_pembatalan").and_then(Value::as_str)),
                    ],
                )
                .await?;
            }
        }
        ("backup" | "backup_karyawan", "cancel") => {
            let id_backup = payload.get("id_backup").and_then(Value::as_str).unwrap_or("");
            let waktu_dibatalkan = payload.get("waktu_dibatalkan").and_then(Value::as_str).unwrap_or("");
            let operator_pembatalan = payload.get("operator_pembatalan").and_then(Value::as_str).unwrap_or("");
            if !id_backup.is_empty() {
                turso.query_one(
                    "UPDATE backup_karyawan SET status_tugas = 'Dibatalkan', waktu_dibatalkan = ?, operator_pembatalan = ? WHERE id_backup = ?;",
                    vec![json!(waktu_dibatalkan), json!(operator_pembatalan), json!(id_backup)],
                ).await?;
            }
        }
        ("backup" | "backup_karyawan", "delete") => {
            let id_backup = payload.get("id_backup").and_then(Value::as_str).unwrap_or("");
            if !id_backup.is_empty() {
                turso.query_one("DELETE FROM backup_karyawan WHERE id_backup = ?;", vec![json!(id_backup)]).await?;
            }
        }
        ("correction" | "koreksi_admin", "create" | "update") => {
            let row = payload.get("correction").unwrap_or(&payload);
            let id_referensi = row.get("id_referensi").and_then(Value::as_str).unwrap_or("");
            if !id_referensi.is_empty() {
                let sql = r#"
                    INSERT INTO koreksi_admin (
                        id_referensi, tanggal, id_karyawan, nama, divisi, jenis_koreksi,
                        jam_koreksi, keterangan_admin, status_proses, timestamp, kode_operator
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(id_referensi) DO UPDATE SET
                        tanggal = excluded.tanggal,
                        jenis_koreksi = excluded.jenis_koreksi,
                        jam_koreksi = excluded.jam_koreksi,
                        keterangan_admin = excluded.keterangan_admin,
                        status_proses = excluded.status_proses,
                        timestamp = excluded.timestamp,
                        kode_operator = excluded.kode_operator;
                "#;
                turso.query_one(
                    sql,
                    vec![
                        json!(id_referensi),
                        json!(row.get("tanggal").and_then(Value::as_str).unwrap_or("")),
                        json!(row.get("id_karyawan").and_then(Value::as_str).unwrap_or("")),
                        json!(row.get("nama").and_then(Value::as_str).unwrap_or("")),
                        json!(row.get("divisi").and_then(Value::as_str).unwrap_or("")),
                        json!(row.get("jenis_koreksi").and_then(Value::as_str).unwrap_or("")),
                        json!(row.get("jam_koreksi").and_then(Value::as_str)),
                        json!(row.get("keterangan_admin").and_then(Value::as_str)),
                        json!(row.get("status_proses").and_then(Value::as_str).unwrap_or("Sudah Diproses")),
                        json!(row.get("timestamp").and_then(Value::as_str).unwrap_or("")),
                        json!(row.get("kode_operator").and_then(Value::as_str).unwrap_or("")),
                    ],
                )
                .await?;
            }

            // Terapkan absensi_harian jika disertakan dalam event koreksi
            if let Some(att) = payload.get("attendance") {
                if !att.is_null() {
                    let id_sesi = att.get("id_sesi").and_then(Value::as_str).unwrap_or("");
                    if !id_sesi.is_empty() {
                        let att_sql = r#"
                            INSERT INTO absensi_harian (
                                tanggal, id_karyawan, nama, kelas_divisi, jam_masuk, jam_pulang,
                                status_kehadiran, status_absen, keterangan, sumber, update_terakhir,
                                menit_terlambat, menit_datang_awal, jam_kerja, lembur,
                                jam_kerja_kurang, id_shift, bulan, tahun, id_sesi, mode_tugas,
                                id_backup, id_karyawan_asal, tanggal_tugas
                            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                            ON CONFLICT(id_sesi) DO UPDATE SET
                                tanggal = excluded.tanggal,
                                id_karyawan = excluded.id_karyawan,
                                nama = excluded.nama,
                                kelas_divisi = excluded.kelas_divisi,
                                jam_masuk = excluded.jam_masuk,
                                jam_pulang = excluded.jam_pulang,
                                status_kehadiran = excluded.status_kehadiran,
                                status_absen = excluded.status_absen,
                                keterangan = excluded.keterangan,
                                sumber = excluded.sumber,
                                update_terakhir = excluded.update_terakhir,
                                menit_terlambat = excluded.menit_terlambat,
                                menit_datang_awal = excluded.menit_datang_awal,
                                jam_kerja = excluded.jam_kerja,
                                lembur = excluded.lembur,
                                jam_kerja_kurang = excluded.jam_kerja_kurang,
                                id_shift = excluded.id_shift,
                                bulan = excluded.bulan,
                                tahun = excluded.tahun,
                                mode_tugas = excluded.mode_tugas,
                                id_backup = excluded.id_backup,
                                id_karyawan_asal = excluded.id_karyawan_asal,
                                tanggal_tugas = excluded.tanggal_tugas;
                        "#;
                        let params = extract_attendance_row_params(att, id_sesi);
                        let _ = turso.query_one(att_sql, params).await;
                    }
                }
            }

            // Terapkan log_scan jika disertakan dalam koreksi
            if let Some(log) = payload.get("log") {
                if !log.is_null() {
                    let timestamp_scan = log.get("timestamp_scan").and_then(Value::as_str).unwrap_or("");
                    let id_karyawan = log.get("id_karyawan").and_then(Value::as_str).unwrap_or("");
                    if !timestamp_scan.is_empty() && !id_karyawan.is_empty() {
                        let log_sql = r#"
                            INSERT INTO log_scan (
                                timestamp_scan, tanggal_kerja, jam_scan, id_karyawan, nama, divisi,
                                jenis_scan, status_proses, sumber_data, catatan_sistem, keterangan,
                                menit_terlambat, menit_datang_awal, id_referensi, kode_operator
                            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
                        "#;
                        let _ = turso.query_one(
                            log_sql,
                            vec![
                                json!(timestamp_scan),
                                json!(log.get("tanggal_kerja").and_then(Value::as_str).unwrap_or("")),
                                json!(log.get("jam_scan").and_then(Value::as_str).unwrap_or("")),
                                json!(id_karyawan),
                                json!(log.get("nama").and_then(Value::as_str).unwrap_or("")),
                                json!(log.get("divisi").and_then(Value::as_str).unwrap_or("")),
                                json!(log.get("jenis_scan").and_then(Value::as_str).unwrap_or("")),
                                json!(log.get("status_proses").and_then(Value::as_str).unwrap_or("Berhasil")),
                                json!(log.get("sumber_data").and_then(Value::as_str).unwrap_or("Koreksi Admin")),
                                json!(log.get("catatan_sistem").and_then(Value::as_str)),
                                json!(log.get("keterangan").and_then(Value::as_str)),
                                json!(log.get("menit_terlambat").and_then(Value::as_i64).unwrap_or(0)),
                                json!(log.get("menit_datang_awal").and_then(Value::as_i64).unwrap_or(0)),
                                json!(log.get("id_referensi").and_then(Value::as_str)),
                                json!(log.get("kode_operator").and_then(Value::as_str)),
                            ],
                        ).await;
                    }
                }
            }
        }
        ("correction" | "koreksi_admin", "delete") => {
            let id_referensi = payload.get("id_referensi").and_then(Value::as_str).unwrap_or("");
            if !id_referensi.is_empty() {
                let _ = turso.query_one("DELETE FROM koreksi_admin WHERE id_referensi = ?;", vec![json!(id_referensi)]).await;
                let _ = turso.query_one("DELETE FROM log_scan WHERE id_referensi = ?;", vec![json!(id_referensi)]).await;
            }
        }
        ("import_offline" | "import-offline" | "offline_import" | "offline-import", "create" | "submit" | "row" | "update" | "upsert") => {
            let row = payload.get("import").unwrap_or(&payload);
            let event_key = row.get("event_key").and_then(Value::as_str).unwrap_or("");
            if !event_key.is_empty() {
                let id_unik = row.get("id_unik").or_else(|| row.get("id_karyawan")).and_then(Value::as_str).unwrap_or("");
                let sql = r#"
                    INSERT INTO import_offline (
                        event_key, timestamp_input, tanggal, id_unik, nama, divisi,
                        jam_masuk, jam_pulang, status_kehadiran, status_absen,
                        keterangan, status_proses, diproses_pada, pesan_error, kode_operator
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Sudah Diproses', datetime('now'), '', ?)
                    ON CONFLICT(event_key) DO UPDATE SET
                        timestamp_input = COALESCE(NULLIF(excluded.timestamp_input, ''), import_offline.timestamp_input),
                        tanggal = excluded.tanggal,
                        id_unik = excluded.id_unik,
                        nama = excluded.nama,
                        divisi = excluded.divisi,
                        jam_masuk = excluded.jam_masuk,
                        jam_pulang = excluded.jam_pulang,
                        status_kehadiran = excluded.status_kehadiran,
                        status_absen = excluded.status_absen,
                        keterangan = excluded.keterangan,
                        status_proses = excluded.status_proses,
                        diproses_pada = excluded.diproses_pada,
                        pesan_error = excluded.pesan_error,
                        kode_operator = excluded.kode_operator;
                "#;
                let _ = turso.query_one(
                    sql,
                    vec![
                        json!(event_key),
                        json!(row.get("timestamp_input").and_then(Value::as_str).unwrap_or("")),
                        json!(row.get("tanggal").and_then(Value::as_str).unwrap_or("")),
                        json!(id_unik),
                        json!(row.get("nama").and_then(Value::as_str)),
                        json!(row.get("divisi").and_then(Value::as_str)),
                        json!(row.get("jam_masuk").and_then(Value::as_str)),
                        json!(row.get("jam_pulang").and_then(Value::as_str)),
                        json!(row.get("status_kehadiran").and_then(Value::as_str)),
                        json!(row.get("status_absen").and_then(Value::as_str)),
                        json!(row.get("keterangan").and_then(Value::as_str)),
                        json!(row.get("kode_operator").and_then(Value::as_str)),
                    ],
                ).await;
            }

            // Terapkan absensi_harian jika disertakan dalam event import offline
            if let Some(att) = payload.get("attendance") {
                if !att.is_null() {
                    let id_sesi = att.get("id_sesi").and_then(Value::as_str).unwrap_or("");
                    if !id_sesi.is_empty() {
                        let att_sql = r#"
                            INSERT INTO absensi_harian (
                                tanggal, id_karyawan, nama, kelas_divisi, jam_masuk, jam_pulang,
                                status_kehadiran, status_absen, keterangan, sumber, update_terakhir,
                                menit_terlambat, menit_datang_awal, jam_kerja, lembur,
                                jam_kerja_kurang, id_shift, bulan, tahun, id_sesi, mode_tugas,
                                id_backup, id_karyawan_asal, tanggal_tugas
                            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                            ON CONFLICT(id_sesi) DO UPDATE SET
                                tanggal = excluded.tanggal,
                                id_karyawan = excluded.id_karyawan,
                                nama = excluded.nama,
                                kelas_divisi = excluded.kelas_divisi,
                                jam_masuk = excluded.jam_masuk,
                                jam_pulang = excluded.jam_pulang,
                                status_kehadiran = excluded.status_kehadiran,
                                status_absen = excluded.status_absen,
                                keterangan = excluded.keterangan,
                                sumber = excluded.sumber,
                                update_terakhir = excluded.update_terakhir,
                                menit_terlambat = excluded.menit_terlambat,
                                menit_datang_awal = excluded.menit_datang_awal,
                                jam_kerja = excluded.jam_kerja,
                                lembur = excluded.lembur,
                                jam_kerja_kurang = excluded.jam_kerja_kurang,
                                id_shift = excluded.id_shift,
                                bulan = excluded.bulan,
                                tahun = excluded.tahun,
                                mode_tugas = excluded.mode_tugas,
                                id_backup = excluded.id_backup,
                                id_karyawan_asal = excluded.id_karyawan_asal,
                                tanggal_tugas = excluded.tanggal_tugas;
                        "#;
                        let params = extract_attendance_row_params(att, id_sesi);
                        let _ = turso.query_one(att_sql, params).await;
                    }
                }
            }

            // Terapkan logs jika disertakan dalam event import offline
            if let Some(logs) = payload.get("logs").and_then(Value::as_array) {
                for log in logs {
                    let timestamp_scan = log.get("timestamp_scan").and_then(Value::as_str).unwrap_or("");
                    let id_karyawan = log.get("id_karyawan").and_then(Value::as_str).unwrap_or("");
                    if !timestamp_scan.is_empty() && !id_karyawan.is_empty() {
                        let log_sql = r#"
                            INSERT INTO log_scan (
                                timestamp_scan, tanggal_kerja, jam_scan, id_karyawan, nama, divisi,
                                jenis_scan, status_proses, sumber_data, catatan_sistem, keterangan,
                                menit_terlambat, menit_datang_awal, id_referensi, kode_operator
                            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
                        "#;
                        let _ = turso.query_one(
                            log_sql,
                            vec![
                                json!(timestamp_scan),
                                json!(log.get("tanggal_kerja").and_then(Value::as_str).unwrap_or("")),
                                json!(log.get("jam_scan").and_then(Value::as_str).unwrap_or("")),
                                json!(id_karyawan),
                                json!(log.get("nama").and_then(Value::as_str).unwrap_or("")),
                                json!(log.get("divisi").and_then(Value::as_str).unwrap_or("")),
                                json!(log.get("jenis_scan").and_then(Value::as_str).unwrap_or("")),
                                json!(log.get("status_proses").and_then(Value::as_str).unwrap_or("")),
                                json!(log.get("sumber_data").and_then(Value::as_str).unwrap_or("")),
                                json!(log.get("catatan_sistem").and_then(Value::as_str)),
                                json!(log.get("keterangan").and_then(Value::as_str)),
                                json!(log.get("menit_terlambat").and_then(Value::as_i64).unwrap_or(0)),
                                json!(log.get("menit_datang_awal").and_then(Value::as_i64).unwrap_or(0)),
                                json!(log.get("id_referensi").and_then(Value::as_str)),
                                json!(log.get("kode_operator").and_then(Value::as_str)),
                            ],
                        ).await;
                    }
                }
            }
        }
        ("import_offline" | "import-offline" | "offline_import" | "offline-import", "delete") => {
            let event_key = payload.get("event_key").and_then(Value::as_str).unwrap_or("");
            if !event_key.is_empty() {
                let _ = turso.query_one("DELETE FROM import_offline WHERE event_key = ?;", vec![json!(event_key)]).await;
                let _ = turso.query_one("DELETE FROM log_scan WHERE id_referensi = ?;", vec![json!(event_key)]).await;
            }
        }
        ("company_profile" | "company-profile" | "companyProfile", "create" | "update" | "upsert") => {
            let row = payload.get("company_profile").unwrap_or(&payload);
            let id = row.get("id").and_then(Value::as_str).unwrap_or("default_company");
            let sql = r#"
                INSERT INTO company_profile (
                    id, company_name, branch_name, logo_url, signature_url, address,
                    phone, email, website, leader_name, leader_title, leader_nip,
                    card_terms, timezone, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
                ON CONFLICT(id) DO UPDATE SET
                    company_name = excluded.company_name,
                    branch_name = excluded.branch_name,
                    logo_url = excluded.logo_url,
                    signature_url = excluded.signature_url,
                    address = excluded.address,
                    phone = excluded.phone,
                    email = excluded.email,
                    website = excluded.website,
                    leader_name = excluded.leader_name,
                    leader_title = excluded.leader_title,
                    leader_nip = excluded.leader_nip,
                    card_terms = excluded.card_terms,
                    timezone = excluded.timezone,
                    updated_at = datetime('now');
            "#;
            turso.query_one(
                sql,
                vec![
                    json!(id),
                    json!(row.get("company_name").and_then(Value::as_str).unwrap_or("SPPG")),
                    json!(row.get("branch_name").and_then(Value::as_str)),
                    json!(row.get("logo_url").and_then(Value::as_str)),
                    json!(row.get("signature_url").and_then(Value::as_str)),
                    json!(row.get("address").and_then(Value::as_str)),
                    json!(row.get("phone").and_then(Value::as_str)),
                    json!(row.get("email").and_then(Value::as_str)),
                    json!(row.get("website").and_then(Value::as_str)),
                    json!(row.get("leader_name").and_then(Value::as_str)),
                    json!(row.get("leader_title").and_then(Value::as_str)),
                    json!(row.get("leader_nip").and_then(Value::as_str)),
                    json!(row.get("card_terms").and_then(Value::as_str)),
                    json!(row.get("timezone").and_then(Value::as_str).unwrap_or("Asia/Jakarta")),
                ],
            )
            .await?;
        }
        ("id_card_template" | "id-card-template" | "idCardTemplate", "create" | "update" | "upsert") => {
            let row = payload.get("id_card_template").unwrap_or(&payload);
            let id = row.get("id").and_then(Value::as_str).unwrap_or("default_template");
            let elements_json = row.get("elements_json").map(|v| if v.is_string() { v.as_str().unwrap().to_owned() } else { v.to_string() }).unwrap_or_else(|| "[]".to_owned());
            let sql = r#"
                INSERT INTO id_card_template (
                    id, name, orientation, front_bg_url, back_bg_url, elements_json,
                    is_active, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
                ON CONFLICT(id) DO UPDATE SET
                    name = excluded.name,
                    orientation = excluded.orientation,
                    front_bg_url = excluded.front_bg_url,
                    back_bg_url = excluded.back_bg_url,
                    elements_json = excluded.elements_json,
                    is_active = excluded.is_active,
                    updated_at = datetime('now');
            "#;
            turso.query_one(
                sql,
                vec![
                    json!(id),
                    json!(row.get("name").and_then(Value::as_str).unwrap_or("Template Default SPPG")),
                    json!(row.get("orientation").and_then(Value::as_str).unwrap_or("landscape")),
                    json!(row.get("front_bg_url").and_then(Value::as_str)),
                    json!(row.get("back_bg_url").and_then(Value::as_str)),
                    json!(elements_json),
                    json!(row.get("is_active").and_then(Value::as_i64).unwrap_or(1)),
                ],
            )
            .await?;
        }
        ("setting" | "settings" | "setting_gex_system" | "setting-gex-system", "create" | "update" | "upsert") => {
            let row = payload.get("setting").unwrap_or(&payload);
            let key = row.get("key").and_then(Value::as_str).unwrap_or("");
            let value = row.get("value").map(|v| if v.is_string() { v.as_str().unwrap().to_string() } else { v.to_string() }).unwrap_or_default();
            if !key.is_empty() {
                let sql = "INSERT INTO setting_gex_system (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value;";
                turso.query_one(sql, vec![json!(key), json!(value)]).await?;
            }
        }
        _ => {}
    }

    Ok(())
}

pub fn verify_password(password: &str, stored_hash: &str) -> bool {
    if stored_hash.is_empty() {
        return false;
    }

    let parts: Vec<&str> = stored_hash.split('$').collect();
    if parts.len() == 4 && parts[0] == "pbkdf2-sha256" {
        let Ok(iterations) = parts[1].parse::<u32>() else {
            return false;
        };
        let Ok(salt) = BASE64_STANDARD.decode(parts[2]) else {
            return false;
        };
        let Ok(expected_hash) = BASE64_STANDARD.decode(parts[3]) else {
            return false;
        };

        if iterations < 1_000 {
            return false;
        }

        let mut derived = vec![0u8; expected_hash.len()];
        pbkdf2_hmac::<Sha256>(password.as_bytes(), &salt, iterations, &mut derived);

        let mut diff = 0u8;
        for (a, b) in derived.iter().zip(expected_hash.iter()) {
            diff |= a ^ b;
        }
        return diff == 0 && derived.len() == expected_hash.len();
    }

    // Cek Argon2 jika format $argon2id$...
    if stored_hash.starts_with("$argon2") {
        if let Ok(parsed) = argon2::PasswordHash::new(stored_hash) {
            return argon2::Argon2::default()
                .verify_password(password.as_bytes(), &parsed)
                .is_ok();
        }
    }

    // Fallback legacy plaintext
    stored_hash == password
}

pub fn hash_password_pbkdf2_with_iterations(password: &str, iterations: u32) -> String {
    use rand_core::{OsRng, RngCore};
    let mut salt = [0u8; 16];
    OsRng.fill_bytes(&mut salt);
    let mut derived = [0u8; 32];
    pbkdf2_hmac::<Sha256>(password.as_bytes(), &salt, iterations, &mut derived);
    format!(
        "pbkdf2-sha256${}${}${}",
        iterations,
        BASE64_STANDARD.encode(salt),
        BASE64_STANDARD.encode(derived)
    )
}

pub fn hash_password_pbkdf2(password: &str) -> String {
    hash_password_pbkdf2_with_iterations(password, 600_000)
}

fn chrono_like_now_iso() -> String {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or_default();
    format!("{now}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_normalize_turso_url() {
        assert_eq!(
            normalize_turso_url("libsql://my-db.turso.io").unwrap().as_str(),
            "https://my-db.turso.io/"
        );
        assert_eq!(
            normalize_turso_url("https://my-db.turso.io/path?query=1").unwrap().as_str(),
            "https://my-db.turso.io/"
        );
        assert!(normalize_turso_url("ftp://my-db.turso.io").is_err());
        assert!(normalize_turso_url("").is_err());
    }

    #[test]
    fn test_pbkdf2_hash_and_verify() {
        let password = "MySecretPassword123!";
        let hash = hash_password_pbkdf2_with_iterations(password, 1_000);
        assert!(hash.starts_with("pbkdf2-sha256$1000$"));
        assert!(verify_password(password, &hash));
        assert!(!verify_password("WrongPassword", &hash));
    }

    #[test]
    fn test_legacy_plaintext_verify() {
        assert!(verify_password("plaintext123", "plaintext123"));
        assert!(!verify_password("plaintext123", "different"));
    }
}
