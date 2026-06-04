// Seed script — throne / milestone 2: modelo-datos-prisma
// Creates one example league in SETUP status + 12 fictional W40k players
// (one of them ADMIN). Idempotent: safe to run multiple times without
// duplicating data. Strategy: upsert League by name+season; upsert Players
// by displayName within the league. Existing data that does not match is left
// untouched.

import "dotenv/config";
import { PrismaLibSql } from "@prisma/adapter-libsql";
import { PrismaClient } from "../src/generated/prisma/client";

function createClient(): PrismaClient {
  const url = process.env.DATABASE_URL ?? "file:./dev.db";
  const adapter = new PrismaLibSql({ url });
  return new PrismaClient({ adapter });
}

const db = createClient();

// ---------------------------------------------------------------------------
// Seed data
// ---------------------------------------------------------------------------

const LEAGUE_NAME = "Liga Warhammer 40K — Capítulo Hierro";
const LEAGUE_SEASON = "2026 Primavera";

// Real bcrypt hash of passcode "1234" (cost=10, generated with bcryptjs).
// All seed players share this passcode so the auth milestone can verify them
// immediately. In production the admin generates unique passcodes via the app.
// To verify: bcryptjs.compareSync("1234", SEED_PASSCODE_HASH) === true.
const SEED_PASSCODE_HASH =
  "$2b$10$4EDHVVhvPoBe7l47tWuXRe2fPNXyFJT/gB1KlkmGHEGh3xa.OgSvm";

interface PlayerSeed {
  displayName: string;
  faction: string | null;
  role: "ADMIN" | "PLAYER";
}

const PLAYERS: PlayerSeed[] = [
  { displayName: "Comisario Valdris",     faction: "Astra Militarum",        role: "ADMIN"  },
  { displayName: "Inquisidor Marak",      faction: "Inquisición",             role: "PLAYER" },
  { displayName: "Capitán Torvayne",      faction: "Space Marines",           role: "PLAYER" },
  { displayName: "Magos Drekk",           faction: "Adeptus Mechanicus",      role: "PLAYER" },
  { displayName: "Señor Fantasma Aelyr",  faction: "Craftworlds Aeldari",     role: "PLAYER" },
  { displayName: "Patriarca Vex",         faction: "Genestealers",            role: "PLAYER" },
  { displayName: "Señora de la Guerra Kovash", faction: "Orks",              role: "PLAYER" },
  { displayName: "Archon Nyss",           faction: "Drukhari",                role: "PLAYER" },
  { displayName: "Shas'O Vior'la",        faction: "T'au",                    role: "PLAYER" },
  { displayName: "Gran Tirano Skrell",    faction: "Tiránidos",               role: "PLAYER" },
  { displayName: "Señor del Caos Rhan",   faction: "Legiones del Caos",       role: "PLAYER" },
  { displayName: "Overlord Zahndrekh",    faction: null,                      role: "PLAYER" },
];

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log("Iniciando seed de throne…");

  // Upsert the League (identify by name + season combination).
  const league = await db.league.upsert({
    where: {
      // There is no composite unique on name+season in the schema, so we use
      // a findFirst + create/update pattern wrapped around a name-based lookup.
      // Since Prisma upsert requires a @unique field, we rely on the league id
      // stored in a well-known way: we look it up by name+season first.
      // Workaround: we store a deterministic id as the lookup key.
      id: "seed-league-001",
    },
    create: {
      id: "seed-league-001",
      name: LEAGUE_NAME,
      season: LEAGUE_SEASON,
      status: "SETUP",
      pointsWin: 3,
      pointsDraw: 1,
      pointsLoss: 0,
      bonusEnabled: true,
      bonusMarginThreshold: 20,
      bonusMinVP: 40,
      playoffSize: 4,
      // tiebreakers uses the default from schema; no override needed.
    },
    update: {
      // On re-run, refresh mutable config fields but preserve status if changed.
      name: LEAGUE_NAME,
      season: LEAGUE_SEASON,
      bonusEnabled: true,
      bonusMarginThreshold: 20,
      bonusMinVP: 40,
      playoffSize: 4,
    },
  });

  console.log(`Liga: ${league.name} (${league.season}) [${league.id}]`);

  // Upsert each player identified by a deterministic seed id.
  // Count created/updated by checking existence before each upsert —
  // more reliable than comparing createdAt/updatedAt timestamps (which can
  // be equal on the same clock tick with the libSQL driver).
  let created = 0;
  let updated = 0;

  for (let i = 0; i < PLAYERS.length; i++) {
    const seed = PLAYERS[i];
    const seedId = `seed-player-${String(i + 1).padStart(3, "0")}`;

    const existing = await db.player.findUnique({ where: { id: seedId } });

    await db.player.upsert({
      where: { id: seedId },
      create: {
        id: seedId,
        leagueId: league.id,
        displayName: seed.displayName,
        faction: seed.faction,
        role: seed.role,
        passcodeHash: SEED_PASSCODE_HASH,
        active: true,
      },
      update: {
        displayName: seed.displayName,
        faction: seed.faction,
        role: seed.role,
        active: true,
      },
    });

    if (existing === null) {
      created++;
    } else {
      updated++;
    }

    const roleLabel = seed.role === "ADMIN" ? "[ADMIN]" : "[PLAYER]";
    const factionLabel = seed.faction ?? "(sin facción)";
    console.log(`  ${roleLabel} ${seed.displayName} — ${factionLabel}`);
  }

  console.log(
    `\nSeed completado: ${created} creados, ${updated} actualizados.`,
  );
  console.log(
    `Liga "${league.name}" en estado ${league.status} con ${PLAYERS.length} jugadores.`,
  );
}

main()
  .catch((err: unknown) => {
    console.error("Error en seed:", err);
    process.exit(1);
  })
  .finally(() => {
    db.$disconnect().catch(() => {});
  });
