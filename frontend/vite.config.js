import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Static hosting (Cloudflare Pages / GitHub Pages project site) sets
// PAGES_BASE_PATH, e.g. "/pi-next-pdf-app/". Default "/" keeps local dev,
// vite preview and Cloudflare Pages on the root.
export default defineConfig({
  plugins: [react()],
  base: process.env.PAGES_BASE_PATH || "/",
  build: { outDir: "dist", sourcemap: false, chunkSizeWarningLimit: 800 },
  server: {
    port: 5173,
    proxy: {
      // Local dev only: the Vite server forwards /api to the FastAPI
      // backend so the browser never sees a second origin.
      "/api": { target: "http://localhost:8000", changeOrigin: true },
    },
  },
});
