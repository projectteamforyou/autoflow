/// <reference types="vitest" />
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as { version: string };

// Relative base: the same build is served at https://<site>/app/ and loaded from disk by the
// Tauri (Windows) and Capacitor (Android) shells. Routing uses the URL hash.
export default defineConfig({
  // "./" for the native shells (loaded from disk); the website build sets VITE_BASE=/app/.
  base: process.env.VITE_BASE ?? "./",
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  plugins: [
    react(),
    VitePWA({
      registerType: "prompt",
      injectRegister: null,
      includeAssets: ["icons/*.png", "favicon.svg"],
      manifest: {
        id: "/app/",
        name: "AutoFlow",
        short_name: "AutoFlow",
        description: "Auto clicker, macros, hotkeys, key remapping and routines — with Easy and Pro modes.",
        start_url: "./#/",
        scope: "./",
        display: "standalone",
        display_override: ["window-controls-overlay", "standalone"],
        background_color: "#0B0B1A",
        theme_color: "#0B0B1A",
        categories: ["productivity", "utilities"],
        icons: [
          { src: "icons/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icons/icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
        shortcuts: [
          { name: "New click automation", url: "./#/new/click" },
          { name: "Practice Canvas", url: "./#/canvas" },
          { name: "Atlas templates", url: "./#/atlas" },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,png,webp,woff2}"],
        navigateFallback: "index.html",
        cleanupOutdatedCaches: true,
        runtimeCaching: [],
      },
    }),
  ],
  build: {
    target: "es2022",
    sourcemap: false,
    chunkSizeWarningLimit: 900,
  },
  server: { port: 5173, strictPort: true },
  test: { environment: "jsdom", setupFiles: ["./test/setup.ts"] },
});
