// Tests for t01 (`guardas-de-escritura`) of the "calendario-de-verdad"
// feature — plan/calendario-de-verdad/PLAN.md §t01, spec
// plan/specs/calendario-de-verdad.md §4.6, §4.7, §4.8, §4.9, §4.14, §5.5,
// §5.6, §5.9.
//
// Criteria covered (spec §8): 18, 19, 20, 21, 23, 24, 25, 26, 27, 28, 30, 31,
// 32, plus the server half of 29 and of 34 (the UI halves belong to t03/t02).
//
// Written against the real test database (file:./test.db) that
// vitest.config.ts injects and tests/db-global-setup.ts migrates: only
// next/cache and @/lib/guards are mocked, @/lib/db stays real — the same
// convention as tests/cierre-de-ronda.test.ts, tests/incomparecencia.test.ts
// and tests/endurecer-guardas-transaccionales.test.ts.
//
// Every league, round and match comes from the shared fixture
// `seedCalendarLeague` (tests/helpers/calendario.ts), which already seeds one
// match per state the spec names. Every date is built with `instantOnDay`
// (src/server/calendar.ts), never `new Date("…")`, so this file means the same
// thing under any `TZ` (spec §4.12).

import { describe, it, expect, vi, afterEach } from "vitest";

// A mutable session the mocked guards read from, same convention as
// tests/endurecer-guardas-transaccionales.test.ts.
const mockSession = vi.hoisted(() => ({
  role: "PLAYER" as "ADMIN" | "PLAYER",
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

import { prisma } from "@/lib/db";
import { setMatchSchedule } from "@/server/match-actions";
import { reportResult, declareWalkover } from "@/server/result-actions";
import { closeRound } from "@/server/round-actions";
import { instantOnDay } from "@/server/calendar";
import {
  seedCalendarLeague,
  FIXTURE_SCHEDULED_AT,
  type SeededCalendar,
} from "./helpers/calendario";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** An ISO instant for "that day at that hour, Spanish time" (§4.12). */
function iso(dayKey: string, time = "20:00"): string {
  return instantOnDay(dayKey, time).toISOString();
}

function asPlayer(playerId: string): void {
  mockSession.role = "PLAYER";
  mockSession.playerId = playerId;
}

function asAdmin(adminPlayerId: string): void {
  mockSession.role = "ADMIN";
  mockSession.playerId = adminPlayerId;
}

function scheduledAtOf(matchId: string): Promise<Date | null> {
  return prisma.match
    .findUniqueOrThrow({
      where: { id: matchId },
      select: { scheduledAt: true },
    })
    .then((m) => m.scheduledAt);
}

/** Give a match a Result with this resolution (states the fixture doesn't seed). */
async function giveResult(
  seed: SeededCalendar,
  matchId: string,
  resolution: "PLAYED" | "WALKOVER" | "UNPLAYED_DRAW"
): Promise<void> {
  await prisma.result.create({
    data: {
      matchId,
      homeVictoryPoints: resolution === "PLAYED" ? 62 : 0,
      awayVictoryPoints: resolution === "PLAYED" ? 45 : 0,
      outcome: resolution === "PLAYED" ? "HOME_WIN" : "DRAW",
      resolution,
      reportedById: seed.players.admin,
    },
  });
  await prisma.match.update({
    where: { id: matchId },
    data: { status: "REPORTED" },
  });
}

/**
 * Pin the wall clock without faking timers: only `Date` is replaced, so
 * Prisma's own timeouts keep using the real event loop. Used by the few
 * criteria whose wording is about *when* the date falls ("una fecha pasada",
 * "una fecha futura") and by `closeRound`, which refuses to close a round
 * whose deadline hasn't arrived.
 */
function pinNow(dayKey: string, time = "12:00"): void {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(instantOnDay(dayKey, time));
}

afterEach(() => {
  vi.useRealTimers();
});

/**
 * Spy on prisma.$transaction so the very next call runs `injected` first
 * (simulating a concurrent write landing in the TOCTOU window) and then
 * delegates to the real transaction. Copied verbatim from
 * tests/endurecer-guardas-transaccionales.test.ts, where the technique was
 * validated for the reportResult/declareWalkover races.
 */
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
// AC-18 — el techo de la ronda, para un participante (§4.6, §5.5)
// ---------------------------------------------------------------------------

describe("AC-18: setMatchSchedule rechaza al participante una fecha posterior a la deadline de su ronda, con un mensaje que nombra la ronda y su cierre", () => {
  it("rechaza el 1 de diciembre en una partida de la ronda 2 (cierra el 30 de noviembre) y no escribe la fecha", async () => {
    const seed = await seedCalendarLeague();
    asPlayer(seed.players.alice);

    const result = await setMatchSchedule(seed.matches.openNoDate, {
      scheduledAt: iso("2026-12-01"),
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("ronda 2");
    expect(result.error).toContain("30 de noviembre");
    expect(await scheduledAtOf(seed.matches.openNoDate)).toBeNull();
  });

  it("acepta el propio día del cierre a las 20:00 hora española (§9.5: el techo es el final de ese día, no el instante guardado)", async () => {
    const seed = await seedCalendarLeague();
    asPlayer(seed.players.alice);

    const result = await setMatchSchedule(seed.matches.openNoDate, {
      scheduledAt: iso("2026-11-30", "20:00"),
    });

    expect(result.ok).toBe(true);
    expect(await scheduledAtOf(seed.matches.openNoDate)).toEqual(
      instantOnDay("2026-11-30", "20:00")
    );
  });
});

// ---------------------------------------------------------------------------
// AC-19 — la salida de admin en el techo (§4.6)
// ---------------------------------------------------------------------------

describe("AC-19: la misma llamada, hecha por un admin, se acepta", () => {
  it("el admin fecha en diciembre una partida de la ronda 2 y la fecha queda escrita", async () => {
    const seed = await seedCalendarLeague();
    asAdmin(seed.players.admin);

    const result = await setMatchSchedule(seed.matches.openNoDate, {
      scheduledAt: iso("2026-12-01"),
    });

    expect(result.ok).toBe(true);
    expect(await scheduledAtOf(seed.matches.openNoDate)).toEqual(
      instantOnDay("2026-12-01", "20:00")
    );
  });
});

// ---------------------------------------------------------------------------
// AC-20 — el suelo, sin salida de rol (§4.7, §5.5)
// ---------------------------------------------------------------------------

describe("AC-20: setMatchSchedule rechaza, para cualquier rol, una fecha anterior al día 1 del mes de League.startMonth", () => {
  it("rechaza al participante el 30 de septiembre (la liga arranca en octubre de 2026)", async () => {
    const seed = await seedCalendarLeague();
    asPlayer(seed.players.alice);

    const result = await setMatchSchedule(seed.matches.openNoDate, {
      scheduledAt: iso("2026-09-30"),
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("octubre de 2026");
    expect(await scheduledAtOf(seed.matches.openNoDate)).toBeNull();
  });

  it("rechaza también al admin: el suelo no tiene salida de rol", async () => {
    const seed = await seedCalendarLeague();
    asAdmin(seed.players.admin);

    const result = await setMatchSchedule(seed.matches.openNoDate, {
      scheduledAt: iso("2026-09-30"),
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("octubre de 2026");
    expect(await scheduledAtOf(seed.matches.openNoDate)).toBeNull();
  });

  it("acepta el primer instante del suelo: el 1 de octubre a las 00:00 hora española", async () => {
    const seed = await seedCalendarLeague();
    asPlayer(seed.players.alice);

    const result = await setMatchSchedule(seed.matches.openNoDate, {
      scheduledAt: iso("2026-10-01", "00:00"),
    });

    expect(result.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// AC-21 — una fecha pasada dentro del rango se acepta (§4.7, §4.10)
// ---------------------------------------------------------------------------

describe("AC-21: una fecha pasada dentro del rango se acepta para cualquier rol", () => {
  it("el participante que jugó la semana pasada sin haber agendado puede fechar la partida hacia atrás", async () => {
    const seed = await seedCalendarLeague();
    pinNow("2026-11-20");
    asPlayer(seed.players.alice);

    const past = instantOnDay("2026-11-05", "20:00");
    expect(past.getTime()).toBeLessThan(Date.now());

    const result = await setMatchSchedule(seed.matches.openNoDate, {
      scheduledAt: past.toISOString(),
    });

    expect(result.ok).toBe(true);
    expect(await scheduledAtOf(seed.matches.openNoDate)).toEqual(past);
  });

  it("el admin también", async () => {
    const seed = await seedCalendarLeague();
    pinNow("2026-11-20");
    asAdmin(seed.players.admin);

    const past = instantOnDay("2026-10-20", "20:00");
    expect(past.getTime()).toBeLessThan(Date.now());

    const result = await setMatchSchedule(seed.matches.openNoDate, {
      scheduledAt: past.toISOString(),
    });

    expect(result.ok).toBe(true);
    expect(await scheduledAtOf(seed.matches.openNoDate)).toEqual(past);
  });
});

// ---------------------------------------------------------------------------
// AC-23 — sin ronda no hay techo (§4.11, §5.2)
// ---------------------------------------------------------------------------

describe("AC-23: una partida de playoff (roundId = null) acepta cualquier fecha desde el suelo en adelante", () => {
  it("acepta una fecha muy posterior a la última ronda de la liga", async () => {
    const seed = await seedCalendarLeague();
    asPlayer(seed.players.alice);

    const result = await setMatchSchedule(seed.matches.playoff, {
      scheduledAt: iso("2028-05-01"),
    });

    expect(result.ok).toBe(true);
    expect(await scheduledAtOf(seed.matches.playoff)).toEqual(
      instantOnDay("2028-05-01", "20:00")
    );
  });

  it("el suelo sí le aplica: rechaza una fecha anterior al arranque de la liga", async () => {
    const seed = await seedCalendarLeague();
    asPlayer(seed.players.alice);

    const result = await setMatchSchedule(seed.matches.playoff, {
      scheduledAt: iso("2026-09-30"),
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("octubre de 2026");
  });

  it("una partida de liga sin ronda asignada (§5.2) tampoco tiene tope", async () => {
    const seed = await seedCalendarLeague();
    asPlayer(seed.players.bob);

    const result = await setMatchSchedule(seed.matches.noRound, {
      scheduledAt: iso("2027-03-01"),
    });

    expect(result.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// AC-24 — editar solo el lugar no revalida la fecha (§5.6)
// ---------------------------------------------------------------------------

describe("AC-24: cambiar solo el location de una partida cuya scheduledAt está fuera de rango no se rechaza", () => {
  it("acepta el cambio de lugar y deja intacta la fecha fuera de rango", async () => {
    const seed = await seedCalendarLeague();
    // Data that predates this spec, or a date the admin set through the §4.6
    // escape: a round-2 match dated in December, past its own deadline.
    const outOfRange = instantOnDay("2026-12-20", "20:00");
    await prisma.match.update({
      where: { id: seed.matches.openScheduled },
      data: { scheduledAt: outOfRange },
    });

    asPlayer(seed.players.bob);
    const result = await setMatchSchedule(seed.matches.openScheduled, {
      location: "Warlotus",
    });

    expect(result.ok).toBe(true);
    const match = await prisma.match.findUniqueOrThrow({
      where: { id: seed.matches.openScheduled },
    });
    expect(match.location).toBe("Warlotus");
    expect(match.scheduledAt).toEqual(outOfRange);
  });
});

// ---------------------------------------------------------------------------
// AC-25 — sin fecha no hay resultado (§4.8)
// ---------------------------------------------------------------------------

describe("AC-25: reportResult sobre una partida con scheduledAt = null se rechaza, también para el admin, y no crea Result ni escribe AuditLog", () => {
  it("rechaza al participante sin dejar rastro en Result ni en AuditLog", async () => {
    const seed = await seedCalendarLeague();
    asPlayer(seed.players.alice);

    const result = await reportResult(seed.matches.openNoDate, {
      homeVictoryPoints: 80,
      awayVictoryPoints: 20,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/fecha/i);

    // The rejection is verified by counting rows, not by the `ok` flag: a
    // guard that returns false *after* writing would pass the check above.
    expect(
      await prisma.result.count({
        where: { matchId: seed.matches.openNoDate },
      })
    ).toBe(0);
    expect(
      await prisma.auditLog.count({
        where: { entityType: "Match", entityId: seed.matches.openNoDate },
      })
    ).toBe(0);
    // And the match never left SCHEDULED.
    const match = await prisma.match.findUniqueOrThrow({
      where: { id: seed.matches.openNoDate },
    });
    expect(match.status).toBe("SCHEDULED");
  });

  it("rechaza también al admin, sin Result ni AuditLog", async () => {
    const seed = await seedCalendarLeague();
    asAdmin(seed.players.admin);

    const result = await reportResult(seed.matches.openNoDate, {
      homeVictoryPoints: 80,
      awayVictoryPoints: 20,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/fecha/i);
    expect(
      await prisma.result.count({
        where: { matchId: seed.matches.openNoDate },
      })
    ).toBe(0);
    expect(
      await prisma.auditLog.count({
        where: { entityType: "Match", entityId: seed.matches.openNoDate },
      })
    ).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// AC-26 — la incomparecencia queda exenta (§4.8)
// ---------------------------------------------------------------------------

describe("AC-26: declareWalkover sobre una partida sin fecha sigue funcionando y crea el Result con resolution = WALKOVER", () => {
  it("el participante declara la incomparecencia en una partida sin fecha", async () => {
    const seed = await seedCalendarLeague();
    asPlayer(seed.players.alice);

    const result = await declareWalkover(seed.matches.openNoDate, {
      winnerId: seed.players.carol,
    });

    expect(result.ok).toBe(true);
    const stored = await prisma.result.findUniqueOrThrow({
      where: { matchId: seed.matches.openNoDate },
    });
    expect(stored).toMatchObject({
      resolution: "WALKOVER",
      homeVictoryPoints: 0,
      awayVictoryPoints: 80,
      outcome: "AWAY_WIN",
    });
    expect(await scheduledAtOf(seed.matches.openNoDate)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// AC-27 — el cierre de ronda queda exento (§4.8)
// ---------------------------------------------------------------------------

describe("AC-27: closeRound sigue saldando a UNPLAYED_DRAW las partidas sin fecha de la ronda que cierra", () => {
  it("cierra la ronda 2 y salda la partida sin fecha ni resultado", async () => {
    const seed = await seedCalendarLeague();
    // The fixture's rounds close in the future; pin the clock past round 2's
    // deadline (30 Nov 2026) so `closeRound` accepts it.
    pinNow("2026-12-05");
    asAdmin(seed.players.admin);

    const result = await closeRound(seed.rounds.r2);

    expect(result.ok).toBe(true);
    const settled = await prisma.result.findUniqueOrThrow({
      where: { matchId: seed.matches.openNoDate },
    });
    expect(settled).toMatchObject({
      resolution: "UNPLAYED_DRAW",
      homeVictoryPoints: 0,
      awayVictoryPoints: 0,
    });
    expect(await scheduledAtOf(seed.matches.openNoDate)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// AC-28 — no hay guarda de fecha futura (§4.10)
// ---------------------------------------------------------------------------

describe("AC-28: reportResult sobre una partida cuya scheduledAt es futura se acepta", () => {
  it("apunta el resultado de una partida fechada dentro de dos semanas", async () => {
    const seed = await seedCalendarLeague();
    pinNow("2026-11-01");
    expect(FIXTURE_SCHEDULED_AT.getTime()).toBeGreaterThan(Date.now());

    asPlayer(seed.players.bob);
    const result = await reportResult(seed.matches.openScheduled, {
      homeVictoryPoints: 50,
      awayVictoryPoints: 40,
    });

    expect(result.ok).toBe(true);
    const stored = await prisma.result.findUniqueOrThrow({
      where: { matchId: seed.matches.openScheduled },
    });
    expect(stored).toMatchObject({
      resolution: "PLAYED",
      homeVictoryPoints: 50,
      awayVictoryPoints: 40,
      outcome: "HOME_WIN",
    });
  });
});

// ---------------------------------------------------------------------------
// AC-29 (mitad de servidor) — la fecha de una partida jugada no se borra (§4.9)
// ---------------------------------------------------------------------------

describe("AC-29 (servidor): setMatchSchedule con scheduledAt: null sobre una partida con resolution = PLAYED se rechaza para cualquier rol", () => {
  it("rechaza al participante y deja la fecha donde estaba", async () => {
    const seed = await seedCalendarLeague();
    await giveResult(seed, seed.matches.openScheduled, "PLAYED");
    asPlayer(seed.players.carol);

    const result = await setMatchSchedule(seed.matches.openScheduled, {
      scheduledAt: null,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/resultado/i);
    expect(await scheduledAtOf(seed.matches.openScheduled)).toEqual(
      FIXTURE_SCHEDULED_AT
    );
  });

  it("rechaza también al admin: §4.9 no tiene salida de rol", async () => {
    const seed = await seedCalendarLeague();
    await giveResult(seed, seed.matches.openScheduled, "PLAYED");
    asAdmin(seed.players.admin);

    const result = await setMatchSchedule(seed.matches.openScheduled, {
      scheduledAt: null,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/resultado/i);
    expect(await scheduledAtOf(seed.matches.openScheduled)).toEqual(
      FIXTURE_SCHEDULED_AT
    );
  });
});

// ---------------------------------------------------------------------------
// AC-30 — limpiar la fecha sigue permitido en el resto de casos (§4.9)
// ---------------------------------------------------------------------------

describe("AC-30: setMatchSchedule con scheduledAt: null sobre una partida sin Result, o con WALKOVER o UNPLAYED_DRAW, se acepta", () => {
  it("sin Result: la fecha se borra", async () => {
    const seed = await seedCalendarLeague();
    asPlayer(seed.players.carol);

    const result = await setMatchSchedule(seed.matches.openScheduled, {
      scheduledAt: null,
    });

    expect(result.ok).toBe(true);
    expect(await scheduledAtOf(seed.matches.openScheduled)).toBeNull();
  });

  it("con WALKOVER: la fecha se borra", async () => {
    const seed = await seedCalendarLeague();
    await prisma.match.update({
      where: { id: seed.matches.walkoverNoDate },
      data: { scheduledAt: instantOnDay("2026-11-10", "20:00") },
    });
    asPlayer(seed.players.alice);

    const result = await setMatchSchedule(seed.matches.walkoverNoDate, {
      scheduledAt: null,
    });

    expect(result.ok).toBe(true);
    expect(await scheduledAtOf(seed.matches.walkoverNoDate)).toBeNull();
  });

  it("con UNPLAYED_DRAW: la fecha se borra", async () => {
    const seed = await seedCalendarLeague();
    await giveResult(seed, seed.matches.onDeadlineDay, "UNPLAYED_DRAW");
    asPlayer(seed.players.alice);

    const result = await setMatchSchedule(seed.matches.onDeadlineDay, {
      scheduledAt: null,
    });

    expect(result.ok).toBe(true);
    expect(await scheduledAtOf(seed.matches.onDeadlineDay)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// AC-31 — cambiarla (no borrarla) sí (§4.9)
// ---------------------------------------------------------------------------

describe("AC-31: cambiar la fecha (no borrarla) de una partida con resolution = PLAYED se acepta, dentro del rango", () => {
  it('"jugamos el 20, no el 14": el participante corrige la fecha de una partida ya apuntada', async () => {
    const seed = await seedCalendarLeague();
    await giveResult(seed, seed.matches.openScheduled, "PLAYED");
    asPlayer(seed.players.carol);

    const result = await setMatchSchedule(seed.matches.openScheduled, {
      scheduledAt: iso("2026-11-20"),
    });

    expect(result.ok).toBe(true);
    expect(await scheduledAtOf(seed.matches.openScheduled)).toEqual(
      instantOnDay("2026-11-20", "20:00")
    );
  });

  it("pero sigue sujeta al rango: fuera del techo se rechaza", async () => {
    const seed = await seedCalendarLeague();
    await giveResult(seed, seed.matches.openScheduled, "PLAYED");
    asPlayer(seed.players.carol);

    const result = await setMatchSchedule(seed.matches.openScheduled, {
      scheduledAt: iso("2026-12-20"),
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("ronda 2");
    expect(await scheduledAtOf(seed.matches.openScheduled)).toEqual(
      FIXTURE_SCHEDULED_AT
    );
  });
});

// ---------------------------------------------------------------------------
// AC-32 — ronda cerrada: la fecha se congela para el jugador (§4.14)
// ---------------------------------------------------------------------------

describe("AC-32: un participante no puede poner ni cambiar la fecha de una partida cuya ronda tiene closedAt; el admin sí", () => {
  it("el participante no puede PONER fecha en una partida de ronda cerrada", async () => {
    const seed = await seedCalendarLeague();
    asPlayer(seed.players.carol);

    const result = await setMatchSchedule(seed.matches.settledInClosedRound, {
      scheduledAt: iso("2026-10-20"),
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/cerrada/i);
    expect(await scheduledAtOf(seed.matches.settledInClosedRound)).toBeNull();
  });

  it("el participante tampoco puede CAMBIARLA", async () => {
    const seed = await seedCalendarLeague();
    const before = await scheduledAtOf(seed.matches.playedInClosedRound);
    asPlayer(seed.players.alice);

    const result = await setMatchSchedule(seed.matches.playedInClosedRound, {
      scheduledAt: iso("2026-10-20"),
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/cerrada/i);
    expect(await scheduledAtOf(seed.matches.playedInClosedRound)).toEqual(
      before
    );
  });

  it("el admin sí puede", async () => {
    const seed = await seedCalendarLeague();
    asAdmin(seed.players.admin);

    const result = await setMatchSchedule(seed.matches.settledInClosedRound, {
      scheduledAt: iso("2026-10-20"),
    });

    expect(result.ok).toBe(true);
    expect(await scheduledAtOf(seed.matches.settledInClosedRound)).toEqual(
      instantOnDay("2026-10-20", "20:00")
    );
  });

  it("TOCTOU: un cierre de ronda que aterriza entre la comprobación y el update bloquea la escritura pendiente", async () => {
    const seed = await seedCalendarLeague();
    // Past round 2's deadline (30 Nov 2026) so the admin's `closeRound` is
    // allowed, while 20 Nov is still inside the round's valid range — the
    // fast-path check of the pending write therefore passes on its own.
    pinNow("2026-12-05");

    const spy = raceIntoNextTransaction(async () => {
      asAdmin(seed.players.admin);
      const closed = await closeRound(seed.rounds.r2);
      expect(closed.ok).toBe(true);
      asPlayer(seed.players.carol);
    });

    asPlayer(seed.players.carol);
    const attempt = await setMatchSchedule(seed.matches.openScheduled, {
      scheduledAt: iso("2026-11-20"),
    });

    spy.mockRestore();

    expect(attempt.ok).toBe(false);
    if (attempt.ok) return;
    expect(attempt.error).toMatch(/cerrada/i);

    // Coherent end state: the round is closed and the pending write never
    // landed — the match keeps the date the fixture gave it.
    const round = await prisma.round.findUniqueOrThrow({
      where: { id: seed.rounds.r2 },
    });
    expect(round.closedAt).not.toBeNull();
    expect(await scheduledAtOf(seed.matches.openScheduled)).toEqual(
      FIXTURE_SCHEDULED_AT
    );
  });
});

// ---------------------------------------------------------------------------
// AC-34 (mitad de servidor) — los PLAYED sin fecha anteriores a la spec (§5.9)
// ---------------------------------------------------------------------------

describe("AC-34 (servidor): un Result PLAYED con scheduledAt = null anterior a esta spec no se migra, y editarlo obliga a fechar la partida primero", () => {
  it("el resultado legacy sobrevive intacto al rechazo, y tras fechar la partida se puede editar", async () => {
    const seed = await seedCalendarLeague();
    const matchId = seed.matches.legacyPlayedNoDate;
    asPlayer(seed.players.carol);

    // 1. Editing it is refused while it has no date.
    const refused = await reportResult(matchId, {
      homeVictoryPoints: 60,
      awayVictoryPoints: 50,
    });
    expect(refused.ok).toBe(false);
    if (refused.ok) return;
    expect(refused.error).toMatch(/fecha/i);

    // The legacy Result is untouched — it is not migrated, and it keeps
    // counting exactly as it did (§5.9).
    const untouched = await prisma.result.findUniqueOrThrow({
      where: { matchId },
    });
    expect(untouched).toMatchObject({
      resolution: "PLAYED",
      homeVictoryPoints: 55,
      awayVictoryPoints: 70,
    });

    // 2. Dating the match is the way out, and it is allowed even though the
    //    match already has a PLAYED result (§4.9: changing is fine).
    const dated = await setMatchSchedule(matchId, {
      scheduledAt: iso("2026-11-10"),
    });
    expect(dated.ok).toBe(true);

    // 3. Now the edit goes through.
    const accepted = await reportResult(matchId, {
      homeVictoryPoints: 60,
      awayVictoryPoints: 50,
    });
    expect(accepted.ok).toBe(true);

    const after = await prisma.result.findUniqueOrThrow({ where: { matchId } });
    expect(after).toMatchObject({
      resolution: "PLAYED",
      homeVictoryPoints: 60,
      awayVictoryPoints: 50,
      outcome: "HOME_WIN",
    });
    expect(await scheduledAtOf(matchId)).toEqual(
      instantOnDay("2026-11-10", "20:00")
    );
  });
});
