---
name: mobile-tauri
description: >-
  Specialized skill for SPPG Absensi Mobile development on Tauri v2 (Android & iOS),
  covering offline-first SQLite synchronization, camera stream lifecycle, GPS geofencing,
  safe area mobile UI design, and Next.js static exports.
---

# SPPG Absensi Mobile Development Skill & Guide

This skill documents mandatory standards, hardware guards, and architectural patterns for developing the SPPG Absensi Mobile application targeting Android (APK/AAB) and iOS via Tauri v2.

---

## 1. Zero-Drift Database Architecture
- **Private SQLite Storage**: The database resides in `app.path().app_local_data_dir()`, isolated inside the Android app sandbox (`/data/user/0/id.sppg.absensi.mobile/files/`).
- **PRAGMA Settings**:
  ```sql
  PRAGMA foreign_keys = ON;
  PRAGMA journal_mode = WAL;
  PRAGMA synchronous = NORMAL;
  PRAGMA busy_timeout = 5000;
  PRAGMA cache_size = -32000;
  ```
- **Outbox Sync**: Local mutations must enqueue records into `desktop_sync_outbox`.

---

## 2. Hardware Lifecycle & Native Integration
1. **Camera Resource Management**:
   - Always stop `MediaStreamTrack` instances when leaving the scanner screen.
   - Attach listener to `visibilitychange` to pause camera when app is backgrounded.
2. **Wake Lock Integration**:
   - Acquire `navigator.wakeLock.request('screen')` during active scanning to prevent screen dimming.
   - Release lock on component cleanup.
3. **Haptic Feedback**:
   - `navigator.vibrate(50)` on successful check-in/out.
   - `navigator.vibrate([100, 50, 100])` on scan rejection.
4. **GPS Geofence Validation**:
   - Haversine distance formula against `lat_kantor`, `lng_kantor`, `radius_meter` in `setting_gex_system`.

---

## 3. UI/UX Mobile Standard
- **Safe Area Insets**: Always apply `pt-[env(safe-area-inset-top)]` and `pb-[calc(env(safe-area-inset-bottom)+4rem)]` for bottom nav clearance.
- **Touch Target**: Minimum button size `44x44px` (`min-h-11 min-w-11`).
- **Bottom Navigation**: 5 core sections: Beranda, Scanner (elevated FAB), Riwayat, Sinkronisasi, Pengaturan.

---

## 4. Verification Checklist
Run before committing any changes:
```bash
bun run check
```
Ensures 0 Biome linter errors, 0 TypeScript errors, 100% Bun tests passed, and 100% Rust cargo tests passed.
