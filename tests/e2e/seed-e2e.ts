/**
 * E2E seed — creates a fresh e2e.db with TWO leagues of disjoint rosters and
 * the admin present in both (multi-liga spec §2.1, §8: "salvo mención
 * expresa, 'liga A' y 'liga B' son dos ligas en circulación con rosters
 * disjuntos y el admin presente en ambas").
 *
 * Runs via: npx tsx tests/e2e/seed-e2e.ts
 * DATABASE_URL must be set to file:./e2e.db in the environment.
 *
 * Admin passcode: "admin-e2e-passcode-secret" (ADMIN_PASSCODE env var,
 * playwright.config.ts) — a single admin, same as production (spec §7,
 * ADR-004), with one `Player` row per league (role=ADMIN, displayName
 * "Admin E2E" in both).
 * Player passcode: "player-e2e-123" (shared by every seeded PLAYER row).
 *
 * The actual league/player data lives in tests/e2e/seed-data.ts (a pure,
 * Prisma-free module) — see that file's docstring for why the split exists.
 * `*.spec.ts` files must import from seed-data.ts, never from this file.
 */

import "dotenv/config";
import { PrismaLibSql } from "@prisma/adapter-libsql";
import { PrismaClient } from "../../src/generated/prisma/client";
import bcryptjs from "bcryptjs";
import { slugify, uniqueSlug } from "../../src/server/slug";
import { DEFAULT_RULES_MARKDOWN } from "../../src/server/league/default-rules";
import {
  E2E_ADMIN_PASSCODE,
  E2E_PLAYER_PASSCODE,
  ADMIN_DISPLAY_NAME,
  LEAGUES,
  type LeagueSeed,
} from "./seed-data";

function createClient(): PrismaClient {
  const url = process.env.DATABASE_URL ?? "file:./e2e.db";
  const adapter = new PrismaLibSql({ url });
  return new PrismaClient({ adapter });
}

const db = createClient();

async function seedLeague(
  seed: LeagueSeed,
  takenSlugs: Set<string>,
  adminHash: string,
  playerHash: string
) {
  const base = slugify(seed.name, seed.season);
  const slug = uniqueSlug(base, takenSlugs);
  takenSlugs.add(slug);

  const league = await db.league.create({
    data: {
      id: seed.id,
      name: seed.name,
      season: seed.season,
      slug,
      rulesMarkdown: seed.rulesIntro + DEFAULT_RULES_MARKDOWN,
      status: "SETUP",
      pointsWin: 3,
      pointsDraw: 1,
      pointsLoss: 0,
      bonusEnabled: true,
      bonusMarginThreshold: 20,
      bonusMinVP: 40,
      playoffSize: 4,
      matchesPerRound: 2,
      startMonth: seed.startMonth,
    },
  });

  // The league's own ADMIN Player (multi-liga spec §4.9, criterio 13). Same
  // displayName in every league — the deliberate exception (spec §2.1).
  await db.player.create({
    data: {
      id: seed.adminId,
      leagueId: league.id,
      displayName: ADMIN_DISPLAY_NAME,
      faction: "Agentes del Imperio",
      role: "ADMIN",
      passcodeHash: adminHash,
      active: true,
    },
  });

  for (const p of seed.players) {
    await db.player.create({
      data: {
        id: p.id,
        leagueId: league.id,
        displayName: p.displayName,
        faction: p.faction,
        role: "PLAYER",
        passcodeHash: playerHash,
        active: true,
      },
    });
  }

  console.log(
    `[e2e seed] Seeded: league "${league.name}" (/liga/${league.slug}), admin + ${seed.players.length} players`
  );
}

async function main() {
  console.log("[e2e seed] Seeding e2e database with two leagues...");

  const adminHash = await bcryptjs.hash(E2E_ADMIN_PASSCODE, 10);
  const playerHash = await bcryptjs.hash(E2E_PLAYER_PASSCODE, 10);

  const takenSlugs = new Set<string>();
  for (const seed of LEAGUES) {
    await seedLeague(seed, takenSlugs, adminHash, playerHash);
  }
}

main()
  .catch((err: unknown) => {
    console.error("[e2e seed] Error:", err);
    process.exit(1);
  })
  .finally(() => {
    db.$disconnect().catch(() => {});
  });
