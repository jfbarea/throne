import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright e2e configuration for throne.
 *
 * Test environment variables are injected via webServer.env — the real .env
 * file is never read or modified. Tests run against a dedicated e2e.db that
 * is reset by the global setup script before each test run.
 *
 * To run: npm run e2e
 */

export const E2E_ADMIN_PASSCODE = "admin-e2e-passcode-secret";
export const E2E_SESSION_SECRET = "throne-e2e-session-secret-32chars!!";
export const E2E_DATABASE_URL = "file:./e2e.db";
export const E2E_BASE_URL = "http://localhost:3001";

export default defineConfig({
  // e2e specs live in tests/e2e/
  testDir: "./tests/e2e",

  // Sequential: DB state is shared across tests in the full-journey spec.
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,

  reporter: [["list"], ["html", { open: "never" }]],

  globalSetup: "./tests/e2e/global-setup.ts",

  use: {
    baseURL: E2E_BASE_URL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    // Default to mobile viewport to validate responsive behaviour.
    viewport: { width: 390, height: 844 },
    // Wait up to 10s for each action.
    actionTimeout: 10_000,
  },

  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 720 } },
    },
    {
      name: "mobile-chrome",
      use: { ...devices["Pixel 7"] },
    },
  ],

  webServer: {
    command: "next dev --port 3001",
    url: E2E_BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      ADMIN_PASSCODE: E2E_ADMIN_PASSCODE,
      SESSION_SECRET: E2E_SESSION_SECRET,
      DATABASE_URL: E2E_DATABASE_URL,
      NODE_ENV: "test",
    },
  },
});
