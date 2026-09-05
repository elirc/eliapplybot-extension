import { defineConfig } from "vitest/config";

// Isolated review probes. These assert observed defects, not desired behavior.
// They are excluded from the app's normal *.test.ts suite.
export default defineConfig({
  test: {
    environment: "jsdom",
    setupFiles: ["src/test/setupDom.ts"],
    include: ["docs/app-review-2026-09-04/*.checks.ts", "docs/app-review-2026-09-04/*.checks.tsx"],
    pool: "forks",
    poolOptions: { forks: { singleFork: true } },
    testTimeout: 15000
  }
});
