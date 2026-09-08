// Tests for Hito H1: modelo-datos-rondas (feature "rondas-con-fecha").
// Covers the acceptance criteria of plan/rondas-con-fecha/PLAN.md §H1, which
// are schema/migration criteria of their own (the spec's 43 numbered
// criteria start at H2). See plan/specs/rondas-con-fecha.md §6.2 for the
// contract these tests verify.
//
// These are write tests against the real test database (file:./test.db)
// that vitest.config.ts injects and tests/db-global-setup.ts migrates, per
// spec §7.3 ("Los tests de escritura usan la DB de test...").

import { describe, it, expect } from "vitest";
import { execSync } from "child_process";
import { prisma } from "@/lib/db";
import { Resolution } from "@/generated/prisma/client";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function uid(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function createLeague(overrides: {
  matchesPerRound?: number;
  startMonth?: Date;
} = {}) {
  return prisma.league.create({
    data: {
      id: uid("league"),
      name: "Liga de test H1",
      season: "2026 Test",
      matchesPerRound: overrides.matchesPerRound ?? 2,
      startMonth: overrides.startMonth ?? new Date(Date.UTC(2026, 2, 1)),
    },
  });
}

async function createPlayer(leagueId: string, displayName: string) {
  return prisma.player.create({
    data: {
      id: uid("player"),
      leagueId,
      displayName,
      passcodeHash: "test-hash",
    },
  });
}

async function createMatch(
  leagueId: string,
  homeId: string,
  awayId: string,
  roundId: string | null = null
) {
  return prisma.match.create({
    data: {
      id: uid("match"),
      leagueId,
      playerHomeId: homeId,
      playerAwayId: awayId,
      roundId,
    },
  });
}

// ---------------------------------------------------------------------------
// H1-AC1: migración y cliente generado con Round y Resolution
// ---------------------------------------------------------------------------

describe("H1-AC1: npx prisma migrate dev + generate producen Round y Resolution", () => {
  it("el cliente Prisma expone el delegate prisma.round", () => {
    expect(typeof prisma.round.create).toBe("function");
    expect(typeof prisma.round.findMany).toBe("function");
  });

  it("crea y persiste un Round real contra la base de datos", async () => {
    const league = await createLeague();
    const round = await prisma.round.create({
      data: {
        id: uid("round"),
        leagueId: league.id,
        index: 1,
        deadline: new Date(Date.UTC(2026, 2, 31)),
      },
    });

    expect(round.id).toBeTruthy();
    expect(round.leagueId).toBe(league.id);
    expect(round.index).toBe(1);
    // closedAt is nullable while the round is open.
    expect(round.closedAt).toBeNull();

    const fetched = await prisma.round.findUnique({ where: { id: round.id } });
    expect(fetched).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// H1-AC2: Match.roundId nullable y Result.resolution con @default(PLAYED)
// ---------------------------------------------------------------------------

describe("H1-AC2: Match.roundId es nullable y Result.resolution por defecto PLAYED", () => {
  it("permite crear un Match sin roundId (caso playoff, sin ronda)", async () => {
    const league = await createLeague();
    const home = await createPlayer(league.id, "Jugador Home");
    const away = await createPlayer(league.id, "Jugador Away");

    const match = await createMatch(league.id, home.id, away.id, null);

    expect(match.roundId).toBeNull();
  });

  it("asocia un Match a un Round existente vía roundId", async () => {
    const league = await createLeague();
    const home = await createPlayer(league.id, "Jugador Home");
    const away = await createPlayer(league.id, "Jugador Away");
    const round = await prisma.round.create({
      data: {
        id: uid("round"),
        leagueId: league.id,
        index: 1,
        deadline: new Date(Date.UTC(2026, 2, 31)),
      },
    });

    const match = await createMatch(league.id, home.id, away.id, round.id);

    expect(match.roundId).toBe(round.id);
    const roundWithMatches = await prisma.round.findUnique({
      where: { id: round.id },
      include: { matches: true },
    });
    expect(roundWithMatches?.matches.map((m) => m.id)).toContain(match.id);
  });

  it("un Result creado sin especificar resolution queda en PLAYED", async () => {
    const league = await createLeague();
    const home = await createPlayer(league.id, "Jugador Home");
    const away = await createPlayer(league.id, "Jugador Away");
    const match = await createMatch(league.id, home.id, away.id, null);

    const result = await prisma.result.create({
      data: {
        id: uid("result"),
        matchId: match.id,
        homeVictoryPoints: 45,
        awayVictoryPoints: 38,
        outcome: "HOME_WIN",
        reportedById: home.id,
      },
    });

    expect(result.resolution).toBe(Resolution.PLAYED);
  });
});

// ---------------------------------------------------------------------------
// H1-AC3: @@unique([leagueId, index]) rechaza índices duplicados
// ---------------------------------------------------------------------------

describe("H1-AC3: @@unique([leagueId, index]) impide dos rondas con el mismo índice", () => {
  it("rechaza una segunda ronda con el mismo índice en la misma liga", async () => {
    const league = await createLeague();
    await prisma.round.create({
      data: {
        id: uid("round"),
        leagueId: league.id,
        index: 1,
        deadline: new Date(Date.UTC(2026, 2, 31)),
      },
    });

    await expect(
      prisma.round.create({
        data: {
          id: uid("round"),
          leagueId: league.id,
          index: 1,
          deadline: new Date(Date.UTC(2026, 3, 30)),
        },
      })
    ).rejects.toMatchObject({
      code: "P2002",
    });
  });

  it("permite el mismo índice en ligas distintas", async () => {
    const leagueA = await createLeague();
    const leagueB = await createLeague();

    await expect(
      prisma.round.create({
        data: {
          id: uid("round"),
          leagueId: leagueA.id,
          index: 1,
          deadline: new Date(Date.UTC(2026, 2, 31)),
        },
      })
    ).resolves.toBeTruthy();

    await expect(
      prisma.round.create({
        data: {
          id: uid("round"),
          leagueId: leagueB.id,
          index: 1,
          deadline: new Date(Date.UTC(2026, 2, 31)),
        },
      })
    ).resolves.toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// H1-AC4: npm run seed deja la liga con matchesPerRound y startMonth
// ---------------------------------------------------------------------------

describe("H1-AC4: el seed deja la liga con matchesPerRound = 2 y un startMonth", () => {
  it("tras ejecutar prisma/seed.ts, la liga sembrada tiene matchesPerRound=2 y startMonth no nulo", () => {
    execSync("npx tsx prisma/seed.ts", {
      env: {
        ...process.env,
        DATABASE_URL: "file:./test.db",
      },
      stdio: "pipe",
    });

    return prisma.league
      .findUnique({ where: { id: "seed-league-001" } })
      .then((league) => {
        expect(league).not.toBeNull();
        expect(league?.matchesPerRound).toBe(2);
        // The seed fixes a deterministic value (prisma/seed.ts:
        // LEAGUE_START_MONTH = new Date(Date.UTC(2026, 2, 1))); assert the
        // exact value, not just its type.
        expect(league?.startMonth).toEqual(new Date(Date.UTC(2026, 2, 1)));
      });
  });
});

// ---------------------------------------------------------------------------
// H1-AC4: startMonth es nullable — una liga sin mes de arranque configurado
// es un estado válido (no se inventa un valor plausible, §4.4).
// ---------------------------------------------------------------------------

describe("H1-AC4: startMonth es nullable — una liga en SETUP puede no tener mes de arranque aún", () => {
  it("crea una League sin startMonth y el campo queda en null", async () => {
    const league = await prisma.league.create({
      data: {
        id: uid("league"),
        name: "Liga sin mes de arranque",
        season: "2026 Test",
        // startMonth omitted on purpose: no admin has configured it yet.
      },
    });

    expect(league.startMonth).toBeNull();
  });
});

// Note on H1-AC5 ("npm run lint, npm run test, npm run e2e y npm run build
// verdes"): this is a regression criterion about the four commands
// themselves, not something a nested test inside `npm run test` can assert
// without becoming circular. It is verified by actually running the four
// commands (documented in the builder's final report), the same way the
// spec's own criterion 38 is verified.
