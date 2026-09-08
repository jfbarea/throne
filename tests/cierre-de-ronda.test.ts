// Tests for Hito 4: cierre-de-ronda (feature "rondas-con-fecha").
// Covers spec criteria 15-22 (plan/specs/rondas-con-fecha.md §8) — see
// plan/rondas-con-fecha/PLAN.md §H4.
//
// Write tests against the real test database (file:./test.db) that
// vitest.config.ts injects and tests/db-global-setup.ts migrates (spec §7.3).
// Only next/cache and @/lib/guards are mocked — @/lib/db stays real, same
// pattern as tests/generar-con-rondas.test.ts.
//
// Rounds and matches are built directly with `prisma` (not via
// generateLeagueMatches) so each test controls exactly which deadlines are
// past/future and which matches already have a Result — that's the whole
// point of these criteria.

import { describe, it, expect, vi } from "vitest";

// A mutable session the mocked guards read from. `requireAdmin` (closeRound)
// always succeeds and uses `adminPlayerId`; `requireAuth` (reportResult)
// reflects whatever role/playerId the test sets, so the same file can
// exercise both the admin-only close action and the participant-vs-admin
// paths of reportResult.
const mockSession = vi.hoisted(() => ({
  adminPlayerId: null as string | null,
  role: "ADMIN" as "ADMIN" | "PLAYER",
  playerId: null as string | null,
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/guards", () => ({
  requireAdmin: vi.fn(async () => ({
    role: "ADMIN",
    playerId: mockSession.adminPlayerId,
  })),
  requireAuth: vi.fn(async () => ({
    role: mockSession.role,
    playerId: mockSession.playerId,
  })),
}));

import { prisma } from "@/lib/db";
import { closeRound } from "@/server/round-actions";
import { reportResult } from "@/server/result-actions";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function uid(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

const PAST = new Date(Date.now() - 24 * 60 * 60 * 1000);
const FUTURE = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
const FAR_FUTURE = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000);

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
      name: "Liga de test H4",
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
      displayName: "Admin de test H4",
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

async function createRound(leagueId: string, index: number, deadline: Date) {
  return prisma.round.create({ data: { leagueId, index, deadline } });
}

async function createMatch(
  leagueId: string,
  roundId: string,
  homeId: string,
  awayId: string
) {
  return prisma.match.create({
    data: {
      leagueId,
      roundId,
      phase: "LEAGUE",
      status: "SCHEDULED",
      playerHomeId: homeId,
      playerAwayId: awayId,
    },
  });
}

// ---------------------------------------------------------------------------
// AC-17: «Cerrar ronda N» exige que la fecha de cierre ya haya pasado
// ---------------------------------------------------------------------------

describe("AC-17: cerrar ronda antes de la fecha de cierre", () => {
  it("rechaza cerrar una ronda cuya fecha límite todavía no ha llegado, y no la toca", async () => {
    const league = await createTestLeague();
    const admin = await createAdmin(league.id);
    mockSession.adminPlayerId = admin.id;
    const round = await createRound(league.id, 1, FUTURE);

    const result = await closeRound(round.id);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/fecha/i);

    const after = await prisma.round.findUnique({ where: { id: round.id } });
    expect(after?.closedAt).toBeNull();
  });

  it("permite cerrar una ronda cuya fecha límite ya pasó", async () => {
    const league = await createTestLeague();
    const admin = await createAdmin(league.id);
    mockSession.adminPlayerId = admin.id;
    const round = await createRound(league.id, 1, PAST);

    const result = await closeRound(round.id);
    expect(result.ok).toBe(true);

    const after = await prisma.round.findUnique({ where: { id: round.id } });
    expect(after?.closedAt).not.toBeNull();
  });

  it("rechaza cerrar una ronda que ya está cerrada (no hay forzado ni doble cierre)", async () => {
    const league = await createTestLeague();
    const admin = await createAdmin(league.id);
    mockSession.adminPlayerId = admin.id;
    const round = await createRound(league.id, 1, PAST);
    await closeRound(round.id);

    const result = await closeRound(round.id);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/ya está cerrada/i);
  });
});

// ---------------------------------------------------------------------------
// AC-18: TODAS las partidas sin Result reciben el 0-0 UNPLAYED_DRAW
// ---------------------------------------------------------------------------

describe("AC-18: al cerrar, todas las partidas sin Result reciben 0-0 UNPLAYED_DRAW", () => {
  it("salda las tres partidas sin resultado de la ronda, no solo la primera", async () => {
    const league = await createTestLeague();
    const admin = await createAdmin(league.id);
    mockSession.adminPlayerId = admin.id;
    const p1 = await createPlayer(league.id, "A");
    const p2 = await createPlayer(league.id, "B");
    const p3 = await createPlayer(league.id, "C");
    const p4 = await createPlayer(league.id, "D");
    const round = await createRound(league.id, 1, PAST);
    const m1 = await createMatch(league.id, round.id, p1.id, p2.id);
    const m2 = await createMatch(league.id, round.id, p3.id, p4.id);
    const m3 = await createMatch(league.id, round.id, p1.id, p3.id);

    const result = await closeRound(round.id);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.settledCount).toBe(3);

    for (const m of [m1, m2, m3]) {
      const withResult = await prisma.match.findUnique({
        where: { id: m.id },
        include: { result: true },
      });
      expect(withResult?.status).toBe("REPORTED");
      expect(withResult?.result).toMatchObject({
        homeVictoryPoints: 0,
        awayVictoryPoints: 0,
        outcome: "DRAW",
        resolution: "UNPLAYED_DRAW",
        bonusHome: 0,
        bonusAway: 0,
      });
    }
  });
});

// ---------------------------------------------------------------------------
// AC-19: las partidas que ya tenían Result quedan intactas
// ---------------------------------------------------------------------------

describe("AC-19: al cerrar, las partidas que ya tenían Result quedan intactas", () => {
  it("no modifica VP, outcome, bonus ni resolution de una partida ya jugada, y no la cuenta como saldada", async () => {
    const league = await createTestLeague({
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
    const round = await createRound(league.id, 1, PAST);
    const playedMatch = await createMatch(league.id, round.id, p1.id, p2.id);
    const pendingMatch = await createMatch(league.id, round.id, p3.id, p4.id);

    await prisma.result.create({
      data: {
        matchId: playedMatch.id,
        homeVictoryPoints: 55,
        awayVictoryPoints: 30,
        outcome: "HOME_WIN",
        resolution: "PLAYED",
        reportedById: p1.id,
        bonusHome: 2,
        bonusAway: 0,
      },
    });
    await prisma.match.update({
      where: { id: playedMatch.id },
      data: { status: "REPORTED" },
    });

    const before = await prisma.result.findUnique({
      where: { matchId: playedMatch.id },
    });

    const result = await closeRound(round.id);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Only the pending match gets settled — the played one is left alone.
    expect(result.data.settledCount).toBe(1);

    const after = await prisma.result.findUnique({
      where: { matchId: playedMatch.id },
    });
    expect(after).toEqual(before);

    const pendingAfter = await prisma.result.findUnique({
      where: { matchId: pendingMatch.id },
    });
    expect(pendingAfter?.resolution).toBe("UNPLAYED_DRAW");
  });
});

// ---------------------------------------------------------------------------
// AC-20: el cierre escribe una entrada de AuditLog con el admin como actor
// ---------------------------------------------------------------------------

describe("AC-20: el cierre escribe una entrada de AuditLog con el admin como actor", () => {
  it("registra CLOSE_ROUND con actorId = admin de la sesión", async () => {
    const league = await createTestLeague();
    const admin = await createAdmin(league.id);
    mockSession.adminPlayerId = admin.id;
    const round = await createRound(league.id, 1, PAST);

    const result = await closeRound(round.id);
    expect(result.ok).toBe(true);

    const entry = await prisma.auditLog.findFirst({
      where: {
        entityType: "Round",
        entityId: round.id,
        action: "CLOSE_ROUND",
      },
    });
    expect(entry).not.toBeNull();
    expect(entry?.actorId).toBe(admin.id);
  });
});

// ---------------------------------------------------------------------------
// AC-21: tras el cierre, un participante no puede apuntar; el admin puede
// editar y la ronda no se reabre
// ---------------------------------------------------------------------------

describe("AC-21: tras el cierre, un participante no puede apuntar; el admin puede editar y no reabre", () => {
  it("rechaza el intento de un participante y permite el override del admin sin reabrir la ronda", async () => {
    const league = await createTestLeague();
    const admin = await createAdmin(league.id);
    const p1 = await createPlayer(league.id, "A");
    const p2 = await createPlayer(league.id, "B");
    const round = await createRound(league.id, 1, PAST);
    const match = await createMatch(league.id, round.id, p1.id, p2.id);

    mockSession.role = "ADMIN";
    mockSession.playerId = admin.id;
    mockSession.adminPlayerId = admin.id;
    const closeResult = await closeRound(round.id);
    expect(closeResult.ok).toBe(true);

    // A participant tries to apuntar the real result on the now-closed round.
    mockSession.role = "PLAYER";
    mockSession.playerId = p1.id;
    const playerAttempt = await reportResult(match.id, {
      homeVictoryPoints: 45,
      awayVictoryPoints: 38,
    });
    expect(playerAttempt.ok).toBe(false);
    if (playerAttempt.ok) return;
    expect(playerAttempt.error).toMatch(/cerrada/i);

    // The rejected attempt wrote nothing — the settled 0-0 is still there.
    const untouched = await prisma.result.findUnique({
      where: { matchId: match.id },
    });
    expect(untouched?.resolution).toBe("UNPLAYED_DRAW");

    // The admin overrides with the real result (SPEC §7.5 override).
    mockSession.role = "ADMIN";
    mockSession.playerId = admin.id;
    const adminEdit = await reportResult(match.id, {
      homeVictoryPoints: 45,
      awayVictoryPoints: 38,
    });
    expect(adminEdit.ok).toBe(true);

    const edited = await prisma.result.findUnique({
      where: { matchId: match.id },
    });
    expect(edited).toMatchObject({
      homeVictoryPoints: 45,
      awayVictoryPoints: 38,
      outcome: "HOME_WIN",
      resolution: "PLAYED",
    });

    // Editing never reopens the round.
    const roundAfter = await prisma.round.findUnique({ where: { id: round.id } });
    expect(roundAfter?.closedAt).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// AC-22: se puede cerrar la ronda 4 con la ronda 3 abierta
// ---------------------------------------------------------------------------

describe("AC-22: se puede cerrar la ronda 4 con la ronda 3 abierta", () => {
  it("cierra la ronda 4 sin afectar a la ronda 3, que sigue abierta con sus partidas intactas", async () => {
    const league = await createTestLeague();
    const admin = await createAdmin(league.id);
    mockSession.adminPlayerId = admin.id;
    const p1 = await createPlayer(league.id, "A");
    const p2 = await createPlayer(league.id, "B");

    const round3 = await createRound(league.id, 3, FUTURE);
    const round4 = await createRound(league.id, 4, PAST);
    const matchRound3 = await createMatch(league.id, round3.id, p1.id, p2.id);
    const matchRound4 = await createMatch(league.id, round4.id, p1.id, p2.id);

    const result = await closeRound(round4.id);
    expect(result.ok).toBe(true);

    const round3After = await prisma.round.findUnique({ where: { id: round3.id } });
    expect(round3After?.closedAt).toBeNull();

    const round4After = await prisma.round.findUnique({ where: { id: round4.id } });
    expect(round4After?.closedAt).not.toBeNull();

    const matchRound3After = await prisma.result.findUnique({
      where: { matchId: matchRound3.id },
    });
    expect(matchRound3After).toBeNull();

    const matchRound4After = await prisma.result.findUnique({
      where: { matchId: matchRound4.id },
    });
    expect(matchRound4After?.resolution).toBe("UNPLAYED_DRAW");
  });
});

// ---------------------------------------------------------------------------
// Regression: closeRound error paths not tied to a numbered criterion, but
// exercised for completeness (round missing, admin session without a player).
// ---------------------------------------------------------------------------

describe("closeRound: rutas de error adicionales", () => {
  it("devuelve error si la ronda no existe", async () => {
    mockSession.adminPlayerId = null;
    const result = await closeRound("round-que-no-existe");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/no encontrada/i);
  });

  it("devuelve error si la sesión de admin no tiene jugador asociado", async () => {
    const league = await createTestLeague();
    mockSession.adminPlayerId = null;
    const round = await createRound(league.id, 1, PAST);

    const result = await closeRound(round.id);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/jugador asociado/i);

    const after = await prisma.round.findUnique({ where: { id: round.id } });
    expect(after?.closedAt).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// AC-15: adelantar una partida de una ronda posterior no da error
// ---------------------------------------------------------------------------

describe("AC-15: un jugador a 0 de 2 puede apuntar sin error una partida de una ronda posterior", () => {
  it("reportResult acepta la partida adelantada mientras la ronda actual del jugador sigue sin resolver", async () => {
    const league = await createTestLeague();
    const p1 = await createPlayer(league.id, "A");
    const p2 = await createPlayer(league.id, "B");
    const p3 = await createPlayer(league.id, "C");

    // Round 1 is "the round that closes this month" — still open (deadline
    // not reached yet), p1 has 0 of 2 there. Round 2 is a later round.
    const round1 = await createRound(league.id, 1, FUTURE);
    const round2 = await createRound(league.id, 2, FAR_FUTURE);
    const currentRoundMatch = await createMatch(league.id, round1.id, p1.id, p2.id);
    const laterMatch = await createMatch(league.id, round2.id, p1.id, p3.id);

    mockSession.role = "PLAYER";
    mockSession.playerId = p1.id;

    const result = await reportResult(laterMatch.id, {
      homeVictoryPoints: 40,
      awayVictoryPoints: 20,
    });
    expect(result.ok).toBe(true);

    // No guard blocked it, and it didn't touch the still-pending current match.
    const currentAfter = await prisma.result.findUnique({
      where: { matchId: currentRoundMatch.id },
    });
    expect(currentAfter).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// AC-16: al cerrarse la ronda actual, el jugador recibe el saldo Y la
// partida adelantada queda intacta en su propia ronda
// ---------------------------------------------------------------------------

describe("AC-16: el jugador recibe el saldo de su ronda cerrada y la partida adelantada queda intacta", () => {
  it("cierra la ronda 1 con un 0-0 mientras la partida adelantada de la ronda 2 conserva su resultado real", async () => {
    const league = await createTestLeague();
    const admin = await createAdmin(league.id);
    const p1 = await createPlayer(league.id, "A");
    const p2 = await createPlayer(league.id, "B");
    const p3 = await createPlayer(league.id, "C");

    const round1 = await createRound(league.id, 1, PAST); // closes this month
    const round2 = await createRound(league.id, 2, FUTURE);
    const currentMatch = await createMatch(league.id, round1.id, p1.id, p2.id);
    const laterMatch = await createMatch(league.id, round2.id, p1.id, p3.id);

    // p1 adelanta su partida de la ronda 2 antes de que cierre la ronda 1.
    mockSession.role = "PLAYER";
    mockSession.playerId = p1.id;
    const advanceResult = await reportResult(laterMatch.id, {
      homeVictoryPoints: 42,
      awayVictoryPoints: 30,
    });
    expect(advanceResult.ok).toBe(true);

    // Se cierra la ronda 1: currentMatch sigue sin resultado y se salda.
    mockSession.role = "ADMIN";
    mockSession.playerId = admin.id;
    mockSession.adminPlayerId = admin.id;
    const closeResult = await closeRound(round1.id);
    expect(closeResult.ok).toBe(true);
    if (!closeResult.ok) return;
    expect(closeResult.data.settledCount).toBe(1);

    // Mitad 1: recibe el saldo en su ronda actual (0-0, sin bonus).
    const settled = await prisma.result.findUnique({
      where: { matchId: currentMatch.id },
    });
    expect(settled).toMatchObject({
      homeVictoryPoints: 0,
      awayVictoryPoints: 0,
      outcome: "DRAW",
      resolution: "UNPLAYED_DRAW",
      bonusHome: 0,
      bonusAway: 0,
    });

    // Mitad 2: la partida adelantada queda intacta, en su propia ronda.
    const laterAfter = await prisma.result.findUnique({
      where: { matchId: laterMatch.id },
    });
    expect(laterAfter).toMatchObject({
      homeVictoryPoints: 42,
      awayVictoryPoints: 30,
      outcome: "HOME_WIN",
      resolution: "PLAYED",
    });
    const laterMatchAfter = await prisma.match.findUnique({
      where: { id: laterMatch.id },
    });
    expect(laterMatchAfter?.roundId).toBe(round2.id);
  });
});
