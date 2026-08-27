//! Share sheet khusus Mobile.
//!
//! Modul ini SENGAJA berada di luar file yang disalin oleh
//! `scripts/sync-rust-modules.ts` (`commands.rs`, `operational.rs`,
//! `administration.rs`, `scanner.rs`, `sync.rs`). Perintah ini tidak punya
//! padanan di Desktop, jadi kalau ditaruh di `commands.rs` ia akan terhapus
//! setiap kali sinkronisasi dari `web-desktop` dijalankan.

use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine};
use serde_json::{json, Value};

use super::models::CommandError;

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
