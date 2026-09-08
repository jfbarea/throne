// Tests for Hito 5: incomparecencia (feature "rondas-con-fecha").
// Covers spec criteria 23-26 (plan/specs/rondas-con-fecha.md §8) — see
// plan/rondas-con-fecha/PLAN.md §H5.
//
// Write tests against the real test database (file:./test.db) that
// vitest.config.ts injects and tests/db-global-setup.ts migrates (spec §7.3).
// Only next/cache and @/lib/guards are mocked — @/lib/db stays real, same
// pattern as tests/cierre-de-ronda.test.ts.

import { describe, it, expect, vi } from "vitest";

// A mutable session the mocked guards read from, same convention as
// tests/cierre-de-ronda.test.ts.
const mockSession = vi.hoisted(() => ({
  role: "PLAYER" as "ADMIN" | "PLAYER",
  playerId: null as string | null,
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/guards", () => ({
  requireAuth: vi.fn(async () => ({
    role: mockSession.role,
    playerId: mockSession.playerId,
  })),
  requireAdmin: vi.fn(async () => ({
    role: "ADMIN",
    playerId: mockSession.playerId,
  })),
}));

import { prisma } from "@/lib/db";
import { declareWalkover, reportResult } from "@/server/result-actions";
import { calculateBonus, WALKOVER_VICTORY_POINTS } from "@/server/result-logic";
import { computeStandings, type StandingsMatch } from "@/server/standings";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function uid(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function createTestLeague(
  overrides: {
    bonusEnabled?: boolean;
    bonusMarginThreshold?: number | null;
    bonusMinVP?: number | null;
  } = {}
) {
  return prisma.league.create({
    data: {
      id: uid("league"),
      name: "Liga de test H5",
      season: "2026 Test",
      matchesPerRound: 2,
      startMonth: new Date(Date.UTC(2026, 2, 1)),
      bonusEnabled: overrides.bonusEnabled ?? false,
      bonusMarginThreshold: overrides.bonusMarginThreshold ?? null,
      bonusMinVP: overrides.bonusMinVP ?? null,
    },
  });
}

async function createAdmin(leagueId: string) {
  return prisma.player.create({
    data: {
      id: uid("admin"),
      leagueId,
      displayName: "Admin de test H5",
      role: "ADMIN",
      passcodeHash: "test-hash",
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

async function createMatch(
  leagueId: string,
  homeId: string,
  awayId: string | null,
  overrides: { phase?: "LEAGUE" | "PLAYOFF"; roundId?: string } = {}
) {
  return prisma.match.create({
    data: {
      leagueId,
      phase: overrides.phase ?? "LEAGUE",
      status: "SCHEDULED",
      playerHomeId: homeId,
      playerAwayId: awayId,
      roundId: overrides.roundId,
    },
  });
}

async function createRound(leagueId: string, index: number, deadline: Date) {
  return prisma.round.create({ data: { leagueId, index, deadline } });
}

const PAST = new Date(Date.now() - 24 * 60 * 60 * 1000);

// ---------------------------------------------------------------------------
// AC-23: cualquiera de los dos participantes declara la incomparecencia
// ---------------------------------------------------------------------------

describe("AC-23: cualquiera de los dos participantes declara la incomparecencia eligiendo vencedor", () => {
  it("el jugador local declara vencedor al visitante: Result 80-0 a su favor con resolution WALKOVER", async () => {
    const league = await createTestLeague();
    const home = await createPlayer(league.id, "A");
    const away = await createPlayer(league.id, "B");
    const match = await createMatch(league.id, home.id, away.id);

    mockSession.role = "PLAYER";
    mockSession.playerId = home.id;

    const res = await declareWalkover(match.id, { winnerId: away.id });
    expect(res.ok).toBe(true);

    const result = await prisma.result.findUnique({ where: { matchId: match.id } });
    expect(result).toMatchObject({
      homeVictoryPoints: 0,
      awayVictoryPoints: WALKOVER_VICTORY_POINTS,
      outcome: "AWAY_WIN",
      resolution: "WALKOVER",
    });
  });

  it("el jugador visitante declara vencedor al local: Result 80-0 a su favor con resolution WALKOVER", async () => {
    const league = await createTestLeague();
    const home = await createPlayer(league.id, "A");
    const away = await createPlayer(league.id, "B");
    const match = await createMatch(league.id, home.id, away.id);

    // The AWAY participant declares it, not the home one — both must work.
    mockSession.role = "PLAYER";
    mockSession.playerId = away.id;

    const res = await declareWalkover(match.id, { winnerId: home.id });
    expect(res.ok).toBe(true);

    const result = await prisma.result.findUnique({ where: { matchId: match.id } });
    expect(result).toMatchObject({
      homeVictoryPoints: WALKOVER_VICTORY_POINTS,
      awayVictoryPoints: 0,
      outcome: "HOME_WIN",
      resolution: "WALKOVER",
    });

    const matchAfter = await prisma.match.findUnique({ where: { id: match.id } });
    expect(matchAfter?.status).toBe("REPORTED");
  });

  it("rechaza a un tercero que no es participante ni admin", async () => {
    const league = await createTestLeague();
    const home = await createPlayer(league.id, "A");
    const away = await createPlayer(league.id, "B");
    const stranger = await createPlayer(league.id, "C");
    const match = await createMatch(league.id, home.id, away.id);

    mockSession.role = "PLAYER";
    mockSession.playerId = stranger.id;

    const res = await declareWalkover(match.id, { winnerId: home.id });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toMatch(/no eres participante/i);
  });

  it("rechaza declarar vencedor a un tercero, aunque quien llama sí sea participante", async () => {
    const league = await createTestLeague();
    const home = await createPlayer(league.id, "A");
    const away = await createPlayer(league.id, "B");
    const stranger = await createPlayer(league.id, "C");
    const match = await createMatch(league.id, home.id, away.id);

    mockSession.role = "PLAYER";
    mockSession.playerId = home.id;

    const res = await declareWalkover(match.id, { winnerId: stranger.id });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toMatch(/uno de los dos participantes/i);

    const result = await prisma.result.findUnique({ where: { matchId: match.id } });
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// AC-24: bonus forzado a 0, incluso con config que daría bonus real
// ---------------------------------------------------------------------------

describe("AC-24: el Result de incomparecencia lleva bonus 0-0 aunque calculateBonus daría 2", () => {
  it("persiste bonusHome=bonusAway=0 con la config del seed, sin pasar por calculateBonus", async () => {
    // Same config as prisma/seed.ts: bonusEnabled true, margin 20, minVP 40.
    const league = await createTestLeague({
      bonusEnabled: true,
      bonusMarginThreshold: 20,
      bonusMinVP: 40,
    });
    const home = await createPlayer(league.id, "A");
    const away = await createPlayer(league.id, "B");
    const match = await createMatch(league.id, home.id, away.id);

    // Proof that calculateBonus WOULD give 2 for an 80-0 with this config —
    // this is the whole reason the action must not call it.
    const wouldBe = calculateBonus(WALKOVER_VICTORY_POINTS, 0, "HOME_WIN", {
      bonusEnabled: league.bonusEnabled,
      bonusMarginThreshold: league.bonusMarginThreshold,
      bonusMinVP: league.bonusMinVP,
    });
    expect(wouldBe).toEqual({ bonusHome: 2, bonusAway: 0 });

    mockSession.role = "PLAYER";
    mockSession.playerId = home.id;
    const res = await declareWalkover(match.id, { winnerId: home.id });
    expect(res.ok).toBe(true);

    const result = await prisma.result.findUnique({ where: { matchId: match.id } });
    expect(result?.bonusHome).toBe(0);
    expect(result?.bonusAway).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// AC-25: el otro participante sobrescribe con el resultado real
// ---------------------------------------------------------------------------

describe("AC-25: el otro participante sobrescribe la incomparecencia con el resultado real", () => {
  it("deja dos entradas en AuditLog (REPORT_RESULT y EDIT_RESULT) y resolution pasa a PLAYED", async () => {
    const league = await createTestLeague();
    const home = await createPlayer(league.id, "A");
    const away = await createPlayer(league.id, "B");
    const match = await createMatch(league.id, home.id, away.id);

    // Home declares a (possibly self-serving) walkover in their own favor.
    mockSession.role = "PLAYER";
    mockSession.playerId = home.id;
    const declared = await declareWalkover(match.id, { winnerId: home.id });
    expect(declared.ok).toBe(true);

    // Away — the other participant — corrects it with the real score.
    mockSession.role = "PLAYER";
    mockSession.playerId = away.id;
    const corrected = await reportResult(match.id, {
      homeVictoryPoints: 45,
      awayVictoryPoints: 38,
    });
    expect(corrected.ok).toBe(true);

    const result = await prisma.result.findUnique({ where: { matchId: match.id } });
    expect(result).toMatchObject({
      homeVictoryPoints: 45,
      awayVictoryPoints: 38,
      outcome: "HOME_WIN",
      resolution: "PLAYED",
    });

    const logs = await prisma.auditLog.findMany({
      where: { entityType: "Match", entityId: match.id },
      orderBy: { createdAt: "asc" },
    });
    expect(logs.map((l) => l.action)).toEqual(["REPORT_RESULT", "EDIT_RESULT"]);
    expect(logs[0].actorId).toBe(home.id);
    expect(logs[1].actorId).toBe(away.id);
  });
});

// ---------------------------------------------------------------------------
// AC-26: en la clasificación, el vencedor suma 3 puntos y 80 VP a favor; el
// ausente 0 puntos y 80 VP en contra
// ---------------------------------------------------------------------------

describe("AC-26: en la clasificación, el vencedor de una incomparecencia suma 3 puntos y 80 VP a favor; el ausente 0 y 80 en contra", () => {
  it("computeStandings procesa el 80-0 WALKOVER con los puntos y VP de una victoria normal", async () => {
    const league = await createTestLeague();
    const home = await createPlayer(league.id, "A");
    const away = await createPlayer(league.id, "B");
    const match = await createMatch(league.id, home.id, away.id);

    mockSession.role = "PLAYER";
    mockSession.playerId = home.id;
    const res = await declareWalkover(match.id, { winnerId: home.id });
    expect(res.ok).toBe(true);

    const matchAfter = await prisma.match.findUniqueOrThrow({
      where: { id: match.id },
      include: { result: true },
    });

    const standingsMatches: StandingsMatch[] = [
      {
        id: matchAfter.id,
        status: matchAfter.status,
        phase: matchAfter.phase,
        playerHomeId: matchAfter.playerHomeId,
        playerAwayId: matchAfter.playerAwayId,
        result: matchAfter.result
          ? {
              homeVictoryPoints: matchAfter.result.homeVictoryPoints,
              awayVictoryPoints: matchAfter.result.awayVictoryPoints,
              outcome: matchAfter.result.outcome,
              bonusHome: matchAfter.result.bonusHome,
              bonusAway: matchAfter.result.bonusAway,
            }
          : null,
      },
    ];

    const rows = computeStandings(standingsMatches, {
      pointsWin: league.pointsWin,
      pointsDraw: league.pointsDraw,
      pointsLoss: league.pointsLoss,
      tiebreakers: league.tiebreakers,
      playoffSize: league.playoffSize,
    });

    const winnerRow = rows.find((r) => r.playerId === home.id);
    const loserRow = rows.find((r) => r.playerId === away.id);

    expect(winnerRow).toMatchObject({ points: 3, vpFor: 80, vpAgainst: 0 });
    expect(loserRow).toMatchObject({ points: 0, vpFor: 0, vpAgainst: 80 });
  });
});

// ---------------------------------------------------------------------------
// Regression: guards reused as-is and scope decisions, not tied to a
// numbered criterion, but exercised for completeness (same convention as
// tests/cierre-de-ronda.test.ts's "rutas de error adicionales").
// ---------------------------------------------------------------------------

describe("declareWalkover: guardas y decisiones de alcance", () => {
  it("el admin puede declarar la incomparecencia sin ser participante", async () => {
    const league = await createTestLeague();
    const admin = await createAdmin(league.id);
    const home = await createPlayer(league.id, "A");
    const away = await createPlayer(league.id, "B");
    const match = await createMatch(league.id, home.id, away.id);

    mockSession.role = "ADMIN";
    mockSession.playerId = admin.id;

    const res = await declareWalkover(match.id, { winnerId: home.id });
    expect(res.ok).toBe(true);
  });

  it("bloquea a un participante en una ronda cerrada; el admin conserva su override", async () => {
    const league = await createTestLeague();
    const admin = await createAdmin(league.id);
    const home = await createPlayer(league.id, "A");
    const away = await createPlayer(league.id, "B");
    const round = await createRound(league.id, 1, PAST);
    await prisma.round.update({ where: { id: round.id }, data: { closedAt: new Date() } });
    const match = await createMatch(league.id, home.id, away.id, { roundId: round.id });

    mockSession.role = "PLAYER";
    mockSession.playerId = home.id;
    const playerAttempt = await declareWalkover(match.id, { winnerId: home.id });
    expect(playerAttempt.ok).toBe(false);
    if (playerAttempt.ok) return;
    expect(playerAttempt.error).toMatch(/cerrada/i);

    mockSession.role = "ADMIN";
    mockSession.playerId = admin.id;
    const adminAttempt = await declareWalkover(match.id, { winnerId: home.id });
    expect(adminAttempt.ok).toBe(true);
  });

  it("rechaza declarar incomparecencia en una partida de playoff (concepto ligado a rondas de liga)", async () => {
    const league = await createTestLeague();
    const home = await createPlayer(league.id, "A");
    const away = await createPlayer(league.id, "B");
    const match = await createMatch(league.id, home.id, away.id, { phase: "PLAYOFF" });

    mockSession.role = "PLAYER";
    mockSession.playerId = home.id;
    const res = await declareWalkover(match.id, { winnerId: home.id });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toMatch(/fase de liga/i);
  });

  it("rechaza declarar incomparecencia en una partida sin rival (bye)", async () => {
    const league = await createTestLeague();
    const home = await createPlayer(league.id, "A");
    const match = await createMatch(league.id, home.id, null);

    mockSession.role = "PLAYER";
    mockSession.playerId = home.id;
    const res = await declareWalkover(match.id, { winnerId: home.id });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toMatch(/sin rival/i);
  });

  it("permite sobrescribir un resultado ya jugado con una incomparecencia (mismo modelo de confianza que reportResult)", async () => {
    const league = await createTestLeague();
    const home = await createPlayer(league.id, "A");
    const away = await createPlayer(league.id, "B");
    const match = await createMatch(league.id, home.id, away.id);

    mockSession.role = "PLAYER";
    mockSession.playerId = home.id;
    const played = await reportResult(match.id, {
      homeVictoryPoints: 45,
      awayVictoryPoints: 38,
    });
    expect(played.ok).toBe(true);

    const overwritten = await declareWalkover(match.id, { winnerId: away.id });
    expect(overwritten.ok).toBe(true);

    const result = await prisma.result.findUnique({ where: { matchId: match.id } });
    expect(result).toMatchObject({
      homeVictoryPoints: 0,
      awayVictoryPoints: WALKOVER_VICTORY_POINTS,
      outcome: "AWAY_WIN",
      resolution: "WALKOVER",
    });
  });
});
