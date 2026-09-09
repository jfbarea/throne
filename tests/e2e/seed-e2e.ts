/**
 * E2E seed — creates a fresh league + admin + test players in the e2e.db.
 * Runs via: npx tsx tests/e2e/seed-e2e.ts
 * DATABASE_URL must be set to file:./e2e.db in the environment.
 *
 * Admin passcode: "admin-e2e-passcode-secret"
 * Player passcode: "player-e2e-123"
 * (must match the constants in playwright.config.ts and full-journey.spec.ts)
 */

import "dotenv/config";
import { PrismaLibSql } from "@prisma/adapter-libsql";
import { PrismaClient } from "../../src/generated/prisma/client";
import bcryptjs from "bcryptjs";

const E2E_ADMIN_PASSCODE = "admin-e2e-passcode-secret";
const E2E_PLAYER_PASSCODE = "player-e2e-123";

function createClient(): PrismaClient {
  const url = process.env.DATABASE_URL ?? "file:./e2e.db";
  const adapter = new PrismaLibSql({ url });
  return new PrismaClient({ adapter });
}

const db = createClient();

async function main() {
  console.log("[e2e seed] Seeding e2e database...");

  const adminHash = await bcryptjs.hash(E2E_ADMIN_PASSCODE, 10);
  const playerHash = await bcryptjs.hash(E2E_PLAYER_PASSCODE, 10);

  // Create league in SETUP state.
  const league = await db.league.create({
    data: {
      id: "e2e-league-001",
      name: "Liga E2E Warhammer",
      season: "2026 Test",
      status: "SETUP",
      pointsWin: 3,
      pointsDraw: 1,
      pointsLoss: 0,
      bonusEnabled: true,
      bonusMarginThreshold: 20,
      bonusMinVP: 40,
      playoffSize: 4,
      // Rondas-con-fecha (plan/specs/rondas-con-fecha.md §6.2): required fields.
      matchesPerRound: 2,
      startMonth: new Date(Date.UTC(2026, 2, 1)),
    },
  });

  // Create admin player.
  await db.player.create({
    data: {
      id: "e2e-admin-001",
      leagueId: league.id,
      displayName: "Admin E2E",
      faction: "Agentes del Imperio",
      role: "ADMIN",
      passcodeHash: adminHash,
      active: true,
    },
  });

  // Create 6 regular players.
  const players = [
    { id: "e2e-player-001", displayName: "Jugador Alfa", faction: "Marines Espaciales" },
    { id: "e2e-player-002", displayName: "Jugador Beta", faction: "Tiránidos" },
    { id: "e2e-player-003", displayName: "Jugador Gamma", faction: "Orkos" },
    { id: "e2e-player-004", displayName: "Jugador Delta", faction: "Imperio T'au" },
    { id: "e2e-player-005", displayName: "Jugador Epsilon", faction: "Drukhari" },
    { id: "e2e-player-006", displayName: "Jugador Zeta", faction: "Necrones" },
  ];

  for (const p of players) {
    await db.player.create({
      data: {
        ...p,
        leagueId: league.id,
        role: "PLAYER",
        passcodeHash: playerHash,
        active: true,
      },
    });
  }

  console.log(
    `[e2e seed] Seeded: league "${league.name}", admin + ${players.length} players`
  );
}

main()
  .catch((err: unknown) => {
    console.error("[e2e seed] Error:", err);
    process.exit(1);
  })
  .finally(() => {
    db.$disconnect().catch(() => {});
  });
