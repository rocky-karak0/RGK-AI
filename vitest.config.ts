import { defineConfig } from "vitest/config";
import { loadEnv } from "vite";
import path from "node:path";

export default defineConfig(({ mode }) => ({
  test: { env: loadEnv(mode, process.cwd(), ""), include: ["tests/unit/**/*.test.ts", "tests/rls/**/*.test.ts"], testTimeout: 30000 },
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
}));
