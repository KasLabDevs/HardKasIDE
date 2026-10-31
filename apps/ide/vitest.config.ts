import path from "node:path";
import { defineConfig } from "vitest/config";

// Unit tests for the data side of the IDE (record parsing, graph layout, store helpers): plain Node, no DOM.
export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") }
  },
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node"
  }
});
