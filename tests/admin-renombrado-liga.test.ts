// Tests for Hito B2 (renombrado-y-liga-no-encontrada, multi-liga).
// Covers the hito's own acceptance criteria (plan/multi-liga/PLAN.md):
//   1. Renombrar cambia el slug y la URL nueva resuelve.
//   2. El slug anterior deja de resolver y el admin ve la pantalla con la
//      lista de ligas, no un 404 seco.
//   3. Renombrar hasta colisionar con otra liga no falla: desambigua con
//      sufijo.
//   4. Un jugador que llega al slug viejo sigue acabando en su liga, sin ver
//      la pantalla del admin.

import { describe, it, expect, vi } from "vitest";

// `updateLeague` calls `requireAdmin()` itself (src/lib/guards.ts), which
// reads the session cookie via `next/headers` — unavailable outside a real
// Next.js request. Mocked the same way as tests/generar-con-rondas.test.ts;
// @/lib/db stays real (test.db).
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/guards", () => ({
  requireAdmin: vi.fn(async () => ({ role: "ADMIN", playerId: null })),
}));

import { prisma } from "@/lib/db";
import { updateLeague } from "@/server/league/config";
import {
  resolveLeagueBySlug,
  requireLeagueAccess,
} from "@/lib/league-context";
import type { SessionPayload } from "@/lib/session";
import type { LeagueConfigInput } from "@/lib/schemas";

function uid(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Flatten a real, already-invoked React element tree down to a searchable
 * string. A bare `JSON.stringify` doesn't work here: `next/link`'s compiled
 * module object carries a genuinely self-referential `default` property (an
 * existing Next.js ESM/CJS interop quirk, unrelated to this feature), and
 * `LeagueNotFoundScreen` (this file's target) renders real `<Link>`
 * elements — tripping `JSON.stringify`'s circular-reference check once
 * actually invoked (unlike tests/route-scaffolding.test.ts, which only ever
 * stringifies un-invoked element references). Repeated object references
 * are simply dropped after their first occurrence — plenty for a
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

async function createTestLeague(overrides: {
  name?: string;
  season?: string;
} = {}) {
  const id = uid("league");
  return prisma.league.create({
    data: {
      id,
      name: overrides.name ?? "Liga de test B2",
      season: overrides.season ?? "2026 Test",
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

/** Same fixed config shape every test needs, only name/season vary. */
function configInput(name: string, season: string): LeagueConfigInput {
  return {
    name,
    season,
    pointsWin: 3,
    pointsDraw: 1,
    pointsLoss: 0,
    bonusEnabled: false,
    playoffSize: 4,
    tiebreakers: ["POINTS", "VP_DIFF", "VP_FOR", "HEAD_TO_HEAD", "LOSSES", "ID_ORDER"],
    matchesPerRound: 2,
    startMonth: null,
  };
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

const ADMIN_SESSION: SessionPayload = { playerId: null, role: "ADMIN" };

describe("updateLeague — slug recomputation (criterio 1)", () => {
  it("recomputes the slug when the name changes, and the new slug resolves", async () => {
    const league = await createTestLeague({ name: "Liga Original" });
    const oldSlug = league.slug;

    const result = await updateLeague(
      league.id,
      configInput("Liga Renombrada", league.season)
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.slug).not.toBe(oldSlug);

    const bySlug = await resolveLeagueBySlug(result.data.slug);
    expect(bySlug?.id).toBe(league.id);
    expect(bySlug?.name).toBe("Liga Renombrada");
  });

  it("recomputes the slug when only the season changes", async () => {
    const league = await createTestLeague({ season: "2026 Primavera" });
    const result = await updateLeague(
      league.id,
      configInput(league.name, "2027 Otoño")
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.slug).not.toBe(league.slug);
  });

  it("keeps the same slug when name and season don't change", async () => {
    const league = await createTestLeague();
    const result = await updateLeague(
      league.id,
      configInput(league.name, league.season)
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.slug).toBe(league.slug);
  });
});

describe("updateLeague — old slug stops resolving (criterio 2)", () => {
  it("the previous slug no longer resolves to anything after a rename", async () => {
    const league = await createTestLeague({ name: "Liga Vieja" });
    const oldSlug = league.slug;

    const result = await updateLeague(
      league.id,
      configInput("Liga Nueva", league.season)
    );
    expect(result.ok).toBe(true);

    expect(await resolveLeagueBySlug(oldSlug)).toBeNull();
  });

  it("the layout falls back to the not-found screen for the old slug, never reaching the page body", async () => {
    const league = await createTestLeague({ name: "Liga Con Slug Viejo" });
    const oldSlug = league.slug;

    const result = await updateLeague(
      league.id,
      configInput("Liga Con Slug Nuevo", league.season)
    );
    expect(result.ok).toBe(true);

    vi.resetModules();
    vi.doMock("@/lib/guards", () => ({
      requireAdmin: vi.fn(async (): Promise<SessionPayload> => ADMIN_SESSION),
    }));
    const { default: AdminLeagueLayout } = await import(
      "@/app/admin/[slug]/layout"
    );

    const element = await AdminLeagueLayout({
      children: "PAGE_BODY_MARKER" as unknown as React.ReactNode,
      params: Promise.resolve({ slug: oldSlug }),
    });

    // The layout only invokes its own body — `LeagueNotFoundScreen` itself
    // (rendered further down the tree) isn't actually called from here, so
    // this only proves the routing, not its contents (covered below). Same
    // convention as tests/route-scaffolding.test.ts.
    expect(renderToText(element)).not.toContain("PAGE_BODY_MARKER");
  });

  it("LeagueNotFoundScreen lists every league (en circulación y archivadas) for the old slug — not a bare 404 (criterio 21)", async () => {
    const league = await createTestLeague({ name: "Liga Con Slug Viejo" });
    const oldSlug = league.slug;
    const otherLeague = await createTestLeague({ name: "Otra Liga En Circulación" });
    const archivedLeague = await createTestLeague({ name: "Liga Archivada Cualquiera" });
    await prisma.league.update({
      where: { id: archivedLeague.id },
      data: { archivedAt: new Date() },
    });

    const result = await updateLeague(
      league.id,
      configInput("Liga Con Slug Nuevo", league.season)
    );
    expect(result.ok).toBe(true);

    const { LeagueNotFoundScreen } = await import(
      "@/components/LeagueNotFoundScreen"
    );
    const element = await LeagueNotFoundScreen({ slug: oldSlug });
    const json = renderToText(element);

    expect(json).toContain(oldSlug);
    // The renamed league is findable under its NEW name, and every other
    // league — in circulation or archived — is listed too, not just the
    // one that moved.
    expect(json).toContain("Liga Con Slug Nuevo");
    expect(json).toContain(otherLeague.name);
    expect(json).toContain(archivedLeague.name);
    expect(json).toContain("En circulación");
    expect(json).toContain("Archivadas");
  });
});

describe("updateLeague — rename colliding with another league (criterio 3)", () => {
  it("disambiguates with a numeric suffix instead of failing", async () => {
    // Fixture leagues get a random test slug (createTestLeague), not a
    // slugify()'d one — give `taken` the real slug its name/season would
    // produce first, so the second rename genuinely collides with it.
    const takenSeed = await createTestLeague();
    const takenResult = await updateLeague(
      takenSeed.id,
      configInput("Liga Colisión", "2026")
    );
    expect(takenResult.ok).toBe(true);
    if (!takenResult.ok) return;
    const takenSlug = takenResult.data.slug;

    const renaming = await createTestLeague({
      name: "Liga Sin Relación",
      season: "2099",
    });

    const result = await updateLeague(
      renaming.id,
      configInput("Liga Colisión", "2026")
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.slug).not.toBe(takenSlug);
    expect(result.data.slug.startsWith(takenSlug)).toBe(true);

    // Both leagues keep resolving to their own row, no data merged.
    const original = await resolveLeagueBySlug(takenSlug);
    const renamed = await resolveLeagueBySlug(result.data.slug);
    expect(original?.id).toBe(takenSeed.id);
    expect(renamed?.id).toBe(renaming.id);
  });
});

describe("a player following the old slug after a rename (criterio 4)", () => {
  it("still lands on their own (renamed) league, never on the admin's not-found screen", async () => {
    const league = await createTestLeague({ name: "Liga Del Jugador" });
    const oldSlug = league.slug;
    const player = await createTestPlayer(league.id);
    // Second active player so the default playoffSize (4) in `configInput`
    // doesn't trip the unrelated "playoffSize > active players" guard.
    await createTestPlayer(league.id);
    await createTestPlayer(league.id);
    await createTestPlayer(league.id);
    const session: SessionPayload = { playerId: player.id, role: "PLAYER" };

    const result = await updateLeague(
      league.id,
      configInput("Liga Del Jugador Renombrada", league.season)
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // The player's bookmark still carries the pre-rename slug — indistinguishable
    // from "ajena"/"inexistente" for a PLAYER session (spec §4.2), which
    // `requireLeagueAccess` already redirects silently to their own league.
    try {
      await requireLeagueAccess(oldSlug, session);
      expect.unreachable("expected a redirect");
    } catch (err) {
      expect(redirectUrl(err)).toBe(`/liga/${result.data.slug}`);
    }
  });
});
