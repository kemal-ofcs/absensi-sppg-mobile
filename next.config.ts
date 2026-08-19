import path from "node:path";
import type { NextConfig } from "next";

const isMobileBuild =
  process.env.SPPG_BUILD_TARGET === "mobile" ||
  process.env.NEXT_PUBLIC_SPPG_RUNTIME === "mobile" ||
  process.env.NODE_ENV === "production";

const zxingBrowserModule = "@zxing/browser/es2015/index.js";
const zxingLibraryModule = "@zxing/library/es2015/index.js";
const zxingBrowserEntry = path.resolve(
  process.cwd(),
  "node_modules/@zxing/browser/es2015/index.js",
);
const zxingLibraryEntry = path.resolve(
  process.cwd(),
  "node_modules/@zxing/library/es2015/index.js",
);

const nextConfig: NextConfig = {
  ...(isMobileBuild ? { output: "export" as const } : {}),
  devIndicators: false,
  turbopack: {
    resolveAlias: {
      "@zxing/browser": zxingBrowserModule,
      "@zxing/library": zxingLibraryModule,
    },
  },
  webpack(config) {
    config.resolve.alias = {
      ...config.resolve.alias,
      "@zxing/browser$": zxingBrowserEntry,
      "@zxing/library$": zxingLibraryEntry,
    };
    return config;
  },
  images: {
    unoptimized: true,
  },
  reactCompiler: true,
};

export default nextConfig;
