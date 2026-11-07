import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  base: "./",
  plugins: [react(), tailwindcss()],
  server: {
    port: 5174,
    strictPort: true,
    proxy: {
      "/term/api": "http://127.0.0.1:7795",
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
