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

pub fn share_desktop_file(
    filename: &str,
    base64_data: &str,
    title: Option<&str>,
) -> Result<Value, CommandError> {
    let bytes = decode_base64(base64_data)
        .ok_or_else(|| CommandError::new("SHARE_FAILED", "Format base64 file tidak valid."))?;

    let sanitized_filename = filename.replace(['/', '\\', ':', '*', '?', '"', '<', '>', '|'], "_");
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
    use tauri_plugin_android_fs::AndroidFsExt;

    let bytes = std::fs::read(source_path).map_err(|error| {
        CommandError::new(
            "BACKUP_READ_FAILED",
            format!("Berkas cadangan tidak dapat dibaca: {error}"),
        )
    })?;

    // Versi asinkron, bukan `android_fs()`. Dialognya menunggu interaksi
    // manusia — memblokir thread runtime selama itu akan membekukan seluruh
    // antarmuka, termasuk dialog yang sedang ditunggu.
    let api = app.android_fs_async();
    let uri = api
        .picker()
        .save_file(None, file_name, Some("application/octet-stream"), false)
        .await
        .map_err(|error| {
            CommandError::new(
                "BACKUP_SAVE_FAILED",
                format!("Pemilih lokasi tidak dapat dibuka: {error}"),
            )
        })?;

    let Some(uri) = uri else {
        // Pengguna menutup dialog. Bukan kegagalan.
        return Ok(false);
    };

    api.write(&uri, &bytes).await.map_err(|error| {
        CommandError::new(
            "BACKUP_SAVE_FAILED",
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
    use super::{decode_base64, share_desktop_file};

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
