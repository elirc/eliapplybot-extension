import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["src/test/setupDom.ts"],
    pool: "forks",
    poolOptions: { forks: { singleFork: true } }
  }
});
