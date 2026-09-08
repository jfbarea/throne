// Tests for Hito 3: generar-con-rondas (feature "rondas-con-fecha").
// Covers spec criteria 8 and 14 (plan/specs/rondas-con-fecha.md §8) plus the
// extra acceptance criteria PLAN.md's §H3 adds on top of them. See
// plan/rondas-con-fecha/PLAN.md §H3 for the full list.
//
// These are write tests against the real test database (file:./test.db)
// that vitest.config.ts injects and tests/db-global-setup.ts migrates, per
// spec §7.3 ("Los tests de escritura usan la DB de test..."). Only the auth
// guard and next/cache are mocked — @/lib/db stays real, same pattern as
// tests/modelo-datos-rondas.test.ts.

import { describe, it, expect, vi } from "vitest";

// A mutable "logged in admin" the mocked guards read from, so AuditLog writes
// (round-actions.ts, league-actions.ts) have a real Player row to reference
// when a test needs one. Tests that don't touch AuditLog just leave it null.
const adminSession = vi.hoisted(() => ({ playerId: null as string | null }));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/guards", () => ({
  requireAdmin: vi.fn(async () => ({
    role: "ADMIN",
    playerId: adminSession.playerId,
  })),
  requireAuth: vi.fn(async () => ({
    role: "ADMIN",
    playerId: adminSession.playerId,
  })),
}));

import { prisma } from "@/lib/db";
import { generateLeagueMatches, setMatchSchedule } from "@/server/match-actions";
import { createLeague, updateLeague } from "@/server/league-actions";
import { updateRoundDeadline } from "@/server/round-actions";
import {
  TIEBREAKER_VALUES,
  leagueConfigSchema,
  type LeagueConfigInput,
} from "@/lib/schemas";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function uid(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function createTestLeague(
  overrides: { matchesPerRound?: number; startMonth?: Date | null } = {}
) {
  const hasStartMonthOverride = "startMonth" in overrides;
  return prisma.league.create({
    data: {
      id: uid("league"),
      name: "Liga de test H3",
      season: "2026 Test",
      matchesPerRound: overrides.matchesPerRound ?? 2,
      startMonth: hasStartMonthOverride
        ? overrides.startMonth
        : new Date(Date.UTC(2026, 2, 1)),
    },
  });
}

async function createAdminPlayer(leagueId: string) {
  return prisma.player.create({
    data: {
      id: uid("admin"),
      leagueId,
      displayName: "Admin de test H3",
      role: "ADMIN",
      passcodeHash: "test-hash",
    },
  });
}

async function createPlayers(leagueId: string, n: number) {
  const players = [];
  for (let i = 0; i < n; i++) {
    players.push(
      await prisma.player.create({
        data: {
          id: uid(`player-${i}`),
          leagueId,
          displayName: `Jugador de test ${i + 1}`,
          passcodeHash: "test-hash",
        },
      })
    );
  }
  return players;
}

function baseLeagueConfig(
  overrides: Partial<LeagueConfigInput> = {}
): LeagueConfigInput {
  return {
    name: "Liga de test",
    season: "2026 Test",
    pointsWin: 3,
    pointsDraw: 1,
    pointsLoss: 0,
    bonusEnabled: false,
    playoffSize: 4,
    tiebreakers: [...TIEBREAKER_VALUES],
    matchesPerRound: 2,
    startMonth: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// H3: generar con 12 jugadores y matchesPerRound=2 crea 6 rondas y 66 partidas
// ---------------------------------------------------------------------------

describe("H3: generar con 12 jugadores y matchesPerRound=2 crea 6 rondas y 66 partidas", () => {
  it("crea exactamente 6 rondas y 66 partidas, todas con roundId no nulo y phase=LEAGUE", async () => {
    const league = await createTestLeague({ matchesPerRound: 2 });
    await createPlayers(league.id, 12);
    adminSession.playerId = null;

    const result = await generateLeagueMatches(league.id);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.count).toBe(66);

    const rounds = await prisma.round.findMany({
      where: { leagueId: league.id },
    });
    expect(rounds).toHaveLength(6);

    const matches = await prisma.match.findMany({
      where: { leagueId: league.id, phase: "LEAGUE" },
    });
    expect(matches).toHaveLength(66);
    for (const m of matches) {
      expect(m.roundId).not.toBeNull();
      expect(m.phase).toBe("LEAGUE");
    }
  });
});

// ---------------------------------------------------------------------------
// AC-8: editar la fecha de cierre de una ronda no reasigna partidas ni toca
// scheduledAt (spec §8, criterio 8; spec §4.4)
// ---------------------------------------------------------------------------

describe("AC-8: editar la fecha de cierre de una ronda no reasigna partidas ni toca scheduledAt", () => {
  it("cambia Round.deadline sin tocar roundId ni scheduledAt de ninguna partida", async () => {
    const league = await createTestLeague({ matchesPerRound: 2 });
    const admin = await createAdminPlayer(league.id);
    await createPlayers(league.id, 12);
    adminSession.playerId = admin.id;

    const genResult = await generateLeagueMatches(league.id);
    expect(genResult.ok).toBe(true);

    const rounds = await prisma.round.findMany({
      where: { leagueId: league.id },
      orderBy: { index: "asc" },
    });
    const targetRound = rounds[0];

    // Give one match in the target round a scheduledAt, so we can prove
    // editing the deadline doesn't disturb it.
    const matchInRound = await prisma.match.findFirstOrThrow({
      where: { roundId: targetRound.id },
    });
    await prisma.match.update({
      where: { id: matchInRound.id },
      data: { scheduledAt: new Date(Date.UTC(2026, 2, 15)) },
    });

    const snapshot = new Map(
      (await prisma.match.findMany({ where: { leagueId: league.id } })).map(
        (m) => [m.id, { roundId: m.roundId, scheduledAt: m.scheduledAt?.getTime() ?? null }]
      )
    );

    const editResult = await updateRoundDeadline(targetRound.id, {
      deadline: "2026-12-25",
    });
    expect(editResult.ok).toBe(true);

    const updatedRound = await prisma.round.findUnique({
      where: { id: targetRound.id },
    });
    expect(updatedRound?.deadline).toEqual(new Date(Date.UTC(2026, 11, 25)));

    const matchesAfter = await prisma.match.findMany({
      where: { leagueId: league.id },
    });
    expect(matchesAfter).toHaveLength(snapshot.size);
    for (const m of matchesAfter) {
      const before = snapshot.get(m.id);
      expect(before).toBeDefined();
      expect(m.roundId).toBe(before?.roundId);
      expect(m.scheduledAt?.getTime() ?? null).toBe(before?.scheduledAt);
    }

    // Audit trail: the edit is traceable to the admin who made it.
    const auditEntry = await prisma.auditLog.findFirst({
      where: { entityType: "Round", entityId: targetRound.id },
    });
    expect(auditEntry?.actorId).toBe(admin.id);
  });

  it("no exige que las fechas de las rondas queden ordenadas (spec §4.4)", async () => {
    const league = await createTestLeague({ matchesPerRound: 2 });
    const admin = await createAdminPlayer(league.id);
    await createPlayers(league.id, 12);
    adminSession.playerId = admin.id;
    await generateLeagueMatches(league.id);

    const rounds = await prisma.round.findMany({
      where: { leagueId: league.id },
      orderBy: { index: "asc" },
    });

    // Move round 4's deadline to well before round 3's — allowed, no ordering check.
    const result = await updateRoundDeadline(rounds[3].id, {
      deadline: "2026-01-01",
    });
    expect(result.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// H3: matchesPerRound = 0 o negativo se rechaza en Zod con mensaje en español
// ---------------------------------------------------------------------------

describe("H3: matchesPerRound = 0 o negativo se rechaza en Zod con mensaje en español", () => {
  it("rechaza 0 con un mensaje en español", () => {
    const result = leagueConfigSchema.safeParse(
      baseLeagueConfig({ matchesPerRound: 0 })
    );
    expect(result.success).toBe(false);
    if (result.success) return;
    const message = result.error.flatten().fieldErrors.matchesPerRound?.[0];
    expect(message).toBeDefined();
    expect(message).toMatch(/mínimo|al menos|entero/i);
  });

  it("rechaza un valor negativo", () => {
    const result = leagueConfigSchema.safeParse(
      baseLeagueConfig({ matchesPerRound: -1 })
    );
    expect(result.success).toBe(false);
  });

  it("acepta valores altos sin tope superior", () => {
    const result = leagueConfigSchema.safeParse(
      baseLeagueConfig({ matchesPerRound: 50 })
    );
    expect(result.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// H3: generateLeagueMatches con startMonth = null falla y la DB queda intacta
// ---------------------------------------------------------------------------

describe("H3: generateLeagueMatches con startMonth = null falla y la DB queda intacta", () => {
  it("no crea ninguna ronda ni ninguna partida, y devuelve un error en español", async () => {
    const league = await createTestLeague({ startMonth: null });
    await createPlayers(league.id, 4);
    adminSession.playerId = null;

    const result = await generateLeagueMatches(league.id);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/mes de arranque/i);

    const roundCount = await prisma.round.count({ where: { leagueId: league.id } });
    const matchCount = await prisma.match.count({ where: { leagueId: league.id } });
    expect(roundCount).toBe(0);
    expect(matchCount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// H3: ninguna liga puede nacer con un mes de arranque inventado
// ---------------------------------------------------------------------------

describe("H3: createLeague nunca inventa un startMonth implícito", () => {
  it("crea la liga con startMonth=null cuando no se especifica ninguno", async () => {
    const result = await createLeague(baseLeagueConfig({ startMonth: null }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const league = await prisma.league.findUnique({ where: { id: result.data.id } });
    expect(league?.startMonth).toBeNull();
  });

  it("crea la liga con exactamente el startMonth configurado, normalizado al mes", async () => {
    const result = await createLeague(
      baseLeagueConfig({ startMonth: "2026-07-15" })
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const league = await prisma.league.findUnique({ where: { id: result.data.id } });
    expect(league?.startMonth).toEqual(new Date(Date.UTC(2026, 6, 1)));
  });
});

// ---------------------------------------------------------------------------
// H3: el startMonth que persiste updateLeague está normalizado al primer día
// del mes a medianoche
// ---------------------------------------------------------------------------

describe("H3: el startMonth que persiste updateLeague está normalizado al primer día del mes a medianoche", () => {
  it("normaliza cualquier día del mes que envíe el formulario a las 00:00 UTC del día 1", async () => {
    const league = await createTestLeague({ startMonth: null });

    const result = await updateLeague(
      league.id,
      baseLeagueConfig({ startMonth: "2026-05-17" })
    );
    expect(result.ok).toBe(true);

    const updated = await prisma.league.findUnique({ where: { id: league.id } });
    expect(updated?.startMonth).toEqual(new Date(Date.UTC(2026, 4, 1)));
  });

  it("persiste null cuando el admin deja el mes de arranque sin fijar", async () => {
    const league = await createTestLeague({
      startMonth: new Date(Date.UTC(2026, 2, 1)),
    });

    const result = await updateLeague(
      league.id,
      baseLeagueConfig({ startMonth: null })
    );
    expect(result.ok).toBe(true);

    const updated = await prisma.league.findUnique({ where: { id: league.id } });
    expect(updated?.startMonth).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// AC-14: la ronda de una partida no se puede cambiar desde ninguna superficie
// de UI: ni jugador ni admin tienen acción para moverla (spec §8, criterio 14;
// spec §4.3)
// ---------------------------------------------------------------------------

describe("AC-14: la ronda de una partida no se puede cambiar desde ninguna superficie", () => {
  it("setMatchSchedule ignora cualquier roundId que llegue en el input", async () => {
    const league = await createTestLeague({ matchesPerRound: 2 });
    const [p1, p2] = await createPlayers(league.id, 2);
    const roundA = await prisma.round.create({
      data: { leagueId: league.id, index: 1, deadline: new Date(Date.UTC(2026, 2, 31)) },
    });
    const roundB = await prisma.round.create({
      data: { leagueId: league.id, index: 2, deadline: new Date(Date.UTC(2026, 3, 30)) },
    });
    const match = await prisma.match.create({
      data: {
        leagueId: league.id,
        playerHomeId: p1.id,
        playerAwayId: p2.id,
        roundId: roundA.id,
      },
    });

    adminSession.playerId = null;
    const scheduledAt = new Date(Date.UTC(2026, 2, 20)).toISOString();

    // Cast to bypass the compile-time schema: this simulates a client that
    // manages to send a roundId field even though ScheduleMatchInput never
    // declares one — the action must still ignore it.
    const result = await setMatchSchedule(match.id, {
      scheduledAt,
      roundId: roundB.id,
    } as unknown as Parameters<typeof setMatchSchedule>[1]);
    expect(result.ok).toBe(true);

    const updated = await prisma.match.findUnique({ where: { id: match.id } });
    expect(updated?.roundId).toBe(roundA.id);
    expect(updated?.scheduledAt?.toISOString()).toBe(scheduledAt);
  });

  it("updateRoundDeadline solo escribe en Round: ninguna partida cambia de roundId", async () => {
    const league = await createTestLeague({ matchesPerRound: 2 });
    const admin = await createAdminPlayer(league.id);
    await createPlayers(league.id, 4);
    adminSession.playerId = admin.id;
    await generateLeagueMatches(league.id);

    const rounds = await prisma.round.findMany({ where: { leagueId: league.id } });
    const before = await prisma.match.findMany({
      where: { leagueId: league.id },
      select: { id: true, roundId: true },
      orderBy: { id: "asc" },
    });

    const result = await updateRoundDeadline(rounds[0].id, {
      deadline: "2026-11-30",
    });
    expect(result.ok).toBe(true);

    const after = await prisma.match.findMany({
      where: { leagueId: league.id },
      select: { id: true, roundId: true },
      orderBy: { id: "asc" },
    });
    expect(after).toEqual(before);
  });
});

// ---------------------------------------------------------------------------
// Regression: regenerating still works now that Round rows are involved
// (not a numbered criterion, but the guard changed as part of this hito).
// ---------------------------------------------------------------------------

describe("H3: regenerar emparejamientos sustituye las rondas anteriores sin violar la unicidad", () => {
  it("puede regenerarse dos veces seguidas sin partidas con resultado", async () => {
    const league = await createTestLeague({ matchesPerRound: 3 });
    await createPlayers(league.id, 8);
    adminSession.playerId = null;

    const first = await generateLeagueMatches(league.id);
    expect(first.ok).toBe(true);

    const second = await generateLeagueMatches(league.id);
    expect(second.ok).toBe(true);

    const rounds = await prisma.round.findMany({ where: { leagueId: league.id } });
    const indexes = rounds.map((r) => r.index);
    expect(new Set(indexes).size).toBe(indexes.length);
  });

  it("se niega a regenerar si hay partidas con resultado apuntado, sin tocar las rondas existentes", async () => {
    const league = await createTestLeague({ matchesPerRound: 2 });
    await createPlayers(league.id, 4);
    adminSession.playerId = null;
    await generateLeagueMatches(league.id);

    const someMatch = await prisma.match.findFirstOrThrow({
      where: { leagueId: league.id },
    });
    await prisma.match.update({
      where: { id: someMatch.id },
      data: { status: "REPORTED" },
    });

    const roundsBefore = await prisma.round.findMany({
      where: { leagueId: league.id },
      orderBy: { index: "asc" },
    });

    const result = await generateLeagueMatches(league.id);
    expect(result.ok).toBe(false);

    const roundsAfter = await prisma.round.findMany({
      where: { leagueId: league.id },
      orderBy: { index: "asc" },
    });
    expect(roundsAfter).toEqual(roundsBefore);
  });
});
