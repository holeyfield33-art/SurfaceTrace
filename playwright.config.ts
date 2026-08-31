import { defineConfig } from "@playwright/test";

const apiToken = "e2e-runtime-token-32-characters-minimum";
const databasePath = `.e2e-data/surfacetrace-${process.pid}.db`;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: "http://127.0.0.1:5173",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: [
    {
      command: "node examples/controlled-replay-lab/lab.mjs",
      url: "http://127.0.0.1:4040/lab/projects/100",
      reuseExistingServer: false,
      timeout: 30_000,
    },
    {
      command: "node packages/server/dist/index.js",
      url: "http://127.0.0.1:8787/health",
      reuseExistingServer: false,
      timeout: 30_000,
      env: {
        HOST: "127.0.0.1",
        PORT: "8787",
        SURFACETRACE_API_TOKEN: apiToken,
        SURFACETRACE_DB_PATH: databasePath,
      },
    },
    {
      command:
        "node node_modules/vite/bin/vite.js preview packages/web --config packages/web/vite.config.ts --port 5173",
      url: "http://127.0.0.1:5173",
      reuseExistingServer: false,
      timeout: 30_000,
      env: { SURFACETRACE_API_TOKEN: apiToken },
    },
  ],
});
