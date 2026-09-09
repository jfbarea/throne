// Tests for Hito 8: recalculo-alta-baja-y-cupo (feature "rondas-con-fecha").
// Covers spec criteria 29-35 (plan/specs/rondas-con-fecha.md §8) — see
// plan/rondas-con-fecha/PLAN.md §H8.
//
// Write tests against the real test database (file:./test.db) that
// vitest.config.ts injects and tests/db-global-setup.ts migrates (spec
// §7.3), same conventions as tests/cierre-de-ronda.test.ts and
// tests/endurecer-guardas-transaccionales.test.ts: only next/cache and
// @/lib/guards are mocked, @/lib/db stays real.

import { describe, it, expect, vi } from "vitest";

const mockSession = vi.hoisted(() => ({
  adminPlayerId: null as string | null,
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/guards", () => ({
  requireAdmin: vi.fn(async () => ({
    role: "ADMIN",
    playerId: mockSession.adminPlayerId,
  })),
  requireAuth: vi.fn(async () => ({
    role: "ADMIN",
    playerId: mockSession.adminPlayerId,
  })),
}));

import { prisma } from "@/lib/db";
import { closeRound, redistributePending } from "@/server/round-actions";
import { addMissingLeagueMatches, generateLeagueMatches } from "@/server/match-actions";
import { setPlayerActive, updateLeague } from "@/server/league-actions";
import { roundRobinRounds } from "@/server/rounds";
import { TIEBREAKER_VALUES, type LeagueConfigInput } from "@/lib/schemas";

// ---------------------------------------------------------------------------
// Helpers (same conventions as tests/cierre-de-ronda.test.ts)
// ---------------------------------------------------------------------------

function uid(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

const PAST = new Date(Date.now() - 24 * 60 * 60 * 1000);

async function createTestLeague(
  overrides: {
    matchesPerRound?: number;
    startMonth?: Date | null;
    bonusEnabled?: boolean;
    bonusMarginThreshold?: number | null;
    bonusMinVP?: number | null;
  } = {}
) {
  return prisma.league.create({
    data: {
      id: uid("league"),
      name: "Liga de test H8",
      season: "2026 Test",
      matchesPerRound: overrides.matchesPerRound ?? 2,
      startMonth: overrides.startMonth ?? new Date(Date.UTC(2020, 0, 1)),
      bonusEnabled: overrides.bonusEnabled ?? false,
      bonusMarginThreshold: overrides.bonusMarginThreshold ?? null,
      bonusMinVP: overrides.bonusMinVP ?? null,
    },
  });
}

/**
 * The admin is a Player too, and — same as any other Player — would
 * otherwise participate in `generateLeagueMatches` / `addMissingLeagueMatches`
 * pairing (only `active` is checked, not `role`; the admin genuinely can play
 * in this codebase). Created inactive here on purpose: these tests only need
 * a valid `Player` row to satisfy `AuditLog.actorId`'s FK, not a participant,
 * and keeping it out of the roster is what makes the player counts below
 * exact instead of off-by-one.
 */
async function createAdmin(leagueId: string) {
  return prisma.player.create({
    data: {
      id: uid("admin"),
      leagueId,
      displayName: "Admin de test H8",
      role: "ADMIN",
      passcodeHash: "test-hash",
      active: false,
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
  roundId: string | null,
  homeId: string,
  awayId: string,
  extra: { scheduledAt?: Date } = {}
) {
  return prisma.match.create({
    data: {
      leagueId,
      roundId,
      phase: "LEAGUE",
      status: "SCHEDULED",
      playerHomeId: homeId,
      playerAwayId: awayId,
      scheduledAt: extra.scheduledAt ?? null,
    },
  });
}

function baseLeagueConfig(
  league: {
    name: string;
    season: string;
    pointsWin: number;
    pointsDraw: number;
    pointsLoss: number;
    bonusEnabled: boolean;
    bonusMarginThreshold: number | null;
    bonusMinVP: number | null;
    playoffSize: number;
    startMonth: Date | null;
  },
  overrides: Partial<LeagueConfigInput> = {}
): LeagueConfigInput {
  return {
    name: league.name,
    season: league.season,
    pointsWin: league.pointsWin,
    pointsDraw: league.pointsDraw,
    pointsLoss: league.pointsLoss,
    bonusEnabled: league.bonusEnabled,
    bonusMarginThreshold: league.bonusMarginThreshold,
    bonusMinVP: league.bonusMinVP,
    playoffSize: league.playoffSize,
    tiebreakers: [...TIEBREAKER_VALUES],
    matchesPerRound: 2,
    startMonth: league.startMonth,
    ...overrides,
  };
}

/** Every league match with an assigned round, grouped by (roundId, playerId),
 * asserts no group exceeds `matchesPerRound` — SPEC §8 criterio 2, the
 * invariant every redistribution has to preserve. */
async function assertQuotaInvariant(leagueId: string, matchesPerRound: number) {
  const matches = await prisma.match.findMany({
    where: { leagueId, phase: "LEAGUE", roundId: { not: null } },
    select: { roundId: true, playerHomeId: true, playerAwayId: true },
  });
  const counts = new Map<string, number>();
  for (const m of matches) {
    for (const playerId of [m.playerHomeId, m.playerAwayId]) {
      if (!playerId) continue;
      const key = `${m.roundId}|${playerId}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  for (const [key, count] of counts) {
    expect(count, `cupo excedido en ${key}: ${count} > ${matchesPerRound}`).toBeLessThanOrEqual(
      matchesPerRound
    );
  }
}

/** Spy on prisma.$transaction so the very next call runs `injected` first
 * (simulating a concurrent write landing in the window between a plan read
 * and the transaction that applies it), then delegates to the real
 * transaction. Same technique as tests/endurecer-guardas-transaccionales.test.ts
 * (validated there for D5 and the H5b sweep). */
function raceIntoNextTransaction(injected: () => Promise<void>) {
  const originalTransaction = prisma.$transaction.bind(prisma);
  return vi
    .spyOn(prisma, "$transaction")
    .mockImplementationOnce(async (callback: unknown) => {
      await injected();
      return (originalTransaction as (fn: unknown) => Promise<unknown>)(
        callback
      );
    });
}

// ---------------------------------------------------------------------------
// AC-29: alta con la ronda 1 y 2 cerradas
// ---------------------------------------------------------------------------

describe("AC-29: alta de jugador con las rondas 1 y 2 cerradas", () => {
  it("las rondas cerradas y sus resultados quedan idénticos, y las pendientes se reparten respetando el cupo", async () => {
    const league = await createTestLeague({ matchesPerRound: 2 });
    const admin = await createAdmin(league.id);
    mockSession.adminPlayerId = admin.id;

    await Promise.all(
      Array.from({ length: 6 }, (_, i) => createPlayer(league.id, String(i + 1)))
    );

    const genResult = await generateLeagueMatches(league.id);
    expect(genResult.ok).toBe(true);
    if (!genResult.ok) return;
    expect(genResult.data.count).toBe(15); // C(6,2)

    const [round1, round2, round3] = await prisma.round.findMany({
      where: { leagueId: league.id },
      orderBy: { index: "asc" },
    });
    expect(round3).toBeDefined();

    // Report a couple of real results in each of the first two rounds before
    // closing — closing then settles the rest as UNPLAYED_DRAW.
    const round1Matches = await prisma.match.findMany({
      where: { roundId: round1.id },
    });
    const round2Matches = await prisma.match.findMany({
      where: { roundId: round2.id },
    });

    for (const m of [round1Matches[0], round2Matches[0]]) {
      await prisma.result.create({
        data: {
          matchId: m.id,
          homeVictoryPoints: 45,
          awayVictoryPoints: 30,
          outcome: "HOME_WIN",
          resolution: "PLAYED",
          reportedById: m.playerHomeId,
          bonusHome: 0,
          bonusAway: 0,
        },
      });
      await prisma.match.update({
        where: { id: m.id },
        data: { status: "REPORTED" },
      });
    }

    const closeResult1 = await closeRound(round1.id);
    const closeResult2 = await closeRound(round2.id);
    expect(closeResult1.ok).toBe(true);
    expect(closeResult2.ok).toBe(true);

    // Snapshot rounds 1 and 2 (rows + every match's full Result) before the
    // alta happens.
    const roundsBefore = await prisma.round.findMany({
      where: { id: { in: [round1.id, round2.id] } },
      orderBy: { id: "asc" },
    });
    const resultsBefore = await prisma.result.findMany({
      where: { match: { roundId: { in: [round1.id, round2.id] } } },
      orderBy: { matchId: "asc" },
    });
    expect(resultsBefore).toHaveLength(round1Matches.length + round2Matches.length);

    // Alta a mitad de liga.
    await createPlayer(league.id, "7");

    const syncResult = await addMissingLeagueMatches(league.id);
    expect(syncResult.ok).toBe(true);
    if (!syncResult.ok) return;
    expect(syncResult.data.count).toBe(6); // the new 7th player vs the other 6.

    // Closed rounds: identical rows and identical Results.
    const roundsAfter = await prisma.round.findMany({
      where: { id: { in: [round1.id, round2.id] } },
      orderBy: { id: "asc" },
    });
    expect(roundsAfter).toEqual(roundsBefore);

    const resultsAfter = await prisma.result.findMany({
      where: { match: { roundId: { in: [round1.id, round2.id] } } },
      orderBy: { matchId: "asc" },
    });
    expect(resultsAfter).toEqual(resultsBefore);

    // Every pending match now has a round, and the quota invariant holds
    // across the whole league (criterio 2).
    const stillPending = await prisma.match.count({
      where: { leagueId: league.id, phase: "LEAGUE", result: null, roundId: null },
    });
    expect(stillPending).toBe(0);
    await assertQuotaInvariant(league.id, 2);

    const totalMatches = await prisma.match.count({
      where: { leagueId: league.id, phase: "LEAGUE" },
    });
    expect(totalMatches).toBe(21); // C(7,2)
  });
});

// ---------------------------------------------------------------------------
// AC-30: se añaden rondas al final con fechas derivadas de los meses
// siguientes al último cierre
// ---------------------------------------------------------------------------

describe("AC-30: el recálculo añade rondas al final con fechas derivadas del mes siguiente al último cierre", () => {
  it("añade exactamente las rondas que faltan, con fechas de cierre concretas", async () => {
    const league = await createTestLeague({ matchesPerRound: 1 });
    const admin = await createAdmin(league.id);
    mockSession.adminPlayerId = admin.id;

    // A single existing OPEN round, deadline 31 mar 2026 — no matches yet.
    const round1 = await createRound(
      league.id,
      1,
      new Date(Date.UTC(2026, 2, 31))
    );

    await Promise.all(
      Array.from({ length: 4 }, (_, i) => createPlayer(league.id, String(i + 1)))
    );

    const syncResult = await addMissingLeagueMatches(league.id);
    expect(syncResult.ok).toBe(true);
    if (!syncResult.ok) return;
    expect(syncResult.data.count).toBe(6); // C(4,2)

    const rounds = await prisma.round.findMany({
      where: { leagueId: league.id },
      orderBy: { index: "asc" },
    });
    // roundsCount(4, 1) = ceil(3/1) = 3: round1 (existing) + 2 new ones.
    expect(rounds).toHaveLength(3);
    expect(rounds[0].id).toBe(round1.id);
    expect(rounds[0].deadline).toEqual(new Date(Date.UTC(2026, 2, 31)));
    expect(rounds[1].deadline).toEqual(new Date(Date.UTC(2026, 3, 30))); // 30 abr 2026
    expect(rounds[2].deadline).toEqual(new Date(Date.UTC(2026, 4, 31))); // 31 may 2026

    await assertQuotaInvariant(league.id, 1);
    const totalMatches = await prisma.match.count({
      where: { leagueId: league.id, phase: "LEAGUE" },
    });
    expect(totalMatches).toBe(6);
  });
});

// ---------------------------------------------------------------------------
// AC-31: el recálculo no modifica ningún scheduledAt
// ---------------------------------------------------------------------------

describe("AC-31: el recálculo no modifica el scheduledAt de ninguna partida", () => {
  it("conserva scheduledAt incluso en partidas que sí cambian de ronda", async () => {
    const league = await createTestLeague({ matchesPerRound: 2 });
    const admin = await createAdmin(league.id);
    mockSession.adminPlayerId = admin.id;

    const players = await Promise.all(
      Array.from({ length: 5 }, (_, i) => createPlayer(league.id, String(i + 1)))
    );
    const ids = players.map((p) => p.id).sort();

    const round1 = await createRound(league.id, 1, new Date(Date.UTC(2026, 2, 31)));
    const round2 = await createRound(league.id, 2, new Date(Date.UTC(2026, 3, 30)));

    // Every one of K5's 10 pairs, all crammed into round1 on purpose (an
    // intentionally invalid starting state — 4 matches per player in one
    // round, well over the quota of 2) — every one of them already carries
    // a distinct scheduledAt, "the pair had already agreed on a date".
    const pairs: { homeId: string; awayId: string }[] = [];
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        pairs.push({ homeId: ids[i], awayId: ids[j] });
      }
    }
    expect(pairs).toHaveLength(10);

    const created = [];
    for (let i = 0; i < pairs.length; i++) {
      const scheduledAt = new Date(Date.UTC(2026, 1, 1 + i)); // distinct dates
      created.push(
        await createMatch(league.id, round1.id, pairs[i].homeId, pairs[i].awayId, {
          scheduledAt,
        })
      );
    }

    const before = new Map(
      created.map((m) => [m.id, { scheduledAt: m.scheduledAt, roundId: m.roundId }])
    );

    const result = await redistributePending(league.id);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const after = await prisma.match.findMany({
      where: { leagueId: league.id },
      orderBy: { id: "asc" },
    });
    expect(after).toHaveLength(10);

    let movedCount = 0;
    for (const m of after) {
      const b = before.get(m.id)!;
      expect(m.scheduledAt).toEqual(b.scheduledAt); // never touched.
      if (m.roundId !== b.roundId) movedCount++;
    }

    // n=5, matchesPerRound=2 (even) — every open round gets exactly 2
    // matches per player (Walecki, no resting player — see rounds.ts), so
    // round1 (5 players * 2 / 2 = 5 matches) and round2 (5 matches) split the
    // 10 pairs evenly: exactly half of the originally-all-in-round1 matches
    // had to move to round2.
    expect(movedCount).toBe(5);

    const round2CountAfter = after.filter((m) => m.roundId === round2.id).length;
    expect(round2CountAfter).toBe(5);

    await assertQuotaInvariant(league.id, 2);
  });
});

// ---------------------------------------------------------------------------
// AC-32: la baja salda 80-0 WALKOVER con bonus 0 aunque el bonus esté activo
// ---------------------------------------------------------------------------

describe("AC-32: dar de baja a un jugador salda sus pendientes como 80-0 WALKOVER con bonus 0", () => {
  it("salda las partidas pendientes del jugador en rondas abiertas, deja intactas las ya jugadas, y fuerza bonus 0 aunque calculateBonus daría 2", async () => {
    const league = await createTestLeague({
      matchesPerRound: 2,
      bonusEnabled: true,
      bonusMarginThreshold: 20,
      bonusMinVP: 40,
    });
    const admin = await createAdmin(league.id);
    mockSession.adminPlayerId = admin.id;

    const p1 = await createPlayer(league.id, "A");
    const p2 = await createPlayer(league.id, "B");
    const p3 = await createPlayer(league.id, "C");
    const p4 = await createPlayer(league.id, "D");

    const round1 = await createRound(league.id, 1, new Date(Date.UTC(2026, 2, 31)));

    // p1 vs p2 already played — must stay untouched.
    const played = await createMatch(league.id, round1.id, p1.id, p2.id);
    await prisma.result.create({
      data: {
        matchId: played.id,
        homeVictoryPoints: 45,
        awayVictoryPoints: 30,
        outcome: "HOME_WIN",
        resolution: "PLAYED",
        reportedById: p1.id,
        bonusHome: 0,
        bonusAway: 0,
      },
    });
    await prisma.match.update({
      where: { id: played.id },
      data: { status: "REPORTED" },
    });
    const playedBefore = await prisma.result.findUnique({
      where: { matchId: played.id },
    });

    // p1 vs p3 and p1 vs p4 are pending — must be settled 80-0 for the rival.
    const pendingP1P3 = await createMatch(league.id, round1.id, p1.id, p3.id);
    const pendingP1P4 = await createMatch(league.id, round1.id, p1.id, p4.id);
    // p2 vs p3 does not involve p1 — must stay pending (result: null).
    const unrelated = await createMatch(league.id, round1.id, p2.id, p3.id);

    const result = await setPlayerActive(p1.id, false);
    expect(result.ok).toBe(true);

    const playerAfter = await prisma.player.findUnique({ where: { id: p1.id } });
    expect(playerAfter?.active).toBe(false);

    // The already-played match is byte-for-byte untouched.
    const playedAfter = await prisma.result.findUnique({
      where: { matchId: played.id },
    });
    expect(playedAfter).toEqual(playedBefore);

    // p1 vs p3: p1 is home, so the rival (away, p3) wins 80-0.
    const resultP1P3 = await prisma.result.findUnique({
      where: { matchId: pendingP1P3.id },
    });
    expect(resultP1P3).toMatchObject({
      homeVictoryPoints: 0,
      awayVictoryPoints: 80,
      outcome: "AWAY_WIN",
      resolution: "WALKOVER",
      bonusHome: 0,
      bonusAway: 0, // forced 0 even though calculateBonus would give 2 here.
    });

    // p1 vs p4: same shape.
    const resultP1P4 = await prisma.result.findUnique({
      where: { matchId: pendingP1P4.id },
    });
    expect(resultP1P4).toMatchObject({
      homeVictoryPoints: 0,
      awayVictoryPoints: 80,
      outcome: "AWAY_WIN",
      resolution: "WALKOVER",
      bonusHome: 0,
      bonusAway: 0,
    });

    // The unrelated pending match (no p1 involved) is not settled at all.
    const unrelatedResult = await prisma.result.findUnique({
      where: { matchId: unrelated.id },
    });
    expect(unrelatedResult).toBeNull();

    // Sanity: calculateBonus would indeed give a bonus for an 80-0 with this
    // league's config, so bonus 0 here is a deliberate override, not a
    // config accident.
    const { calculateBonus } = await import("@/server/result-logic");
    const wouldBeBonus = calculateBonus(0, 80, "AWAY_WIN", {
      bonusEnabled: true,
      bonusMarginThreshold: 20,
      bonusMinVP: 40,
    });
    expect(wouldBeBonus.bonusAway).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// AC-33: reactivar no revierte los resultados de la baja
// ---------------------------------------------------------------------------

describe("AC-33: reactivar a un jugador no revierte los resultados que produjo su baja", () => {
  it("los WALKOVER quedan exactamente igual tras volver a activar al jugador", async () => {
    const league = await createTestLeague({ matchesPerRound: 2 });
    const admin = await createAdmin(league.id);
    mockSession.adminPlayerId = admin.id;

    const p1 = await createPlayer(league.id, "A");
    const p2 = await createPlayer(league.id, "B");
    const round1 = await createRound(league.id, 1, new Date(Date.UTC(2026, 2, 31)));
    const pending = await createMatch(league.id, round1.id, p1.id, p2.id);

    const deactivate = await setPlayerActive(p1.id, false);
    expect(deactivate.ok).toBe(true);

    const walkoverBefore = await prisma.result.findUnique({
      where: { matchId: pending.id },
    });
    expect(walkoverBefore?.resolution).toBe("WALKOVER");

    const reactivate = await setPlayerActive(p1.id, true);
    expect(reactivate.ok).toBe(true);

    const playerAfter = await prisma.player.findUnique({ where: { id: p1.id } });
    expect(playerAfter?.active).toBe(true);

    const walkoverAfter = await prisma.result.findUnique({
      where: { matchId: pending.id },
    });
    expect(walkoverAfter).toEqual(walkoverBefore);
  });
});

// ---------------------------------------------------------------------------
// AC-34, AC-35: matchesPerRound edit recomputes the reparto
// ---------------------------------------------------------------------------

describe("AC-34: editar matchesPerRound recalcula el reparto respetando el cupo nuevo", () => {
  it("subir de 2 a 3 reduce el número de rondas y no toca la ronda cerrada", async () => {
    const league = await createTestLeague({ matchesPerRound: 2 });
    const admin = await createAdmin(league.id);
    mockSession.adminPlayerId = admin.id;

    // A closed round, decoupled from the K6 group below (its own two
    // players), so the coloring math stays a clean, exact K6 construction.
    const p7 = await createPlayer(league.id, "7");
    const p8 = await createPlayer(league.id, "8");
    const closedRound = await createRound(league.id, 1, PAST);
    await createMatch(league.id, closedRound.id, p7.id, p8.id);
    const closeResult = await closeRound(closedRound.id);
    expect(closeResult.ok).toBe(true);

    const closedRoundBefore = await prisma.round.findUnique({
      where: { id: closedRound.id },
    });
    const closedResultBefore = await prisma.result.findFirst({
      where: { match: { roundId: closedRound.id } },
    });

    // K6, split exactly like `generateLeagueMatches` would for
    // matchesPerRound=2 — via the same pure algorithm, assigned to 3
    // manually-created open rounds so `closedRound` above is untouched by
    // this setup.
    const players = await Promise.all(
      Array.from({ length: 6 }, (_, i) => createPlayer(league.id, `k6-${i + 1}`))
    );
    const rrRounds = roundRobinRounds(
      players.map((p) => p.id),
      2
    );
    expect(rrRounds).toHaveLength(3); // roundsCount(6, 2) = ceil(5/2) = 3

    const openRounds = [];
    for (let i = 0; i < rrRounds.length; i++) {
      openRounds.push(
        await createRound(league.id, i + 2, new Date(Date.UTC(2026, 2 + i, 28)))
      );
    }
    for (let i = 0; i < rrRounds.length; i++) {
      for (const pairing of rrRounds[i]) {
        await createMatch(league.id, openRounds[i].id, pairing.homeId, pairing.awayId);
      }
    }
    const totalBefore = await prisma.match.count({
      where: { leagueId: league.id, phase: "LEAGUE" },
    });
    expect(totalBefore).toBe(16); // C(6,2) + the p7-vs-p8 closed one.

    const config = baseLeagueConfig(league, { matchesPerRound: 3 });
    const updateResult = await updateLeague(league.id, config);
    expect(updateResult.ok).toBe(true);

    // The closed round and its Result are completely untouched.
    const closedRoundAfter = await prisma.round.findUnique({
      where: { id: closedRound.id },
    });
    expect(closedRoundAfter).toEqual(closedRoundBefore);
    const closedResultAfter = await prisma.result.findFirst({
      where: { match: { roundId: closedRound.id } },
    });
    expect(closedResultAfter).toEqual(closedResultBefore);

    // roundsCount(6, 3) = ceil(5/3) = 2: exactly 2 open rounds survive — the
    // 3rd one (fully emptied by the new, coarser grouping) gets deleted.
    const openRoundsAfter = await prisma.round.findMany({
      where: { leagueId: league.id, closedAt: null },
      orderBy: { index: "asc" },
    });
    expect(openRoundsAfter).toHaveLength(2);
    const deletedRound = await prisma.round.findUnique({
      where: { id: openRounds[2].id },
    });
    expect(deletedRound).toBeNull();

    await assertQuotaInvariant(league.id, 3);
    const totalAfter = await prisma.match.count({
      where: { leagueId: league.id, phase: "LEAGUE" },
    });
    expect(totalAfter).toBe(totalBefore); // nothing created or destroyed.
  });
});

describe("AC-35: bajar matchesPerRound de 2 a 1 aumenta el número de rondas", () => {
  it("añade las rondas que hagan falta para respetar el cupo nuevo, más estrecho", async () => {
    const league = await createTestLeague({ matchesPerRound: 2 });
    const admin = await createAdmin(league.id);
    mockSession.adminPlayerId = admin.id;

    const players = await Promise.all(
      Array.from({ length: 6 }, (_, i) => createPlayer(league.id, `k6-${i + 1}`))
    );
    const rrRounds = roundRobinRounds(
      players.map((p) => p.id),
      2
    );
    expect(rrRounds).toHaveLength(3);

    const openRounds = [];
    for (let i = 0; i < rrRounds.length; i++) {
      openRounds.push(
        await createRound(league.id, i + 1, new Date(Date.UTC(2026, 2 + i, 28)))
      );
    }
    for (let i = 0; i < rrRounds.length; i++) {
      for (const pairing of rrRounds[i]) {
        await createMatch(league.id, openRounds[i].id, pairing.homeId, pairing.awayId);
      }
    }

    const config = baseLeagueConfig(league, { matchesPerRound: 1 });
    const updateResult = await updateLeague(league.id, config);
    expect(updateResult.ok).toBe(true);

    // roundsCount(6, 1) = ceil(5/1) = 5: 3 existing open rounds are not
    // enough, 2 new ones get appended.
    const roundsAfter = await prisma.round.findMany({
      where: { leagueId: league.id },
      orderBy: { index: "asc" },
    });
    expect(roundsAfter).toHaveLength(5);

    await assertQuotaInvariant(league.id, 1);
    const totalAfter = await prisma.match.count({
      where: { leagueId: league.id, phase: "LEAGUE" },
    });
    expect(totalAfter).toBe(15); // C(6,2), nothing created or destroyed.
  });
});

// ---------------------------------------------------------------------------
// Endurecimiento (H5b pattern): un closeRound que aterriza en la ventana no
// debe recibir partidas nuevas.
// ---------------------------------------------------------------------------

describe("H8 endurecimiento: redistributePending compite con closeRound", () => {
  it("un cierre de ronda que aterriza en la ventana entre el plan y la escritura aborta el recálculo, sin colar partidas en la ronda recién cerrada", async () => {
    const league = await createTestLeague({ matchesPerRound: 2 });
    const admin = await createAdmin(league.id);
    mockSession.adminPlayerId = admin.id;

    const players = await Promise.all(
      Array.from({ length: 4 }, (_, i) => createPlayer(league.id, String(i + 1)))
    );
    const rrRounds = roundRobinRounds(
      players.map((p) => p.id),
      2
    );
    expect(rrRounds).toHaveLength(2); // roundsCount(4, 2) = ceil(3/2) = 2

    const round1 = await createRound(league.id, 1, PAST); // due — closeable
    const round2 = await createRound(league.id, 2, new Date(Date.UTC(2026, 5, 30)));
    for (const pairing of rrRounds[0]) {
      await createMatch(league.id, round1.id, pairing.homeId, pairing.awayId);
    }
    for (const pairing of rrRounds[1]) {
      await createMatch(league.id, round2.id, pairing.homeId, pairing.awayId);
    }

    const round2MatchesBefore = await prisma.match.findMany({
      where: { roundId: round2.id },
      orderBy: { id: "asc" },
    });

    // Land a real closeRound(round1) squarely in the window between
    // redistributePending's plan (read before the transaction) and the
    // transaction that would otherwise apply it.
    const spy = raceIntoNextTransaction(async () => {
      const closeResult = await closeRound(round1.id);
      expect(closeResult.ok).toBe(true);
    });

    const result = await redistributePending(league.id);

    spy.mockRestore();

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/cerr/i);

    // round1 is closed, and every match it held got settled by closeRound
    // itself (0-0 UNPLAYED_DRAW) — not by any stray write from the aborted
    // redistribution.
    const round1After = await prisma.round.findUnique({ where: { id: round1.id } });
    expect(round1After?.closedAt).not.toBeNull();
    const round1MatchesAfter = await prisma.match.findMany({
      where: { roundId: round1.id },
      include: { result: true },
    });
    for (const m of round1MatchesAfter) {
      expect(m.result?.resolution).toBe("UNPLAYED_DRAW");
    }

    // round2 — never touched by the aborted transaction — keeps exactly its
    // original matches.
    const round2MatchesAfter = await prisma.match.findMany({
      where: { roundId: round2.id },
      orderBy: { id: "asc" },
    });
    expect(round2MatchesAfter).toEqual(round2MatchesBefore);
  });
});
