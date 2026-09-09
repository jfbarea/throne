// Aggregated view of every round, for /rondas (SPEC §4.6, criterios 12-13).
// Hito 6 (ui-cupo-y-rondas, plan/rondas-con-fecha/PLAN.md).
//
// The whole point of this module is SPEC §7.1/§7.4's "no N+1" requirement:
// exactly one query for rounds, one for players and one for matches — none
// of the three scales with player count or round count — with every
// player's cupo per round (roundQuota, Hito 2, src/server/rounds.ts)
// computed in memory afterwards. Verified by a query-counting test
// (tests/rondas-overview.test.ts, criterio 12) rather than by inspection.

import type { PrismaClient } from "../generated/prisma/client";
import { roundQuota, quotaLabel, type RoundMatchInput } from "./rounds";

export interface RoundOverviewPlayerQuota {
  playerId: string;
  displayName: string;
  required: number;
  resolved: number;
  label: string;
}

export interface RoundOverviewRow {
  roundId: string;
  index: number;
  deadline: Date;
  closedAt: Date | null;
  resolvedMatches: number;
  totalMatches: number;
  playerQuotas: RoundOverviewPlayerQuota[];
}

/**
 * `db` is typed structurally against the model delegates this function
 * actually calls (not the full generated `PrismaClient`) so a test can pass
 * a `$extends`-wrapped client — SPEC §7.3: "instrumentar el cliente Prisma
 * en test... contando queries" — without a type mismatch: a client
 * extension's return type carries extra generic bookkeeping that isn't
 * always structurally identical to the bare `PrismaClient` type, even
 * though every model delegate it exposes behaves the same.
 */
export type RoundOverviewDb = Pick<PrismaClient, "round" | "player" | "match">;

/**
 * Build the `/rondas` overview: every round, how many of its matches are
 * resolved, and every active player's cupo in it (SPEC §4.6's second
 * mockup). Three queries total, fixed regardless of how many players or
 * rounds the league has — no query is issued per round or per player.
 */
export async function getRoundsOverview(
  db: RoundOverviewDb,
  leagueId: string
): Promise<RoundOverviewRow[]> {
  const [rounds, players, matches] = await Promise.all([
    db.round.findMany({
      where: { leagueId },
      orderBy: { index: "asc" },
    }),
    db.player.findMany({
      where: { leagueId, active: true },
      select: { id: true, displayName: true },
      orderBy: { createdAt: "asc" },
    }),
    // The single match query criterio 12 is about: every league match that
    // belongs to a round, with its Result presence, in one round-trip.
    // Everything below aggregates this in memory instead of querying again
    // per round or per player.
    db.match.findMany({
      where: { leagueId, phase: "LEAGUE", roundId: { not: null } },
      select: {
        roundId: true,
        playerHomeId: true,
        playerAwayId: true,
        result: { select: { id: true } },
      },
    }),
  ]);

  const roundIndexById = new Map(rounds.map((r) => [r.id, r.index]));

  // Shared across every roundQuota call below — roundQuota (Hito 2) filters
  // by roundIndex and playerId itself, so this is built once, not once per
  // round or per player.
  const matchInputs: RoundMatchInput[] = [];
  const matchesByRoundIndex = new Map<number, { hasResult: boolean }[]>();

  for (const m of matches) {
    if (m.roundId === null) continue; // excluded by the query already; narrows the type.
    const index = roundIndexById.get(m.roundId);
    if (index === undefined) continue; // orphaned roundId — should never happen, skip defensively.

    const hasResult = m.result !== null;

    // League matches always have a real opponent (byes only exist in the
    // playoff phase, excluded above by `phase: "LEAGUE"`); the null check
    // is only to satisfy the nullable schema type.
    if (m.playerAwayId !== null) {
      matchInputs.push({
        roundIndex: index,
        playerHomeId: m.playerHomeId,
        playerAwayId: m.playerAwayId,
        hasResult,
      });
    }

    const bucket = matchesByRoundIndex.get(index) ?? [];
    bucket.push({ hasResult });
    matchesByRoundIndex.set(index, bucket);
  }

  return rounds.map((round) => {
    const roundMatches = matchesByRoundIndex.get(round.index) ?? [];
    const resolvedMatches = roundMatches.filter((m) => m.hasResult).length;

    const playerQuotas: RoundOverviewPlayerQuota[] = players.map((p) => {
      const { required, resolved } = roundQuota(p.id, round.index, matchInputs);
      return {
        playerId: p.id,
        displayName: p.displayName,
        required,
        resolved,
        label: quotaLabel(resolved, required),
      };
    });

    return {
      roundId: round.id,
      index: round.index,
      deadline: round.deadline,
      closedAt: round.closedAt,
      resolvedMatches,
      totalMatches: roundMatches.length,
      playerQuotas,
    };
  });
}
