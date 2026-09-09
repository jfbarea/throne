// Tests for Hito H9: puerta-a-playoffs (feature "rondas-con-fecha").
// Covers criterios 36 and 37 (plan/specs/rondas-con-fecha.md §8, §4.11) — see
// plan/rondas-con-fecha/PLAN.md §H9.
//
// Write tests against the real test database (file:./test.db) that
// vitest.config.ts injects and tests/db-global-setup.ts migrates (spec §7.3).
// Only next/cache and @/lib/guards are mocked — @/lib/db stays real, same
// convention as tests/cierre-de-ronda.test.ts and
// tests/endurecer-guardas-transaccionales.test.ts. Rounds, players and
// results are built directly with `prisma` (not via generateLeagueMatches or
// reportResult) so each test fully controls which rounds are open/closed and
// which standings order comes out of computeStandings — startPlayoffs is the
// only thing under test here.

import { describe, it, expect, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/guards", () => ({
  requireAdmin: vi.fn(async () => ({ role: "ADMIN", playerId: null })),
}));

import { prisma } from "@/lib/db";
import { startPlayoffs } from "@/server/playoff-actions";
import { buildBracket, seedsFromStandings } from "@/server/bracket";
import { computeStandings, type StandingsMatch } from "@/server/standings";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function uid(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

const PAST = new Date(Date.now() - 24 * 60 * 60 * 1000);
const FUTURE = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
const FAR_FUTURE = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000);

async function createLeague(overrides: { playoffSize: number }) {
  return prisma.league.create({
    data: {
      id: uid("league"),
      name: "Liga de test H9",
      season: "2026 Test",
      status: "LEAGUE",
      matchesPerRound: 2,
      startMonth: new Date(Date.UTC(2026, 2, 1)),
      playoffSize: overrides.playoffSize,
    },
  });
}

async function createPlayer(leagueId: string, name: string) {
  return prisma.player.create({
    data: {
      id: uid("player"),
      leagueId,
      displayName: `Jugador ${name}`,
      passcodeHash: "test-hash",
    },
  });
}

async function createRound(
  leagueId: string,
  index: number,
  deadline: Date,
  closedAt: Date | null
) {
  return prisma.round.create({
    data: { leagueId, index, deadline, closedAt },
  });
}

/** Creates a LEAGUE, REPORTED match with a real PLAYED result (`homeId` wins
 * by a fixed 50-10 margin), and returns the `StandingsMatch` shape it maps
 * to — so the test can feed the exact same data it just wrote into
 * `computeStandings` directly, as the oracle for what `startPlayoffs` should
 * produce. */
async function createPlayedMatch(
  leagueId: string,
  roundId: string,
  homeId: string,
  awayId: string
): Promise<StandingsMatch> {
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
      homeVictoryPoints: 50,
      awayVictoryPoints: 10,
      outcome: "HOME_WIN",
      resolution: "PLAYED",
      reportedById: homeId,
      bonusHome: 0,
      bonusAway: 0,
    },
  });
  return {
    id: match.id,
    status: "REPORTED",
    phase: "LEAGUE",
    playerHomeId: homeId,
    playerAwayId: awayId,
    result: {
      homeVictoryPoints: 50,
      awayVictoryPoints: 10,
      outcome: "HOME_WIN",
      bonusHome: 0,
      bonusAway: 0,
    },
  };
}

/** Every player beats every player that comes after it in `players` — a
 * strictly descending win count (n-1, n-2, …, 0) guarantees a strict,
 * tiebreaker-proof standings order players[0] > players[1] > … in points
 * alone, with the seed of `players[i]` always `i + 1`. */
async function createStrictRoundRobin(
  leagueId: string,
  roundId: string,
  players: { id: string }[]
): Promise<StandingsMatch[]> {
  const matches: StandingsMatch[] = [];
  for (let i = 0; i < players.length; i++) {
    for (let j = i + 1; j < players.length; j++) {
      matches.push(
        await createPlayedMatch(leagueId, roundId, players[i].id, players[j].id)
      );
    }
  }
  return matches;
}

/** Spy on prisma.$transaction so the very next call runs `injected` first
 * (simulating a concurrent write landing in the window) and then delegates
 * to the real transaction — same technique validated for D5's and H5b's
 * TOCTOU fixes. */
function raceIntoNextTransaction(injected: () => Promise<void>) {
  const originalTransaction = prisma.$transaction.bind(prisma);
  return vi
    .spyOn(prisma, "$transaction")
    .mockImplementationOnce(async (callback: unknown) => {
      await injected();
      return (originalTransaction as (fn: unknown) => Promise<unknown>)(
        callback
      );
    });
}

// ---------------------------------------------------------------------------
// AC-36: startPlayoffs falla nombrando las rondas concretas que faltan y su
// fecha de cierre
// ---------------------------------------------------------------------------

describe("AC-36: startPlayoffs falla mientras exista una ronda sin closedAt, nombrando cuáles y su fecha", () => {
  it("con más de una ronda sin cerrar, el mensaje nombra cada una con su fecha de cierre y no menciona la que sí está cerrada", async () => {
    const league = await createLeague({ playoffSize: 2 });
    const p1 = await createPlayer(league.id, "A");
    const p2 = await createPlayer(league.id, "B");

    const round1 = await createRound(league.id, 1, PAST, PAST); // closed
    const round2 = await createRound(league.id, 2, FUTURE, null); // open
    const round3 = await createRound(league.id, 3, FAR_FUTURE, null); // open

    const attempt = await startPlayoffs(league.id);

    expect(attempt.ok).toBe(false);
    if (attempt.ok) return;

    const round2Date = round2.deadline.toLocaleDateString("es-ES");
    const round3Date = round3.deadline.toLocaleDateString("es-ES");

    // Named explicitly — not a generic "faltan rondas" — and each with its
    // own deadline (criterio 36's exact wording).
    expect(attempt.error).toContain(`ronda 2 (cierre ${round2Date})`);
    expect(attempt.error).toContain(`ronda 3 (cierre ${round3Date})`);
    // The already-closed round is never named as missing.
    expect(attempt.error).not.toMatch(/ronda 1\b/);

    // No side effect: nothing was ever built.
    const bracket = await prisma.bracket.findUnique({
      where: { leagueId: league.id },
    });
    expect(bracket).toBeNull();
    const leagueAfter = await prisma.league.findUnique({
      where: { id: league.id },
    });
    expect(leagueAfter?.status).toBe("LEAGUE");

    // Silence unused-var lint on p1/p2 — created for realism (a real league
    // never has zero players), not read by this assertion.
    expect([p1.id, p2.id]).toHaveLength(2);
    void round1;
  });

  it("con una sola ronda sin cerrar, el mensaje la nombra igualmente (no exige plural)", async () => {
    const league = await createLeague({ playoffSize: 2 });
    await createPlayer(league.id, "A");
    await createPlayer(league.id, "B");
    const round1 = await createRound(league.id, 1, FUTURE, null);

    const attempt = await startPlayoffs(league.id);

    expect(attempt.ok).toBe(false);
    if (attempt.ok) return;
    expect(attempt.error).toContain(
      `ronda 1 (cierre ${round1.deadline.toLocaleDateString("es-ES")})`
    );
  });
});

// ---------------------------------------------------------------------------
// Endurecimiento (encargo del coordinador tras la review de H9): la
// intención de §4.11 — "los playoffs arrancan con las C(n,2) partidas
// resueltas" — no se sostiene ni vacuamente si la liga no tiene NINGUNA
// `Round`. Alcanzable solo a través del hueco no-atómico ya documentado en
// `redistributePending` (src/server/round-actions.ts): la primera alta de una
// liga puede dejar `status: LEAGUE` con partidas de `roundId: null` y cero
// filas `Round` si esa segunda transacción falla. Distinto del mensaje de
// "faltan rondas por cerrar" (AC-36) — el diagnóstico es otro.
// ---------------------------------------------------------------------------

describe("Endurecimiento: liga sin ninguna ronda generada (intención de §4.11, no cubierta por la literalidad del criterio 36)", () => {
  it("con status LEAGUE, cero Round y partidas con roundId: null, startPlayoffs rechaza con un mensaje propio y no crea ningún Bracket ni BracketSlot", async () => {
    const league = await createLeague({ playoffSize: 2 });
    const p1 = await createPlayer(league.id, "A");
    const p2 = await createPlayer(league.id, "B");

    // Reproduces the documented non-atomic gap directly: a LEAGUE match with
    // roundId: null and zero Round rows for the league — no round-robin
    // generator involved, this is exactly the state redistributePending's
    // own docstring says addMissingLeagueMatches can leave behind.
    await prisma.match.create({
      data: {
        leagueId: league.id,
        roundId: null,
        phase: "LEAGUE",
        status: "SCHEDULED",
        playerHomeId: p1.id,
        playerAwayId: p2.id,
      },
    });

    const roundCountBefore = await prisma.round.count({
      where: { leagueId: league.id },
    });
    expect(roundCountBefore).toBe(0);

    const attempt = await startPlayoffs(league.id);

    expect(attempt.ok).toBe(false);
    if (attempt.ok) return;
    // Its own diagnosis — not the "faltan rondas por cerrar" wording, which
    // would be misleading here (there is nothing to name).
    expect(attempt.error).toContain("no tiene ninguna ronda generada");
    expect(attempt.error).not.toContain("sin cerrar");

    const bracket = await prisma.bracket.findUnique({
      where: { leagueId: league.id },
    });
    expect(bracket).toBeNull();
    const bracketSlots = await prisma.bracketSlot.findMany({
      where: { bracket: { leagueId: league.id } },
    });
    expect(bracketSlots).toHaveLength(0);
    const leagueAfter = await prisma.league.findUnique({
      where: { id: league.id },
    });
    expect(leagueAfter?.status).toBe("LEAGUE");
  });
});

// ---------------------------------------------------------------------------
// AC-37: con todas las rondas cerradas, startPlayoffs funciona exactamente
// como hoy — mismo bracket, mismo seeding, mismos byes. Comparación de
// estructura completa contra buildBracket/seedsFromStandings llamados
// directamente sobre los mismos datos, no solo "existe un bracket".
// ---------------------------------------------------------------------------

describe("AC-37: con todas las rondas cerradas, startPlayoffs produce el mismo bracket, seeding y byes que antes de este hito", () => {
  it("playoffSize=4 (sin byes): estructura de slots, seeding y matches idénticos a buildBracket(seeds)", async () => {
    const league = await createLeague({ playoffSize: 4 });
    const players = await Promise.all(
      ["A", "B", "C", "D"].map((n) => createPlayer(league.id, n))
    );
    const round = await createRound(league.id, 1, PAST, PAST); // closed
    const standingsMatches = await createStrictRoundRobin(
      league.id,
      round.id,
      players
    );

    const attempt = await startPlayoffs(league.id);
    expect(attempt.ok).toBe(true);
    if (!attempt.ok) return;

    // Oracle: the exact same pure pipeline startPlayoffs itself calls,
    // fed the exact same data this test just wrote to the DB.
    const standings = computeStandings(
      standingsMatches,
      {
        pointsWin: league.pointsWin,
        pointsDraw: league.pointsDraw,
        pointsLoss: league.pointsLoss,
        tiebreakers: league.tiebreakers,
        playoffSize: league.playoffSize,
      },
      players.map((p) => p.id)
    );
    const seeds = seedsFromStandings(standings, league.playoffSize);
    const spec = buildBracket(seeds);

    // Strict descending win-count fixture: players[0] is seed 1, …
    expect(seeds.map((s) => s.playerId)).toEqual(players.map((p) => p.id));

    const bracket = await prisma.bracket.findUnique({
      where: { leagueId: league.id },
    });
    expect(bracket).not.toBeNull();
    expect(bracket!.size).toBe(spec.size);
    expect(bracket!.id).toBe(attempt.data.bracketId);

    const dbSlots = await prisma.bracketSlot.findMany({
      where: { bracketId: bracket!.id },
      orderBy: [{ roundIndex: "asc" }, { position: "asc" }],
    });
    expect(dbSlots).toHaveLength(spec.slots.length);

    for (let i = 0; i < spec.slots.length; i++) {
      const specSlot = spec.slots[i];
      const dbSlot = dbSlots[i];
      expect(dbSlot.roundIndex).toBe(specSlot.roundIndex);
      expect(dbSlot.position).toBe(specSlot.position);
      expect(dbSlot.playerId).toBe(specSlot.playerId);
      if (specSlot.feedsIntoIndex === null) {
        expect(dbSlot.feedsIntoSlotId).toBeNull();
      } else {
        expect(dbSlot.feedsIntoSlotId).toBe(dbSlots[specSlot.feedsIntoIndex].id);
      }

      const match = await prisma.match.findFirst({
        where: { bracketSlotId: dbSlot.id },
      });
      if (specSlot.isBye) {
        expect(match).toMatchObject({
          phase: "PLAYOFF",
          status: "CONFIRMED",
          isBye: true,
          playerHomeId: specSlot.playerId,
          playerAwayId: null,
        });
      } else if (specSlot.roundIndex === 1) {
        const topSeedNum = specSlot.position;
        const bottomSeedNum = spec.size + 1 - specSlot.position;
        const homePlayer = seeds.find((s) => s.seed === topSeedNum)!;
        const awayPlayer = seeds.find((s) => s.seed === bottomSeedNum)!;
        expect(match).toMatchObject({
          phase: "PLAYOFF",
          status: "SCHEDULED",
          isBye: false,
          playerHomeId: homePlayer.playerId,
          playerAwayId: awayPlayer.playerId,
        });
      } else {
        expect(match).toBeNull();
      }
    }

    const leagueAfter = await prisma.league.findUnique({
      where: { id: league.id },
    });
    expect(leagueAfter?.status).toBe("PLAYOFFS");
  });

  it("playoffSize=6 (2 byes, size efectivo 8): los byes salen a los mismos seeds que produce buildBracket(seeds) directamente", async () => {
    const league = await createLeague({ playoffSize: 6 });
    const players = await Promise.all(
      ["A", "B", "C", "D", "E", "F"].map((n) => createPlayer(league.id, n))
    );
    // Two rounds this time, both closed — the guard doesn't care how many,
    // only that none is open.
    const round1 = await createRound(league.id, 1, PAST, PAST);
    const round2 = await createRound(
      league.id,
      2,
      new Date(PAST.getTime() + 1000),
      new Date(PAST.getTime() + 1000)
    );
    const half = Math.ceil(players.length / 2);
    const groupA = players.slice(0, half);
    const groupB = players.slice(half);
    const standingsMatches = [
      ...(await createStrictRoundRobin(league.id, round1.id, groupA)),
      ...(await createStrictRoundRobin(league.id, round2.id, groupB)),
      // Cross-group matches so every player still has n-1 games with a
      // strictly descending win count overall (players[i] beats players[j]
      // for every i < j, split arbitrarily between the two closed rounds).
      ...(await (async () => {
        const cross: StandingsMatch[] = [];
        for (let i = 0; i < groupA.length; i++) {
          for (let j = 0; j < groupB.length; j++) {
            cross.push(
              await createPlayedMatch(
                league.id,
                round1.id,
                groupA[i].id,
                groupB[j].id
              )
            );
          }
        }
        return cross;
      })()),
    ];

    const attempt = await startPlayoffs(league.id);
    expect(attempt.ok).toBe(true);
    if (!attempt.ok) return;

    const standings = computeStandings(
      standingsMatches,
      {
        pointsWin: league.pointsWin,
        pointsDraw: league.pointsDraw,
        pointsLoss: league.pointsLoss,
        tiebreakers: league.tiebreakers,
        playoffSize: league.playoffSize,
      },
      players.map((p) => p.id)
    );
    const seeds = seedsFromStandings(standings, league.playoffSize);
    const spec = buildBracket(seeds);

    expect(seeds.map((s) => s.playerId)).toEqual(players.map((p) => p.id));

    const bracket = await prisma.bracket.findUnique({
      where: { leagueId: league.id },
    });
    expect(bracket!.size).toBe(8);

    const dbSlots = await prisma.bracketSlot.findMany({
      where: { bracketId: bracket!.id },
      orderBy: [{ roundIndex: "asc" }, { position: "asc" }],
    });

    const dbByeSlots = dbSlots.filter((s, i) => spec.slots[i].isBye);
    expect(dbByeSlots).toHaveLength(2);
    // Byes go to the two top seeds — same as buildBracket(seeds) alone.
    expect(dbByeSlots.map((s) => s.playerId).sort()).toEqual(
      [players[0].id, players[1].id].sort()
    );

    for (let i = 0; i < spec.slots.length; i++) {
      expect(dbSlots[i].playerId).toBe(spec.slots[i].playerId);
      expect(dbSlots[i].roundIndex).toBe(spec.slots[i].roundIndex);
      expect(dbSlots[i].position).toBe(spec.slots[i].position);
    }
  });
});

// ---------------------------------------------------------------------------
// Endurecimiento (H9 encargo, plan/rondas-con-fecha/PLAN.md, patrón de H5b):
// la relectura autoritativa con `tx` dentro de la transacción es la que
// decide — sin ella, una ronda que aparece/reabre en la ventana entre la
// comprobación previa y la transacción se colaría y el bracket se
// construiría igualmente.
// ---------------------------------------------------------------------------

describe("Endurecimiento: la relectura de rondas dentro de la transacción bloquea una ronda que se cuela en la ventana", () => {
  it("una ronda nueva creada justo cuando se abre la transacción hace fallar startPlayoffs, sin bracket ni transición de estado", async () => {
    const league = await createLeague({ playoffSize: 2 });
    await createPlayer(league.id, "A");
    await createPlayer(league.id, "B");
    // Fast-path check sees a fully closed league — passes normally.
    await createRound(league.id, 1, PAST, PAST);

    const spy = raceIntoNextTransaction(async () => {
      // Simulates a concurrent trigger (an alta mid-liga via
      // `redistributePending`, or a round that was never actually closed)
      // appending a fresh OPEN round in the exact window between the
      // fast-path check above and this transaction opening.
      await prisma.round.create({
        data: { leagueId: league.id, index: 2, deadline: FUTURE },
      });
    });

    const attempt = await startPlayoffs(league.id);

    spy.mockRestore();

    expect(attempt.ok).toBe(false);
    if (attempt.ok) return;
    expect(attempt.error).toContain("ronda 2");

    // Atomic abort: no bracket, no phase transition — the transaction never
    // committed anything past its first check.
    const bracket = await prisma.bracket.findUnique({
      where: { leagueId: league.id },
    });
    expect(bracket).toBeNull();
    const leagueAfter = await prisma.league.findUnique({
      where: { id: league.id },
    });
    expect(leagueAfter?.status).toBe("LEAGUE");
  });

  it("un fallo real de DB dentro de la transacción no se reporta como «faltan rondas por cerrar»", async () => {
    const league = await createLeague({ playoffSize: 2 });
    await createPlayer(league.id, "A");
    await createPlayer(league.id, "B");
    await createRound(league.id, 1, PAST, PAST); // fully closed

    const spy = vi
      .spyOn(prisma, "$transaction")
      .mockImplementationOnce(async () => {
        throw new Error("simulated generic DB failure");
      });

    await expect(startPlayoffs(league.id)).rejects.toThrow(
      "simulated generic DB failure"
    );

    spy.mockRestore();

    // Untouched: the failed transaction rolled back / never committed.
    const bracket = await prisma.bracket.findUnique({
      where: { leagueId: league.id },
    });
    expect(bracket).toBeNull();
  });
});
