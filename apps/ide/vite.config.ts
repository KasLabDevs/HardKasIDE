import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";
import path from "node:path";
import { defineConfig } from "vite";

// The version shown in the UI is the package version, so a release bump reaches the status bar.
const pkg = JSON.parse(readFileSync(path.resolve(__dirname, "package.json"), "utf8")) as { version: string };

// Port 5173 is fixed: the HardKas dev-server only allows CORS from :7420 and :5173.
// The IDE never calls the dev-server directly anyway; everything goes through ide-server (:7421).
// A second checkout (a git worktree) can run next to the first one with HARDKAS_IDE_UI_PORT and HARDKAS_IDE_PORT
// (the ide-server then needs HARDKAS_IDE_PORT too, and the UI origin in HARDKAS_IDE_EXTRA_ORIGINS).
const uiPort = Number(process.env.HARDKAS_IDE_UI_PORT ?? 5173);
const serverPort = Number(process.env.HARDKAS_IDE_PORT ?? 7421);

export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") }
  },
  server: {
    port: uiPort,
    strictPort: true,
    proxy: {
      "/api": { target: `http://127.0.0.1:${serverPort}`, changeOrigin: false, ws: true }
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
