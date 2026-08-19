import { cpSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const desktopSrc = join(__dirname, "../../web-desktop/src");
const mobileSrc = join(__dirname, "../src");

const desktopIcons = join(__dirname, "../../web-desktop/src-tauri/icons");
const mobileIcons = join(__dirname, "../src-tauri/icons");

if (existsSync(desktopIcons)) {
  mkdirSync(mobileIcons, { recursive: true });
  cpSync(desktopIcons, mobileIcons, { recursive: true });
  console.log("Copied icons to src-tauri/icons");
}

const filesToCopy = ["lib/db.ts", "lib/db-schema.ts", "lib/db-migrations.ts"];

for (const file of filesToCopy) {
  const src = join(desktopSrc, file);
  const dest = join(mobileSrc, file);
  if (existsSync(src)) {
    cpSync(src, dest);
    console.log(`Copied ${file} to mobile`);
  }
}

const dirsToCopy = [
  "lib/attendance",
  "lib/auth",
  "lib/client",
  "lib/context",
  "lib/contracts",
  "lib/gateways",
  "lib/hooks",
  "lib/operators",
  "lib/rbac",
  "lib/runtime",
  "lib/server",
  "lib/services",
  "lib/utils",
  "lib/validations",
  "types",
];

for (const dir of dirsToCopy) {
  const src = join(desktopSrc, dir);
  const dest = join(mobileSrc, dir);
  if (existsSync(src)) {
    mkdirSync(dest, { recursive: true });
    cpSync(src, dest, { recursive: true });
    console.log(`Copied ${dir} to mobile`);
  }
}
