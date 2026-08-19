import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

function collectRouteFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      return collectRouteFiles(fullPath);
    }
    if (entry.isFile() && entry.name === "route.ts") {
      return [fullPath];
    }
    return [];
  });
}

describe("Next.js Static Export Compatibility Guard (Tauri v2)", () => {
  test("seluruh route handler di src/app/api TIDAK boleh mengekspor method GET (wajib POST/PUT/PATCH/DELETE)", () => {
    const apiDir = join(process.cwd(), "src/app/api");
    const routeFiles = collectRouteFiles(apiDir);

    const violations: string[] = [];

    for (const file of routeFiles) {
      const content = readFileSync(file, "utf-8");
      if (
        /export\s+(async\s+)?function\s+GET\b/.test(content) ||
        /export\s*\{\s*[^}]*\bGET\b[^}]*\}/.test(content)
      ) {
        violations.push(file);
      }
    }

    expect(violations).toEqual([]);
  });
});
