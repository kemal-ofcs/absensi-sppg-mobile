import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const desktopDir = join(__dirname, "../../web-desktop/src-tauri/src/desktop");
const mobileDir = join(__dirname, "../src-tauri/src/mobile");

const filesToSync = [
  "sync.rs",
  "operational.rs",
  "administration.rs",
  "scanner.rs",
  "commands.rs",
  // Tarif default payroll: satu sumber untuk SQLite lokal dan Turso cloud, di
  // kedua workspace. Perbedaan sekecil apa pun di sini membuat baris seed lokal
  // terdorong ke cloud dan menggandakan bracket pajak.
  "payroll_seed.rs",
  // Klien Turso: DDL cloud, seed katalog permission, dan guard prioritas
  // absensi. Dulu berkas ini dipelihara terpisah dan sudah drift dua arah —
  // seed permission Mobile ketinggalan lima permission payroll dan menanam dua
  // permission yang tidak ada di `catalog.ts`, sementara hanya Mobile yang
  // menanam shift default. Karena keduanya membangun database Turso yang sama,
  // berkas ini WAJIB identik.
  "turso.rs",
];

for (const file of filesToSync) {
  const srcPath = join(desktopDir, file);
  let content = readFileSync(srcPath, "utf-8");

  // Adapt Desktop types to Mobile types
  content = content
    .replaceAll("DesktopState", "MobileState")
    .replaceAll("DesktopSyncStatus", "MobileSyncStatus")
    .replaceAll("DesktopLoginResult", "MobileLoginResult")
    .replaceAll("DesktopRuntimeStatus", "MobileRuntimeStatus")
    .replaceAll("DesktopSession", "MobileSession")
    .replaceAll("desktop-security.db", "mobile-security.db")
    .replaceAll("crate::desktop::", "crate::mobile::")
    .replaceAll("use crate::desktop", "use crate::mobile")
    .replaceAll("super::super::desktop", "super::super::mobile");

  const destPath = join(mobileDir, file);
  writeFileSync(destPath, content, "utf-8");
  console.log(`Synced ${file} to ${destPath}`);
}
