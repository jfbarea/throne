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

  it("permite sobrescribir una incomparecencia existente con otra (cambio de vencedor) — no afectado por D5", async () => {
    const league = await createTestLeague();
    const home = await createPlayer(league.id, "A");
    const away = await createPlayer(league.id, "B");
    const match = await createMatch(league.id, home.id, away.id);

    mockSession.role = "PLAYER";
    mockSession.playerId = home.id;
    const first = await declareWalkover(match.id, { winnerId: home.id });
    expect(first.ok).toBe(true);

    // The other participant changes the winner — still a WALKOVER, no
    // played Result involved, so D5 doesn't block this.
    mockSession.role = "PLAYER";
    mockSession.playerId = away.id;
    const changed = await declareWalkover(match.id, { winnerId: away.id });
    expect(changed.ok).toBe(true);

    const result = await prisma.result.findUnique({ where: { matchId: match.id } });
    expect(result).toMatchObject({
      homeVictoryPoints: 0,
      awayVictoryPoints: WALKOVER_VICTORY_POINTS,
      outcome: "AWAY_WIN",
      resolution: "WALKOVER",
    });
  });
});

// ---------------------------------------------------------------------------
// D5 (plan/rondas-con-fecha/PLAN.md): a participant cannot turn an
// already-PLAYED result into a walkover; the admin can, via §7.5 override.
// Ratified by the user after H5's first review found the hole: without this
// guard, the legitimate winner of a real 45-40 could unilaterally inflate
// their own score to 80-0.
// ---------------------------------------------------------------------------

describe("D5: un participante no puede convertir un resultado ya jugado en incomparecencia; el admin sí", () => {
  it("rechaza al ganador legítimo de un 45-40 que intenta convertirlo en 80-0, y el Result original queda intacto", async () => {
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

    const before = await prisma.result.findUnique({ where: { matchId: match.id } });

    const attempt = await declareWalkover(match.id, { winnerId: home.id });
    expect(attempt.ok).toBe(false);
    if (attempt.ok) return;
    expect(attempt.error).toMatch(/ya tiene un resultado jugado/i);

    // The original PLAYED Result is untouched — compare every field, not
    // just that it still exists.
    const after = await prisma.result.findUnique({ where: { matchId: match.id } });
    expect(after).toEqual(before);
    expect(after).toMatchObject({
      homeVictoryPoints: 45,
      awayVictoryPoints: 38,
      outcome: "HOME_WIN",
      resolution: "PLAYED",
    });
  });

  it("el admin sí puede convertir un resultado jugado en incomparecencia, y el AuditLog queda a su nombre", async () => {
    const league = await createTestLeague();
    const admin = await createAdmin(league.id);
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

    mockSession.role = "ADMIN";
    mockSession.playerId = admin.id;
    const overridden = await declareWalkover(match.id, { winnerId: away.id });
    expect(overridden.ok).toBe(true);

    const result = await prisma.result.findUnique({ where: { matchId: match.id } });
    expect(result).toMatchObject({
      homeVictoryPoints: 0,
      awayVictoryPoints: WALKOVER_VICTORY_POINTS,
      outcome: "AWAY_WIN",
      resolution: "WALKOVER",
    });

    const logs = await prisma.auditLog.findMany({
      where: { entityType: "Match", entityId: match.id },
      orderBy: { createdAt: "asc" },
    });
    expect(logs.map((l) => l.action)).toEqual(["REPORT_RESULT", "EDIT_RESULT"]);
    expect(logs[1].actorId).toBe(admin.id);
  });

  it("sin regresión: declarar incomparecencia sobre una partida sin Result sigue funcionando para los dos participantes", async () => {
    const league = await createTestLeague();
    const home = await createPlayer(league.id, "A");
    const away = await createPlayer(league.id, "B");
    const matchHome = await createMatch(league.id, home.id, away.id);
    const matchAway = await createMatch(league.id, home.id, away.id);

    mockSession.role = "PLAYER";
    mockSession.playerId = home.id;
    const byHome = await declareWalkover(matchHome.id, { winnerId: away.id });
    expect(byHome.ok).toBe(true);

    mockSession.role = "PLAYER";
    mockSession.playerId = away.id;
    const byAway = await declareWalkover(matchAway.id, { winnerId: home.id });
    expect(byAway.ok).toBe(true);
  });

  it("sin regresión: sobrescribir una incomparecencia existente cambiando de vencedor sigue funcionando", async () => {
    const league = await createTestLeague();
    const home = await createPlayer(league.id, "A");
    const away = await createPlayer(league.id, "B");
    const match = await createMatch(league.id, home.id, away.id);

    mockSession.role = "PLAYER";
    mockSession.playerId = home.id;
    const first = await declareWalkover(match.id, { winnerId: home.id });
    expect(first.ok).toBe(true);

    mockSession.role = "PLAYER";
    mockSession.playerId = away.id;
    const changed = await declareWalkover(match.id, { winnerId: away.id });
    expect(changed.ok).toBe(true);

    const result = await prisma.result.findUnique({ where: { matchId: match.id } });
    expect(result?.outcome).toBe("AWAY_WIN");
    expect(result?.resolution).toBe("WALKOVER");
  });
});

describe("D5: canDeclareWalkoverOverExistingResult — predicado puro", () => {
  async function getPredicate() {
    const { canDeclareWalkoverOverExistingResult } = await import(
      "@/server/result-logic"
    );
    return canDeclareWalkoverOverExistingResult;
  }

  it("bloquea a un participante cuando el Result existente es PLAYED", async () => {
    const canDeclare = await getPredicate();
    expect(canDeclare("PLAYED", false)).toBe(false);
  });

  it("el admin puede aunque el Result existente sea PLAYED", async () => {
    const canDeclare = await getPredicate();
    expect(canDeclare("PLAYED", true)).toBe(true);
  });

  it("permite a un participante cuando no hay Result todavía (null)", async () => {
    const canDeclare = await getPredicate();
    expect(canDeclare(null, false)).toBe(true);
  });

  it("permite a un participante sobrescribir un WALKOVER existente", async () => {
    const canDeclare = await getPredicate();
    expect(canDeclare("WALKOVER", false)).toBe(true);
  });

  it("permite a un participante sobrescribir un UNPLAYED_DRAW existente", async () => {
    const canDeclare = await getPredicate();
    expect(canDeclare("UNPLAYED_DRAW", false)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// D5 second review: TOCTOU between the fast-path read and the transaction.
//
// declareWalkover reads the existing Result once, outside prisma.$transaction,
// to give a quick Spanish rejection without opening a transaction for
// nothing. That read can go stale: a concurrent, legitimate reportResult from
// the other participant can land in the window between that read and the
// transaction actually opening. The fix re-checks the guard INSIDE the
// transaction, with `tx.result.findUnique`, as the very first thing it does —
// that re-read is what actually decides; the outer one is only a shortcut.
//
// This test reproduces the race by spying on prisma.$transaction: the mocked
// implementation runs a full, real reportResult (the "concurrent write") the
// instant declareWalkover's transaction is about to open, then lets the real
// transaction proceed. It starts from an existing WALKOVER (not PLAYED, so
// the fast-path read passes) — the same starting point that makes the
// pre-fix code take the "update the existing row" branch instead of hitting
// a unique-constraint crash on `create`, which is what let the old bug
// silently succeed instead of failing loudly.
// ---------------------------------------------------------------------------

describe("D5: TOCTOU — la re-lectura dentro de la transacción es la que manda, no la de fuera", () => {
  it("un reportResult real que aterriza justo antes de abrir la transacción bloquea igualmente la incomparecencia pendiente", async () => {
    const league = await createTestLeague();
    const home = await createPlayer(league.id, "A");
    const away = await createPlayer(league.id, "B");
    const match = await createMatch(league.id, home.id, away.id);

    // Starting point: an existing WALKOVER (not PLAYED), so declareWalkover's
    // fast-path read — taken before the race below is even set up — sees a
    // resolution that's fine to overwrite and proceeds towards the
    // transaction, exactly like a real "the other participant is about to
    // correct this" scenario.
    mockSession.role = "PLAYER";
    mockSession.playerId = home.id;
    const initial = await declareWalkover(match.id, { winnerId: home.id });
    expect(initial.ok).toBe(true);

    const originalTransaction = prisma.$transaction.bind(prisma);
    const transactionSpy = vi
      .spyOn(prisma, "$transaction")
      .mockImplementationOnce(async (callback: unknown) => {
        // Simulate the real reportResult from the away participant
        // committing in the window between declareWalkover's fast-path read
        // (already taken, above) and this transaction opening.
        mockSession.role = "PLAYER";
        mockSession.playerId = away.id;
        const concurrent = await reportResult(match.id, {
          homeVictoryPoints: 45,
          awayVictoryPoints: 40,
        });
        expect(concurrent.ok).toBe(true);

        // Now let the pending declareWalkover transaction actually run,
        // against the real DB, with the just-committed PLAYED result in
        // place. Its own tx.result.findUnique re-read is what must catch it.
        return (
          originalTransaction as (fn: unknown) => Promise<unknown>
        )(callback);
      });

    mockSession.role = "PLAYER";
    mockSession.playerId = home.id;
    const attempt = await declareWalkover(match.id, { winnerId: home.id });

    transactionSpy.mockRestore();

    expect(attempt.ok).toBe(false);
    if (attempt.ok) return;
    expect(attempt.error).toMatch(/ya tiene un resultado jugado/i);

    // The result that "won the race" — the real, concurrently reported
    // 45-40 — is what's actually persisted. The pending walkover never wrote
    // over it.
    const result = await prisma.result.findUnique({ where: { matchId: match.id } });
    expect(result).toMatchObject({
      homeVictoryPoints: 45,
      awayVictoryPoints: 40,
      outcome: "HOME_WIN",
      resolution: "PLAYED",
    });
  });
});
