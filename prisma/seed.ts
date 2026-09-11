// Seed script — throne / milestone 2: modelo-datos-prisma.
// Multi-liga Z1 (seed-y-e2e-con-dos-ligas, plan/multi-liga/PLAN.md): the app
// no longer assumes a single league (multi-liga spec §1), so this seed
// stopped reflecting reality the moment lane C0 added `League.slug`. It now
// creates TWO leagues with DISJOINT rosters, exactly the shape the spec's
// own acceptance criteria assume by convention ("salvo mención expresa,
// 'liga A' y 'liga B' son dos ligas en circulación con rosters disjuntos y
// el admin presente en ambas", spec §8) — the one exception being the admin,
// who has a `Player` row with `role = ADMIN` in every league (spec §2.1).
//
// Idempotent: safe to run multiple times without duplicating data. Strategy:
// upsert each League by a fixed id, upsert each Player by a fixed id.
// Existing data that does not match is left untouched.

import "dotenv/config";
import { PrismaLibSql } from "@prisma/adapter-libsql";
import { PrismaClient } from "../src/generated/prisma/client";
import { serialiseFactions } from "../src/lib/factions";
import { slugify, uniqueSlug } from "../src/server/slug";
import { DEFAULT_RULES_MARKDOWN } from "../src/server/league/default-rules";

function createClient(): PrismaClient {
  const url = process.env.DATABASE_URL ?? "file:./dev.db";
  const adapter = new PrismaLibSql({ url });
  return new PrismaClient({ adapter });
}

const db = createClient();

// ---------------------------------------------------------------------------
// Seed data — two leagues, disjoint rosters, admin present in both
// (multi-liga spec §2.1, §8: "liga A" y "liga B" son dos ligas en
// circulación con rosters disjuntos y el admin presente en ambas).
// ---------------------------------------------------------------------------

// Real bcrypt hash of passcode "1234" (cost=10, generated with bcryptjs).
// All seed players share this passcode so the auth milestone can verify them
// immediately. In production the admin generates unique passcodes via the app.
// To verify: bcryptjs.compareSync("1234", SEED_PASSCODE_HASH) === true.
const SEED_PASSCODE_HASH =
  "$2b$10$4EDHVVhvPoBe7l47tWuXRe2fPNXyFJT/gB1KlkmGHEGh3xa.OgSvm";

// The admin is the one person allowed to have a homonymous `Player` row in
// more than one league (spec §2.1, §2.7's exception): the display name below
// is never checked against `findDisplayNameConflict` because that check only
// ever fires for `role = PLAYER` rows.
const ADMIN_DISPLAY_NAME = "Comisario Valdris";

interface PlayerSeed {
  displayName: string;
  faction: string | null;
}

interface LeagueSeed {
  id: string;
  name: string;
  season: string;
  // Rondas-con-fecha (plan/specs/rondas-con-fecha.md §6.2): stored as the
  // first day of the month at midnight.
  startMonth: Date;
  adminId: string;
  players: PlayerSeed[];
  // Prepended to DEFAULT_RULES_MARKDOWN so the two leagues' bases prose is
  // never byte-identical (multi-liga spec §2.11, criterio 33: "ninguno
  // menciona datos de la otra liga" — and the reverse holds too, each one
  // names only itself).
  rulesIntro: string;
}

// League A — the pre-existing seeded league, unchanged in name, season,
// startMonth and roster. Only its admin row moved out of the roster array:
// it's now a per-league concept (`adminId` + `ADMIN_DISPLAY_NAME`), not a
// `role: "ADMIN"` entry mixed into the same list as everyone else.
const LEAGUE_A: LeagueSeed = {
  id: "seed-league-001",
  name: "Liga Warhammer 40K — Capítulo Hierro",
  season: "2026 Primavera",
  startMonth: new Date(Date.UTC(2026, 2, 1)),
  adminId: "seed-admin-a",
  rulesIntro: "_Bases de la Liga Warhammer 40K — Capítulo Hierro, 2026 Primavera._\n\n",
  players: [
    {
      displayName: "Inquisidor Marak",
      faction: "Agentes del Imperio",
    },
    {
      displayName: "Capitán Torvayne",
      faction: "Marines Espaciales",
    },
    { displayName: "Magos Drekk", faction: "Adeptus Mechanicus" },
    { displayName: "Señor Fantasma Aelyr", faction: "Aeldari" },
    {
      displayName: "Patriarca Vex",
      faction: "Cultos Genestealer",
    },
    {
      displayName: "Señora de la Guerra Kovash",
      faction: "Orkos",
    },
    { displayName: "Archon Nyss", faction: "Drukhari" },
    { displayName: "Shas'O Vior'la", faction: "Imperio T'au" },
    { displayName: "Gran Tirano Skrell", faction: "Tiránidos" },
    {
      displayName: "Señor del Caos Rhan",
      faction: serialiseFactions([
        "Marines Espaciales del Caos",
        "Guardia de la Muerte",
      ]),
    },
    { displayName: "Overlord Zahndrekh", faction: null },
  ],
};

// League B — a second, independent group of friends (multi-liga spec §1):
// its own season, its own start month, and a roster that shares not a
// single `displayName` with League A's (spec §2.7: `displayName` is unique
// globally among `role = PLAYER` rows across non-archived leagues). The
// admin is the sole intentional exception (spec §2.1): same
// `ADMIN_DISPLAY_NAME`, a distinct `Player` row (`adminId`).
const LEAGUE_B: LeagueSeed = {
  id: "seed-league-002",
  name: "Liga Warhammer 40K — Capítulo Ónix",
  season: "2026 Otoño",
  startMonth: new Date(Date.UTC(2026, 8, 1)),
  adminId: "seed-admin-b",
  rulesIntro: "_Bases de la Liga Warhammer 40K — Capítulo Ónix, 2026 Otoño._\n\n",
  players: [
    { displayName: "Canonesa Ithreth", faction: "Adepta Sororitas" },
    { displayName: "Custodio Aurelian", faction: "Adeptus Custodes" },
    { displayName: "Gran Maestre Coburn", faction: "Caballeros Grises" },
    { displayName: "Piloto Rurik", faction: "Caballeros Imperiales" },
    { displayName: "Hermano Lobo Skarde", faction: "Lobos Espaciales" },
    { displayName: "Reclusiarca Nassar", faction: "Templarios Negros" },
    {
      displayName: "Hechicero Vall'therion",
      faction: "Mil Hijos",
    },
    {
      displayName: "Campeón Deiphage",
      faction: "Hijos del Emperador",
    },
    { displayName: "Rey Yllithan", faction: "Ligas de los Votann" },
    { displayName: "Señor de la Corte Nemetheq", faction: "Necrones" },
    { displayName: "Enjambre Voraz Ulgroth", faction: null },
  ],
};

const LEAGUES: LeagueSeed[] = [LEAGUE_A, LEAGUE_B];

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function upsertLeague(seed: LeagueSeed, takenSlugs: Set<string>) {
  // The slug is computed the same way the app computes it for a real league
  // (`createLeague`, src/server/league/lifecycle.ts) — not left to the
  // schema's `@default(cuid())` safety net, which exists only for fixtures
  // that never pass a slug at all (plan/multi-liga/PLAN.md, "Hallazgos de
  // los cimientos" #1).
  const base = slugify(seed.name, seed.season);
  const slug = uniqueSlug(base, takenSlugs);
  takenSlugs.add(slug);

  const league = await db.league.upsert({
    where: { id: seed.id },
    create: {
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
      // archivedAt stays null (schema default): both seeded leagues are in
      // circulation. tiebreakers uses the schema default too.
    },
    update: {
      // On re-run, refresh mutable config fields but preserve status if
      // changed. The slug is NOT recomputed here on purpose — same
      // convention as `updateLeague`, which only regenerates it when
      // `name`/`season` actually change (spec §2.6): re-running this seed
      // with the same name/season must never invalidate a link that's
      // already circulating.
      name: seed.name,
      season: seed.season,
      bonusEnabled: true,
      bonusMarginThreshold: 20,
      bonusMinVP: 40,
      playoffSize: 4,
      matchesPerRound: 2,
      startMonth: seed.startMonth,
    },
  });

  console.log(
    `Liga: ${league.name} (${league.season}) [${league.id}] — /liga/${league.slug}`
  );

  // The league's own ADMIN Player (multi-liga spec §4.9, criterio 13): every
  // league is born with exactly one. Its passcode is never used to log in —
  // the admin authenticates with ADMIN_PASSCODE (spec §2.4, §4.4) — but the
  // column is NOT NULL, so it gets the same shared seed hash as everyone
  // else, unused in practice.
  const existingAdmin = await db.player.findUnique({
    where: { id: seed.adminId },
  });
  await db.player.upsert({
    where: { id: seed.adminId },
    create: {
      id: seed.adminId,
      leagueId: league.id,
      displayName: ADMIN_DISPLAY_NAME,
      faction: "Astra Militarum",
      role: "ADMIN",
      passcodeHash: SEED_PASSCODE_HASH,
      active: true,
    },
    update: {
      displayName: ADMIN_DISPLAY_NAME,
      faction: "Astra Militarum",
      role: "ADMIN",
      active: true,
    },
  });
  console.log(`  [ADMIN] ${ADMIN_DISPLAY_NAME} — Astra Militarum`);

  let created = existingAdmin === null ? 1 : 0;
  let updated = existingAdmin === null ? 0 : 1;

  for (let i = 0; i < seed.players.length; i++) {
    const p = seed.players[i];
    const seedId = `${seed.id}-player-${String(i + 1).padStart(3, "0")}`;

    const existing = await db.player.findUnique({ where: { id: seedId } });

    await db.player.upsert({
      where: { id: seedId },
      create: {
        id: seedId,
        leagueId: league.id,
        displayName: p.displayName,
        faction: p.faction,
        role: "PLAYER",
        passcodeHash: SEED_PASSCODE_HASH,
        active: true,
      },
      update: {
        displayName: p.displayName,
        faction: p.faction,
        role: "PLAYER",
        active: true,
      },
    });

    if (existing === null) {
      created++;
    } else {
      updated++;
    }

    const factionLabel = p.faction ?? "(sin facción)";
    console.log(`  [PLAYER] ${p.displayName} — ${factionLabel}`);
  }

  console.log(
    `Liga "${league.name}" en estado ${league.status} con ${seed.players.length + 1} jugadores (incluido el admin).\n`
  );

  return { created, updated };
}

async function main(): Promise<void> {
  console.log("Iniciando seed de throne (dos ligas, rosters disjuntos)…\n");

  // Slugs are computed against every OTHER league already in the database,
  // same collision surface `createLeague` checks (spec §4.6) — not just
  // against the two seeds' own slugs, so re-running this seed alongside
  // leagues created by hand through the app never produces a silent clash.
  const existingSlugs = (
    await db.league.findMany({ select: { slug: true } })
  ).map((l) => l.slug);
  const takenSlugs = new Set(existingSlugs);

  let totalCreated = 0;
  let totalUpdated = 0;

  for (const seed of LEAGUES) {
    const { created, updated } = await upsertLeague(seed, takenSlugs);
    totalCreated += created;
    totalUpdated += updated;
  }

  console.log(
    `Seed completado: ${totalCreated} jugadores creados, ${totalUpdated} actualizados, en ${LEAGUES.length} ligas.`
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
