import { defineConfig } from "vite";
import { fileURLToPath, URL } from "node:url";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "@shared": fileURLToPath(new URL("../shared", import.meta.url)),
    },
  },
  build: {
    // The Worker serves the built SPA from the repo-root dist/ (bound in wrangler.toml).
    outDir: "../dist",
    emptyOutDir: true,
  },
  server: {
    // In dev, proxy API calls to the local `wrangler dev` Worker.
    proxy: {
      "/api": "http://localhost:8787",
    },
  },
});
