// Tests for Hito C2 (andamiaje-de-rutas, multi-liga).
// Exercises the two new layouts directly as functions (no real page.tsx
// exists yet under either segment — C2's own scope is layouts only, lane A/B
// add pages later) against the real test database, per the hito's own
// acceptance criteria:
//   1. A page under /liga/[slug]/ receives the already-resolved league.
//   2. A slug that doesn't resolve never reaches the page body.
//   3. The layouts don't hit the database more than once per request.
//   4. (npm run build passing with empty page folders is verified manually,
//      not here — see the builder's report for this hito.)

import { describe, it, expect, vi } from "vitest";
import { prisma } from "@/lib/db";
import type { SessionPayload } from "@/lib/session";

function uid(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function createTestLeague(overrides: { archivedAt?: Date | null } = {}) {
  const id = uid("league");
  return prisma.league.create({
    data: {
      id,
      name: "Liga de test C2",
      season: "2026 Test",
      slug: `${id}-slug`,
      archivedAt: overrides.archivedAt ?? null,
    },
  });
}

async function createTestPlayer(leagueId: string) {
  return prisma.player.create({
    data: {
      id: uid("player"),
      leagueId,
      displayName: `Jugador ${uid("name")}`,
      role: "PLAYER",
      passcodeHash: "test-hash",
    },
  });
}

/** Extract the redirect target from a thrown next/navigation redirect error,
 * same helper as tests/league-context.test.ts. */
function redirectUrl(err: unknown): string {
  const digest = (err as { digest?: string }).digest;
  if (!digest || !digest.startsWith("NEXT_REDIRECT")) {
    throw new Error(`Not a redirect error: ${String(err)}`);
  }
  return digest.split(";")[2];
}

const PAGE_BODY = "PAGE_BODY_MARKER";

describe("liga/[slug] layout", () => {
  it("passes the resolved league through to the page body (PLAYER, own league)", async () => {
    vi.resetModules();
    const league = await createTestLeague();
    const player = await createTestPlayer(league.id);
    const session: SessionPayload = { playerId: player.id, role: "PLAYER" };
    vi.doMock("@/lib/session", () => ({
      getSession: vi.fn(async (): Promise<SessionPayload> => session),
    }));

    const { default: LigaLayout } = await import("@/app/liga/[slug]/layout");
    const element = await LigaLayout({
      children: PAGE_BODY as unknown as React.ReactNode,
      params: Promise.resolve({ slug: league.slug }),
    });

    // The page body marker must appear somewhere in the rendered tree.
    expect(JSON.stringify(element)).toContain(PAGE_BODY);
    // ...and the league's own name, proving the layout resolved it (not a
    // stub) before rendering children alongside it.
    expect(JSON.stringify(element)).toContain(league.name);
  });

  it("never reaches the page body for a PLAYER on a foreign/nonexistent slug — redirects instead", async () => {
    vi.resetModules();
    const own = await createTestLeague();
    const player = await createTestPlayer(own.id);
    const session: SessionPayload = { playerId: player.id, role: "PLAYER" };
    vi.doMock("@/lib/session", () => ({
      getSession: vi.fn(async (): Promise<SessionPayload> => session),
    }));

    const { default: LigaLayout } = await import("@/app/liga/[slug]/layout");

    try {
      await LigaLayout({
        children: PAGE_BODY as unknown as React.ReactNode,
        params: Promise.resolve({ slug: `nonexistent-${uid("slug")}` }),
      });
      expect.unreachable("expected a redirect, the page body must never render");
    } catch (err) {
      expect(redirectUrl(err)).toBe(`/liga/${own.slug}`);
    }
  });

  it("renders a fallback (not the page body) for an ADMIN on a nonexistent slug", async () => {
    vi.resetModules();
    const session: SessionPayload = { playerId: null, role: "ADMIN" };
    vi.doMock("@/lib/session", () => ({
      getSession: vi.fn(async (): Promise<SessionPayload> => session),
    }));

    const { default: LigaLayout } = await import("@/app/liga/[slug]/layout");
    const slug = `nonexistent-${uid("slug")}`;
    const element = await LigaLayout({
      children: PAGE_BODY as unknown as React.ReactNode,
      params: Promise.resolve({ slug }),
    });

    expect(JSON.stringify(element)).not.toContain(PAGE_BODY);
    expect(JSON.stringify(element)).toContain(slug);
  });

  it("resolves the league as a public read with no session, without redirecting (bases stays reachable)", async () => {
    vi.resetModules();
    vi.doMock("@/lib/session", () => ({
      getSession: vi.fn(async (): Promise<null> => null),
    }));
    const league = await createTestLeague();

    const { default: LigaLayout } = await import("@/app/liga/[slug]/layout");
    const element = await LigaLayout({
      children: PAGE_BODY as unknown as React.ReactNode,
      params: Promise.resolve({ slug: league.slug }),
    });

    expect(JSON.stringify(element)).toContain(PAGE_BODY);
    expect(JSON.stringify(element)).toContain(league.name);
  });

  // Note: React's `cache()` (wrapping `resolveLeagueBySlug`, src/lib/league-
  // context.ts) only dedupes calls made during an actual Next.js request
  // render — it needs the async-storage scope Next.js's server sets up, which
  // a plain Vitest call outside of any render doesn't have. Calling it twice
  // back-to-back here (outside Next) does NOT dedupe, so that specific
  // cross-call guarantee can't be asserted from this suite; it's the
  // documented, standard behavior of `cache()` in the App Router (layout +
  // page independently calling the same `cache()`-wrapped fetcher resolve to
  // one query), verified by code inspection rather than a unit test here.
  //
  // What IS testable here, and is this hito's actual acceptance criterion:
  // the layout's OWN code path resolves the league with a single query, not
  // an accidental extra one of its own.
  it("resolves the league with a single query per request (PLAYER, own league)", async () => {
    vi.resetModules();
    const league = await createTestLeague();
    const player = await createTestPlayer(league.id);
    const session: SessionPayload = { playerId: player.id, role: "PLAYER" };
    vi.doMock("@/lib/session", () => ({
      getSession: vi.fn(async (): Promise<SessionPayload> => session),
    }));

    const spy = vi.spyOn(prisma.league, "findUnique");
    const { default: LigaLayout } = await import("@/app/liga/[slug]/layout");
    await LigaLayout({
      children: PAGE_BODY as unknown as React.ReactNode,
      params: Promise.resolve({ slug: league.slug }),
    });

    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });
});

describe("admin/[slug] layout", () => {
  it("passes the resolved league through to the page body for ADMIN", async () => {
    vi.resetModules();
    const session: SessionPayload = { playerId: null, role: "ADMIN" };
    vi.doMock("@/lib/guards", () => ({
      requireAdmin: vi.fn(async () => session),
    }));

    const league = await createTestLeague();
    const { default: AdminLeagueLayout } = await import(
      "@/app/admin/[slug]/layout"
    );
    const element = await AdminLeagueLayout({
      children: PAGE_BODY as unknown as React.ReactNode,
      params: Promise.resolve({ slug: league.slug }),
    });

    expect(JSON.stringify(element)).toContain(PAGE_BODY);
    expect(JSON.stringify(element)).toContain(league.name);
  });

  it("grants ADMIN access to an archived league (read-only enforced elsewhere) instead of blocking navigation", async () => {
    vi.resetModules();
    const session: SessionPayload = { playerId: null, role: "ADMIN" };
    vi.doMock("@/lib/guards", () => ({
      requireAdmin: vi.fn(async () => session),
    }));

    const league = await createTestLeague({ archivedAt: new Date() });
    const { default: AdminLeagueLayout } = await import(
      "@/app/admin/[slug]/layout"
    );
    const element = await AdminLeagueLayout({
      children: PAGE_BODY as unknown as React.ReactNode,
      params: Promise.resolve({ slug: league.slug }),
    });

    expect(JSON.stringify(element)).toContain(PAGE_BODY);
  });

  it("renders a fallback (not the page body) for a nonexistent slug", async () => {
    vi.resetModules();
    const session: SessionPayload = { playerId: null, role: "ADMIN" };
    vi.doMock("@/lib/guards", () => ({
      requireAdmin: vi.fn(async () => session),
    }));

    const { default: AdminLeagueLayout } = await import(
      "@/app/admin/[slug]/layout"
    );
    const slug = `nonexistent-${uid("slug")}`;
    const element = await AdminLeagueLayout({
      children: PAGE_BODY as unknown as React.ReactNode,
      params: Promise.resolve({ slug }),
    });

    expect(JSON.stringify(element)).not.toContain(PAGE_BODY);
    expect(JSON.stringify(element)).toContain(slug);
  });
});
