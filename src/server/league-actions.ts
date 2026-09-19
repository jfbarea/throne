// Server-side domain actions for league configuration and player management.
//
// Multi-liga C1 (contexto-de-liga-y-modulos): split into
// src/server/league/{config,players,lifecycle,rules}.ts — pure move, no
// logic change (see the git history of this commit for the diff). This file
// is now a re-export barrel so every existing `import { X } from
// "@/server/league-actions"` keeps working unchanged:
//   - config.ts     — updateLeague
//   - players.ts    — createPlayer, updatePlayer, setPlayerActive,
//                      resetPlayerPasscode, deletePlayer
//   - lifecycle.ts  — createLeague, resetLeague
//   - rules.ts      — empty for now; lane E (bases-por-liga) adds
//                      updateLeagueRules here
//
// New code should import directly from the specific submodule instead of
// this barrel — it exists only for backwards compatibility with call sites
// that predate the split.
//
// Hito 5: admin-liga-jugadores. SPEC §4.1, §4.2, §5.

export type { ActionResult } from "./league/action-result";
export * from "./league/config";
export * from "./league/players";
export * from "./league/lifecycle";
export * from "./league/rules";
