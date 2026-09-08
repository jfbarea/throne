// Tests for Hito H5b: endurecer-guardas-transaccionales (feature
// "rondas-con-fecha"). See plan/rondas-con-fecha/PLAN.md §H5b.
//
// Origin: closing D5's TOCTOU (declareWalkover vs a concurrent reportResult)
// led the reviewer to apply the same test to the round-closed guard and find
// the identical, preexisting-since-H4 defect: `match.round?.closedAt` was
// read once before `prisma.$transaction` and never refreshed inside it, in
// BOTH `reportResult` and `declareWalkover`. A participant could colar a
// result — or a walkover — in the exact window where the admin's
// `closeRound` lands, and the write would go through into an already-closed
// round (breaking criterio 21 and contaminating the settlement of
// criterio 18).
//
// Write tests against the real test database (file:./test.db), same
// conventions as tests/cierre-de-ronda.test.ts and tests/incomparecencia.test.ts:
// only next/cache and @/lib/guards are mocked, @/lib/db stays real. The race
// itself is reproduced by spying on prisma.$transaction, same technique
// validated for D5's TOCTOU fix.

import { describe, it, expect, vi } from "vitest";

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
import { reportResult, declareWalkover } from "@/server/result-actions";

// ---------------------------------------------------------------------------
// Helpers (same conventions as tests/cierre-de-ronda.test.ts)
// ---------------------------------------------------------------------------

function uid(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

const PAST = new Date(Date.now() - 24 * 60 * 60 * 1000);
const FUTURE = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

async function createTestLeague() {
  return prisma.league.create({
    data: {
      id: uid("league"),
      name: "Liga de test H5b",
      season: "2026 Test",
      matchesPerRound: 2,
      startMonth: new Date(Date.UTC(2026, 2, 1)),
    },
  });
}

async function createAdmin(leagueId: string) {
  return prisma.player.create({
    data: {
      id: uid("admin"),
      leagueId,
      displayName: "Admin de test H5b",
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

/** Spy on prisma.$transaction so the very next call runs `injected` first
 * (simulating a concurrent write landing in the window) and then delegates
 * to the real transaction. Only the first `prisma.$transaction` call made
 * after this is intercepted; everything `injected` itself does internally
 * (it likely calls `prisma.$transaction` too) falls through to the real
 * implementation, since only one override is queued. */
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
// Criterio 1: reportResult vs. closeRound racing in the window
// ---------------------------------------------------------------------------

describe("H5b criterio 1: TOCTOU de la guarda de ronda cerrada en reportResult", () => {
  it("un cierre de ronda del admin que aterriza en la ventana bloquea el reportResult pendiente, y la ronda queda cerrada y coherente", async () => {
    const league = await createTestLeague();
    const admin = await createAdmin(league.id);
    const p1 = await createPlayer(league.id, "A");
    const p2 = await createPlayer(league.id, "B");
    const round = await createRound(league.id, 1, PAST); // due — closeable
    const match = await createMatch(league.id, round.id, p1.id, p2.id);

    // p1's fast-path read (outside this race helper) will see the round
    // still open — this is set up BEFORE the spy so reportResult's own
    // outer check passes normally.
    const spy = raceIntoNextTransaction(async () => {
      mockSession.adminPlayerId = admin.id;
      const closeResult = await closeRound(round.id);
      expect(closeResult.ok).toBe(true);
    });

    mockSession.role = "PLAYER";
    mockSession.playerId = p1.id;
    const attempt = await reportResult(match.id, {
      homeVictoryPoints: 45,
      awayVictoryPoints: 38,
    });

    spy.mockRestore();

    expect(attempt.ok).toBe(false);
    if (attempt.ok) return;
    expect(attempt.error).toMatch(/cerrada/i);

    // Coherent end state: the round is closed, and the match was settled by
    // closeRound (0-0 UNPLAYED_DRAW) — the pending reportResult never wrote
    // its 45-38 on top.
    const roundAfter = await prisma.round.findUnique({
      where: { id: round.id },
    });
    expect(roundAfter?.closedAt).not.toBeNull();

    const result = await prisma.result.findUnique({
      where: { matchId: match.id },
    });
    expect(result).toMatchObject({
      homeVictoryPoints: 0,
      awayVictoryPoints: 0,
      outcome: "DRAW",
      resolution: "UNPLAYED_DRAW",
    });
  });
});

// ---------------------------------------------------------------------------
// Criterio 2: declareWalkover vs. closeRound racing in the window
// ---------------------------------------------------------------------------

describe("H5b criterio 2: TOCTOU de la guarda de ronda cerrada en declareWalkover", () => {
  it("un cierre de ronda del admin que aterriza en la ventana bloquea la incomparecencia pendiente, y la ronda queda cerrada y coherente", async () => {
    const league = await createTestLeague();
    const admin = await createAdmin(league.id);
    const p1 = await createPlayer(league.id, "A");
    const p2 = await createPlayer(league.id, "B");
    const round = await createRound(league.id, 1, PAST);
    const match = await createMatch(league.id, round.id, p1.id, p2.id);

    const spy = raceIntoNextTransaction(async () => {
      mockSession.adminPlayerId = admin.id;
      const closeResult = await closeRound(round.id);
      expect(closeResult.ok).toBe(true);
    });

    mockSession.role = "PLAYER";
    mockSession.playerId = p1.id;
    const attempt = await declareWalkover(match.id, { winnerId: p1.id });

    spy.mockRestore();

    expect(attempt.ok).toBe(false);
    if (attempt.ok) return;
    expect(attempt.error).toMatch(/cerrada/i);

    const roundAfter = await prisma.round.findUnique({
      where: { id: round.id },
    });
    expect(roundAfter?.closedAt).not.toBeNull();

    const result = await prisma.result.findUnique({
      where: { matchId: match.id },
    });
    expect(result).toMatchObject({
      homeVictoryPoints: 0,
      awayVictoryPoints: 0,
      outcome: "DRAW",
      resolution: "UNPLAYED_DRAW",
    });
  });
});

// ---------------------------------------------------------------------------
// Criterio 3: a real DB failure inside the transaction is never mistaken for
// "the round is closed" (or, for closeRound itself, "ya está cerrada" /
// "no due yet") — the catch blocks are scoped with `instanceof`.
// ---------------------------------------------------------------------------

describe("H5b criterio 3: un fallo real de DB no se reporta como guarda de ronda cerrada", () => {
  it("reportResult deja pasar un fallo genérico de la transacción sin traducirlo al mensaje de ronda cerrada", async () => {
    const league = await createTestLeague();
    const p1 = await createPlayer(league.id, "A");
    const p2 = await createPlayer(league.id, "B");
    const round = await createRound(league.id, 1, FUTURE); // open round
    const match = await createMatch(league.id, round.id, p1.id, p2.id);

    const spy = vi
      .spyOn(prisma, "$transaction")
      .mockImplementationOnce(async () => {
        throw new Error("simulated generic DB failure");
      });

    mockSession.role = "PLAYER";
    mockSession.playerId = p1.id;

    await expect(
      reportResult(match.id, { homeVictoryPoints: 45, awayVictoryPoints: 38 })
    ).rejects.toThrow("simulated generic DB failure");

    spy.mockRestore();
  });

  it("declareWalkover deja pasar un fallo genérico de la transacción sin traducirlo a ninguno de sus mensajes de guarda", async () => {
    const league = await createTestLeague();
    const p1 = await createPlayer(league.id, "A");
    const p2 = await createPlayer(league.id, "B");
    const round = await createRound(league.id, 1, FUTURE);
    const match = await createMatch(league.id, round.id, p1.id, p2.id);

    const spy = vi
      .spyOn(prisma, "$transaction")
      .mockImplementationOnce(async () => {
        throw new Error("simulated generic DB failure");
      });

    mockSession.role = "PLAYER";
    mockSession.playerId = p1.id;

    await expect(
      declareWalkover(match.id, { winnerId: p1.id })
    ).rejects.toThrow("simulated generic DB failure");

    spy.mockRestore();
  });

  it("closeRound deja pasar un fallo genérico de la transacción sin traducirlo a 'ya está cerrada' ni a la guarda de fecha", async () => {
    const league = await createTestLeague();
    const admin = await createAdmin(league.id);
    const round = await createRound(league.id, 1, PAST);

    const spy = vi
      .spyOn(prisma, "$transaction")
      .mockImplementationOnce(async () => {
        throw new Error("simulated generic DB failure");
      });

    mockSession.adminPlayerId = admin.id;

    await expect(closeRound(round.id)).rejects.toThrow(
      "simulated generic DB failure"
    );

    spy.mockRestore();

    // Untouched: the failed transaction rolled back / never committed.
    const roundAfter = await prisma.round.findUnique({
      where: { id: round.id },
    });
    expect(roundAfter?.closedAt).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Criterio 4: the admin override still works on a closed round (criterio 21)
// and editing doesn't reopen it — reconfirmed after the H5b hardening, for
// both reportResult and declareWalkover.
// ---------------------------------------------------------------------------

describe("H5b criterio 4: el override del admin sigue funcionando en ronda cerrada tras el endurecimiento", () => {
  it("reportResult: el admin edita una partida de una ronda ya cerrada por closeRound, y la ronda no se reabre", async () => {
    const league = await createTestLeague();
    const admin = await createAdmin(league.id);
    const p1 = await createPlayer(league.id, "A");
    const p2 = await createPlayer(league.id, "B");
    const round = await createRound(league.id, 1, PAST);
    const match = await createMatch(league.id, round.id, p1.id, p2.id);

    mockSession.adminPlayerId = admin.id;
    const closeResult = await closeRound(round.id);
    expect(closeResult.ok).toBe(true);

    mockSession.role = "ADMIN";
    mockSession.playerId = admin.id;
    const adminEdit = await reportResult(match.id, {
      homeVictoryPoints: 45,
      awayVictoryPoints: 38,
    });
    expect(adminEdit.ok).toBe(true);

    const result = await prisma.result.findUnique({
      where: { matchId: match.id },
    });
    expect(result).toMatchObject({
      homeVictoryPoints: 45,
      awayVictoryPoints: 38,
      outcome: "HOME_WIN",
      resolution: "PLAYED",
    });

    const roundAfter = await prisma.round.findUnique({
      where: { id: round.id },
    });
    expect(roundAfter?.closedAt).not.toBeNull();
  });

  it("declareWalkover: el admin declara una incomparecencia en una ronda ya cerrada por closeRound, y la ronda no se reabre", async () => {
    const league = await createTestLeague();
    const admin = await createAdmin(league.id);
    const p1 = await createPlayer(league.id, "A");
    const p2 = await createPlayer(league.id, "B");
    const round = await createRound(league.id, 1, PAST);
    const match = await createMatch(league.id, round.id, p1.id, p2.id);

    mockSession.adminPlayerId = admin.id;
    const closeResult = await closeRound(round.id);
    expect(closeResult.ok).toBe(true);

    mockSession.role = "ADMIN";
    mockSession.playerId = admin.id;
    const adminWalkover = await declareWalkover(match.id, {
      winnerId: p1.id,
    });
    expect(adminWalkover.ok).toBe(true);

    const result = await prisma.result.findUnique({
      where: { matchId: match.id },
    });
    expect(result).toMatchObject({
      homeVictoryPoints: 80,
      awayVictoryPoints: 0,
      outcome: "HOME_WIN",
      resolution: "WALKOVER",
    });

    const roundAfter = await prisma.round.findUnique({
      where: { id: round.id },
    });
    expect(roundAfter?.closedAt).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Regression, not tied to a numbered criterion: closeRound's own
// double-close race (admin-vs-admin), covered because H5b's sweep hardened
// closeRound too — see the sweep verdict in the builder's final report.
// ---------------------------------------------------------------------------

describe("H5b: closeRound — doble cierre concurrente de la misma ronda", () => {
  it("un segundo closeRound que aterriza en la ventana de un primer cierre en curso es rechazado, no re-cierra en silencio", async () => {
    const league = await createTestLeague();
    const admin = await createAdmin(league.id);
    const p1 = await createPlayer(league.id, "A");
    const p2 = await createPlayer(league.id, "B");
    const round = await createRound(league.id, 1, PAST);
    await createMatch(league.id, round.id, p1.id, p2.id);

    const spy = raceIntoNextTransaction(async () => {
      // The first closeRound call commits fully inside this window, before
      // the second call's own transaction opens.
      const firstClose = await closeRound(round.id);
      expect(firstClose.ok).toBe(true);
    });

    mockSession.adminPlayerId = admin.id;
    const secondClose = await closeRound(round.id);

    spy.mockRestore();

    expect(secondClose.ok).toBe(false);
    if (secondClose.ok) return;
    expect(secondClose.error).toMatch(/ya está cerrada/i);

    // Only one CLOSE_ROUND audit entry — the second call never wrote one.
    const logs = await prisma.auditLog.findMany({
      where: { entityType: "Round", entityId: round.id, action: "CLOSE_ROUND" },
    });
    expect(logs).toHaveLength(1);
  });
});
