/**
 * E2E seed data — pure data + slug computation, no DB access, no Prisma
 * import.
 *
 * Split out of tests/e2e/seed-e2e.ts on purpose: that file pulls in the
 * generated Prisma client (`@/generated/prisma/client`), which Playwright's
 * own test-file loader chokes on when a `*.spec.ts` imports it transitively
 * ("ReferenceError: exports is not defined" — a CJS/ESM interop issue in the
 * generated client, unrelated to anything about slugs or leagues). Every
 * `tests/e2e/*.spec.ts` that needs the seeded leagues' names, players or
 * slugs imports THIS module instead, never `seed-e2e.ts` itself.
 *
 * Multi-liga Z1 (seed-y-e2e-con-dos-ligas, plan/multi-liga/PLAN.md): two
 * leagues with disjoint rosters and the admin present in both (spec §2.1,
 * §8) — see seed-e2e.ts's own docstring for how this data gets persisted.
 */

import { slugify } from "../../src/server/slug";

export const E2E_ADMIN_PASSCODE = "admin-e2e-passcode-secret";
export const E2E_PLAYER_PASSCODE = "player-e2e-123";
export const ADMIN_DISPLAY_NAME = "Admin E2E";

export interface PlayerSeed {
  id: string;
  displayName: string;
  faction: string;
}

export interface LeagueSeed {
  id: string;
  adminId: string;
  name: string;
  season: string;
  startMonth: Date;
  rulesIntro: string;
  players: PlayerSeed[];
}

// League A — the original e2e league (full-journey.spec.ts's PLAYER1/2/3 and
// SCALE_PLAYERS all live here; unchanged names and ids so that spec's own
// idempotency checks across the two Playwright projects keep working).
export const LEAGUE_A: LeagueSeed = {
  id: "e2e-league-001",
  adminId: "e2e-admin-a",
  name: "Liga E2E Warhammer",
  season: "2026 Test",
  startMonth: new Date(Date.UTC(2026, 2, 1)),
  rulesIntro: "_Bases de la Liga E2E Warhammer._\n\n",
  players: [
    { id: "e2e-player-001", displayName: "Jugador Alfa", faction: "Marines Espaciales" },
    { id: "e2e-player-002", displayName: "Jugador Beta", faction: "Tiránidos" },
    { id: "e2e-player-003", displayName: "Jugador Gamma", faction: "Orkos" },
    { id: "e2e-player-004", displayName: "Jugador Delta", faction: "Imperio T'au" },
    { id: "e2e-player-005", displayName: "Jugador Epsilon", faction: "Drukhari" },
    { id: "e2e-player-006", displayName: "Jugador Zeta", faction: "Necrones" },
  ],
};

// League B — a second, independent group (multi-liga spec §1): its own
// season and start month, and a roster that shares not a single
// `displayName` with League A's (spec §2.7). Only used by
// tests/e2e/multi-liga.spec.ts (the admin cross-league recorrido) — kept
// small (2 players) since it never runs the full league lifecycle the way
// full-journey.spec.ts does with League A.
export const LEAGUE_B: LeagueSeed = {
  id: "e2e-league-002",
  adminId: "e2e-admin-b",
  name: "Liga E2E Segundo Grupo",
  season: "2026 Test B",
  startMonth: new Date(Date.UTC(2026, 5, 1)),
  rulesIntro: "_Bases de la Liga E2E Segundo Grupo._\n\n",
  players: [
    { id: "e2e-player-101", displayName: "Jugador Sigma", faction: "Aeldari" },
    { id: "e2e-player-102", displayName: "Jugador Omega", faction: "Adeptus Custodes" },
  ],
};

export const LEAGUES: LeagueSeed[] = [LEAGUE_A, LEAGUE_B];

// Precomputed slugs (multi-liga spec §2.6, §4.6) for specs to build URLs
// with — `slugify` is pure and deterministic, and a fresh e2e.db never has
// a name+season collision to disambiguate, so this matches exactly what
// seed-e2e.ts persists.
export const LEAGUE_A_SLUG = slugify(LEAGUE_A.name, LEAGUE_A.season);
export const LEAGUE_B_SLUG = slugify(LEAGUE_B.name, LEAGUE_B.season);
