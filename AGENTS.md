<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# SPPG Absensi Mobile (Android & iOS) - Core Engineering Rules

1. **Quality Gate**: Every task must pass `bun run check` (Biome linter, TypeScript strict typecheck, Bun tests, and Rust cargo tests) with 0 errors and 0 warnings. Format issues can be auto-resolved with `bun run format`.
2. **Anti-Asumsi & Single Source of Truth**:
   - DILARANG berasumsi. WAJIB memeriksa struktur kode, nama tabel, kolom skema, dan helper/fungsi yang sudah ada (`grep_search` / `view_file`) sebelum menulis kode baru.
   - Tidak boleh membuat fungsi duplikat atau memanggil nama fungsi/kolom yang tidak sesuai kontrak asli.
3. **Pelestarian Arsitektur Lama & Wajib Konfirmasi Perubahan**:
   - DIWAJIBKAN untuk mempertahankan dan TIDAK mengubah/menghapus struktur maupun arsitektur lama yang sudah berjalan stabil.
   - Jika terdapat kebutuhan perubahan arsitektur atau breaking change, WAJIB meminta konfirmasi dan persetujuan User terlebih dahulu sebelum dieksekusi.
4. **Tri-Platform Schema Synchronization (Zero-Drift)**:
   - When creating or modifying tables/columns, you MUST update all schemas simultaneously: Web Turso (`src/lib/db-schema.ts`), Desktop & Mobile SQLite (`src-tauri/src/mobile/storage.rs`), and Sync Contracts.
5. **Next.js Static Export Compatibility (`output: "export"`)**:
   - Tauri Mobile builds rely strictly on `output: "export"`. Route handlers in `src/app/api/` must NEVER export a `GET` handler (which breaks static exports).
   - All data fetching on Mobile is done directly via Tauri IPC invokes (`invokeDesktop` / `invokeMobile`) or client-side fetch.
6. **Mobile Hardware Lifecycle & Battery Guards**:
   - **Camera Stream Auto-Release**: Stop all media stream tracks immediately on unmount or tab visibility change to avoid camera lock and battery drain.
   - **Wake Lock API**: Request screen keep-alive only while active in the scanner view.
   - **Haptic Vibration Feedback**: Trigger tactile feedback on scan events (`50ms` on success, pattern `[100, 50, 100]` on error).
   - **Dual-Tier Geolocation**: Cache GPS coordinates for 60s to ensure instantaneous 0ms scan submissions without blocking GPS hardware queries.
7. **Mobile UI/UX Ergonomics**:
   - Support Safe Area Insets (`env(safe-area-inset-top)`, `env(safe-area-inset-bottom)`).
   - Minimum touch-target size: `44x44px`.
   - Prevent virtual keyboard overlap and keep bottom navigation accessible.
   - In dialogs/modals (`Modal`), callback props (`onClose`) MUST be stabilized via `useRef` (`onCloseRef.current = onClose`) to prevent event listener churn on each keystroke and prevent focus-stealing bugs.
8. **Immersive 3D & Motion UI on Android/iOS WebView**:
   - **Approved stack only**: `three` + `@react-three/fiber` (v9+) + `@react-three/drei`, `@splinetool/react-spline`, `motion` (Framer Motion), `@rive-app/react-canvas`, `detect-gpu`, `zustand`, Draco / `@gltf-transform/*` (devDependency only), plus vendored Aceternity UI & Magic UI. Same pinned versions as `web-desktop/`. Anything else needs explicit USER approval.
   - **Never mount a `<Canvas>`/Spline scene while the scanner camera is live.** GPU video decoding plus 3D rendering overheats mid-range Android devices, drops frames, and can kill the camera stream — the exact regression rule 4.7 exists to prevent. Scanner decoration is limited to Motion/CSS 2D effects.
   - **Hardware gate is mandatory**: `detect-gpu` once at startup → tier `high|medium|low|off` (fallback `low`), plus a real WebGL guard and a 2D fallback. Mobile budget: `dpr` max `[1, 1.5]`, `antialias: false`, `shadows={false}`, particles ≤ 1200, `frameloop="demand"`, loop stopped on `visibilitychange`/blur, auto-downgrade one tier after 3s below target FPS.
   - **Zero CDN, small APK**: bundle every `.glb`/`.riv`/`.wasm`/decoder/benchmark in `mobile/public/3d/` (create the dir) and override each library's CDN default. Max 800 KB per scene, 3 MB total; report APK growth above 5 MB to the USER. Models must pass through Draco/GLTF-Transform first.
   - **Memory**: one live WebGL context at a time; on unmount dispose geometry/material/texture, call `gl.dispose()` and `forceContextLoss()`, and handle `webglcontextlost`. Cleanup lives in its own `useEffect` with an empty dependency array, exactly like the camera rule.
   - **Touch ergonomics**: no pointer-tracking 3D tilt on primary interactive elements (scan button, list rows, form fields); keep `44x44px` targets; glow/aurora/meteor effects must never cover the bottom nav or safe-area insets; avoid heavy `backdrop-filter` behind long scrolling lists.
   - Visual tier lives in `localStorage` (`sppg.visual.tier`), never in a synced table. `src/components/visual/` and `src/lib/stores/` are generated copies from `web-desktop/` — register them in `scripts/sync-frontend-lib.ts` and never hand-edit them. Full contract: `.agents/skills/absensi-sppg-rules/references/07-immersive-3d-ui-ux.md`.
9. **Light/Dark Theme Harmony & Symmetric Tone Inversion**:
   - **Base JSX is Dark Mode**: Always use dark base classes (`bg-slate-900`, `bg-slate-950`, `text-white`, `text-slate-400`, `border-white/10`). NEVER put inline light base classes (`bg-white dark:...`).
   - **Mobile Variable Inversion**: Light mode is handled via `:root[data-theme="light"]` CSS variables. When adding accent text (`text-amber-100`, etc.), ensure matching variables (`--color-amber-100: #78350f`, etc.) are mapped so text is never pale/invisible against light surfaces.
   - **Semantic Classes for Critical Elements**: Critical components (recovery code pills, bootstrap panels, modals) MUST carry dedicated semantic classes with explicit styles for both themes.
10. **Mode Database Lokal (offline-first tanpa server)**:
   - Provider ada **TIGA**, bukan dua: `turso`, `self_hosted`, dan `local_file`. Nilainya disimpan eksplisit di `TursoConfig.provider` dan TIDAK PERNAH ditebak dari bentuk URL. `normalize_database_url` di `turso.rs` adalah satu-satunya gerbangnya.
   - Pada `local_file` yang ditukar hanya **transport**-nya (`LocalTransport` di `sql_backend.rs`), bukan SQL-nya. `ensure_schema()` yang sama membangun database cloud maupun berkas lokal, sehingga drift antara keduanya mustahil secara struktural.
   - Perangkat memegang **DUA berkas terpisah**: `desktop-security.db` (operasional + outbox) dan `sppg-hub.db` (berperan sebagai cloud). Mutasi lokal hanya menyentuh yang pertama; hub baru terisi lewat `push_outbox`.
   - `export_database` dan promosi ke cloud sama-sama membaca **hub**. Outbox yang tidak terkuras berarti cadangan dan migrasi kehilangan data tanpa satu pun pesan error — karena itu mesin sinkronisasi TETAP WAJIB berjalan di mode lokal.
   - Formulir provisioning mode ini sengaja tidak punya kolom alamat, jadi provider WAJIB ditentukan SEBELUM alamat kosong ditolak.
11. **Android Scoped Storage & Perintah Khusus Mobile**:
   - DILARANG menulis langsung ke `/storage/emulated/0/Download`. Sejak Android 10 penulisan itu ditolak dan gagal secara DIAM: berkas tetap dibuat di folder privat, pemanggil melapor sukses, pengguna tidak pernah menemukannya.
   - Berkas untuk pengguna diserahkan lewat dialog Storage Access Framework (`tauri-plugin-android-fs`, di-`cfg` khusus Android). WAJIB `android_fs_async()`, bukan `android_fs()` — dialognya menunggu manusia dan memblokir thread runtime akan membekukan antarmuka termasuk dialog itu sendiri. Pengguna yang menutup dialog adalah PEMBATALAN, bukan kegagalan.
   - Perintah yang hanya ada di biner Mobile hidup di modul di luar daftar salin `sync-rust-modules.ts` dan namanya WAJIB berawalan `mobile_`; di gateway bersama dipanggil dari dalam blok `if (isMobileRuntime()) { … }` (guard POSITIF). Keduanya adalah bentuk yang dikenali `audit:contract`.
   - Administrasi payroll (rate gaji, komponen, aturan lembur/PPh 21/BPJS, batch & persetujuan) memakai `src-tauri/src/mobile/payroll_admin/` — SALINAN `desktop/payroll/*` hasil `sync-rust-modules.ts`, dengan 23 command `desktop_*` bernama asli. Jangan menyunting salinannya; ubah versi `web-desktop` lalu jalankan skripnya.
12. **Pemulihan Password: TIGA jalur, jangan asumsikan email**:
   - Jalurnya `email`, `in_app` (persetujuan peninjau), dan kode pemulihan cetak. Pemilihnya `password_reset_route` / `resolvePasswordResetRoute`; nilai eksplisit di `setting_gex_system` menang lebih dulu, baru `app_mail_config.is_active` sebagai bawaan — urutan ini tidak boleh dibalik.
   - Pada jalur `in_app`, `verify` TIDAK membuat token; token lahir di layar peninjau saat `approve`. Versi yang selalu mengirim email membuat "Lupa Password" mati total di setiap pemasangan tanpa konfigurasi email.
   - `password_reset.approve` masuk `SENSITIVE_MUTATION_PERMISSIONS` bersama `password_reset.delete`.
   - `generateRecoveryCodes`/`normalizeRecoveryCode` (TS) dan padanan Rust-nya wajib tetap identik, termasuk membuang setiap karakter non-alfanumerik.
