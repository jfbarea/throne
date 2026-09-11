// Tests for multi-liga C5: fix src/server/round-actions.ts's admin-actor
// derivation, the same defect class C3 fixed in result-actions.ts and
// league/players.ts (spec §2.1.1, §2.4, §4.4, §4.9) but left unpatched here.
//
// closeRound, updateRoundDeadline and redistributePending used to read
// session.playerId directly for the AuditLog/Result actor and reject the
// write when it was null. Since login-admin now ALWAYS signs
// `playerId: null` (C3), that made every one of these admin actions
// unusable in production — a regression the rest of the suite never caught
// because it mocks @/lib/guards and hand-sets session.playerId to whatever
// value the test wants (see tests/cierre-de-ronda.test.ts and
// tests/recalculo-alta-baja-y-cupo.test.ts), never exercising the real
// login-admin → signed cookie → decoded session path.
//
// This file closes that hole: it calls the REAL POST /api/auth/login-admin
// handler and decodes the REAL signed cookie it returns with the REAL
// verifySession — the exact SessionPayload a production request would carry
// — and only then feeds that (not a hand-typed `{ playerId: null, role:
// "ADMIN" }` literal) into round-actions.ts through a minimal @/lib/guards
// mock. @/lib/db stays real, same convention as
// tests/sesion-de-admin-sin-playerid.test.ts.

import { describe, it, expect, vi } from "vitest";

function uid(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function createTestLeague() {
  const { prisma } = await import("@/lib/db");
  const id = uid("league");
  return prisma.league.create({
    data: {
      id,
      name: "Liga de test C5",
      season: "2026 Test",
      slug: `${id}-slug`,
      matchesPerRound: 2,
      startMonth: new Date(Date.UTC(2026, 2, 1)),
    },
  });
}

async function createAdminPlayer(leagueId: string) {
  const { prisma } = await import("@/lib/db");
  return prisma.player.create({
    data: {
      id: uid("admin"),
      leagueId,
      displayName: "Admin",
      role: "ADMIN",
      passcodeHash: "test-hash",
    },
  });
}

async function createPlayer(leagueId: string, name: string) {
  const { prisma } = await import("@/lib/db");
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
  const { prisma } = await import("@/lib/db");
  return prisma.round.create({ data: { leagueId, index, deadline } });
}

async function createMatch(
  leagueId: string,
  roundId: string,
  homeId: string,
  awayId: string
) {
  const { prisma } = await import("@/lib/db");
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

const PAST = new Date(Date.now() - 24 * 60 * 60 * 1000);

/**
 * Log in as the admin through the REAL route handler and decode the REAL
 * signed cookie it sets, with the REAL verifySession — no hand-typed
 * SessionPayload literal anywhere in this helper. This is what makes the
 * tests below actually exercise the login → session path end to end,
 * instead of just asserting round-actions.ts against an assumption of what
 * that path produces.
 */
async function loginAsAdminForReal() {
  const { NextRequest } = await import("next/server");
  const { POST } = await import("@/app/api/auth/login-admin/route");
  const { verifySession, SESSION_COOKIE } = await import("@/lib/session");

  const req = new NextRequest("http://localhost/api/auth/login-admin", {
    method: "POST",
    body: JSON.stringify({ passcode: "super-admin-test-passcode" }),
    headers: { "content-type": "application/json" },
  });
  const res = await POST(req);
  expect(res.status).toBe(200);

  const cookie = res.cookies.get(SESSION_COOKIE);
  const payload = await verifySession(cookie!.value);
  expect(payload).not.toBeNull();
  // Documents the precondition the rest of this file relies on — if
  // login-admin ever regresses to resolving a real playerId again, this
  // fails loudly here instead of the tests below silently passing for the
  // wrong reason.
  expect(payload!.playerId).toBeNull();
  expect(payload!.role).toBe("ADMIN");
  return payload!;
}

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const mockSession = vi.hoisted(() => ({
  role: "ADMIN" as "ADMIN" | "PLAYER",
  playerId: null as string | null,
}));

vi.mock("@/lib/guards", () => ({
  requireAdmin: vi.fn(async () => ({
    role: mockSession.role,
    playerId: mockSession.playerId,
  })),
}));

describe("round-actions.ts — admin actor derived from the REAL login-admin session (multi-liga C5)", () => {
  it("closeRound: AuditLog.actorId and the settled Result.reportedById point at the role=ADMIN Player of THIS round's league, not another one", async () => {
    const { prisma } = await import("@/lib/db");
    const { closeRound } = await import("@/server/round-actions");

    // The session the real login-admin route produces — decoded from an
    // actual signed cookie, not asserted by hand.
    const realAdminSession = await loginAsAdminForReal();
    mockSession.role = realAdminSession.role;
    mockSession.playerId = realAdminSession.playerId;

    // Two leagues, each with its own ADMIN Player — proves the actor is
    // re-derived per league, not cached from wherever the session last
    // pointed (same shape as the C3 cross-league test in
    // tests/sesion-de-admin-sin-playerid.test.ts).
    const leagueA = await createTestLeague();
    await createAdminPlayer(leagueA.id);

    const leagueB = await createTestLeague();
    const adminB = await createAdminPlayer(leagueB.id);

    const home = await createPlayer(leagueB.id, "Home");
    const away = await createPlayer(leagueB.id, "Away");
    const round = await createRound(leagueB.id, 1, PAST);
    const match = await createMatch(leagueB.id, round.id, home.id, away.id);

    const res = await closeRound(round.id);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.settledCount).toBe(1);

    const roundAfter = await prisma.round.findUnique({ where: { id: round.id } });
    expect(roundAfter?.closedAt).not.toBeNull();

    const result = await prisma.result.findUnique({
      where: { matchId: match.id },
    });
    expect(result?.reportedById).toBe(adminB.id);
    expect(result?.resolution).toBe("UNPLAYED_DRAW");

    const audit = await prisma.auditLog.findFirst({
      where: { action: "CLOSE_ROUND", entityId: round.id },
      orderBy: { createdAt: "desc" },
    });
    expect(audit?.actorId).toBe(adminB.id);
  });

  it("closeRound rejects with an explicit error (not a crash) when the round's league has no ADMIN Player at all", async () => {
    const { closeRound } = await import("@/server/round-actions");

    const realAdminSession = await loginAsAdminForReal();
    mockSession.role = realAdminSession.role;
    mockSession.playerId = realAdminSession.playerId;

    const league = await createTestLeague();
    // No ADMIN Player created for this league on purpose.
    const round = await createRound(league.id, 1, PAST);

    const res = await closeRound(round.id);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toMatch(/no tiene un jugador con rol ADMIN/i);
  });

  it("updateRoundDeadline: the AuditLog entry attributes to THIS round's own ADMIN Player under the real login-admin session", async () => {
    const { prisma } = await import("@/lib/db");
    const { updateRoundDeadline } = await import("@/server/round-actions");

    const realAdminSession = await loginAsAdminForReal();
    mockSession.role = realAdminSession.role;
    mockSession.playerId = realAdminSession.playerId;

    const leagueA = await createTestLeague();
    await createAdminPlayer(leagueA.id);

    const leagueB = await createTestLeague();
    const adminB = await createAdminPlayer(leagueB.id);
    const round = await createRound(leagueB.id, 1, PAST);

    const res = await updateRoundDeadline(round.id, { deadline: "2026-06-01" });
    expect(res.ok).toBe(true);

    const audit = await prisma.auditLog.findFirst({
      where: { action: "UPDATE_ROUND_DEADLINE", entityId: round.id },
      orderBy: { createdAt: "desc" },
    });
    expect(audit?.actorId).toBe(adminB.id);
  });
});
