import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { defineConfig } from "vite";

// Port 5173 is fixed: the HardKas dev-server only allows CORS from :7420 and :5173.
// The IDE never calls the dev-server directly anyway; everything goes through ide-server (:7421).
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") }
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": { target: "http://127.0.0.1:7421", changeOrigin: false, ws: true }
    }
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          "react-vendor": ["react", "react-dom", "zustand"],
          "xyflow": ["@xyflow/react"],
          "xterm": ["@xterm/xterm", "@xterm/addon-fit"],
          "textmate": ["vscode-textmate", "vscode-oniguruma"],
          "icons": ["lucide-react"]
        }
      }
    }
  }
});
