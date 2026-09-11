// Tests for Hito E1 (bases-por-liga, multi-liga lane E, plan/multi-liga/
// PLAN.md). Calls the page component directly as a function against the
// real test database (file:./test.db), same convention as
// tests/route-scaffolding.test.ts, then renders the resulting element tree
// to static HTML (`react-dom/server`'s `renderToStaticMarkup`) to check its
// text content — `JSON.stringify` (route-scaffolding.test.ts's own trick)
// chokes on this page's tree once `next/link`'s client-component wrapper is
// in it ("Converting circular structure to JSON"), so this file uses actual
// rendering instead.
//
// No session is mocked to a real value: `getSession` is mocked to always
// return `null`, exercising the sessionless, public path — this route's
// whole point (spec §2.11).
//
// Criterios covered (plan/multi-liga/PLAN.md, hito E1):
//   1 (spec 33): two leagues render distinct text, no cross-mention.
//   2 (spec 35, 36): pointsWin/matchesPerRound/playoffSize/bonusEnabled/
//     tiebreakers changes are reflected without editing any text (unit-level
//     coverage lives in tests/bases-rules-content.test.ts; this file proves
//     the same thing end-to-end, through the actual page).
//   3 (spec 37): editing A's prose changes only A's page.
//   4 (spec 38): empty prose still renders (generated block only).
//   5 (spec 39): an archived league's bases still render.
//   6 (spec 45): the migrated page says what the pre-migration
//     src/app/bases/page.tsx said — same five section titles, same scoring
//     values, same round cadence. The one deliberate exception, called out
//     explicitly rather than silently asserted, is the tiebreaker order: the
//     pre-migration page's hardcoded prose ("resultado directo · diferencia
//     de VP · VP a favor · dado") had drifted from the League.tiebreakers
//     default that SPEC.md §7.3 and src/server/standings.ts actually use
//     (POINTS, VP_DIFF, VP_FOR, HEAD_TO_HEAD, LOSSES, ID_ORDER) — missing
//     LOSSES entirely and ordering HEAD_TO_HEAD first instead of fourth.
//     Spec §4.11 is explicit that this block must read "del mismo sitio que
//     usan computeStandings", so the migrated page fixes that drift instead
//     of reproducing it. Flagged for the reviewer/architect rather than
//     decided silently (see the builder's final report).

import { describe, it, expect, vi } from "vitest";

// `getSession` reads `next/headers`' `cookies()`, which throws outside a real
// Next.js request scope (`throwForMissingRequestStore`). Every test in this
// file exercises the sessionless, public path (spec §2.11) on purpose, so
// mocking `getSession` to `null` is the exact scenario, not a workaround —
// same convention as tests/route-scaffolding.test.ts's `vi.doMock`.
vi.mock("@/lib/session", () => ({
  getSession: vi.fn(async () => null),
}));

import { renderToStaticMarkup } from "react-dom/server";
import { prisma } from "@/lib/db";
import { DEFAULT_RULES_MARKDOWN } from "@/server/league/default-rules";
import LigaBasesPage from "@/app/liga/[slug]/bases/page";

function uid(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function createTestLeague(overrides: Record<string, unknown> = {}) {
  const id = uid("league");
  return prisma.league.create({
    data: {
      id,
      name: "Liga de test E1",
      season: "2026 Test",
      slug: `${id}-slug`,
      archivedAt: null,
      ...overrides,
    },
  });
}

async function renderBases(slug: string): Promise<string> {
  const element = await LigaBasesPage({ params: Promise.resolve({ slug }) });
  return renderToStaticMarkup(element as React.ReactElement);
}

describe("/liga/[slug]/bases — E1", () => {
  it("renders distinct text for two leagues, with no cross-mention (spec 33)", async () => {
    const a = await createTestLeague({
      name: "Liga del Martes",
      rulesMarkdown: "## Ejércitos\n\nSolo listas de 1000 puntos en esta liga.",
    });
    const b = await createTestLeague({
      name: "Liga del Jueves",
      rulesMarkdown: "## Ejércitos\n\nSolo listas de 2000 puntos en esta liga.",
    });

    const renderedA = await renderBases(a.slug);
    const renderedB = await renderBases(b.slug);

    expect(renderedA).toContain("1000 puntos");
    expect(renderedA).not.toContain("2000 puntos");
    expect(renderedB).toContain("2000 puntos");
    expect(renderedB).not.toContain("1000 puntos");
    expect(renderedA).not.toBe(renderedB);
  });

  it("reflects pointsWin, matchesPerRound, playoffSize, bonusEnabled and tiebreaker order (spec 35, 36)", async () => {
    const league = await createTestLeague({
      pointsWin: 5,
      matchesPerRound: 3,
      playoffSize: 6,
      bonusEnabled: true,
      bonusMarginThreshold: 25,
      bonusMinVP: 45,
      tiebreakers: JSON.stringify(["VP_FOR", "POINTS", "LOSSES"]),
    });
    const rendered = await renderBases(league.slug);

    expect(rendered).toContain("Victoria 5");
    expect(rendered).toContain("3 partidas por ronda");
    expect(rendered).toContain("Clasifican a playoffs los 6");
    expect(rendered).toContain("25 VP de diferencia");
    expect(rendered).toContain("45 VP");
    expect(rendered.indexOf("VP a favor")).toBeLessThan(
      rendered.indexOf("Puntos de liga")
    );
  });

  it("editing one league's prose does not affect another's (spec 37)", async () => {
    const a = await createTestLeague({
      rulesMarkdown: "## Ejércitos\n\nTexto original de A.",
    });
    const b = await createTestLeague({
      rulesMarkdown: "## Ejércitos\n\nTexto original de B.",
    });

    await prisma.league.update({
      where: { id: a.id },
      data: { rulesMarkdown: "## Ejércitos\n\nTexto editado de A." },
    });

    const renderedA = await renderBases(a.slug);
    const renderedB = await renderBases(b.slug);

    expect(renderedA).toContain("Texto editado de A");
    expect(renderedA).not.toContain("Texto original de A");
    expect(renderedB).toContain("Texto original de B");
  });

  it("still renders with the generated block only when prose is empty (spec 38)", async () => {
    const league = await createTestLeague({ rulesMarkdown: "" });
    const rendered = await renderBases(league.slug);

    expect(rendered).toContain("Puntuación");
    expect(rendered).toContain("Victoria 3");
  });

  it("still renders the bases of an archived league (spec 39)", async () => {
    const league = await createTestLeague({
      archivedAt: new Date(),
      rulesMarkdown: "## Ejércitos\n\nBases archivadas, pero legibles.",
    });
    const rendered = await renderBases(league.slug);

    expect(rendered).toContain("Bases archivadas, pero legibles");
  });

  it("says what the pre-migration page said: same five sections, same default scoring and round cadence (spec 45)", async () => {
    // Schema defaults (prisma/schema.prisma, League) match exactly what the
    // pre-migration src/app/bases/page.tsx hardcoded: Victoria 3 · Empate 1 ·
    // Derrota 0, 2 partidas por ronda. rulesMarkdown is set explicitly here
    // because this fixture creates the League row directly (bypassing
    // createLeague, lane D's job, which is what actually wires this
    // template in for every brand-new league).
    const league = await createTestLeague({
      rulesMarkdown: DEFAULT_RULES_MARKDOWN,
    });
    const rendered = await renderBases(league.slug);

    for (const title of [
      "Formato",
      "Puntuación",
      "Ejércitos",
      "Incidencias",
      "Convivencia",
    ]) {
      expect(rendered).toContain(title);
    }
    expect(rendered).toContain("Victoria 3 · Empate 1 · Derrota 0.");
    expect(rendered).toContain("2 partidas por ronda");
    expect(rendered).toContain("80-0");
    expect(rendered).toContain("slow play");
  });
});
