import { spawn } from "node:child_process";

const host = "0.0.0.0";
const child = spawn(
  process.execPath,
  ["x", "next", "dev", "--webpack", "-p", "3000", "-H", host],
  {
    cwd: process.cwd(),
    env: {
      ...process.env,
      SPPG_BUILD_TARGET: "mobile",
      NEXT_PUBLIC_SPPG_RUNTIME: "mobile",
    },
    stdio: "inherit",
  },
);

child.on("error", (error) => {
  console.error("Gagal menjalankan dev server mobile:", error);
  process.exit(1);
});

child.on("exit", (code) => {
  process.exit(code ?? 0);
});
