// Tests for multi-liga C3: sesion-de-admin-sin-playerid.
// Covers the hito's own acceptance criteria (plan/multi-liga/PLAN.md):
//   1. Tras el login de admin, el payload del JWT lleva `playerId: null`.
//   2. Un resultado apuntado por el admin en la liga B tiene `reportedById`
//      apuntando a un Player cuyo leagueId es el de B.
//   3. El AuditLog de esa acción tiene `actorId` apuntando a ese mismo Player.
//   4. `/mi-perfil` con sesión de admin redirige en vez de reventar.
//   5. La cabecera con sesión de admin renderiza sin `playerId`.
//
// Write tests against the real test database (file:./test.db), same
// conventions as tests/incomparecencia.test.ts and
// tests/route-scaffolding.test.ts: guards/session are mocked per describe
// block as needed, @/lib/db stays real.

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
      name: "Liga de test C3",
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

async function createMatch(leagueId: string, homeId: string, awayId: string) {
  const { prisma } = await import("@/lib/db");
  return prisma.match.create({
    data: {
      leagueId,
      phase: "LEAGUE",
      status: "SCHEDULED",
      playerHomeId: homeId,
      playerAwayId: awayId,
    },
  });
}

// ---------------------------------------------------------------------------
// Criterio 1: POST /api/auth/login-admin signs playerId: null
// ---------------------------------------------------------------------------

describe("POST /api/auth/login-admin", () => {
  it("signs the session with playerId: null (no global admin Player resolved)", async () => {
    vi.resetModules();
    // Even with an ADMIN Player row present in the DB, login-admin must NOT
    // resolve it — the whole point of C3 is that no single playerId can
    // represent "the" admin across leagues (spec §2.4, §4.4).
    const league = await createTestLeague();
    await createAdminPlayer(league.id);

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
    expect(cookie?.value).toBeTruthy();

    const payload = await verifySession(cookie!.value);
    expect(payload).not.toBeNull();
    expect(payload?.playerId).toBeNull();
    expect(payload?.role).toBe("ADMIN");
  });

  it("rejects a wrong passcode without touching the session cookie", async () => {
    vi.resetModules();
    const { NextRequest } = await import("next/server");
    const { POST } = await import("@/app/api/auth/login-admin/route");

    const req = new NextRequest("http://localhost/api/auth/login-admin", {
      method: "POST",
      body: JSON.stringify({ passcode: "wrong" }),
      headers: { "content-type": "application/json" },
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// Criterios 2-3: the actor of an admin write is derived per-league
// ---------------------------------------------------------------------------

const mockSession = vi.hoisted(() => ({
  role: "ADMIN" as "ADMIN" | "PLAYER",
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

describe("reportResult — admin actor derived per league (multi-liga spec §2.1.1, §4.4)", () => {
  it("a Result reported by the admin in league B has reportedById pointing at league B's own ADMIN Player, not league A's", async () => {
    const { prisma } = await import("@/lib/db");
    const { reportResult } = await import("@/server/result-actions");

    const leagueA = await createTestLeague();
    const adminA = await createAdminPlayer(leagueA.id);

    const leagueB = await createTestLeague();
    const adminB = await createAdminPlayer(leagueB.id);

    const home = await createPlayer(leagueB.id, "Home");
    const away = await createPlayer(leagueB.id, "Away");
    const match = await createMatch(leagueB.id, home.id, away.id);

    // The ADMIN session carries no fixed playerId (post-C3, always null) —
    // deliberately set to leagueA's admin id here to prove the write does
    // NOT just echo session.playerId back: it must re-derive the actor from
    // the match's own league (B), ignoring whatever the session happens to
    // carry.
    mockSession.role = "ADMIN";
    mockSession.playerId = adminA.id;

    const res = await reportResult(match.id, {
      homeVictoryPoints: 60,
      awayVictoryPoints: 40,
    });
    expect(res.ok).toBe(true);

    const result = await prisma.result.findUnique({
      where: { matchId: match.id },
    });
    expect(result?.reportedById).toBe(adminB.id);
    expect(result?.reportedById).not.toBe(adminA.id);

    // Criterio 3: the AuditLog entry for this action has the same actorId.
    const audit = await prisma.auditLog.findFirst({
      where: { entityType: "Match", entityId: match.id },
      orderBy: { createdAt: "desc" },
    });
    expect(audit?.actorId).toBe(adminB.id);
  });

  it("declareWalkover by the admin also attributes to the match's own league ADMIN Player", async () => {
    const { prisma } = await import("@/lib/db");
    const { declareWalkover } = await import("@/server/result-actions");

    const leagueA = await createTestLeague();
    const adminA = await createAdminPlayer(leagueA.id);

    const leagueB = await createTestLeague();
    const adminB = await createAdminPlayer(leagueB.id);

    const home = await createPlayer(leagueB.id, "Home");
    const away = await createPlayer(leagueB.id, "Away");
    const match = await createMatch(leagueB.id, home.id, away.id);

    mockSession.role = "ADMIN";
    mockSession.playerId = adminA.id;

    const res = await declareWalkover(match.id, { winnerId: home.id });
    expect(res.ok).toBe(true);

    const result = await prisma.result.findUnique({
      where: { matchId: match.id },
    });
    expect(result?.reportedById).toBe(adminB.id);
  });

  it("rejects the write with an explicit error when the match's league has no ADMIN Player at all", async () => {
    const { reportResult } = await import("@/server/result-actions");

    const league = await createTestLeague();
    // No ADMIN Player created for this league on purpose.
    const home = await createPlayer(league.id, "Home");
    const away = await createPlayer(league.id, "Away");
    const match = await createMatch(league.id, home.id, away.id);

    mockSession.role = "ADMIN";
    mockSession.playerId = null;

    const res = await reportResult(match.id, {
      homeVictoryPoints: 10,
      awayVictoryPoints: 0,
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toMatch(/no tiene un jugador con rol ADMIN/i);
  });
});

// ---------------------------------------------------------------------------
// Criterio 4: /mi-perfil with an ADMIN session redirects to /admin
// ---------------------------------------------------------------------------

describe("/mi-perfil — ADMIN session", () => {
  it("redirects to /admin instead of trying to resolve a nonexistent player row", async () => {
    vi.resetModules();
    const session = { playerId: null, role: "ADMIN" as const };
    vi.doMock("@/lib/guards", () => ({
      requireAuth: vi.fn(async () => session),
    }));

    const { default: MiPerfilPage } = await import("@/app/mi-perfil/page");

    try {
      await MiPerfilPage();
      expect.unreachable("expected a redirect to /admin");
    } catch (err) {
      const digest = (err as { digest?: string }).digest;
      expect(digest).toMatch(/^NEXT_REDIRECT/);
      expect(digest?.split(";")[2]).toBe("/admin");
    }
  });
});

// ---------------------------------------------------------------------------
// Criterio 5: the header renders with an ADMIN session that has no playerId
// ---------------------------------------------------------------------------

describe("AppHeaderUser — ADMIN session with playerId: null", () => {
  it("renders a label without dereferencing a Player row", async () => {
    vi.resetModules();
    const session = { playerId: null, role: "ADMIN" as const };
    vi.doMock("@/lib/session", () => ({
      getSession: vi.fn(async () => session),
    }));

    const { prisma } = await import("@/lib/db");
    const spy = vi.spyOn(prisma.player, "findUnique");

    const { AppHeaderUser } = await import("@/components/AppHeaderUser");
    const element = await AppHeaderUser();

    expect(element).not.toBeNull();
    expect(JSON.stringify(element)).toContain("Administrador");
    // playerId is null → no reason to hit the DB at all.
    expect(spy).not.toHaveBeenCalled();

    spy.mockRestore();
  });
});
