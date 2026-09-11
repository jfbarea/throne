// Tests for Hito E3 (plantilla-completa-en-la-migracion, multi-liga lane E).
//
// The migration that backfills `League.rulesMarkdown`
// (prisma/migrations/20260911140227_add_league_slug_archived_rules/
// migration.sql) hand-bakes the default bases template as a SQL string
// literal, bounded by `-- RULES_MARKDOWN_TEMPLATE_BEGIN`/`_END` comment
// markers. That literal has to stay byte-for-byte identical to
// `DEFAULT_RULES_MARKDOWN` (src/server/league/default-rules.ts) — the two
// are meant to be the exact same template, just baked into two different
// places (one is SQL run once, historically, against whatever leagues exist
// at migration time; the other is TS, read by every league created from
// here on). This test is the tripwire: whoever edits either one without the
// other breaks the suite, on purpose.
//
// Why the migration can be rewritten at all: this migration is NOT deployed
// anywhere — not in the repo's dev.db (its last applied migration is
// 20260908160808_make_start_month_nullable, from before multi-liga), and
// `feat/multi-liga` has never been merged to `main`. A migration only
// becomes immutable once it has actually run somewhere real; this one
// hasn't. See the E3 builder's report for the verification.

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import path from "path";
import { DEFAULT_RULES_MARKDOWN } from "@/server/league/default-rules";

const MIGRATION_SQL_PATH = path.resolve(
  process.cwd(),
  "prisma/migrations/20260911140227_add_league_slug_archived_rules/migration.sql"
);

const BEGIN_MARKER = "-- RULES_MARKDOWN_TEMPLATE_BEGIN";
const END_MARKER = "-- RULES_MARKDOWN_TEMPLATE_END";

function extractMigrationRulesMarkdownLiteral(): string {
  const sql = readFileSync(MIGRATION_SQL_PATH, "utf8");

  const beginIdx = sql.indexOf(BEGIN_MARKER);
  const endIdx = sql.indexOf(END_MARKER);
  if (beginIdx === -1 || endIdx === -1 || endIdx < beginIdx) {
    throw new Error(
      "RULES_MARKDOWN_TEMPLATE_BEGIN/END markers not found (or out of order) in migration.sql"
    );
  }

  const region = sql.slice(beginIdx + BEGIN_MARKER.length, endIdx);
  const firstQuote = region.indexOf("'");
  const lastQuote = region.lastIndexOf("'");
  if (firstQuote === -1 || lastQuote === firstQuote) {
    throw new Error(
      "Could not find the bounding single quotes of the rulesMarkdown SQL literal"
    );
  }

  return region.slice(firstQuote + 1, lastQuote);
}

describe("migration rulesMarkdown backfill vs DEFAULT_RULES_MARKDOWN (criterio E3-4)", () => {
  it("is byte-for-byte identical to the TS template", () => {
    const migrationLiteral = extractMigrationRulesMarkdownLiteral();
    expect(migrationLiteral).toBe(DEFAULT_RULES_MARKDOWN);
  });

  it("the TS template itself has no unescaped single quote (would break the SQL literal)", () => {
    expect(DEFAULT_RULES_MARKDOWN).not.toContain("'");
  });
});
