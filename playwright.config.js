import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "tests/e2e",
  use: {
    baseURL: "http://127.0.0.1:4179",
    browserName: "chromium",
    viewport: { width: 1440, height: 900 },
    trace: "retain-on-failure",
    screenshot: "only-on-failure"
  },
  webServer: {
    command: "node tests/fixtures/static-server.mjs",
    url: "http://127.0.0.1:4179/examples/device-ops/index.html",
    reuseExistingServer: false
  }
});
