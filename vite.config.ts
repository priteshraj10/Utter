import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { resolve } from "path";

const host = process.env.TAURI_DEV_HOST;

// https://vitejs.dev/config/
export default defineConfig(async () => ({
  plugins: [react(), tailwindcss()],

  // Path aliases
  resolve: {
    alias: {
      "@": resolve(__dirname, "./src"),
      "@/bindings": resolve(__dirname, "./src/bindings.ts"),
    },
  },

  // Multiple entry points: the main app and the overlay
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        overlay: resolve(__dirname, "src/overlay/index.html"),
      },
      output: {
        manualChunks(id) {
          if (id.includes("/src/i18n/locales/")) {
            return "locales-data";
          }
          if (id.includes("node_modules")) {
            if (
              id.includes("react-markdown") ||
              id.includes("remark") ||
              id.includes("micromark") ||
              id.includes("unist") ||
              id.includes("mdast") ||
              id.includes("vfile")
            ) {
              return "markdown-vendor";
            }
            if (id.includes("lucide-react")) {
              return "icons-vendor";
            }
            if (id.includes("i18next") || id.includes("react-i18next")) {
              return "i18n-vendor";
            }
            if (
              id.includes("react") ||
              id.includes("react-dom") ||
              id.includes("scheduler")
            ) {
              return "react-vendor";
            }
          }
        },
      },
    },
    chunkSizeWarningLimit: 1000,
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
