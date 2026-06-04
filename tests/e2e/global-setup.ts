/**
 * Playwright global setup — runs once before all e2e tests.
 *
 * Responsibilities:
 *  1. Delete the e2e database if it exists (fresh state for every test run).
 *  2. Apply Prisma migrations against e2e.db.
 *  3. Seed the e2e database with a fresh league + admin + test players via a
 *     dedicated seed script (runs as tsx subprocess to avoid ESM issues).
 *
 * Environment: env vars are injected by playwright.config.ts webServer.env.
 * The real .env file is never read or modified.
 */

import { execSync } from "child_process";
import { existsSync, unlinkSync } from "fs";
import path from "path";

const E2E_DB_PATH = path.resolve(process.cwd(), "e2e.db");
const E2E_DATABASE_URL = `file:${E2E_DB_PATH}`;

export default async function globalSetup() {
  console.log("\n[e2e setup] Preparing e2e database...");

  // 1. Remove stale e2e database.
  if (existsSync(E2E_DB_PATH)) {
    unlinkSync(E2E_DB_PATH);
    console.log("[e2e setup] Removed stale e2e.db");
  }

  // 2. Apply Prisma migrations.
  execSync("npx prisma migrate deploy", {
    env: {
      ...process.env,
      DATABASE_URL: E2E_DATABASE_URL,
    },
    stdio: "pipe",
  });
  console.log("[e2e setup] Migrations applied");

  // 3. Run the e2e seed script via tsx.
  execSync("npx tsx tests/e2e/seed-e2e.ts", {
    env: {
      ...process.env,
      DATABASE_URL: E2E_DATABASE_URL,
    },
    stdio: "inherit",
  });

  console.log("[e2e setup] E2E database ready\n");
}
