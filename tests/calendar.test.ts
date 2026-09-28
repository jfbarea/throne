// Tests for track T0 (`contratos-y-fechas`) of the feature
// "calendario-de-verdad" — plan/calendario-de-verdad/TRACKS.md.
// Spec: plan/specs/calendario-de-verdad.md §4.1, §4.5, §4.6, §4.7, §4.8, §4.9,
// §4.12, §4.14, §5.10 and — the one that matters most — §9.5.
//
// Every `describe` is named after the acceptance criterion of the track (or of
// the spec, at unit level) that it closes, so the criterion is greppable from
// the test output.
//
// **None of these tests may depend on the machine's timezone.** They are run
// with `TZ=UTC`, `TZ=Europe/Madrid` and `TZ=America/New_York` before the track
// is closed. That is why no assertion ever goes through `toLocaleString`,
// `getHours()` or a bare `new Date("2026-10-17T20:00")` (which reads the local
// zone): instants are built with `Date.UTC(...)` or with `instantOnDay`, and
// compared as ISO-8601 (always UTC).

import { describe, it, expect } from "vitest";

import {
  LEAGUE_TZ,
  addMonths,
  compareMonthKeys,
  dayKeyOf,
  dayLabel,
  daysInMonth,
  endOfDay,
  entryMonth,
  formatMonthKey,
  groupByDay,
  instantOnDay,
  monthBounds,
  monthGridDays,
  monthKeyEquals,
  monthKeyOf,
  monthLabel,
  monthOfRound,
  navigableMonths,
  parseMonthKey,
  scheduleBounds,
  startOfDay,
  timeLabel,
  type MonthKey,
  type RoundRef,
} from "@/server/calendar";

import {
  canReportGivenSchedule,
  canScheduleAt,
  eligibleForDay,
  type EligibilityInput,
  type ScheduleContext,
} from "@/server/result-logic";

import {
  FIXTURE_DEADLINES,
  FIXTURE_ON_DEADLINE_DAY_AT,
  FIXTURE_START_MONTH,
  seedCalendarLeague,
} from "./helpers/calendario";

// ---------------------------------------------------------------------------
// Shared values. October 2026 league, three monthly rounds.
// ---------------------------------------------------------------------------

const START_MONTH = FIXTURE_START_MONTH; // 2026-10-01T00:00:00Z
const R1_DEADLINE = FIXTURE_DEADLINES.r1; // 2026-10-31T00:00:00Z
const R2_DEADLINE = FIXTURE_DEADLINES.r2; // 2026-11-30T00:00:00Z
const R3_DEADLINE = FIXTURE_DEADLINES.r3; // 2026-12-31T00:00:00Z

const ROUNDS: RoundRef[] = [
  { index: 1, deadline: R1_DEADLINE, closedAt: new Date(Date.UTC(2026, 10, 1)) },
  { index: 2, deadline: R2_DEADLINE, closedAt: null },
  { index: 3, deadline: R3_DEADLINE, closedAt: null },
];

function iso(d: Date): string {
  return d.toISOString();
}

// ---------------------------------------------------------------------------
// T0-AC1 — el día de un instante se decide en Europe/Madrid (spec §4.12,
// criterio 3 a nivel unitario)
// ---------------------------------------------------------------------------

describe("T0-AC1: dayKeyOf sitúa cada instante en su día de Europe/Madrid", () => {
  it("el 1 de noviembre a las 00:30 hora española es el 1 de noviembre, no el 31 de octubre", () => {
    // 2026-11-01 00:30 CET = 2026-10-31 23:30 UTC. Leído en UTC sería octubre:
    // otro día de la rejilla y, peor, otra ronda.
    const instant = new Date(Date.UTC(2026, 9, 31, 23, 30));

    expect(dayKeyOf(instant)).toBe("2026-11-01");
    expect(monthKeyOf(instant)).toEqual({ year: 2026, month: 11 });
  });

  it("el 31 de octubre a las 23:30 hora española sigue siendo el 31 de octubre", () => {
    const instant = new Date(Date.UTC(2026, 9, 31, 22, 30));

    expect(dayKeyOf(instant)).toBe("2026-10-31");
    expect(monthKeyOf(instant)).toEqual({ year: 2026, month: 10 });
  });

  it("en verano (CEST, UTC+2) el corte de día también es el español", () => {
    // 2026-07-01 01:00 CEST = 2026-06-30 23:00 UTC.
    expect(dayKeyOf(new Date(Date.UTC(2026, 5, 30, 23, 0)))).toBe("2026-07-01");
    // 2026-06-30 23:00 CEST = 2026-06-30 21:00 UTC.
    expect(dayKeyOf(new Date(Date.UTC(2026, 5, 30, 21, 0)))).toBe("2026-06-30");
  });

  it("la zona es fija y declarada, no la de la máquina", () => {
    expect(LEAGUE_TZ).toBe("Europe/Madrid");
  });

  it("timeLabel da la hora española, no la del proceso", () => {
    // 19:00 UTC = 20:00 CET en invierno, 21:00 CEST en verano.
    expect(timeLabel(new Date(Date.UTC(2026, 11, 31, 19, 0)))).toBe("20:00");
    expect(timeLabel(new Date(Date.UTC(2026, 6, 4, 19, 0)))).toBe("21:00");
  });
});

// ---------------------------------------------------------------------------
// T0-AC2 — §9.5: el día del cierre cae DENTRO de su propia ronda
// ---------------------------------------------------------------------------

describe("T0-AC2: scheduleBounds acepta una partida el mismo día del cierre a las 20:00 (spec §9.5)", () => {
  it("el techo es el final del día de la deadline en Europe/Madrid, no el instante guardado", () => {
    const { max } = scheduleBounds(START_MONTH, R1_DEADLINE);

    // deriveDeadlines guarda "31 de octubre 00:00 UTC". El techo tiene que ser
    // el 31 de octubre a las 23:59:59.999 hora española = 22:59:59.999 UTC.
    expect(iso(max!)).toBe("2026-10-31T22:59:59.999Z");
    // Y, explícitamente: el techo es posterior al instante guardado.
    expect(max!.getTime()).toBeGreaterThan(R1_DEADLINE.getTime());
  });

  it("una partida jugada el día del cierre a las 20:00 hora española se acepta", () => {
    const onDeadlineDay = instantOnDay("2026-10-31", "20:00");
    const { max } = scheduleBounds(START_MONTH, R1_DEADLINE);

    expect(onDeadlineDay.getTime()).toBeLessThanOrEqual(max!.getTime());

    // Y por el predicado completo, que es lo que llamará setMatchSchedule.
    const decision = canScheduleAt(
      onDeadlineDay,
      {
        roundDeadline: R1_DEADLINE,
        roundClosedAt: null,
        leagueStartMonth: START_MONTH,
        hasPlayedResult: false,
      },
      false
    );
    expect(decision).toEqual({ ok: true });
  });

  it("devolver la deadline tal cual habría rechazado esa misma partida", () => {
    // La regresión que §9.5 anticipa, escrita como test para que quede fijada:
    // comparar contra el instante guardado rechaza las 20:00 del día del cierre.
    const onDeadlineDay = instantOnDay("2026-10-31", "20:00");
    expect(onDeadlineDay.getTime()).toBeGreaterThan(R1_DEADLINE.getTime());
  });

  it("lo mismo con la última ronda, en diciembre (la fixture compartida)", () => {
    const { max } = scheduleBounds(START_MONTH, R3_DEADLINE);
    expect(FIXTURE_ON_DEADLINE_DAY_AT.getTime()).toBeLessThanOrEqual(
      max!.getTime()
    );
  });

  it("el día siguiente al cierre ya queda fuera", () => {
    const { max } = scheduleBounds(START_MONTH, R1_DEADLINE);
    const nextDay = instantOnDay("2026-11-01", "00:00");
    expect(nextDay.getTime()).toBeGreaterThan(max!.getTime());
  });

  it("el suelo es el día 1 del mes de arranque a las 00:00 hora española", () => {
    const { min } = scheduleBounds(START_MONTH, R1_DEADLINE);
    // 2026-10-01 00:00 CEST = 2026-09-30 22:00 UTC.
    expect(iso(min!)).toBe("2026-09-30T22:00:00.000Z");
  });

  it("sin startMonth no hay suelo, y sin deadline no hay techo (§4.11, §5.1, §5.2)", () => {
    expect(scheduleBounds(null, R1_DEADLINE).min).toBeNull();
    expect(scheduleBounds(START_MONTH, null).max).toBeNull();
    expect(scheduleBounds(null, null)).toEqual({ min: null, max: null });
  });
});

// ---------------------------------------------------------------------------
// T0-AC3 — meses de 28/29/30/31 días y los dos cambios de hora (spec §5.10)
// ---------------------------------------------------------------------------

describe("T0-AC3: monthOfRound y monthGridDays aciertan en 28/29/30/31 días y en los dos cambios de hora", () => {
  it("monthOfRound cuenta desde startMonth, con salto de año", () => {
    expect(monthOfRound(START_MONTH, 1)).toEqual({ year: 2026, month: 10 });
    expect(monthOfRound(START_MONTH, 3)).toEqual({ year: 2026, month: 12 });
    expect(monthOfRound(START_MONTH, 4)).toEqual({ year: 2027, month: 1 });
    expect(monthOfRound(START_MONTH, 16)).toEqual({ year: 2028, month: 1 });
  });

  it("monthOfRound lee el startMonth en Europe/Madrid, no en la zona del proceso", () => {
    // Guardado como el día 1 a medianoche UTC (src/lib/schemas.ts).
    expect(monthOfRound(new Date(Date.UTC(2026, 2, 1)), 1)).toEqual({
      year: 2026,
      month: 3,
    });
  });

  it("daysInMonth: 28, 29, 30 y 31", () => {
    expect(daysInMonth({ year: 2026, month: 2 })).toBe(28);
    expect(daysInMonth({ year: 2028, month: 2 })).toBe(29); // bisiesto
    expect(daysInMonth({ year: 2026, month: 4 })).toBe(30);
    expect(daysInMonth({ year: 2026, month: 10 })).toBe(31);
  });

  it("la rejilla de octubre 2026 empieza en lunes 28 de septiembre y son 5 semanas", () => {
    const cells = monthGridDays({ year: 2026, month: 10 });

    expect(cells).toHaveLength(35);
    expect(cells[0]).toEqual({
      dayKey: "2026-09-28",
      day: 28,
      month: { year: 2026, month: 9 },
      inMonth: false,
      weekday: 1,
    });
    expect(cells[3].dayKey).toBe("2026-10-01");
    expect(cells[3].inMonth).toBe(true);
    expect(cells[33].dayKey).toBe("2026-10-31");
    expect(cells[33].inMonth).toBe(true);
    expect(cells[34]).toEqual({
      dayKey: "2026-11-01",
      day: 1,
      month: { year: 2026, month: 11 },
      inMonth: false,
      weekday: 7,
    });
  });

  for (const m of [
    { year: 2026, month: 2 }, // 28 días, empieza en domingo
    { year: 2028, month: 2 }, // 29 días
    { year: 2026, month: 4 }, // 30 días
    { year: 2026, month: 10 }, // 31 días
    { year: 2026, month: 3 }, // el mes del cambio de hora de primavera
    { year: 2027, month: 1 }, // salto de año por arriba
    { year: 2026, month: 12 }, // salto de año por abajo
  ] as MonthKey[]) {
    it(`la rejilla de ${formatMonthKey(m)} son semanas completas de lunes a domingo`, () => {
      const cells = monthGridDays(m);

      expect(cells.length % 7).toBe(0);
      expect(cells[0].weekday).toBe(1);
      expect(cells[cells.length - 1].weekday).toBe(7);
      expect(cells.map((c) => c.weekday)).toEqual(
        cells.map((_, i) => (i % 7) + 1)
      );

      const own = cells.filter((c) => c.inMonth);
      expect(own).toHaveLength(daysInMonth(m));
      expect(own[0].dayKey).toBe(`${formatMonthKey(m)}-01`);
      expect(own[0].day).toBe(1);
      expect(own[own.length - 1].day).toBe(daysInMonth(m));
      expect(own.every((c) => monthKeyEquals(c.month, m))).toBe(true);
      expect(
        cells.filter((c) => !c.inMonth).every((c) => !monthKeyEquals(c.month, m))
      ).toBe(true);
    });
  }

  it("cambio de hora de primavera (29 de marzo de 2026): el día dura 23 horas y nada se sale de él", () => {
    // A las 02:00 CET se salta a las 03:00 CEST.
    expect(iso(startOfDay("2026-03-29"))).toBe("2026-03-28T23:00:00.000Z");
    expect(iso(endOfDay("2026-03-29"))).toBe("2026-03-29T21:59:59.999Z");

    // 01:30 hora española (todavía CET) e 03:30 (ya CEST) caen en el mismo día.
    expect(iso(instantOnDay("2026-03-29", "01:30"))).toBe(
      "2026-03-29T00:30:00.000Z"
    );
    expect(iso(instantOnDay("2026-03-29", "03:30"))).toBe(
      "2026-03-29T01:30:00.000Z"
    );
    expect(dayKeyOf(new Date(Date.UTC(2026, 2, 29, 0, 30)))).toBe("2026-03-29");
    expect(dayKeyOf(new Date(Date.UTC(2026, 2, 29, 1, 30)))).toBe("2026-03-29");
  });

  it("cambio de hora de otoño (25 de octubre de 2026): el día dura 25 horas", () => {
    // A las 03:00 CEST se vuelve a las 02:00 CET.
    expect(iso(startOfDay("2026-10-25"))).toBe("2026-10-24T22:00:00.000Z");
    expect(iso(endOfDay("2026-10-25"))).toBe("2026-10-25T22:59:59.999Z");

    // Las dos 02:30 del día (CEST y CET) siguen siendo el 25 de octubre.
    expect(dayKeyOf(new Date(Date.UTC(2026, 9, 25, 0, 30)))).toBe("2026-10-25");
    expect(dayKeyOf(new Date(Date.UTC(2026, 9, 25, 1, 30)))).toBe("2026-10-25");
  });

  it("monthBounds cubre el mes entero en hora española", () => {
    const { start, end } = monthBounds({ year: 2026, month: 10 });
    expect(iso(start)).toBe("2026-09-30T22:00:00.000Z");
    expect(iso(end)).toBe("2026-10-31T22:59:59.999Z");

    const feb = monthBounds({ year: 2028, month: 2 });
    expect(dayKeyOf(feb.end)).toBe("2028-02-29");
  });
});

// ---------------------------------------------------------------------------
// T0-AC4 — canScheduleAt: los cuatro rechazos y las dos ramas de rol
// ---------------------------------------------------------------------------

const OPEN_R2: ScheduleContext = {
  roundDeadline: R2_DEADLINE,
  roundClosedAt: null,
  leagueStartMonth: START_MONTH,
  hasPlayedResult: false,
};

describe("T0-AC4: canScheduleAt devuelve el reason correcto en los cuatro rechazos (criterios 18-21, 23, 29-32)", () => {
  it("AFTER_ROUND_DEADLINE: el participante no puede pasarse del cierre de su ronda (criterio 18)", () => {
    const tooLate = instantOnDay("2026-12-01", "20:00"); // ronda 2 cierra en nov.
    expect(canScheduleAt(tooLate, OPEN_R2, false)).toEqual({
      ok: false,
      reason: "AFTER_ROUND_DEADLINE",
    });
  });

  it("AFTER_ROUND_DEADLINE: el admin sí puede (criterio 19)", () => {
    const tooLate = instantOnDay("2026-12-01", "20:00");
    expect(canScheduleAt(tooLate, OPEN_R2, true)).toEqual({ ok: true });
  });

  it("BEFORE_LEAGUE_START: rechazado para cualquier rol, sin salida de admin (criterio 20)", () => {
    const tooEarly = instantOnDay("2026-09-30", "20:00");
    expect(canScheduleAt(tooEarly, OPEN_R2, false)).toEqual({
      ok: false,
      reason: "BEFORE_LEAGUE_START",
    });
    expect(canScheduleAt(tooEarly, OPEN_R2, true)).toEqual({
      ok: false,
      reason: "BEFORE_LEAGUE_START",
    });
  });

  it("el primer instante del mes de arranque sí entra", () => {
    const floor = instantOnDay("2026-10-01", "00:00");
    expect(canScheduleAt(floor, OPEN_R2, false)).toEqual({ ok: true });
  });

  it("una fecha pasada dentro del rango se acepta para cualquier rol (criterio 21)", () => {
    const yesterdayish = instantOnDay("2026-11-02", "11:00");
    expect(canScheduleAt(yesterdayish, OPEN_R2, false)).toEqual({ ok: true });
    expect(canScheduleAt(yesterdayish, OPEN_R2, true)).toEqual({ ok: true });
  });

  it("ROUND_CLOSED: el participante no toca la fecha de una ronda cerrada; el admin sí (criterio 32, §4.14)", () => {
    const closed: ScheduleContext = {
      ...OPEN_R2,
      roundClosedAt: new Date(Date.UTC(2026, 11, 1)),
    };
    const date = instantOnDay("2026-11-14", "20:00");

    expect(canScheduleAt(date, closed, false)).toEqual({
      ok: false,
      reason: "ROUND_CLOSED",
    });
    expect(canScheduleAt(date, closed, true)).toEqual({ ok: true });
  });

  it("ROUND_CLOSED también bloquea el borrado de fecha del participante", () => {
    const closed: ScheduleContext = {
      ...OPEN_R2,
      roundClosedAt: new Date(Date.UTC(2026, 11, 1)),
    };
    expect(canScheduleAt(null, closed, false)).toEqual({
      ok: false,
      reason: "ROUND_CLOSED",
    });
  });

  it("CLEARING_PLAYED_MATCH: borrar la fecha de una partida PLAYED se rechaza a cualquier rol (criterio 29, §4.9)", () => {
    const played: ScheduleContext = { ...OPEN_R2, hasPlayedResult: true };

    expect(canScheduleAt(null, played, false)).toEqual({
      ok: false,
      reason: "CLEARING_PLAYED_MATCH",
    });
    expect(canScheduleAt(null, played, true)).toEqual({
      ok: false,
      reason: "CLEARING_PLAYED_MATCH",
    });
  });

  it("borrar la fecha de una partida sin Result, o con WALKOVER/UNPLAYED_DRAW, se acepta (criterio 30)", () => {
    expect(canScheduleAt(null, OPEN_R2, false)).toEqual({ ok: true });
  });

  it("cambiar (no borrar) la fecha de una partida PLAYED se acepta dentro del rango (criterio 31)", () => {
    const played: ScheduleContext = { ...OPEN_R2, hasPlayedResult: true };
    expect(canScheduleAt(instantOnDay("2026-11-12", "20:00"), played, false)).toEqual(
      { ok: true }
    );
  });

  it("una partida de playoff (sin ronda) acepta cualquier fecha desde el suelo (criterio 23, §4.11)", () => {
    const playoff: ScheduleContext = {
      roundDeadline: null,
      roundClosedAt: null,
      leagueStartMonth: START_MONTH,
      hasPlayedResult: false,
    };

    expect(canScheduleAt(instantOnDay("2027-06-01", "20:00"), playoff, false)).toEqual(
      { ok: true }
    );
    expect(canScheduleAt(instantOnDay("2026-09-30", "20:00"), playoff, false)).toEqual(
      { ok: false, reason: "BEFORE_LEAGUE_START" }
    );
  });

  it("una liga sin startMonth no tiene suelo (§5.1)", () => {
    const noStart: ScheduleContext = { ...OPEN_R2, leagueStartMonth: null };
    expect(canScheduleAt(instantOnDay("2020-01-01", "20:00"), noStart, false)).toEqual(
      { ok: true }
    );
  });
});

// ---------------------------------------------------------------------------
// §4.8 — sin fecha no hay resultado (criterio 25, nivel unitario)
// ---------------------------------------------------------------------------

describe("T0-AC4b: canReportGivenSchedule exige fecha y no distingue rol (§4.8, criterio 25)", () => {
  it("sin fecha, no", () => {
    expect(canReportGivenSchedule(null)).toBe(false);
  });

  it("con fecha, sí — incluso futura (§4.10, criterio 28)", () => {
    expect(canReportGivenSchedule(instantOnDay("2026-11-14", "20:00"))).toBe(true);
    expect(canReportGivenSchedule(instantOnDay("2099-01-01", "20:00"))).toBe(true);
  });

  it("la firma no acepta rol: el admin tampoco se la salta", () => {
    expect(canReportGivenSchedule.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// §4.5, §4.14 — qué ofrece el selector (criterios 13, 17, 33 a nivel unitario)
// ---------------------------------------------------------------------------

const OCT: MonthKey = { year: 2026, month: 10 };
const NOV: MonthKey = { year: 2026, month: 11 };
const JAN_2027: MonthKey = { year: 2027, month: 1 };

const ALICE = "alice";
const BOB = "bob";
const CAROL = "carol";

const CANDIDATES: EligibilityInput[] = [
  // Ronda 1 (cerrada) — de Alice.
  { id: "r1-alice", playerHomeId: ALICE, playerAwayId: BOB, roundIndex: 1, roundClosedAt: new Date(Date.UTC(2026, 10, 1)) },
  // Ronda 2 — de Alice, ya agendada.
  { id: "r2-alice", playerHomeId: CAROL, playerAwayId: ALICE, roundIndex: 2, roundClosedAt: null },
  // Ronda 3 — de Alice.
  { id: "r3-alice", playerHomeId: ALICE, playerAwayId: CAROL, roundIndex: 3, roundClosedAt: null },
  // Ronda 2 — ajena a Alice.
  { id: "r2-otros", playerHomeId: BOB, playerAwayId: CAROL, roundIndex: 2, roundClosedAt: null },
  // Sin ronda (§5.2) — de Alice.
  { id: "sin-ronda-alice", playerHomeId: ALICE, playerAwayId: BOB, roundIndex: null, roundClosedAt: null },
];

describe("T0-AC4c: eligibleForDay aplica 'adelantar sí, retrasar no' (§4.5, criterios 13, 17, 33)", () => {
  it("un jugador ve sus partidas de la ronda del mes y de las posteriores, nunca de las anteriores (criterio 13)", () => {
    const ids = eligibleForDay(CANDIDATES, {
      month: NOV, // ronda 2
      rounds: ROUNDS,
      playerId: ALICE,
      isAdmin: false,
    });

    expect(ids).toEqual(["r2-alice", "r3-alice", "sin-ronda-alice"]);
  });

  it("retrasar no: una partida de una ronda ANTERIOR todavía abierta no se ofrece en un mes posterior (§4.5)", () => {
    // Diciembre es la ronda 3; `r2-alice` es de la ronda 2, que sigue abierta
    // (no la filtra la guarda de ronda cerrada, la filtra la regla de orden).
    const ids = eligibleForDay(CANDIDATES, {
      month: { year: 2026, month: 12 },
      rounds: ROUNDS,
      playerId: ALICE,
      isAdmin: false,
    });

    expect(ids).not.toContain("r2-alice");
    expect(ids).toEqual(["r3-alice", "sin-ronda-alice"]);
  });

  it("no ofrece partidas ajenas", () => {
    const ids = eligibleForDay(CANDIDATES, {
      month: NOV,
      rounds: ROUNDS,
      playerId: ALICE,
      isAdmin: false,
    });
    expect(ids).not.toContain("r2-otros");
  });

  it("no ofrece a un jugador partidas de rondas cerradas (criterio 33, §4.14)", () => {
    const ids = eligibleForDay(CANDIDATES, {
      month: OCT, // ronda 1, cerrada
      rounds: ROUNDS,
      playerId: ALICE,
      isAdmin: false,
    });

    expect(ids).not.toContain("r1-alice");
    // En octubre, la ronda 1 está cerrada: solo quedan las posteriores y la
    // que no tiene ronda.
    expect(ids).toEqual(["r2-alice", "r3-alice", "sin-ronda-alice"]);
  });

  it("el selector de un admin ofrece partidas de cualquier ronda, cerrada incluida (criterio 17)", () => {
    const ids = eligibleForDay(CANDIDATES, {
      month: NOV,
      rounds: ROUNDS,
      playerId: null, // admin sin Player (§5.11)
      isAdmin: true,
    });

    expect(ids).toEqual([
      "r1-alice",
      "r2-alice",
      "r3-alice",
      "r2-otros",
      "sin-ronda-alice",
    ]);
  });

  it("en un mes de playoffs, un jugador solo puede llevar allí lo que no tiene ronda (§4.11)", () => {
    const ids = eligibleForDay(CANDIDATES, {
      month: JAN_2027, // ningún Round cubre este mes
      rounds: ROUNDS,
      playerId: ALICE,
      isAdmin: false,
    });

    expect(ids).toEqual(["sin-ronda-alice"]);
  });

  it("una sesión sin playerId y sin rol de admin no puede llevar nada a ningún día", () => {
    const ids = eligibleForDay(CANDIDATES, {
      month: NOV,
      rounds: ROUNDS,
      playerId: null,
      isAdmin: false,
    });
    expect(ids).toEqual([]);
  });

  it("la partida ya agendada se sigue ofreciendo: elegirla la mueve (criterio 14)", () => {
    const ids = eligibleForDay(CANDIDATES, {
      month: NOV,
      rounds: ROUNDS,
      playerId: ALICE,
      isAdmin: false,
    });
    // `r2-alice` es la que ya tiene fecha en la fixture de la UI.
    expect(ids).toContain("r2-alice");
  });
});

// ---------------------------------------------------------------------------
// §4.1 — el mes visible: ?mes, rango navegable y mes de entrada
// (criterios 8, 9, 10 a nivel unitario)
// ---------------------------------------------------------------------------

describe("T0-AC5: el mes visible (parseMonthKey, navigableMonths, entryMonth — criterios 8, 9, 10)", () => {
  it("parseMonthKey acepta AAAA-MM y rechaza todo lo demás sin lanzar (criterio 8)", () => {
    expect(parseMonthKey("2026-10")).toEqual({ year: 2026, month: 10 });
    expect(parseMonthKey("2026-01")).toEqual({ year: 2026, month: 1 });
    expect(parseMonthKey(null)).toBeNull();
    expect(parseMonthKey("patata")).toBeNull();
    expect(parseMonthKey("202610")).toBeNull();
    expect(parseMonthKey("2026-13")).toBeNull();
    expect(parseMonthKey("2026-00")).toBeNull();
  });

  it("formatMonthKey es el inverso y es lo que va en ?mes", () => {
    expect(formatMonthKey({ year: 2026, month: 10 })).toBe("2026-10");
    expect(formatMonthKey({ year: 2027, month: 1 })).toBe("2027-01");
    expect(parseMonthKey(formatMonthKey({ year: 2026, month: 3 }))).toEqual({
      year: 2026,
      month: 3,
    });
  });

  it("addMonths y compareMonthKeys navegan el mes y ordenan", () => {
    expect(addMonths({ year: 2026, month: 12 }, 1)).toEqual({ year: 2027, month: 1 });
    expect(addMonths({ year: 2026, month: 1 }, -1)).toEqual({ year: 2025, month: 12 });
    expect(addMonths({ year: 2026, month: 10 }, 0)).toEqual({ year: 2026, month: 10 });
    expect(addMonths({ year: 2026, month: 1 }, -13)).toEqual({ year: 2024, month: 12 });

    expect(compareMonthKeys({ year: 2026, month: 1 }, { year: 2027, month: 1 })).toBeLessThan(0);
    expect(compareMonthKeys({ year: 2026, month: 3 }, { year: 2026, month: 1 })).toBeGreaterThan(0);
    expect(compareMonthKeys({ year: 2026, month: 3 }, { year: 2026, month: 3 })).toBe(0);
    expect(monthKeyEquals({ year: 2026, month: 3 }, { year: 2026, month: 3 })).toBe(true);
    expect(monthKeyEquals({ year: 2026, month: 3 }, { year: 2026, month: 4 })).toBe(false);
  });

  it("navigableMonths cubre las rondas y los meses con playoff agendado (§4.11)", () => {
    const nav = navigableMonths(ROUNDS, [instantOnDay("2027-01-10", "20:00")]);

    expect(nav.map(formatMonthKey)).toEqual([
      "2026-10",
      "2026-11",
      "2026-12",
      "2027-01",
    ]);
  });

  it("navigableMonths rellena el hueco entre la última ronda y un playoff lejano", () => {
    const nav = navigableMonths([ROUNDS[0]], [instantOnDay("2027-03-01", "20:00")]);

    expect(nav.map(formatMonthKey)).toEqual([
      "2026-10",
      "2026-11",
      "2026-12",
      "2027-01",
      "2027-02",
      "2027-03",
    ]);
  });

  it("navigableMonths también abre hacia atrás si un playoff cayera antes", () => {
    const nav = navigableMonths([ROUNDS[2]], [instantOnDay("2026-11-10", "20:00")]);
    expect(nav.map(formatMonthKey)).toEqual(["2026-11", "2026-12"]);
  });

  it("sin rondas ni playoffs no hay rango navegable (§5.1, criterio 35)", () => {
    expect(navigableMonths([], [])).toEqual([]);
  });

  it("entryMonth: el mes de hoy si cae en el rango (criterio 9)", () => {
    const nav = navigableMonths(ROUNDS, []);
    const now = new Date(Date.UTC(2026, 10, 15, 12, 0)); // 15 nov 2026
    expect(entryMonth(nav, ROUNDS, now)).toEqual({ year: 2026, month: 11 });
  });

  it("entryMonth: si hoy no cae, el mes de la primera ronda abierta (criterio 9)", () => {
    const nav = navigableMonths(ROUNDS, []);
    const now = new Date(Date.UTC(2025, 0, 15, 12, 0)); // la liga no ha empezado
    // Ronda 1 está cerrada: la primera abierta es la 2, noviembre.
    expect(entryMonth(nav, ROUNDS, now)).toEqual({ year: 2026, month: 11 });
  });

  it("entryMonth: si no hay ninguna abierta, el mes de la última ronda (criterio 9)", () => {
    const allClosed: RoundRef[] = ROUNDS.map((r) => ({
      ...r,
      closedAt: new Date(Date.UTC(2027, 0, 1)),
    }));
    const nav = navigableMonths(allClosed, []);
    const now = new Date(Date.UTC(2030, 0, 15, 12, 0));

    expect(entryMonth(nav, allClosed, now)).toEqual({ year: 2026, month: 12 });
  });

  it("entryMonth: sin rango navegable, el mes de hoy en hora española (§5.1)", () => {
    // 1 de enero de 2027 a las 00:30 hora española = 31 dic 2026 23:30 UTC.
    const now = new Date(Date.UTC(2026, 11, 31, 23, 30));
    expect(entryMonth([], [], now)).toEqual({ year: 2027, month: 1 });
  });

  it("entryMonth: un rango hecho solo de meses de playoff cae en el último", () => {
    const nav = navigableMonths([], [instantOnDay("2027-03-01", "20:00")]);
    const now = new Date(Date.UTC(2020, 0, 1));
    expect(entryMonth(nav, [], now)).toEqual({ year: 2027, month: 3 });
  });
});

// ---------------------------------------------------------------------------
// §4.2 — reparto de partidas en celdas
// ---------------------------------------------------------------------------

describe("T0-AC6: groupByDay reparte las partidas por su día español (§4.2)", () => {
  it("agrupa por día, acumula varias en el mismo y descarta las que no tienen fecha", () => {
    const items = [
      { id: "a", scheduledAt: instantOnDay("2026-11-14", "10:00") },
      { id: "b", scheduledAt: instantOnDay("2026-11-14", "20:00") },
      { id: "c", scheduledAt: null },
      // 00:30 hora española del 15: día 15, no día 14 (§4.12).
      { id: "d", scheduledAt: new Date(Date.UTC(2026, 10, 14, 23, 30)) },
    ];

    const byDay = groupByDay(items);

    expect([...byDay.keys()].sort()).toEqual(["2026-11-14", "2026-11-15"]);
    expect(byDay.get("2026-11-14")!.map((m) => m.id)).toEqual(["a", "b"]);
    expect(byDay.get("2026-11-15")!.map((m) => m.id)).toEqual(["d"]);
  });

  it("una lista vacía da un mapa vacío", () => {
    expect(groupByDay([]).size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Etiquetas en español (cálculo, no presentación — como quotaLabel)
// ---------------------------------------------------------------------------

describe("T0-AC6b: etiquetas de mes y de día", () => {
  it("monthLabel da 'Octubre 2026' para la cabecera (§4.1)", () => {
    expect(monthLabel({ year: 2026, month: 10 })).toBe("Octubre 2026");
    expect(monthLabel({ year: 2027, month: 1 })).toBe("Enero 2027");
  });

  it("dayLabel da 'Sábado 17 de octubre' para el detalle del día (§4.3)", () => {
    expect(dayLabel("2026-10-17")).toBe("Sábado 17 de octubre");
    expect(dayLabel("2026-11-01")).toBe("Domingo 1 de noviembre");
    expect(dayLabel("2026-12-31")).toBe("Jueves 31 de diciembre");
  });
});

// ---------------------------------------------------------------------------
// Entrega 4 — la fixture compartida siembra de verdad lo que los cuatro
// tracks van a pedirle
//
// (La Entrega 3 de este track eran los stubs de MonthGrid, DayDetail y
// DaySchedulePicker, y su bloque T0-AC7 comprobaba que renderizaban un
// marcador visible en vez de null y que montaban el siguiente componente de
// la cadena. Los tres stubs ya están sustituidos por su implementación real,
// así que ese bloque se retiró aquí: quien vigila ahora que no sobreviva
// ningún STUB_MARKER en src/, y que la cadena siga montada de punta a punta,
// es tests/montaje.test.tsx.)
// ---------------------------------------------------------------------------

describe("T0-AC8: seedCalendarLeague crea la liga, las 3 rondas y las 9 partidas de la spec", () => {
  it("siembra todos los estados que la spec nombra", async () => {
    const { prisma } = await import("@/lib/db");
    const seeded = await seedCalendarLeague();

    const league = await prisma.league.findUniqueOrThrow({
      where: { id: seeded.leagueId },
    });
    expect(league.startMonth?.toISOString()).toBe(START_MONTH.toISOString());

    const rounds = await prisma.round.findMany({
      where: { leagueId: seeded.leagueId },
      orderBy: { index: "asc" },
    });
    expect(rounds.map((r) => r.index)).toEqual([1, 2, 3]);
    expect(rounds[0].closedAt).not.toBeNull(); // ronda 1 cerrada (§4.14)
    expect(rounds[1].closedAt).toBeNull();
    expect(rounds.map((r) => r.deadline.toISOString())).toEqual([
      R1_DEADLINE.toISOString(),
      R2_DEADLINE.toISOString(),
      R3_DEADLINE.toISOString(),
    ]);

    const matches = await prisma.match.findMany({
      where: { leagueId: seeded.leagueId },
      select: {
        id: true,
        phase: true,
        roundId: true,
        scheduledAt: true,
        result: { select: { resolution: true } },
      },
    });
    expect(matches).toHaveLength(9);

    const byId = new Map(matches.map((m) => [m.id, m]));
    const m = seeded.matches;

    // Sin fecha / con fecha.
    expect(byId.get(m.openNoDate)!.scheduledAt).toBeNull();
    expect(byId.get(m.openScheduled)!.scheduledAt).not.toBeNull();

    // Las tres resolutions.
    expect(byId.get(m.playedInClosedRound)!.result!.resolution).toBe("PLAYED");
    expect(byId.get(m.walkoverNoDate)!.result!.resolution).toBe("WALKOVER");
    expect(byId.get(m.settledInClosedRound)!.result!.resolution).toBe(
      "UNPLAYED_DRAW"
    );

    // §5.9: PLAYED sin fecha, el dato anterior a la spec.
    expect(byId.get(m.legacyPlayedNoDate)!.result!.resolution).toBe("PLAYED");
    expect(byId.get(m.legacyPlayedNoDate)!.scheduledAt).toBeNull();

    // §5.2: partida de liga sin ronda.
    expect(byId.get(m.noRound)!.roundId).toBeNull();
    expect(byId.get(m.noRound)!.phase).toBe("LEAGUE");

    // §4.11: playoff sin ronda y con fecha.
    expect(byId.get(m.playoff)!.phase).toBe("PLAYOFF");
    expect(byId.get(m.playoff)!.roundId).toBeNull();

    // §9.5: la partida del propio día de cierre de la ronda 3 es válida.
    const onDeadline = byId.get(m.onDeadlineDay)!;
    expect(dayKeyOf(onDeadline.scheduledAt!)).toBe("2026-12-31");
    expect(
      canScheduleAt(
        onDeadline.scheduledAt!,
        {
          roundDeadline: R3_DEADLINE,
          roundClosedAt: null,
          leagueStartMonth: START_MONTH,
          hasPlayedResult: false,
        },
        false
      )
    ).toEqual({ ok: true });
  });
});
