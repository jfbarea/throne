// Apply versioned Prisma migrations to a remote Turso (libSQL) database.
//
// Uses @libsql/client directly (the same client Prisma's libSQL adapter uses)
// instead of the turso CLI: it authenticates non-interactively with the auth
// token and does not depend on a specific turso CLI version or flags.
//
// Usage (DATABASE_URL/DATABASE_AUTH_TOKEN are auto-loaded from .env if present;
// in CI/Netlify they come from the real environment):
//   npm run db:migrate:turso
//
// Requirements:
//   - DATABASE_URL set to a libsql:// URL (not a file: path)
//   - DATABASE_AUTH_TOKEN set to a valid Turso token

import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@libsql/client";

const url = process.env.DATABASE_URL;
const authToken = process.env.DATABASE_AUTH_TOKEN;

if (!url) {
  console.error("ERROR: DATABASE_URL is not set.");
  process.exit(1);
}
if (!url.startsWith("libsql://")) {
  console.error(
    `ERROR: DATABASE_URL must be a libsql:// URL for Turso migrations, got: ${url}`,
  );
  process.exit(1);
}
if (!authToken) {
  console.error("ERROR: DATABASE_AUTH_TOKEN is not set.");
  process.exit(1);
}

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(here, "..", "prisma", "migrations");

// Migration directories are timestamp-prefixed, so lexicographic sort is chronological.
const migrations = readdirSync(migrationsDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

if (migrations.length === 0) {
  console.error(`No migrations found in ${migrationsDir}`);
  process.exit(1);
}

const client = createClient({ url, authToken });

console.log(`Applying ${migrations.length} migration(s) to ${url}`);

try {
  for (const name of migrations) {
    const sql = readFileSync(join(migrationsDir, name, "migration.sql"), "utf8");
    process.stdout.write(`  → ${name} ... `);
    // executeMultiple runs the whole migration script (multiple statements,
    // including PRAGMAs) without wrapping it in an implicit transaction.
    await client.executeMultiple(sql);
    console.log("done");
  }
  console.log("All migrations applied successfully.");
} catch (err) {
  console.error(`\nERROR applying migrations: ${err?.message ?? err}`);
  process.exitCode = 1;
} finally {
  client.close();
}
