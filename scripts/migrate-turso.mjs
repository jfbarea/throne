// Apply versioned Prisma migrations to a remote Turso (libSQL) database.
//
// Uses @libsql/client directly (the same client Prisma's libSQL adapter uses)
// instead of the turso CLI: it authenticates non-interactively with the auth
// token and does not depend on a specific turso CLI version or flags.
//
// Keeps its own bookkeeping in a `_throne_migrations` table, so it applies
// only what the target database is missing and is safe to re-run. Prisma's
// migrations are not idempotent (CREATE TABLE, DROP TABLE), so without that
// record a second run fails on the first already-applied migration — which is
// exactly how a database ends up silently stuck several migrations behind.
//
// The table is deliberately NOT Prisma's own `_prisma_migrations`: that one
// carries checksums and a specific schema that `prisma migrate` interprets,
// and writing a partial imitation of it would make `prisma migrate status`
// report nonsense.
//
// Usage (DATABASE_URL/DATABASE_AUTH_TOKEN are auto-loaded from .env if present;
// in CI/Netlify they come from the real environment):
//
//   npm run db:migrate:turso                 apply what is missing
//   npm run db:migrate:turso -- --dry-run    list what would be applied
//   npm run db:migrate:turso -- --baseline <name>
//                                            adopt a database that was
//                                            migrated before this bookkeeping
//                                            existed: mark every migration up
//                                            to and including <name> as
//                                            already applied, without running
//                                            it. Refuses to run if the
//                                            bookkeeping table already has
//                                            entries.
//   npm run db:migrate:turso -- --allow-file  permit a file: URL (local test)
//
// Requirements:
//   - DATABASE_URL set to a libsql:// URL (a file: path needs --allow-file)
//   - DATABASE_AUTH_TOKEN set to a valid Turso token (not needed for file:)

import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@libsql/client";

const BOOKKEEPING_TABLE = "_throne_migrations";

// ---------------------------------------------------------------------------
// Arguments
// ---------------------------------------------------------------------------

const argv = process.argv.slice(2);
const dryRun = argv.includes("--dry-run");
const allowFile = argv.includes("--allow-file");

let baseline = null;
const baselineIndex = argv.indexOf("--baseline");
if (baselineIndex !== -1) {
  baseline = argv[baselineIndex + 1];
  if (!baseline || baseline.startsWith("--")) {
    console.error("ERROR: --baseline needs a migration name.");
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Connection
// ---------------------------------------------------------------------------

const url = process.env.DATABASE_URL;
const authToken = process.env.DATABASE_AUTH_TOKEN;

if (!url) {
  console.error("ERROR: DATABASE_URL is not set.");
  process.exit(1);
}

const isFileUrl = url.startsWith("file:");

if (!url.startsWith("libsql://") && !isFileUrl) {
  console.error(
    `ERROR: DATABASE_URL must be a libsql:// URL for Turso migrations, got: ${url}`,
  );
  process.exit(1);
}
if (isFileUrl && !allowFile) {
  console.error(
    `ERROR: DATABASE_URL points at a local file (${url}). Use \`npx prisma migrate dev\`\n` +
      "for the development database, or pass --allow-file if you really mean to\n" +
      "run this script against a file (testing this script, or a restored dump).",
  );
  process.exit(1);
}
if (!isFileUrl && !authToken) {
  console.error("ERROR: DATABASE_AUTH_TOKEN is not set.");
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Migrations on disk
// ---------------------------------------------------------------------------

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

if (baseline !== null && !migrations.includes(baseline)) {
  console.error(
    `ERROR: --baseline ${baseline} is not a migration. Available:\n` +
      migrations.map((m) => `  ${m}`).join("\n"),
  );
  process.exit(1);
}

const client = createClient(isFileUrl ? { url } : { url, authToken });

try {
  await client.execute(
    `CREATE TABLE IF NOT EXISTS "${BOOKKEEPING_TABLE}" (
       "name" TEXT NOT NULL PRIMARY KEY,
       "applied_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
     )`,
  );

  const recorded = await client.execute(
    `SELECT "name" FROM "${BOOKKEEPING_TABLE}"`,
  );
  const applied = new Set(recorded.rows.map((row) => row.name));

  // -------------------------------------------------------------------------
  // Baseline: adopt a database migrated before this bookkeeping existed
  // -------------------------------------------------------------------------

  if (baseline !== null) {
    if (applied.size > 0) {
      console.error(
        `ERROR: "${BOOKKEEPING_TABLE}" already records ${applied.size} migration(s).\n` +
          "Baselining is only for adopting a database that has none. Drop the\n" +
          "flag and run the script normally.",
      );
      process.exitCode = 1;
    } else {
      const upTo = migrations.indexOf(baseline) + 1;
      const adopted = migrations.slice(0, upTo);
      console.log(
        `Baselining ${url}: marking ${adopted.length} migration(s) as already applied, without running them.`,
      );
      for (const name of adopted) {
        console.log(`  ✓ ${name}`);
        if (!dryRun) {
          await client.execute({
            sql: `INSERT INTO "${BOOKKEEPING_TABLE}" ("name") VALUES (?)`,
            args: [name],
          });
        }
      }
      console.log(
        dryRun
          ? "\nDry run: nothing was written."
          : `\nBaseline recorded. Run the script again to apply the remaining ${
              migrations.length - adopted.length
            } migration(s).`,
      );
    }
  } else {
    // -----------------------------------------------------------------------
    // Normal run: apply whatever is missing
    // -----------------------------------------------------------------------

    const pending = migrations.filter((name) => !applied.has(name));

    if (applied.size === 0 && migrations.length > 1) {
      // A database with tables but no bookkeeping is the trap this script now
      // guards against: applying migration 1 to it fails, or worse, half-runs.
      const existing = await client.execute(
        `SELECT count(*) AS n FROM sqlite_master
          WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name <> '${BOOKKEEPING_TABLE}'`,
      );
      if (Number(existing.rows[0].n) > 0) {
        console.error(
          `ERROR: ${url} already has tables but no migration record.\n\n` +
            "This database was migrated before this script kept track. Adopt it\n" +
            "first, naming the last migration it actually has:\n\n" +
            "  npm run db:migrate:turso -- --baseline <migration-name>\n\n" +
            "Then run this again to apply the rest. Available migrations:\n" +
            migrations.map((m) => `  ${m}`).join("\n"),
        );
        process.exitCode = 1;
        throw new Error("__handled__");
      }
    }

    if (pending.length === 0) {
      console.log(
        `${url} is up to date: all ${migrations.length} migration(s) already applied.`,
      );
    } else {
      console.log(
        `${url}: ${applied.size} already applied, ${pending.length} pending.`,
      );
      for (const name of pending) {
        const sql = readFileSync(join(migrationsDir, name, "migration.sql"), "utf8");
        process.stdout.write(`  → ${name} ... `);
        if (dryRun) {
          console.log("(dry run, skipped)");
          continue;
        }
        // executeMultiple runs the whole migration script (multiple statements,
        // including PRAGMAs) without wrapping it in an implicit transaction.
        await client.executeMultiple(sql);
        await client.execute({
          sql: `INSERT INTO "${BOOKKEEPING_TABLE}" ("name") VALUES (?)`,
          args: [name],
        });
        console.log("done");
      }
      console.log(
        dryRun ? "\nDry run: nothing was applied." : "\nAll migrations applied successfully.",
      );
    }
  }
} catch (err) {
  if (err?.message !== "__handled__") {
    console.error(`\nERROR applying migrations: ${err?.message ?? err}`);
    process.exitCode = 1;
  }
} finally {
  client.close();
}
