import { defineConfig } from "vite";

export default defineConfig({
  build: {
    outDir: "dist/client",
  },
  server: {
    port: 5173,
    host: "0.0.0.0",
    allowedHosts: ["terminal.local"],
    proxy: {
      "/api": { target: "http://127.0.0.1:8000", changeOrigin: true },
      "/healthz": { target: "http://127.0.0.1:8000", changeOrigin: true },
      "/tiles": { target: "http://127.0.0.1:8000", changeOrigin: true },
      "/export": { target: "http://127.0.0.1:8000", changeOrigin: true },
    },
  },
});
