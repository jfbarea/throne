// Regression test for I2 (auditoria-de-cierre) bug 1 — spec criterio 5.
//
// Neither existing suite could have caught this bug:
//   - tests/league-context.test.ts and tests/route-scaffolding.test.ts call
//     `requireLeagueAccess` (or the layout alone) in isolation.
//   - tests/vistas-de-jugador-con-slug.test.ts calls each page function
//     directly, never through the layout that wraps it in the real app.
// The actual bug lived in the INTERACTION between the two: `/liga/[slug]/
// layout.tsx` called `requireLeagueAccess(slug, session)` without
// `samePagePath` and redirected from there for a PLAYER on a foreign or
// nonexistent slug — a parent Server Component's `redirect()` always wins
// the render race in Next.js's App Router (it throws and aborts before any
// nested page's own async body starts), so the page's own, more precise
// `requireLeagueAccess(slug, session, "<page>")` call never got a chance to
// run. The result: a player of A requesting `/liga/<slug-B>/clasificacion`
// landed on `/liga/<slug-A>` (the bare segment, itself redirecting to
// `mis-partidas`) instead of `/liga/<slug-A>/clasificacion` — wrong
// destination, even though no data leaked.
//
// This file closes that coverage gap by walking the same two steps Next.js
// actually performs for a nested route, in the same order, with the real
// functions (not an opaque string standing in for the page, and not
// `requireLeagueAccess` called on its own):
//   1. Invoke the real `LigaLayout` for the requested slug — assert it does
//      NOT redirect (that's the fix: access enforcement for a PLAYER moved
//      entirely out of the layout).
//   2. Only then — mirroring how Next.js would actually reach it, since the
//      layout didn't abort — invoke the real page component for that same
//      slug, and assert THAT'S what produces the exact-page redirect.
// A regression that reintroduces the bug (the layout redirecting again,
// generically) would fail step 1 here, which is exactly what slipped past
// both existing suites before.

import { describe, it, expect, vi } from "vitest";
import { prisma } from "@/lib/db";
import type { SessionPayload } from "@/lib/session";

const mockSession = vi.hoisted(() => ({
  current: null as SessionPayload | null,
}));

vi.mock("@/lib/session", () => ({
  getSession: vi.fn(async () => mockSession.current),
}));
vi.mock("@/lib/guards", () => ({
  requireAuth: vi.fn(async () => {
    if (!mockSession.current) {
      throw new Error("requireAuth called with no session in test mock");
    }
    return mockSession.current;
  }),
}));

function uid(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function createTestLeague() {
  const id = uid("league");
  return prisma.league.create({
    data: {
      id,
      name: "Liga de test I2",
      season: "2026 Test",
      slug: `${id}-slug`,
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
 * same helper as tests/league-context.test.ts and tests/route-scaffolding.test.ts. */
function redirectUrl(err: unknown): string {
  const digest = (err as { digest?: string }).digest;
  if (!digest || !digest.startsWith("NEXT_REDIRECT")) {
    throw new Error(`Not a redirect error: ${String(err)}`);
  }
  return digest.split(";")[2];
}

const PAGE_MODULES: Record<string, string> = {
  clasificacion: "@/app/liga/[slug]/clasificacion/page",
  calendario: "@/app/liga/[slug]/calendario/page",
  rondas: "@/app/liga/[slug]/rondas/page",
  bracket: "@/app/liga/[slug]/bracket/page",
  "mis-partidas": "@/app/liga/[slug]/mis-partidas/page",
};

describe("layout + página en serie — spec criterio 5, las cinco vistas", () => {
  it.each(Object.keys(PAGE_MODULES))(
    "un jugador de A pidiendo /liga/<slug-B>/%s acaba exactamente ahí, en su propia liga",
    async (pageName) => {
      const leagueA = await createTestLeague();
      const leagueB = await createTestLeague();
      const player = await createTestPlayer(leagueA.id);
      mockSession.current = { playerId: player.id, role: "PLAYER" };

      const { default: LigaLayout } = await import("@/app/liga/[slug]/layout");
      const { default: Page } = await import(PAGE_MODULES[pageName]);

      // Step 1: the layout, given the SAME foreign slug, must NOT redirect —
      // this is the fix. Pre-I2, this line alone would have thrown
      // NEXT_REDIRECT to the bare `/liga/<leagueA.slug>`, and step 2 below
      // would never have been reached in the real app either.
      const layoutElement = await LigaLayout({
        children: "PAGE_BODY_MARKER" as unknown as React.ReactNode,
        params: Promise.resolve({ slug: leagueB.slug }),
      });
      expect(JSON.stringify(layoutElement)).toContain("PAGE_BODY_MARKER");

      // Step 2: only because the layout let it through does Next.js ever
      // reach the page — this is what actually redirects, and it's the only
      // one of the two that knows the exact page name.
      try {
        await Page({ params: Promise.resolve({ slug: leagueB.slug }) });
        expect.unreachable("expected the page's own redirect");
      } catch (err) {
        expect(redirectUrl(err)).toBe(`/liga/${leagueA.slug}/${pageName}`);
      }
    }
  );

  it.each(Object.keys(PAGE_MODULES))(
    "un slug inexistente produce la misma respuesta exacta que uno ajeno, en %s",
    async (pageName) => {
      const leagueA = await createTestLeague();
      const player = await createTestPlayer(leagueA.id);
      mockSession.current = { playerId: player.id, role: "PLAYER" };
      const nonexistentSlug = `nonexistent-${uid("slug")}`;

      const { default: LigaLayout } = await import("@/app/liga/[slug]/layout");
      const { default: Page } = await import(PAGE_MODULES[pageName]);

      const layoutElement = await LigaLayout({
        children: "PAGE_BODY_MARKER" as unknown as React.ReactNode,
        params: Promise.resolve({ slug: nonexistentSlug }),
      });
      expect(JSON.stringify(layoutElement)).toContain("PAGE_BODY_MARKER");

      try {
        await Page({ params: Promise.resolve({ slug: nonexistentSlug }) });
        expect.unreachable("expected the page's own redirect");
      } catch (err) {
        expect(redirectUrl(err)).toBe(`/liga/${leagueA.slug}/${pageName}`);
      }
    }
  );

  it("un jugador en su propia liga recorre layout + página sin ningún redirect", async () => {
    const league = await createTestLeague();
    const player = await createTestPlayer(league.id);
    mockSession.current = { playerId: player.id, role: "PLAYER" };

    const { default: LigaLayout } = await import("@/app/liga/[slug]/layout");
    const { default: ClasificacionPage } = await import(
      "@/app/liga/[slug]/clasificacion/page"
    );

    const layoutElement = await LigaLayout({
      children: "PAGE_BODY_MARKER" as unknown as React.ReactNode,
      params: Promise.resolve({ slug: league.slug }),
    });
    expect(JSON.stringify(layoutElement)).toContain("PAGE_BODY_MARKER");

    // No throw expected here — the page renders normally in the player's
    // own league.
    const pageElement = await ClasificacionPage({
      params: Promise.resolve({ slug: league.slug }),
    });
    expect(JSON.stringify(pageElement)).toContain(league.name);
  });
});
