//! Share sheet khusus Mobile.
//!
//! Modul ini SENGAJA berada di luar file yang disalin oleh
//! `scripts/sync-rust-modules.ts` (`commands.rs`, `operational.rs`,
//! `administration.rs`, `scanner.rs`, `sync.rs`). Perintah ini tidak punya
//! padanan di Desktop, jadi kalau ditaruh di `commands.rs` ia akan terhapus
//! setiap kali sinkronisasi dari `web-desktop` dijalankan.

use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine};
use serde_json::{json, Value};
use tauri::State;

use super::config::MobileState;
use super::models::CommandError;
use super::{portability, storage};

fn decode_base64(input: &str) -> Option<Vec<u8>> {
    let clean = if let Some(idx) = input.find(";base64,") {
        &input[idx + 8..]
    } else if let Some(idx) = input.find(',') {
        &input[idx + 1..]
    } else {
        input.trim()
    };
    let clean: String = clean.chars().filter(|c| !c.is_whitespace()).collect();
    BASE64_STANDARD.decode(&clean).ok()
}

/// Buang karakter yang tidak sah di nama berkas pada Windows, Android, dan SAF.
fn nama_berkas_aman(filename: &str) -> String {
    let aman = filename
        .trim()
        .replace(['/', '\\', ':', '*', '?', '"', '<', '>', '|'], "_");
    if aman.is_empty() {
        "berkas".to_owned()
    } else {
        aman
    }
}

/// Jenis MIME untuk dialog "Simpan ke…".
///
/// Petunjuk dari frontend dipakai bila bentuknya wajar (`jenis/subjenis`);
/// selain itu ditebak dari ekstensi. Jenis yang tepat membuat Android
/// menawarkan aplikasi pembuka yang benar untuk berkas hasil simpan.
// Di luar Android berkas diteruskan ke `save_desktop_file`, yang tidak butuh
// jenis MIME — fungsi ini hanya dipakai cabang Android dan tesnya.
#[cfg_attr(not(target_os = "android"), allow(dead_code))]
fn mime_berkas(file_name: &str, hint: Option<&str>) -> String {
    if let Some(hint) = hint.map(str::trim) {
        if hint.contains('/') && !hint.contains(char::is_whitespace) {
            return hint.to_owned();
        }
    }
    let ekstensi = file_name
        .rsplit_once('.')
        .map(|(_, ext)| ext.to_ascii_lowercase())
        .unwrap_or_default();
    match ekstensi.as_str() {
        "xlsx" => "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "csv" => "text/csv",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        "pdf" => "application/pdf",
        "json" => "application/json",
        "txt" => "text/plain",
        _ => "application/octet-stream",
    }
    .to_owned()
}

pub fn share_desktop_file(
    filename: &str,
    base64_data: &str,
    title: Option<&str>,
) -> Result<Value, CommandError> {
    let bytes = decode_base64(base64_data)
        .ok_or_else(|| CommandError::new("SHARE_FAILED", "Format base64 file tidak valid."))?;

    let sanitized_filename = nama_berkas_aman(filename);
    let share_dir = std::env::temp_dir().join("sppg_share");
    if !share_dir.exists() {
        let _ = std::fs::create_dir_all(&share_dir);
    }
    let target_path = share_dir.join(&sanitized_filename);
    std::fs::write(&target_path, &bytes).map_err(|e| {
        CommandError::new(
            "SHARE_FAILED",
            format!("Gagal menyiapkan file untuk dibagikan: {e}"),
        )
    })?;

    Ok(json!({
        "sukses": true,
        "path": target_path.to_string_lossy().to_string(),
        "filename": sanitized_filename,
        "title": title.unwrap_or("ID Card SPPG")
    }))
}

/// Nama command dipertahankan persis seperti sebelumnya karena frontend
/// memanggilnya lewat `invoke("desktop_share_file", ...)` di
/// `src/lib/client/share.ts`.
#[tauri::command]
pub fn desktop_share_file(
    filename: String,
    base64_data: String,
    title: Option<String>,
) -> Result<Value, CommandError> {
    share_desktop_file(&filename, &base64_data, title.as_deref())
}

/// Keluarkan cadangan database, lalu serahkan ke pemilih "Simpan ke…" Android.
///
/// Ini menggantikan penulisan langsung ke `/storage/emulated/0/Download`, yang
/// sejak Android 10 (scoped storage) DITOLAK: berkasnya tetap dibuat di folder
/// privat aplikasi, pengguna tidak pernah menemukannya, dan satu-satunya
/// petunjuk adalah kalimat maaf di layar. Storage Access Framework membalik
/// keadaannya — penggunalah yang memilih tujuannya, termasuk Drive atau
/// penyimpanan lain, dan izin diberikan per berkas tanpa permission manifest
/// apa pun.
///
/// Frontend TIDAK menyerahkan path apa pun ke sini. Perintah ini mengekspor
/// sendiri lalu langsung menyerahkan hasilnya, sehingga tidak ada jalan bagi
/// pemanggil untuk menunjuk berkas lain di dalam folder data aplikasi.
///
/// Balasan `savedToDevice: false` berarti pengguna menutup dialognya — itu
/// pembatalan, bukan kegagalan, dan UI wajib memperlakukannya begitu.
#[tauri::command]
pub async fn mobile_export_database_to_device(
    app: tauri::AppHandle,
    state: State<'_, MobileState>,
    passphrase: Option<String>,
) -> Result<Value, CommandError> {
    let operator = super::commands::require_permission(&state, "database_backup.export")?;
    let report = portability::export_database(&state, passphrase.as_deref())?;

    let saved = simpan_ke_perangkat(&app, &report.path, &report.file_name).await?;

    storage::audit(
        &state.data_dir,
        Some(operator.id),
        if saved {
            "database-export-saved-to-device"
        } else {
            "database-export-save-cancelled"
        },
        Some(&report.file_name),
    );

    Ok(json!({
        "path": report.path,
        "fileName": report.file_name,
        "sizeBytes": report.size_bytes,
        "encrypted": report.encrypted,
        "savedToDevice": saved,
    }))
}

/// Simpan berkas buatan frontend (ekspor Excel/CSV, gambar ID card, QR,
/// template impor) lewat pemilih "Simpan ke…" Android.
///
/// Menggantikan `desktop_save_file` di Android, yang menulis ke folder Unduhan:
/// sejak Android 10 penulisan itu ditolak atau jatuh ke folder privat aplikasi,
/// sementara pemanggilnya tetap melapor sukses. Di sini penggunalah yang
/// memilih tujuannya, jadi tidak ada path yang bisa diserahkan frontend.
///
/// Balasan `savedToDevice: false` berarti pengguna menutup dialog — itu
/// PEMBATALAN, bukan kegagalan, dan UI wajib memperlakukannya begitu.
///
/// Pada build non-Android (iOS, dan host saat `cargo test`) perilakunya tetap
/// seperti sebelumnya: diteruskan ke `save_desktop_file`.
#[tauri::command]
pub async fn mobile_save_file_to_device(
    app: tauri::AppHandle,
    filename: String,
    base64_data: String,
    mime_type: Option<String>,
) -> Result<Value, CommandError> {
    let file_name = nama_berkas_aman(&filename);
    simpan_berkas(&app, &file_name, &base64_data, mime_type.as_deref()).await
}

#[cfg(target_os = "android")]
async fn simpan_berkas(
    app: &tauri::AppHandle,
    file_name: &str,
    base64_data: &str,
    mime_type: Option<&str>,
) -> Result<Value, CommandError> {
    let bytes = decode_base64(base64_data).ok_or_else(|| {
        CommandError::new("DEVICE_SAVE_FAILED", "Format base64 berkas tidak valid.")
    })?;
    let mime = mime_berkas(file_name, mime_type);
    let saved = tulis_lewat_dialog(app, &bytes, file_name, &mime, "DEVICE_SAVE_FAILED").await?;
    Ok(json!({ "savedToDevice": saved, "fileName": file_name }))
}

#[cfg(not(target_os = "android"))]
async fn simpan_berkas(
    _app: &tauri::AppHandle,
    file_name: &str,
    base64_data: &str,
    _mime_type: Option<&str>,
) -> Result<Value, CommandError> {
    let hasil = super::operational::save_desktop_file(file_name, base64_data)?;
    Ok(json!({
        "savedToDevice": true,
        "fileName": hasil.get("filename").cloned().unwrap_or_else(|| json!(file_name)),
        "path": hasil.get("path").cloned().unwrap_or(Value::Null),
    }))
}

/// Buka dialog SAF lalu tulis isinya ke tujuan yang dipilih pengguna.
///
/// Dipisahkan supaya cabang non-Android hanya ada di satu tempat. Workspace
/// mobile ini juga dikompilasi untuk host saat `cargo test`, jadi seluruh
/// modul wajib tetap dapat dibangun tanpa plugin Android-nya.
#[cfg(target_os = "android")]
async fn simpan_ke_perangkat(
    app: &tauri::AppHandle,
    source_path: &str,
    file_name: &str,
) -> Result<bool, CommandError> {
    let bytes = std::fs::read(source_path).map_err(|error| {
        CommandError::new(
            "BACKUP_READ_FAILED",
            format!("Berkas cadangan tidak dapat dibaca: {error}"),
        )
    })?;
    tulis_lewat_dialog(
        app,
        &bytes,
        file_name,
        "application/octet-stream",
        "BACKUP_SAVE_FAILED",
    )
    .await
}

/// Inti dialog "Simpan ke…" yang dipakai cadangan database maupun berkas
/// ekspor. `Ok(false)` = pengguna menutup dialog.
#[cfg(target_os = "android")]
async fn tulis_lewat_dialog(
    app: &tauri::AppHandle,
    bytes: &[u8],
    file_name: &str,
    mime: &str,
    // `CommandError::new` menyimpan kodenya sebagai `&'static str`.
    kode_error: &'static str,
) -> Result<bool, CommandError> {
    use tauri_plugin_android_fs::AndroidFsExt;

    // Versi asinkron, bukan `android_fs()`. Dialognya menunggu interaksi
    // manusia — memblokir thread runtime selama itu akan membekukan seluruh
    // antarmuka, termasuk dialog yang sedang ditunggu.
    let api = app.android_fs_async();
    let uri = api
        .picker()
        .save_file(None, file_name, Some(mime), false)
        .await
        .map_err(|error| {
            CommandError::new(
                kode_error,
                format!("Pemilih lokasi tidak dapat dibuka: {error}"),
            )
        })?;

    let Some(uri) = uri else {
        // Pengguna menutup dialog. Bukan kegagalan.
        return Ok(false);
    };

    api.write(&uri, bytes).await.map_err(|error| {
        CommandError::new(
            kode_error,
            format!("Berkas tidak dapat ditulis ke lokasi pilihan: {error}"),
        )
    })?;
    Ok(true)
}

#[cfg(not(target_os = "android"))]
async fn simpan_ke_perangkat(
    _app: &tauri::AppHandle,
    _source_path: &str,
    _file_name: &str,
) -> Result<bool, CommandError> {
    Err(CommandError::new(
        "BACKUP_SAVE_UNSUPPORTED",
        "Dialog simpan berkas hanya tersedia pada build Android.",
    ))
}

#[cfg(test)]
mod tests {
    use super::{decode_base64, mime_berkas, nama_berkas_aman, share_desktop_file};

    #[test]
    fn mime_mengikuti_petunjuk_yang_wajar_lalu_ekstensi() {
        assert_eq!(mime_berkas("a.csv", Some("text/csv")), "text/csv");
        // Petunjuk rusak diabaikan, jatuh ke tebakan dari ekstensi.
        assert_eq!(
            mime_berkas("Rekap.XLSX", Some("bukan mime")),
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        );
        assert_eq!(mime_berkas("qr.png", None), "image/png");
        assert_eq!(
            mime_berkas("tanpa-ekstensi", Some("")),
            "application/octet-stream"
        );
    }

    #[test]
    fn nama_berkas_kosong_tetap_punya_nama() {
        assert_eq!(nama_berkas_aman("   "), "berkas");
        assert_eq!(nama_berkas_aman("Rekap: 01/09"), "Rekap_ 01_09");
    }

    #[test]
    fn base64_diterima_dengan_maupun_tanpa_prefix_data_url() {
        assert_eq!(decode_base64("aGFsbw==").as_deref(), Some(&b"halo"[..]));
        assert_eq!(
            decode_base64("data:image/png;base64,aGFsbw==").as_deref(),
            Some(&b"halo"[..])
        );
        assert!(decode_base64("bukan base64!!").is_none());
    }

    #[test]
    fn nama_file_berbahaya_disanitasi_sebelum_ditulis() {
        let hasil = share_desktop_file("../../etc/passwd", "aGFsbw==", None)
            .expect("penulisan file share gagal");
        assert_eq!(hasil["filename"], ".._.._etc_passwd");
        assert_eq!(hasil["title"], "ID Card SPPG");
    }
}
