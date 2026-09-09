// Tests for Hito 6 (ui-cupo-y-rondas) of the feature "rondas-con-fecha".
// Spec: plan/specs/rondas-con-fecha.md §4.6, §7.1, §7.3, §7.4, §8 (criterio 12).
//
// Write tests against the real test database (file:./test.db) that
// vitest.config.ts injects and tests/db-global-setup.ts migrates, same
// pattern as tests/cierre-de-ronda.test.ts. @/lib/db stays real; nothing is
// mocked here — getRoundsOverview takes the Prisma client as a parameter
// precisely so a test can hand it an instrumented one (see countQueries
// below), per spec §7.3: "instrumentar el cliente Prisma en test... contando
// queries, no comprobarlo mirando la pantalla".

import { describe, it, expect } from "vitest";
import { prisma } from "@/lib/db";
import { getRoundsOverview } from "@/server/round-overview";

// ---------------------------------------------------------------------------
// Query-counting Prisma extension (criterio 12)
// ---------------------------------------------------------------------------

/**
 * Wraps `prisma` with a `$extends` query middleware that counts every
 * client-level operation issued, broken down by model. This is what
 * "instrumentar el cliente Prisma en test... contando queries" (spec §7.3)
 * actually means here: a client-level operation (`round.findMany`,
 * `match.findMany`, ...) is what "una consulta" refers to in criterio 12
 * ("una sola query de partidas"), not the raw SQL statements the driver
 * issues underneath.
 */
function countQueries(client: typeof prisma): {
  extended: typeof prisma;
  counts: Record<string, number>;
  total: () => number;
} {
  const counts: Record<string, number> = {};
  const extended = client.$extends({
    query: {
      $allModels: {
        async $allOperations({ model, args, query }) {
          counts[model] = (counts[model] ?? 0) + 1;
          return query(args);
        },
      },
    },
  }) as unknown as typeof prisma;

  return {
    extended,
    counts,
    total: () => Object.values(counts).reduce((sum, n) => sum + n, 0),
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function uid(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function createTestLeague() {
  return prisma.league.create({
    data: {
      id: uid("league"),
      name: "Liga de test H6",
      season: "2026 Test",
      matchesPerRound: 2,
      startMonth: new Date(Date.UTC(2026, 2, 1)),
    },
  });
}

async function createPlayer(leagueId: string, name: string) {
  return prisma.player.create({
    data: {
      id: uid("player"),
      leagueId,
      displayName: `Jugador ${name}`,
      passcodeHash: "test-hash",
    },
  });
}

async function createRound(leagueId: string, index: number, deadline: Date) {
  return prisma.round.create({ data: { leagueId, index, deadline } });
}

async function createMatch(
  leagueId: string,
  roundId: string,
  homeId: string,
  awayId: string,
  withResult: boolean
) {
  const match = await prisma.match.create({
    data: {
      leagueId,
      roundId,
      phase: "LEAGUE",
      status: withResult ? "REPORTED" : "SCHEDULED",
      playerHomeId: homeId,
      playerAwayId: awayId,
    },
  });
  if (withResult) {
    await prisma.result.create({
      data: {
        matchId: match.id,
        homeVictoryPoints: 50,
        awayVictoryPoints: 30,
        outcome: "HOME_WIN",
        reportedById: homeId,
      },
    });
  }
  return match;
}

/** Build a league with `playerCount` players, one round, and every pair of
 * that round's players as a Match — `resolvedCount` of them with a Result. */
async function buildLeagueWithOneRound(playerCount: number, resolvedCount: number) {
  const league = await createTestLeague();
  const players = await Promise.all(
    Array.from({ length: playerCount }, (_, i) => createPlayer(league.id, `P${i}`))
  );
  const round = await createRound(league.id, 1, new Date(Date.UTC(2026, 3, 30)));

  let resolved = 0;
  for (let i = 0; i + 1 < players.length; i += 2) {
    await createMatch(league.id, round.id, players[i].id, players[i + 1].id, resolved < resolvedCount);
    resolved++;
  }

  return { league, players, round };
}

// ---------------------------------------------------------------------------
// AC-12: /rondas responde con una sola query de partidas (sin N+1)
// ---------------------------------------------------------------------------

describe("AC-12: getRoundsOverview no hace N+1 — una sola query de partidas", () => {
  it("hace exactamente una query de Match, una de Round y una de Player con 4 jugadores", async () => {
    const { league } = await buildLeagueWithOneRound(4, 1);
    const { extended, counts, total } = countQueries(prisma);

    await getRoundsOverview(extended, league.id);

    expect(counts.Match).toBe(1);
    expect(counts.Round).toBe(1);
    expect(counts.Player).toBe(1);
    expect(total()).toBe(3);
  });

  it("el número de queries NO crece con más jugadores ni más rondas (16 jugadores, 3 rondas)", async () => {
    const league = await createTestLeague();
    const players = await Promise.all(
      Array.from({ length: 16 }, (_, i) => createPlayer(league.id, `Q${i}`))
    );
    const rounds = await Promise.all([
      createRound(league.id, 1, new Date(Date.UTC(2026, 3, 30))),
      createRound(league.id, 2, new Date(Date.UTC(2026, 4, 31))),
      createRound(league.id, 3, new Date(Date.UTC(2026, 5, 30))),
    ]);

    // Scatter matches across every round and every player pair — the point
    // is that none of this should change the query count below.
    let roundCursor = 0;
    for (let i = 0; i + 1 < players.length; i += 2) {
      const round = rounds[roundCursor % rounds.length];
      await createMatch(league.id, round.id, players[i].id, players[i + 1].id, i % 3 === 0);
      roundCursor++;
    }

    const { extended, counts, total } = countQueries(prisma);
    await getRoundsOverview(extended, league.id);

    expect(counts.Match).toBe(1);
    expect(counts.Round).toBe(1);
    expect(counts.Player).toBe(1);
    expect(total()).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// Correctness (not just the query count): the aggregation itself.
// ---------------------------------------------------------------------------

describe("getRoundsOverview: el cupo agregado en memoria coincide con roundQuota", () => {
  it("cuenta las partidas resueltas de la ronda y el cupo de cada jugador activo", async () => {
    const { league, players, round } = await buildLeagueWithOneRound(4, 1);

    const [overview] = await getRoundsOverview(prisma, league.id);

    expect(overview.roundId).toBe(round.id);
    expect(overview.totalMatches).toBe(2); // 4 players -> 2 matches in one round
    expect(overview.resolvedMatches).toBe(1);
    expect(overview.playerQuotas).toHaveLength(4);

    const byId = new Map(overview.playerQuotas.map((q) => [q.playerId, q]));
    // players[0] vs players[1] has a Result; players[2] vs players[3] doesn't.
    expect(byId.get(players[0].id)).toMatchObject({ required: 1, resolved: 1, label: "cumplido" });
    expect(byId.get(players[1].id)).toMatchObject({ required: 1, resolved: 1, label: "cumplido" });
    expect(byId.get(players[2].id)).toMatchObject({ required: 1, resolved: 0, label: "falta 1 de 1" });
    expect(byId.get(players[3].id)).toMatchObject({ required: 1, resolved: 0, label: "falta 1 de 1" });
  });

  it("no cuenta jugadores inactivos", async () => {
    const { league, players, round } = await buildLeagueWithOneRound(4, 0);
    await prisma.player.update({ where: { id: players[3].id }, data: { active: false } });

    const [overview] = await getRoundsOverview(prisma, league.id);

    expect(overview.playerQuotas.map((q) => q.playerId)).not.toContain(players[3].id);
    expect(round.id).toBe(overview.roundId);
  });

  it("una liga sin rondas generadas devuelve un array vacío", async () => {
    const league = await createTestLeague();
    const overview = await getRoundsOverview(prisma, league.id);
    expect(overview).toEqual([]);
  });
});
