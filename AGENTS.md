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
