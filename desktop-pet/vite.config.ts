import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vitest/config";

const configuredDevPort = Number.parseInt(process.env.MMD_PET_DEV_PORT ?? "5174", 10);
const devPort = Number.isFinite(configuredDevPort) ? configuredDevPort : 5174;
const configuredApiBaseUrl =
  process.env.MMD_PET_API_BASE_URL ?? process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://127.0.0.1:8000";

export default defineConfig({
  plugins: [react()],
  base: "./",
  build: {
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL("./index.html", import.meta.url)),
        menu: fileURLToPath(new URL("./menu.html", import.meta.url)),
        notification: fileURLToPath(new URL("./notification.html", import.meta.url)),
      },
    },
  },
  server: {
    host: "127.0.0.1",
    port: devPort,
    strictPort: true,
  },
  resolve: {
    dedupe: ["react", "react-dom"],
    alias: {
      "@": fileURLToPath(new URL("../web/src", import.meta.url)),
    },
  },
  define: {
    "process.env.NEXT_PUBLIC_API_BASE_URL": JSON.stringify(configuredApiBaseUrl),
  },
  test: {
    exclude: ["**/node_modules/**", "**/dist/**", "**/dist-electron/**"],
    server: {
      deps: {
        inline: ["reze-engine"],
      },
    },
  },
});
