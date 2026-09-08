import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "node",
    // Prepares file:./test.db (migrations) once before the suite runs, so
    // tests that write to the real DB (rondas-con-fecha, H1) find it ready.
    globalSetup: ["./tests/db-global-setup.ts"],
    // Include unit tests; explicitly exclude e2e specs (run with Playwright, not Vitest).
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    exclude: ["tests/e2e/**"],
    globals: true,
    // Inject test-only env vars so tests never depend on the real .env file.
    // SESSION_SECRET must be >= 32 chars; ADMIN_PASSCODE is a known test value.
    env: {
      SESSION_SECRET: "throne-test-secret-32-chars-padding!",
      ADMIN_PASSCODE: "super-admin-test-passcode",
      DATABASE_URL: "file:./test.db",
      NODE_ENV: "test",
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
