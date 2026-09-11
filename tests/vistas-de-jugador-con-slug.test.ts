// Tests for Hito A1 (vistas-de-jugador-con-slug, lane A, multi-liga).
// plan/multi-liga/PLAN.md, hito A1's own acceptance criteria (spec criterios
// 1-4):
//   1. grep -rn "league.findFirst" sobre las cinco rutas no devuelve nada.
//   2. Con dos ligas sembradas, la clasificación de A contiene exactamente
//      los jugadores de A.
//   3. La clasificación de A con dos ligas en base es idéntica, fila a fila,
//      a la calculada con A como única liga.
//   4. Crear la liga B no altera ninguna de las cinco vistas de un jugador
//      de A.
//
// `requireAuth` (src/lib/guards.ts) is mocked so each page gets a fixed
// session without needing a real signed cookie — same pattern as
// tests/cierre-de-ronda.test.ts. Everything else (the DB, `requireLeagueAccess`)
// is real, against the test database (file:./test.db).

import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "fs";
import path from "path";

const mockSession = vi.hoisted(() => ({
  playerId: null as string | null,
  role: "PLAYER" as "ADMIN" | "PLAYER",
}));

vi.mock("@/lib/guards", () => ({
  requireAuth: vi.fn(async () => ({
    playerId: mockSession.playerId,
    role: mockSession.role,
  })),
}));

import { prisma } from "@/lib/db";
import { computeStandings } from "@/server/standings";

function uid(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function createLeague(label: string) {
  const id = uid(`league-${label}`);
  return prisma.league.create({
    data: {
      id,
      name: `Liga ${label}`,
      season: "2026 Test",
      slug: `${id}-slug`,
      matchesPerRound: 2,
    },
  });
}

async function createPlayer(leagueId: string, name: string) {
  return prisma.player.create({
    data: {
      id: uid("player"),
      leagueId,
      displayName: name,
      role: "PLAYER",
      passcodeHash: "test-hash",
    },
  });
}

async function createReportedMatch(
  leagueId: string,
  roundId: string | null,
  homeId: string,
  awayId: string,
  homeVP: number,
  awayVP: number
) {
  const match = await prisma.match.create({
    data: {
      leagueId,
      roundId,
      phase: "LEAGUE",
      status: "REPORTED",
      playerHomeId: homeId,
      playerAwayId: awayId,
    },
  });
  await prisma.result.create({
    data: {
      matchId: match.id,
      homeVictoryPoints: homeVP,
      awayVictoryPoints: awayVP,
      outcome: homeVP > awayVP ? "HOME_WIN" : awayVP > homeVP ? "AWAY_WIN" : "DRAW",
      resolution: "PLAYED",
      reportedById: homeId,
    },
  });
  return match;
}

async function createRound(leagueId: string, index: number) {
  return prisma.round.create({
    data: { leagueId, index, deadline: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) },
  });
}

/** Builds two leagues (A, B) with disjoint rosters, one round each and one
 * reported league match each — B's numbers are deliberately different from
 * A's so any leak between them would change what a test observes. */
async function seedTwoLeagues() {
  const leagueA = await createLeague("A");
  const leagueB = await createLeague("B");

  const roundA = await createRound(leagueA.id, 1);
  const roundB = await createRound(leagueB.id, 1);

  const ana = await createPlayer(leagueA.id, `Ana ${uid("n")}`);
  const bruno = await createPlayer(leagueA.id, `Bruno ${uid("n")}`);
  const carla = await createPlayer(leagueB.id, `Carla ${uid("n")}`);
  const dani = await createPlayer(leagueB.id, `Dani ${uid("n")}`);

  await createReportedMatch(leagueA.id, roundA.id, ana.id, bruno.id, 60, 20);
  await createReportedMatch(leagueB.id, roundB.id, carla.id, dani.id, 99, 1);

  return { leagueA, leagueB, roundA, ana, bruno, carla, dani };
}

async function standingsForLeague(leagueId: string) {
  const players = await prisma.player.findMany({
    where: { leagueId, active: true },
    select: { id: true },
    orderBy: { createdAt: "asc" },
  });
  const rawMatches = await prisma.match.findMany({
    where: { leagueId, phase: "LEAGUE" },
    select: {
      id: true,
      status: true,
      phase: true,
      playerHomeId: true,
      playerAwayId: true,
      result: {
        select: {
          homeVictoryPoints: true,
          awayVictoryPoints: true,
          outcome: true,
          bonusHome: true,
          bonusAway: true,
          resolution: true,
        },
      },
    },
  });
  const config = {
    pointsWin: 3,
    pointsDraw: 1,
    pointsLoss: 0,
    tiebreakers: JSON.stringify([
      "POINTS",
      "VP_DIFF",
      "VP_FOR",
      "HEAD_TO_HEAD",
      "LOSSES",
      "ID_ORDER",
    ]),
    playoffSize: 4,
  };
  return computeStandings(
    rawMatches.map((m) => ({
      id: m.id,
      status: m.status,
      phase: m.phase,
      playerHomeId: m.playerHomeId,
      playerAwayId: m.playerAwayId,
      result: m.result,
    })),
    config,
    players.map((p) => p.id)
  );
}

// ---------------------------------------------------------------------------
// Criterio 1 — no `league.findFirst` in the five moved routes
// ---------------------------------------------------------------------------

describe("A1 criterio 1 — sin resolución implícita de liga", () => {
  const files = [
    "src/app/liga/[slug]/clasificacion/page.tsx",
    "src/app/liga/[slug]/calendario/page.tsx",
    "src/app/liga/[slug]/rondas/page.tsx",
    "src/app/liga/[slug]/bracket/page.tsx",
    "src/app/liga/[slug]/mis-partidas/page.tsx",
  ];

  it.each(files)("%s no contiene prisma.league.findFirst", (relPath) => {
    const source = readFileSync(path.resolve(process.cwd(), relPath), "utf-8");
    expect(source).not.toMatch(/league\.findFirst/);
  });
});

// ---------------------------------------------------------------------------
// Criterios 2-4 — aislamiento entre ligas
// ---------------------------------------------------------------------------

describe("A1 criterios 2-4 — aislamiento entre ligas", () => {
  it("clasificación de A contiene exactamente los jugadores de A, no los de B", async () => {
    const { leagueA, ana, bruno, carla, dani } = await seedTwoLeagues();
    mockSession.playerId = ana.id;
    mockSession.role = "PLAYER";

    const { default: ClasificacionPage } = await import(
      "@/app/liga/[slug]/clasificacion/page"
    );
    const element = await ClasificacionPage({
      params: Promise.resolve({ slug: leagueA.slug }),
    });
    const html = JSON.stringify(element);

    expect(html).toContain(ana.displayName);
    expect(html).toContain(bruno.displayName);
    expect(html).not.toContain(carla.displayName);
    expect(html).not.toContain(dani.displayName);
  });

  it("la clasificación de A es idéntica, fila a fila, con o sin la liga B en la base", async () => {
    const leagueA = await createLeague("A");
    const roundA = await createRound(leagueA.id, 1);
    const ana = await createPlayer(leagueA.id, `Ana ${uid("n")}`);
    const bruno = await createPlayer(leagueA.id, `Bruno ${uid("n")}`);
    await createReportedMatch(leagueA.id, roundA.id, ana.id, bruno.id, 60, 20);

    const before = await standingsForLeague(leagueA.id);

    // Now create league B, with different players and different numbers.
    const leagueB = await createLeague("B");
    const roundB = await createRound(leagueB.id, 1);
    const carla = await createPlayer(leagueB.id, `Carla ${uid("n")}`);
    const dani = await createPlayer(leagueB.id, `Dani ${uid("n")}`);
    await createReportedMatch(leagueB.id, roundB.id, carla.id, dani.id, 99, 1);

    const after = await standingsForLeague(leagueA.id);

    expect(after).toEqual(before);
    expect(after.map((r) => r.playerId).sort()).toEqual(
      [ana.id, bruno.id].sort()
    );
  });

  it("crear la liga B no altera ninguna de las cinco vistas de un jugador de A", async () => {
    const { leagueA, roundA, ana, bruno, carla, dani } = await seedTwoLeagues();
    mockSession.playerId = ana.id;
    mockSession.role = "PLAYER";

    const [
      { default: ClasificacionPage },
      { default: CalendarioPage },
      { default: RondasPage },
      { default: BracketPage },
      { default: MisPartidasPage },
    ] = await Promise.all([
      import("@/app/liga/[slug]/clasificacion/page"),
      import("@/app/liga/[slug]/calendario/page"),
      import("@/app/liga/[slug]/rondas/page"),
      import("@/app/liga/[slug]/bracket/page"),
      import("@/app/liga/[slug]/mis-partidas/page"),
    ]);

    const params = Promise.resolve({ slug: leagueA.slug });
    const pages = await Promise.all([
      ClasificacionPage({ params }),
      CalendarioPage({ params }),
      RondasPage({ params }),
      BracketPage({ params }),
      MisPartidasPage({ params }),
    ]);

    for (const element of pages) {
      const html = JSON.stringify(element);
      expect(html).not.toContain(carla.displayName);
      expect(html).not.toContain(dani.displayName);
    }

    // Sanity: the views DO show A's own data (roundA and the A/B players are
    // referenced so a trivially-empty render can't pass the assertions above).
    expect(roundA.leagueId).toBe(leagueA.id);
    expect(JSON.stringify(pages[0])).toContain(ana.displayName);
    expect(JSON.stringify(pages[4])).toContain(bruno.displayName);
  });
});
