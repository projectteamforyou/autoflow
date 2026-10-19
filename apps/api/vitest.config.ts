import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    globalSetup: ["./test/global-setup.ts"],
    pool: "forks",
    testTimeout: 30_000,
    hookTimeout: 120_000,
    env: { NODE_ENV: "test" },
  },
});
