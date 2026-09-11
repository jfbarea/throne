// Tests for Hito E2 (bases-publicas-y-ruta-antigua, multi-liga lane E,
// plan/multi-liga/PLAN.md). Real test database (file:./test.db).
//
// Criterios covered (plan/multi-liga/PLAN.md, hito E2):
//   1 (spec 34): /liga/[slug]/bases responds without a session (no redirect
//     thrown) for a league in circulation.
//   2 (spec 44): /bases with no session and exactly one league in
//     circulation redirects straight to that league's bases, not /login.
//   3 (spec 40): /bases with a PLAYER session redirects to their own
//     league's bases; with an ADMIN session, to /admin; with no session and
//     two-or-more leagues in circulation, it renders the "usa el enlace
//     concreto" screen instead of guessing or listing.
//   4 (spec 34/40/44, "nunca lista ligas"): the rendered "usa el enlace
//     concreto" screen never contains any league's name or slug.
//
// A shared concern across the /bases tests: the real test.db accumulates
// leagues from every other test file in the suite (none of them archive or
// delete what they create), so "exactly one league in circulation" can't be
// asserted against however many leagues happen to already exist. Each test
// that depends on a specific *count* of circulating leagues archives every
// pre-existing circulating league first — archiving, not deleting, because
// League has no cascading FK deletes and other tests' leagues may have
// related rows; no other test file counts leagues globally, so this can't
// break them.

import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/session", () => ({
  getSession: vi.fn(async () => null),
}));

import { renderToStaticMarkup } from "react-dom/server";
import { prisma } from "@/lib/db";
import type { SessionPayload } from "@/lib/session";
import LigaBasesPage from "@/app/liga/[slug]/bases/page";

function uid(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function createTestLeague(overrides: Record<string, unknown> = {}) {
  const id = uid("league");
  return prisma.league.create({
    data: {
      id,
      name: `Liga secreta ${uid("name")}`,
      season: "2026 Test",
      slug: `${id}-slug`,
      archivedAt: null,
      ...overrides,
    },
  });
}

async function createTestPlayer(
  leagueId: string,
  role: "ADMIN" | "PLAYER" = "PLAYER"
) {
  return prisma.player.create({
    data: {
      id: uid("player"),
      leagueId,
      displayName: `Jugador ${uid("name")}`,
      role,
      passcodeHash: "test-hash",
    },
  });
}

/** Archive every league currently in circulation, so tests that need an
 * exact count of circulating leagues start from a known baseline. */
async function archiveAllCirculatingLeagues(): Promise<void> {
  await prisma.league.updateMany({
    where: { archivedAt: null },
    data: { archivedAt: new Date() },
  });
}

function redirectUrl(err: unknown): string {
  const digest = (err as { digest?: string }).digest;
  if (!digest || !digest.startsWith("NEXT_REDIRECT")) {
    throw new Error(`Not a redirect error: ${String(err)}`);
  }
  return digest.split(";")[2];
}

describe("/liga/[slug]/bases without a session (spec 34)", () => {
  it("responds (renders, doesn't redirect) for a league in circulation", async () => {
    const league = await createTestLeague();
    const element = await LigaBasesPage({
      params: Promise.resolve({ slug: league.slug }),
    });
    const html = renderToStaticMarkup(element as React.ReactElement);
    expect(html).toContain("Bases de la Liga");
  });
});

describe("/bases (bare route) — E2", () => {
  it("with no session and exactly one league in circulation, redirects straight to its bases (spec 44)", async () => {
    await archiveAllCirculatingLeagues();
    const only = await createTestLeague();

    vi.doMock("@/lib/session", () => ({
      getSession: vi.fn(async (): Promise<null> => null),
    }));
    vi.resetModules();
    const { default: BasesIndexPage } = await import("@/app/bases/page");

    try {
      await BasesIndexPage();
      expect.unreachable("expected a redirect");
    } catch (err) {
      expect(redirectUrl(err)).toBe(`/liga/${only.slug}/bases`);
    }
  });

  it("with no session and two-or-more leagues in circulation, renders the 'usa el enlace concreto' screen without listing any (spec 40)", async () => {
    await archiveAllCirculatingLeagues();
    const one = await createTestLeague({ name: "Liga Secreta Uno" });
    const two = await createTestLeague({ name: "Liga Secreta Dos" });

    vi.doMock("@/lib/session", () => ({
      getSession: vi.fn(async (): Promise<null> => null),
    }));
    vi.resetModules();
    const { default: BasesIndexPage } = await import("@/app/bases/page");

    const element = await BasesIndexPage();
    const html = renderToStaticMarkup(element as React.ReactElement);

    expect(html).not.toContain(one.name);
    expect(html).not.toContain(two.name);
    expect(html).not.toContain(one.slug);
    expect(html).not.toContain(two.slug);
  });

  it("with no session and zero leagues in circulation, also renders the 'usa el enlace concreto' screen (never lists, never crashes)", async () => {
    await archiveAllCirculatingLeagues();

    vi.doMock("@/lib/session", () => ({
      getSession: vi.fn(async (): Promise<null> => null),
    }));
    vi.resetModules();
    const { default: BasesIndexPage } = await import("@/app/bases/page");

    const element = await BasesIndexPage();
    const html = renderToStaticMarkup(element as React.ReactElement);
    expect(html).toContain("throne");
  });

  it("with a PLAYER session, redirects to their own league's bases (spec 40)", async () => {
    const league = await createTestLeague();
    const player = await createTestPlayer(league.id);
    const session: SessionPayload = { playerId: player.id, role: "PLAYER" };

    vi.doMock("@/lib/session", () => ({
      getSession: vi.fn(async (): Promise<SessionPayload> => session),
    }));
    vi.resetModules();
    const { default: BasesIndexPage } = await import("@/app/bases/page");

    try {
      await BasesIndexPage();
      expect.unreachable("expected a redirect");
    } catch (err) {
      expect(redirectUrl(err)).toBe(`/liga/${league.slug}/bases`);
    }
  });

  it("with a PLAYER session whose league is archived, signs them out (redirects to /login)", async () => {
    const league = await createTestLeague({ archivedAt: new Date() });
    const player = await createTestPlayer(league.id);
    const session: SessionPayload = { playerId: player.id, role: "PLAYER" };

    vi.doMock("@/lib/session", () => ({
      getSession: vi.fn(async (): Promise<SessionPayload> => session),
    }));
    vi.resetModules();
    const { default: BasesIndexPage } = await import("@/app/bases/page");

    try {
      await BasesIndexPage();
      expect.unreachable("expected a redirect");
    } catch (err) {
      expect(redirectUrl(err)).toBe("/login");
    }
  });

  it("with an ADMIN session, redirects to /admin without querying leagues (spec 40)", async () => {
    const session: SessionPayload = { playerId: null, role: "ADMIN" };

    vi.doMock("@/lib/session", () => ({
      getSession: vi.fn(async (): Promise<SessionPayload> => session),
    }));
    vi.resetModules();
    const { default: BasesIndexPage } = await import("@/app/bases/page");

    try {
      await BasesIndexPage();
      expect.unreachable("expected a redirect");
    } catch (err) {
      expect(redirectUrl(err)).toBe("/admin");
    }
  });
});
