import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const base = process.env.BASE_PATH ?? "/";
const rootDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  base,
  define: {
    __APP_VERSION__: JSON.stringify(process.env.GITHUB_SHA?.slice(0, 7) ?? "dev"),
  },
  resolve: {
    alias: {
      "@shared": path.resolve(rootDir, "shared"),
    },
  },
  server: {
    port: 5173,
  },
  build: {
    rollupOptions: {
      input: {
        main: path.resolve(rootDir, "index.html"),
        text: path.resolve(rootDir, "text.html"),
        labels: path.resolve(rootDir, "labels.html"),
        qr: path.resolve(rootDir, "qr.html"),
      },
    },
  },
});
