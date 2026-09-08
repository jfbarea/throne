/**
 * Vitest global setup — prepares the unit-test database (file:./test.db)
 * once before running the suite.
 *
 * Responsibilities:
 *  1. Remove any stale test.db (and its SQLite sidecar files) so schema
 *     changes always apply cleanly.
 *  2. Apply Prisma migrations against test.db.
 *
 * Mirrors tests/e2e/global-setup.ts (same pattern for the e2e database).
 * The URL here must match vitest.config.ts's `test.env.DATABASE_URL`.
 */

import { execSync } from "child_process";
import { existsSync, unlinkSync } from "fs";
import path from "path";

const TEST_DB_PATH = path.resolve(process.cwd(), "test.db");
const TEST_DATABASE_URL = "file:./test.db";

export default async function globalSetup() {
  for (const suffix of ["", "-journal", "-shm", "-wal"]) {
    const filePath = `${TEST_DB_PATH}${suffix}`;
    if (existsSync(filePath)) {
      unlinkSync(filePath);
    }
  }

  execSync("npx prisma migrate deploy", {
    env: {
      ...process.env,
      DATABASE_URL: TEST_DATABASE_URL,
    },
    stdio: "pipe",
  });
}
