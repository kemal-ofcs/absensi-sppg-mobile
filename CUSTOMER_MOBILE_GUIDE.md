# Panduan Distribusi & Instalasi Customer — Mobile Android (APK) Absensi SPPG

Dokumen ini adalah panduan lengkap kompilasi, persiapan environment, instalasi, dan pemberian izin aplikasi **Absensi SPPG Mobile (Android APK)** untuk diserahkan kepada customer/klien.

---

## 1. Spesifikasi Teknis & Arsitektur Mobile

Aplikasi mobile Absensi SPPG dibangun dengan arsitektur native hybrid berperforma tinggi:
- **Core Native Backend**: Rust 1.85+ (Tauri v2 Mobile Engine) dengan SQLite lokal (`rusqlite`) berformat WAL (Write-Ahead Logging).
- **Keamanan Kredensial Offline**: Enkripsi Vault **AES-256-GCM** dengan key derivation **Argon2id**.
- **Jaringan & TLS**: HTTP Client `reqwest` terkonfigurasi dengan `webpki-roots` (Mozilla Root CAs) untuk kompatibilitas penuh di Android.
- **Frontend / UI**: Next.js 16 (Static Export), React 19, Tailwind CSS v4, ZXing QR Scanner Engine, Native Haptics & Sound Synthesis.
- **Kompatibilitas Android**: Android 7.0 (Nougat / API Level 24) hingga Android 15 (Vanilla Ice Cream / API Level 35). Dioptimalkan khusus untuk chipset **ARM64 (POCO, Xiaomi, Samsung, Oppo, Vivo, Realme, Infinix, dll)**.

---

## 2. Prasyarat Lingkungan Build (Developer Machine)

Sebelum mengompilasi APK untuk customer, pastikan lingkungan pengembang telah terpasang:
1. **Bun runtime**: `bun >= 1.3.0`
2. **Rust & Cargo**: Rust toolchain stable dengan target Android:
   ```powershell
   rustup target add aarch64-linux-android armv7-linux-androideabi x86_64-linux-android
   ```
3. **Android SDK & NDK**:
   - Android SDK Platform 34 atau 35
   - NDK versi `30.0.15729638` (atau NDK 26+)
   - Java Development Kit (JDK 17 atau 21)
4. **Environment Variables Sistem**:
   - `ANDROID_HOME` = `C:\Users\<User>\AppData\Local\Android\Sdk`
   - `NDK_HOME` = `$env:ANDROID_HOME\ndk\<versi-ndk>`
   - `JAVA_HOME` = Path direktori JDK 17/21

---

## 3. Konfigurasi Environment Khusus Customer

Setiap file APK dikompilasi terikat (*hard-locked*) ke origin server API customer tersebut untuk alasan keamanan.

Buka file `mobile/.env` atau set environment variable di terminal sebelum kompilasi:

```ini
# URL Domain Server Produksi Customer (Wajib HTTPS tanpa trailing slash)
SPPG_API_BASE_URL=https://absensi.pt-abc.com

# Masa berlaku sesi offline yang disetujui (1-720 jam, default: 720 = 30 hari)
SPPG_OFFLINE_AUTH_MAX_AGE_HOURS=720

# Runtime Target (Wajib mobile)
SPPG_BUILD_TARGET=mobile
NEXT_PUBLIC_SPPG_RUNTIME=mobile
```

> [!CAUTION]
> **JANGAN PERNAH** menaruh token Turso (`TURSO_AUTH_TOKEN`) di dalam file `.env` mobile atau client build! APK mobile hanya berkomunikasi melalui secure Route Handler API backend Next.js customer.

---

## 4. Perintah Kompilasi Build APK Release

Masuk ke direktori `mobile/` dan pilih tipe build sesuai kebutuhan customer:

### 4.1 Build Cepat untuk Perangkat Modern ARM64 (Rekomendasi Utama)
Digunakan untuk smartphone modern (Xiaomi, POCO, Samsung, Vivo, Oppo keluaran 2018 ke atas). Ukuran APK sangat ringkas dan proses kompilasi paling cepat.

```powershell
cd e:\Freelance\absensi-sppg-app\mobile
bun run tauri:android:build:arm64
```
**Lokasi Output APK:**
`mobile/src-tauri/gen/android/app/build/outputs/apk/universal/release/app-universal-release.apk`
*(Rename file ini menjadi: `Absensi-SPPG-v0.1.0-PT-ABC-arm64.apk`)*

### 4.2 Build Split Multi-ABI (Untuk Beragam Perangkat Karyawan)
Menghasilkan APK individual untuk masing-masing arsitektur CPU (arm64-v8a, armeabi-v7a, x86_64).

```powershell
bun run tauri:android:build:split
```

### 4.3 Build Universal APK
Menghasilkan satu APK tunggal yang mendukung seluruh chipset Android (ukuran file lebih besar).

```powershell
bun run tauri:android:build
```

---

## 5. Prosedur Instalasi di Smartphone Android Customer

Berikan file APK kepada customer (misalnya via WhatsApp Document, Google Drive, atau kabel USB) dan berikan panduan instalasi berikut:

### 5.1 Mengaktifkan Izin Instalasi Sumber Tidak Dikenal
1. Buka file APK `Absensi-SPPG-v0.1.0-PT-ABC-arm64.apk` di HP Android.
2. Jika muncul peringatan *"Demi keamanan, ponsel Anda tidak diizinkan menginstal aplikasi tidak dikenal dari sumber ini"*:
   - Ketuk **Setelan (Settings)**.
   - Aktifkan toggle **Izinkan dari sumber ini (Allow from this source)**.
   - Kembali dan ketuk **Instal (Install)**.
3. Tunggu hingga proses instalasi selesai, lalu ketuk **Buka (Open)**.

---

## 6. Pengaturan Izin Krusial (Permissions Setup)

Agar seluruh fitur scanner, GPS geofencing, getaran, dan sinkronisasi background berjalan sempurna, pandu customer untuk mengaktifkan izin berikut:

### 6.1 Izin Kamera (Camera Permission)
- **Kapan Diminta**: Saat pertama kali menekan tombol *"Buka Kamera"* di tab Scanner.
- **Pilihan Wajib**: Pilih **"Saat aplikasi digunakan" (While using the app)**.

### 6.2 Izin Lokasi Presisi (Precise GPS Geofencing)
- **Kapan Diminta**: Saat pertama kali scan atau membuka menu Scanner/Settings.
- **Pilihan Wajib**:
  - Pilih **"Saat aplikasi digunakan"**.
  - Pastikan opsi **"Akurat / Tepat" (Precise Location)** dalam posisi AKTIF (bukan perkiraan/approximate) agar titik radius kantor terbaca akurat.

### 6.3 Pengaturan Hemat Baterai (Unrestricted Battery)
- Buka **Pengaturan HP → Aplikasi → Kelola Aplikasi → Absensi SPPG**.
- Pilih menu **Penghemat Baterai (Battery Saver)** → Ubah ke **"Tidak ada pembatasan" (No restrictions)**.
- *Tujuan*: Mencegah sistem Android mematikan proses sinkronisasi absensi saat HP terkunci atau layar mati.

---

## 7. Checklist Uji Kelayakan (Acceptance Checklist) Sebelum Serah Terima

Lakukan pengujian akhir pada HP fisik sebelum serahkan ke customer:

| No | Komponen Uji | Prosedur | Kriteria Lolos |
| :---: | :--- | :--- | :--- |
| 1 | **Login Online** | Masukkan username & password operator | Berhasil masuk ke Dashboard, muncul toast *"Akses offline diperbarui"* |
| 2 | **Kamera Scanner** | Buka tab *Scanner* → Ketuk *Buka Kamera* | Feed kamera belakang langsung aktif, laser pemindai muncul, lampu senter (torch) dapat dinyalakan |
| 3 | **Haptics & Suara** | Lakukan scan QR test karyawan | HP bergetar pendek (haptic vibration), terdengar nada beep sukses, dan nama karyawan dibacakan suara |
| 4 | **GPS Geofencing** | Scan saat berada di radius kantor | Absensi diterima status *Masuk Tepat Waktu* |
| 5 | **Anti Double-Scan** | Scan QR yang sama berturut-turut dalam 10 detik | Scan kedua diabaikan/ditolak (proteksi cooldown aktif) |
| 6 | **Mode Full Offline** | Aktifkan *Mode Pesawat (Airplane Mode)*, tutup aplikasi, buka kembali, dan login | Login offline berhasil via Vault AES-256-GCM |
| 7 | **Scan Offline** | Scan QR karyawan saat Mode Pesawat | Absensi tercatat di SQLite lokal, antrean outbox bertambah |
| 8 | **Auto-Sync Kembali** | Matikan Mode Pesawat (koneksi pulih) | Data absensi outbox otomatis terunggah ke Cloud Server dalam hitungan detik |
| 9 | **Menu Operasional** | Buka tab *Operasional* (Koreksi Admin & Backup) | Form terbuka lancar dan tersimpan ke SQLite lokal |
| 10 | **Logout & Keamanan** | Buka tab *Pengaturan* → *Keluar dari Akun* | Sesi terhapus aman dari memori dan kembali ke form login |

---

## 8. Troubleshooting Masalah Mobile Umum

- **Penyebab Kamera Blank Hitam**: Izin kamera ditolak di setelan aplikasi Android. Buka *Pengaturan HP → Aplikasi → Absensi SPPG → Izin → Kamera → Izinkan*.
- **Penyebab Scan Gagal "Lokasi Di Luar Jangkauan Kantor"**: GPS HP dalam mode hemat daya atau berada di dalam gedung tebal. Buka Google Maps sebentar agar GPS mengunci satelit, lalu lakukan scan ulang.
- **Penyebab Error "Origin Server Ditolak"**: APK dibuild dengan URL server yang berbeda dengan domain backend aktif. Pastikan `SPPG_API_BASE_URL` sama persis dengan domain Vercel customer.
