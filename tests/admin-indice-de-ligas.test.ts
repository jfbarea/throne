// Tests for Hito B1 (indice-de-ligas-y-pantallas-con-slug, multi-liga).
// Covers the hito's own acceptance criteria (plan/multi-liga/PLAN.md):
//   1. grep for "league.findFirst" in files this lane owns — see the
//      builder's report; not expressible as a Vitest assertion.
//   2. "/clasificacion" con sesión de admin acaba en "/admin" — the redirect
//      itself lives in lane A's files (old unslugged routes), not touched by
//      this lane; not testable here without lane A's code present.
//   3. The admin opens A's and B's admin screens in the same session,
//      without signing out, and each lists only its own roster.
//   4. Each card's counter matches that league's own active players, not the
//      database total.
//   5. The header indicates the league of the context — exercised at the
//      `buildNavHref`/`buildAdminLinks` level (AppHeader/AdminMenu, spec
//      §4.10) plus the `/admin/[slug]` layout's LeagueIndicator, already
//      covered by tests/route-scaffolding.test.ts.

import { describe, it, expect, vi } from "vitest";
import { prisma } from "@/lib/db";
import type { SessionPayload } from "@/lib/session";
import { buildNavHref } from "@/components/AppHeader";
import { buildAdminLinks } from "@/components/AdminMenu";

function uid(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Flatten a real, already-invoked React element tree (e.g. the output of
 * directly calling an async page/layout function, as these tests do) down
 * to a searchable string, the same way tests/route-scaffolding.test.ts uses
 * `JSON.stringify` on elements that were never actually invoked. A bare
 * `JSON.stringify` doesn't work here: `next/link`'s compiled module object
 * carries a genuinely self-referential `default` property (an existing
 * Next.js ESM/CJS interop quirk, unrelated to this feature), and any tree
 * containing a real `<Link>` element trips `JSON.stringify`'s circular-
 * reference check. Repeated object references (that self-reference among
 * them) are simply dropped after their first occurrence — plenty for a
 * `.toContain(...)` assertion on text content.
 */
function renderToText(node: unknown): string {
  const seen = new WeakSet<object>();
  return JSON.stringify(node, (_key, value) => {
    if (typeof value === "object" && value !== null) {
      if (seen.has(value)) return undefined;
      seen.add(value);
    }
    return value;
  }) ?? "";
}

/**
 * Find the `LeagueActionTarget` (src/components/admin/league-actions-
 * contract.ts) passed to the `LeagueRow` element for a given league id,
 * searching the raw (un-invoked) element tree `/admin/page.tsx` returns.
 * `LeagueRow` itself is never actually called here (same reason
 * `renderToText` exists: directly calling a page function only expands ONE
 * level of JSX — nested custom components stay as un-invoked references) —
 * but the counter this test cares about is already fully computed data by
 * the time it's handed to `LeagueRow` as a prop, so it doesn't need
 * `LeagueRow` to actually render to be inspected. Walks with a `Set` to
 * survive the same self-referential `next/link` module object
 * `renderToText`'s comment describes, without needing to serialize anything.
 */
function findLeagueRowTarget(
  root: unknown,
  leagueId: string
): { activePlayerCount: number } | undefined {
  const seen = new Set<unknown>();
  function walk(node: unknown): { activePlayerCount: number } | undefined {
    if (node === null || typeof node !== "object") return undefined;
    if (seen.has(node)) return undefined;
    seen.add(node);

    const asRecord = node as Record<string, unknown>;
    const league = asRecord.league as { id?: string; activePlayerCount?: number } | undefined;
    if (league && league.id === leagueId && typeof league.activePlayerCount === "number") {
      return league as { activePlayerCount: number };
    }

    if (Array.isArray(node)) {
      for (const child of node) {
        const found = walk(child);
        if (found) return found;
      }
      return undefined;
    }
    for (const value of Object.values(asRecord)) {
      const found = walk(value);
      if (found) return found;
    }
    return undefined;
  }
  return walk(root);
}

async function createTestLeague(overrides: { archivedAt?: Date | null } = {}) {
  const id = uid("league");
  return prisma.league.create({
    data: {
      id,
      name: `Liga ${id}`,
      season: "2026 Test",
      slug: `${id}-slug`,
      archivedAt: overrides.archivedAt ?? null,
    },
  });
}

async function createTestPlayer(
  leagueId: string,
  overrides: { active?: boolean; role?: "ADMIN" | "PLAYER" } = {}
) {
  return prisma.player.create({
    data: {
      id: uid("player"),
      leagueId,
      displayName: `Jugador ${uid("name")}`,
      role: overrides.role ?? "PLAYER",
      active: overrides.active ?? true,
      passcodeHash: "test-hash",
    },
  });
}

const ADMIN_SESSION: SessionPayload = { playerId: null, role: "ADMIN" };

describe("buildNavHref (AppHeader, spec §4.10)", () => {
  it("points into the league of the context when a slug is known", () => {
    expect(buildNavHref("clasificacion", "liga-de-los-martes")).toBe(
      "/liga/liga-de-los-martes/clasificacion"
    );
  });

  it("falls back to the old unslugged route without a slug (resolves via its own redirect)", () => {
    expect(buildNavHref("clasificacion")).toBe("/clasificacion");
  });
});

describe("buildAdminLinks (AdminMenu, spec §2.3, §4.10)", () => {
  it("offers only the league index without a slug in context", () => {
    const links = buildAdminLinks();
    expect(links).toEqual([{ href: "/admin", label: "Panel", Icon: links[0].Icon }]);
  });

  it("builds every per-league section under the given slug", () => {
    const links = buildAdminLinks("liga-de-los-martes");
    const hrefs = links.map((l) => l.href);
    expect(hrefs).toEqual([
      "/admin",
      "/admin/liga-de-los-martes/liga",
      "/admin/liga-de-los-martes/jugadores",
      "/admin/liga-de-los-martes/emparejamientos",
      "/admin/liga-de-los-martes/rondas",
      "/admin/liga-de-los-martes/playoffs",
    ]);
  });
});

describe("admin/page.tsx — índice de ligas (criterio 4)", () => {
  it("counts active players per league, not the database total", async () => {
    const leagueA = await createTestLeague();
    const leagueB = await createTestLeague();
    // A: 2 active + 1 inactive. B: 1 active. A DB-wide count would show 3.
    await createTestPlayer(leagueA.id, { active: true });
    await createTestPlayer(leagueA.id, { active: true });
    await createTestPlayer(leagueA.id, { active: false });
    await createTestPlayer(leagueB.id, { active: true });

    vi.resetModules();
    const { default: AdminPage } = await import("@/app/admin/page");
    const element = await AdminPage();

    const targetA = findLeagueRowTarget(element, leagueA.id);
    const targetB = findLeagueRowTarget(element, leagueB.id);

    expect(targetA?.activePlayerCount).toBe(2);
    expect(targetB?.activePlayerCount).toBe(1);
    // Neither card's counter is the database-wide total (3).
    expect(targetA?.activePlayerCount).not.toBe(3);
    expect(targetB?.activePlayerCount).not.toBe(3);
  });

  it("separates leagues in circulación from archivadas", async () => {
    const enCirculacion = await createTestLeague();
    const archivada = await createTestLeague({ archivedAt: new Date() });

    vi.resetModules();
    const { default: AdminPage } = await import("@/app/admin/page");
    const element = await AdminPage();
    const json = renderToText(element);

    expect(json).toContain("En circulación");
    expect(json).toContain("Archivadas");
    expect(json).toContain(enCirculacion.name);
    expect(json).toContain(archivada.name);
  });
});

describe("admin screens — same session across two leagues (criterio 3)", () => {
  it("lists only its own roster for each league, without re-authenticating", async () => {
    const leagueA = await createTestLeague();
    const leagueB = await createTestLeague();
    const playerA = await createTestPlayer(leagueA.id);
    const playerB = await createTestPlayer(leagueB.id);

    vi.resetModules();
    vi.doMock("@/lib/guards", () => ({
      requireAdmin: vi.fn(async (): Promise<SessionPayload> => ADMIN_SESSION),
    }));

    const { default: AdminJugadoresPage } = await import(
      "@/app/admin/[slug]/jugadores/page"
    );

    // Same imported module, same "session" (mocked once) — two different
    // slugs in a row, exactly like the admin jumping between leagues
    // in-app without closing anything (spec §2.3, §5.9).
    const elementA = await AdminJugadoresPage({
      params: Promise.resolve({ slug: leagueA.slug }),
    });
    const elementB = await AdminJugadoresPage({
      params: Promise.resolve({ slug: leagueB.slug }),
    });

    const jsonA = renderToText(elementA);
    const jsonB = renderToText(elementB);

    expect(jsonA).toContain(playerA.displayName);
    expect(jsonA).not.toContain(playerB.displayName);
    expect(jsonB).toContain(playerB.displayName);
    expect(jsonB).not.toContain(playerA.displayName);
  });
});
