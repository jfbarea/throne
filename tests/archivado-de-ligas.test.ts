// Tests for multi-liga D1: archivado-de-ligas.
// Covers spec criterios 22, 23, 24, 25 and plan/multi-liga/PLAN.md's D1
// acceptance criteria.
//
// Write tests against the real test database (file:./test.db), same
// conventions as tests/endurecer-guardas-transaccionales.test.ts and
// tests/recalculo-alta-baja-y-cupo.test.ts: only next/cache and @/lib/guards
// are mocked, @/lib/db stays real.

import { describe, it, expect, vi } from "vitest";

const mockSession = vi.hoisted(() => ({
  role: "ADMIN" as "ADMIN" | "PLAYER",
  playerId: null as string | null,
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/guards", () => ({
  requireAdmin: vi.fn(async () => ({ role: "ADMIN", playerId: null })),
  requireAuth: vi.fn(async () => ({
    role: mockSession.role,
    playerId: mockSession.playerId,
  })),
}));

import { prisma } from "@/lib/db";
import {
  archiveLeague,
  unarchiveLeague,
  resetLeague,
} from "@/server/league/lifecycle";
import { updateLeague } from "@/server/league/config";
import {
  createPlayer,
  updatePlayer,
  setPlayerActive,
  resetPlayerPasscode,
  deletePlayer,
} from "@/server/league/players";
import {
  generateLeagueMatches,
  addMissingLeagueMatches,
  setMatchSchedule,
} from "@/server/match-actions";
import {
  updateRoundDeadline,
  closeRound,
  redistributePending,
} from "@/server/round-actions";
import { reportResult, declareWalkover } from "@/server/result-actions";
import { startPlayoffs, advancePlayoffWinner } from "@/server/playoff-actions";
import {
  requireLeagueAccess,
  LeagueArchivedError,
} from "@/lib/league-context";
import { TIEBREAKER_VALUES, type LeagueConfigInput } from "@/lib/schemas";
import type { SessionPayload } from "@/lib/session";

const ARCHIVED_ERROR_MESSAGE = new LeagueArchivedError().message;

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function uid(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function createTestLeague(
  overrides: { archivedAt?: Date | null } = {}
) {
  const id = uid("league");
  return prisma.league.create({
    data: {
      id,
      name: "Liga de test D1",
      season: "2026 Test",
      slug: `${id}-slug`,
      archivedAt:
        overrides.archivedAt === undefined ? null : overrides.archivedAt,
      matchesPerRound: 2,
      startMonth: new Date(Date.UTC(2026, 2, 1)),
    },
  });
}

async function createTestPlayer(
  leagueId: string,
  role: "ADMIN" | "PLAYER" = "PLAYER",
  name?: string
) {
  return prisma.player.create({
    data: {
      id: uid("player"),
      leagueId,
      displayName: name ?? `Jugador ${uid("name")}`,
      role,
      passcodeHash: "test-hash",
    },
  });
}

async function createTestRound(leagueId: string, index = 1) {
  return prisma.round.create({
    data: { leagueId, index, deadline: new Date(Date.UTC(2026, 3, 1)) },
  });
}

async function createTestMatch(
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

/** Full fixture set an archived league's write actions need to be invoked
 * against: two players, one open round, one unresolved match. */
async function setupArchivedLeagueFixture() {
  const league = await createTestLeague({ archivedAt: new Date() });
  const p1 = await createTestPlayer(league.id, "PLAYER", "Jugador Uno");
  const p2 = await createTestPlayer(league.id, "PLAYER", "Jugador Dos");
  const round = await createTestRound(league.id);
  const match = await createTestMatch(league.id, round.id, p1.id, p2.id);
  return { league, p1, p2, round, match };
}

function baseLeagueConfig(
  overrides: Partial<LeagueConfigInput> = {}
): LeagueConfigInput {
  return {
    name: "Liga de test D1 (updateLeague)",
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
// archiveLeague
// ---------------------------------------------------------------------------

describe("archiveLeague", () => {
  it("sets archivedAt and takes the league out of circulation (criterio 22)", async () => {
    const league = await createTestLeague();
    expect(league.archivedAt).toBeNull();

    const result = await archiveLeague(league.id);
    expect(result.ok).toBe(true);

    const after = await prisma.league.findUnique({ where: { id: league.id } });
    expect(after?.archivedAt).not.toBeNull();
  });

  it("does not change status when archiving", async () => {
    const league = await createTestLeague();
    await archiveLeague(league.id);
    const after = await prisma.league.findUnique({ where: { id: league.id } });
    expect(after?.status).toBe(league.status);
  });

  it("is idempotent: archiving an already-archived league does not move archivedAt", async () => {
    const firstArchivedAt = new Date(Date.UTC(2020, 0, 1));
    const league = await createTestLeague({ archivedAt: firstArchivedAt });

    const result = await archiveLeague(league.id);
    expect(result.ok).toBe(true);

    const after = await prisma.league.findUnique({ where: { id: league.id } });
    expect(after?.archivedAt?.getTime()).toBe(firstArchivedAt.getTime());
  });

  it("fails for a nonexistent league", async () => {
    const result = await archiveLeague(`nonexistent-${uid("league")}`);
    expect(result.ok).toBe(false);
  });

  it("a player with an open session in the archived league is signed out on their next request (criterio 24)", async () => {
    const league = await createTestLeague();
    const player = await createTestPlayer(league.id);
    const session: SessionPayload = { playerId: player.id, role: "PLAYER" };

    // Sanity check: before archiving, the guard grants normal access.
    const before = await requireLeagueAccess(league.slug, session);
    expect(before.id).toBe(league.id);

    const archiveResult = await archiveLeague(league.id);
    expect(archiveResult.ok).toBe(true);

    // Same session, same league slug, after archiving: requireLeagueAccess
    // (multi-liga C1) redirects to /login instead of granting access.
    await expect(requireLeagueAccess(league.slug, session)).rejects.toThrow();
    try {
      await requireLeagueAccess(league.slug, session);
      expect.unreachable("expected a redirect");
    } catch (err) {
      const digest = (err as { digest?: string }).digest;
      expect(digest?.split(";")[2]).toBe("/login");
    }
  });

  it("the admin retains full read access to an archived league", async () => {
    const league = await createTestLeague();
    await archiveLeague(league.id);

    const session: SessionPayload = { playerId: null, role: "ADMIN" };
    const result = await requireLeagueAccess(league.slug, session);
    expect(result.id).toBe(league.id);
    expect(result.archivedAt).not.toBeNull();
  });

  it("leaves an AuditLog trail whose actor is this league's own ADMIN Player", async () => {
    const league = await createTestLeague();
    const admin = await createTestPlayer(league.id, "ADMIN", "Admin De La Liga");

    const result = await archiveLeague(league.id);
    expect(result.ok).toBe(true);

    const entry = await prisma.auditLog.findFirst({
      where: { entityType: "League", entityId: league.id, action: "ARCHIVE_LEAGUE" },
    });
    expect(entry).not.toBeNull();
    expect(entry?.actorId).toBe(admin.id);
  });
});

// ---------------------------------------------------------------------------
// unarchiveLeague
// ---------------------------------------------------------------------------

describe("unarchiveLeague", () => {
  it("clears archivedAt when there is no name conflict", async () => {
    const league = await createTestLeague({ archivedAt: new Date() });
    await createTestPlayer(league.id, "PLAYER", "Sin conflicto");

    const result = await unarchiveLeague(league.id);
    expect(result.ok).toBe(true);

    const after = await prisma.league.findUnique({ where: { id: league.id } });
    expect(after?.archivedAt).toBeNull();
  });

  it("fails and lists every conflicting name without touching archivedAt (criterio 25)", async () => {
    const circulationLeague = await createTestLeague();
    await createTestPlayer(circulationLeague.id, "PLAYER", "Javi");
    await createTestPlayer(circulationLeague.id, "PLAYER", "Ana");

    const archivedAt = new Date(Date.UTC(2020, 0, 1));
    const archived = await createTestLeague({ archivedAt });
    await createTestPlayer(archived.id, "PLAYER", "Javi");
    await createTestPlayer(archived.id, "PLAYER", "Ana");
    await createTestPlayer(archived.id, "PLAYER", "Sin Conflicto Único");

    const result = await unarchiveLeague(archived.id);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("Javi");
    expect(result.error).toContain("Ana");
    expect(result.error).not.toContain("Sin Conflicto Único");

    const after = await prisma.league.findUnique({ where: { id: archived.id } });
    expect(after?.archivedAt?.getTime()).toBe(archivedAt.getTime());
  });

  it("the admin's homonymous row in each league never counts as a conflict", async () => {
    const circulationLeague = await createTestLeague();
    await createTestPlayer(circulationLeague.id, "ADMIN", "Admin Compartido");

    const archived = await createTestLeague({ archivedAt: new Date() });
    await createTestPlayer(archived.id, "ADMIN", "Admin Compartido");

    const result = await unarchiveLeague(archived.id);
    expect(result.ok).toBe(true);
  });

  it("does not consider a deactivated PLAYER exempt from the conflict check", async () => {
    const circulationLeague = await createTestLeague();
    await createTestPlayer(circulationLeague.id, "PLAYER", "Nombre Repetido");

    const archived = await createTestLeague({ archivedAt: new Date() });
    await prisma.player.create({
      data: {
        id: uid("player"),
        leagueId: archived.id,
        displayName: "Nombre Repetido",
        role: "PLAYER",
        passcodeHash: "test-hash",
        active: false,
      },
    });

    const result = await unarchiveLeague(archived.id);
    expect(result.ok).toBe(false);
  });

  it("is idempotent: unarchiving a league already in circulation is a no-op success", async () => {
    const league = await createTestLeague();
    const result = await unarchiveLeague(league.id);
    expect(result.ok).toBe(true);
  });

  it("fails for a nonexistent league", async () => {
    const result = await unarchiveLeague(`nonexistent-${uid("league")}`);
    expect(result.ok).toBe(false);
  });

  it("leaves an AuditLog trail whose actor is this league's own ADMIN Player", async () => {
    const league = await createTestLeague({ archivedAt: new Date() });
    const admin = await createTestPlayer(league.id, "ADMIN", "Admin De La Liga");

    const result = await unarchiveLeague(league.id);
    expect(result.ok).toBe(true);

    const entry = await prisma.auditLog.findFirst({
      where: {
        entityType: "League",
        entityId: league.id,
        action: "UNARCHIVE_LEAGUE",
      },
    });
    expect(entry).not.toBeNull();
    expect(entry?.actorId).toBe(admin.id);
  });
});

// ---------------------------------------------------------------------------
// resetLeague — actor resolution (coordinator follow-up: the admin session
// carries no fixed playerId, spec §4.4; the audit actor must be derived by
// league via resolveActingPlayerId, not read off session.playerId).
// ---------------------------------------------------------------------------

describe("resetLeague — actor resolution", () => {
  it("resolves the actor via resolveActingPlayerId instead of session.playerId (which is always null for ADMIN)", async () => {
    const league = await createTestLeague();
    const admin = await createTestPlayer(league.id, "ADMIN", "Admin Que Resetea");
    const p1 = await createTestPlayer(league.id, "PLAYER", "P1");
    const p2 = await createTestPlayer(league.id, "PLAYER", "P2");
    await createTestMatch(league.id, (await createTestRound(league.id)).id, p1.id, p2.id);

    const result = await resetLeague(league.id);
    expect(result.ok).toBe(true);

    const entry = await prisma.auditLog.findFirst({
      where: { entityType: "League", entityId: league.id, action: "RESET_LEAGUE" },
    });
    expect(entry).not.toBeNull();
    expect(entry?.actorId).toBe(admin.id);
  });
});

// ---------------------------------------------------------------------------
// Criterio 23 — every write action from spec §5.6, invoked directly against
// an archived league, fails and leaves the DB untouched.
// ---------------------------------------------------------------------------

describe("criterio 23: every write action rejects an archived league when invoked directly", () => {
  it("updateLeague", async () => {
    const { league } = await setupArchivedLeagueFixture();
    // playoffSize=2 matches the fixture's 2 active players, so the
    // cross-validation in updateLeague (config.ts) passes and the call
    // actually reaches the archived-league guard being tested here.
    const result = await updateLeague(
      league.id,
      baseLeagueConfig({ playoffSize: 2 })
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe(ARCHIVED_ERROR_MESSAGE);

    const after = await prisma.league.findUnique({ where: { id: league.id } });
    expect(after?.name).toBe(league.name);
  });

  it("createPlayer", async () => {
    const { league } = await setupArchivedLeagueFixture();
    const countBefore = await prisma.player.count({ where: { leagueId: league.id } });

    const result = await createPlayer(league.id, {
      displayName: "Nuevo",
      role: "PLAYER",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe(ARCHIVED_ERROR_MESSAGE);

    const countAfter = await prisma.player.count({ where: { leagueId: league.id } });
    expect(countAfter).toBe(countBefore);
  });

  it("updatePlayer", async () => {
    const { p1 } = await setupArchivedLeagueFixture();
    const result = await updatePlayer(p1.id, { displayName: "Cambiado" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe(ARCHIVED_ERROR_MESSAGE);

    const after = await prisma.player.findUnique({ where: { id: p1.id } });
    expect(after?.displayName).toBe(p1.displayName);
  });

  it("setPlayerActive", async () => {
    const { p1 } = await setupArchivedLeagueFixture();
    const result = await setPlayerActive(p1.id, false);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe(ARCHIVED_ERROR_MESSAGE);

    const after = await prisma.player.findUnique({ where: { id: p1.id } });
    expect(after?.active).toBe(true);
  });

  it("resetPlayerPasscode", async () => {
    const { p1 } = await setupArchivedLeagueFixture();
    const result = await resetPlayerPasscode(p1.id);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe(ARCHIVED_ERROR_MESSAGE);

    const after = await prisma.player.findUnique({ where: { id: p1.id } });
    expect(after?.passcodeHash).toBe("test-hash");
  });

  it("deletePlayer", async () => {
    const { p1 } = await setupArchivedLeagueFixture();
    const result = await deletePlayer(p1.id);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe(ARCHIVED_ERROR_MESSAGE);

    const after = await prisma.player.findUnique({ where: { id: p1.id } });
    expect(after).not.toBeNull();
  });

  it("generateLeagueMatches", async () => {
    const { league } = await setupArchivedLeagueFixture();
    const matchCountBefore = await prisma.match.count({ where: { leagueId: league.id } });

    const result = await generateLeagueMatches(league.id);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe(ARCHIVED_ERROR_MESSAGE);

    const matchCountAfter = await prisma.match.count({ where: { leagueId: league.id } });
    expect(matchCountAfter).toBe(matchCountBefore);
  });

  it("addMissingLeagueMatches", async () => {
    const { league } = await setupArchivedLeagueFixture();
    const matchCountBefore = await prisma.match.count({ where: { leagueId: league.id } });

    const result = await addMissingLeagueMatches(league.id);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe(ARCHIVED_ERROR_MESSAGE);

    const matchCountAfter = await prisma.match.count({ where: { leagueId: league.id } });
    expect(matchCountAfter).toBe(matchCountBefore);
  });

  it("setMatchSchedule", async () => {
    const { match } = await setupArchivedLeagueFixture();
    const result = await setMatchSchedule(match.id, {
      scheduledAt: new Date().toISOString(),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe(ARCHIVED_ERROR_MESSAGE);

    const after = await prisma.match.findUnique({ where: { id: match.id } });
    expect(after?.scheduledAt).toBeNull();
  });

  it("updateRoundDeadline", async () => {
    const { round } = await setupArchivedLeagueFixture();
    const result = await updateRoundDeadline(round.id, { deadline: "2026-01-01" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe(ARCHIVED_ERROR_MESSAGE);

    const after = await prisma.round.findUnique({ where: { id: round.id } });
    expect(after?.deadline.getTime()).toBe(round.deadline.getTime());
  });

  it("closeRound", async () => {
    const { round } = await setupArchivedLeagueFixture();
    const result = await closeRound(round.id);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe(ARCHIVED_ERROR_MESSAGE);

    const after = await prisma.round.findUnique({ where: { id: round.id } });
    expect(after?.closedAt).toBeNull();
  });

  it("redistributePending", async () => {
    const { league } = await setupArchivedLeagueFixture();
    const result = await redistributePending(league.id);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe(ARCHIVED_ERROR_MESSAGE);
  });

  it("startPlayoffs", async () => {
    const { league } = await setupArchivedLeagueFixture();
    const result = await startPlayoffs(league.id);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe(ARCHIVED_ERROR_MESSAGE);

    const after = await prisma.league.findUnique({ where: { id: league.id } });
    expect(after?.status).toBe("SETUP");
    const bracketCount = await prisma.bracket.count({ where: { leagueId: league.id } });
    expect(bracketCount).toBe(0);
  });

  it("advancePlayoffWinner (internal helper invoked directly)", async () => {
    const { league, p1, p2, match } = await setupArchivedLeagueFixture();

    await expect(
      prisma.$transaction(async (tx) => {
        await advancePlayoffWinner(
          tx,
          match.id,
          "HOME_WIN",
          league.id,
          p1.id,
          p2.id
        );
      })
    ).rejects.toThrow(LeagueArchivedError);
  });

  it("reportResult", async () => {
    const { match } = await setupArchivedLeagueFixture();
    mockSession.role = "ADMIN";
    mockSession.playerId = null;

    const result = await reportResult(match.id, {
      homeVictoryPoints: 40,
      awayVictoryPoints: 30,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe(ARCHIVED_ERROR_MESSAGE);

    const after = await prisma.match.findUnique({
      where: { id: match.id },
      include: { result: true },
    });
    expect(after?.result).toBeNull();
    expect(after?.status).toBe("SCHEDULED");
  });

  it("declareWalkover", async () => {
    const { p1, match } = await setupArchivedLeagueFixture();
    mockSession.role = "ADMIN";
    mockSession.playerId = null;

    const result = await declareWalkover(match.id, { winnerId: p1.id });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe(ARCHIVED_ERROR_MESSAGE);

    const after = await prisma.match.findUnique({
      where: { id: match.id },
      include: { result: true },
    });
    expect(after?.result).toBeNull();
    expect(after?.status).toBe("SCHEDULED");
  });

  it("resetLeague", async () => {
    const { league } = await setupArchivedLeagueFixture();
    const result = await resetLeague(league.id);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe(ARCHIVED_ERROR_MESSAGE);

    const matchCountAfter = await prisma.match.count({ where: { leagueId: league.id } });
    expect(matchCountAfter).toBe(1);
  });
});
