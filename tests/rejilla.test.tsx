// @vitest-environment jsdom
//
// Tests for t02 (`rejilla`) of the feature "calendario-de-verdad"
// (plan/calendario-de-verdad/PLAN.md). Spec:
// plan/specs/calendario-de-verdad.md §4.1-§4.4, §4.11, §4.12, §5.1-§5.4, §5.9.
// Criteria 1-12, 35, 36, the presentation half of 34 and of 38.
//
// **The page is exercised through its real path**, never by calling a helper:
// every test awaits the server component `/calendario` with real rows in
// `file:./test.db`, renders the tree it returns, and clicks the grid. That is
// deliberate — the failure mode this repo has shipped three times (PR #1) is a
// component that is built, tested in isolation and never mounted, with the
// suite still green. Here a broken chain MonthGrid → DayDetail →
// DaySchedulePicker fails AC-7 and AC-15's mount assertion.
//
// Time is frozen with `vi.setSystemTime` (Date only, so Prisma's timers keep
// working) because "today" and "the entry month" are criteria (9, and the
// today marker of §4.2); the dates themselves are built with `instantOnDay`,
// so the file means the same under any `TZ` (§4.12).

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";

// ---------------------------------------------------------------------------
// Instrumented Prisma client (§7, "una consulta por vista, sin N+1")
// ---------------------------------------------------------------------------

const { counts, sessionRef } = vi.hoisted(() => ({
  counts: {} as Record<string, number>,
  sessionRef: {
    current: { sub: "test", role: "ADMIN", playerId: null } as {
      sub: string;
      role: "ADMIN" | "PLAYER";
      playerId: string | null;
    },
  },
}));

vi.mock("@/lib/guards", () => ({
  requireAuth: async () => sessionRef.current,
}));

// The header is a client component with its own navigation; irrelevant here.
vi.mock("@/components/AppHeader", () => ({ AppHeader: () => null }));

// Same technique as tests/rondas-overview.test.ts: a `$extends` middleware that
// counts client-level operations per model. `/calendario` reads `prisma` from
// the module directly (it is a page, not a function taking a client), so the
// instrumentation goes in through the module mock.
vi.mock("@/lib/db", async () => {
  const actual = await vi.importActual<typeof import("@/lib/db")>("@/lib/db");
  const extended = actual.prisma.$extends({
    query: {
      $allModels: {
        async $allOperations({ model, args, query }) {
          counts[model] = (counts[model] ?? 0) + 1;
          return query(args);
        },
      },
    },
  }) as unknown as typeof actual.prisma;
  return { ...actual, prisma: extended };
});

import { prisma } from "@/lib/db";
import CalendarioPage from "@/app/calendario/page";
import { instantOnDay } from "@/server/calendar";
import {
  nextCreatedAt,
  seedCalendarLeague,
  type SeededCalendar,
} from "./helpers/calendario";

function resetCounts() {
  for (const key of Object.keys(counts)) delete counts[key];
}

function totalQueries(): number {
  return Object.values(counts).reduce((sum, n) => sum + n, 0);
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/**
 * `/calendario` shows the most recently created league, and every test file
 * shares one `test.db`, so each seeded league has to be newer than everything
 * already there. That ordering is guaranteed by the shared fixture itself
 * (`nextCreatedAt` in tests/helpers/calendario.ts), which reads the current
 * maximum from the database.
 *
 * This file used to pin its leagues to 1 Jan 2030 instead. It fixed the ties
 * here and broke tests/periferia.test.tsx, which renders `/rondas` and got
 * *this* file's league — 2030 outlives everyone — whenever rejilla ran first.
 * Don't reintroduce a per-file clock: the ordering rule belongs in the fixture,
 * where every caller gets the same one.
 */
let seq = 0;
async function freshLeague(): Promise<SeededCalendar> {
  return seedCalendarLeague();
}

/**
 * A bare league with no `startMonth`, no rounds and no matches (§5.1).
 *
 * `createdAt` comes from the shared helper's `nextCreatedAt`, the same one
 * `seedCalendarLeague` uses — this used to be a hand-copied duplicate of that
 * rule, which is precisely the kind of thing that drifts on one side only.
 */
async function freshSetupLeague(): Promise<string> {
  seq += 1;
  const league = await prisma.league.create({
    data: {
      id: `league-setup-${seq}-${Math.random().toString(36).slice(2, 8)}`,
      name: "Liga recién creada",
      season: "2027 Setup",
      status: "SETUP",
      matchesPerRound: 2,
      startMonth: null,
      createdAt: await nextCreatedAt(),
    },
  });
  return league.id;
}

interface ExtraMatch {
  leagueId: string;
  roundId?: string | null;
  homeId: string;
  awayId: string;
  at?: Date | null;
  location?: string | null;
  status?: "SCHEDULED" | "REPORTED" | "CONFIRMED";
  phase?: "LEAGUE" | "PLAYOFF";
  resolution?: "PLAYED" | "WALKOVER" | "UNPLAYED_DRAW" | null;
}

async function addMatch(spec: ExtraMatch): Promise<string> {
  const match = await prisma.match.create({
    data: {
      leagueId: spec.leagueId,
      phase: spec.phase ?? "LEAGUE",
      status: spec.status ?? "SCHEDULED",
      roundId: spec.roundId ?? null,
      playerHomeId: spec.homeId,
      playerAwayId: spec.awayId,
      scheduledAt: spec.at ?? null,
      location: spec.location ?? null,
    },
  });
  if (spec.resolution != null) {
    await prisma.result.create({
      data: {
        matchId: match.id,
        homeVictoryPoints: 70,
        awayVictoryPoints: 50,
        outcome: "HOME_WIN",
        resolution: spec.resolution,
        reportedById: spec.homeId,
      },
    });
  }
  return match.id;
}

function setToday(iso: string) {
  vi.setSystemTime(new Date(iso));
}

async function renderCalendario(mes?: string) {
  resetCounts();
  const tree = await CalendarioPage({
    searchParams: Promise.resolve(mes === undefined ? {} : { mes }),
  });
  return render(tree);
}

/** Every cell of the grid, in order. Only cells carry `data-in-month`. */
function cells(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>("[data-in-month]"));
}

function cell(dayKey: string): HTMLElement {
  return screen.getByTestId(`day-${dayKey}`);
}

function heading(): string {
  return screen.getByTestId("month-heading").textContent ?? "";
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  // Inside November 2026 — round 2's month, which the fixture leaves open.
  setToday("2026-11-14T10:00:00.000Z");
  sessionRef.current = { sub: "test", role: "ADMIN", playerId: null };
});

afterEach(() => {
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// AC-1
// ---------------------------------------------------------------------------

describe("AC-1: rejilla de 7 columnas desde lunes, semanas completas, relleno inerte", () => {
  it("noviembre de 2026 son 6 semanas completas que arrancan el lunes 26 de octubre", async () => {
    await freshLeague();
    const { container } = await renderCalendario("2026-11");

    const grid = screen.getByTestId("grid-cells");
    expect(grid.style.gridTemplateColumns).toBe("repeat(7, minmax(0, 1fr))");

    // Weekday header, Monday first.
    const weekdays = Array.from(
      container.querySelectorAll<HTMLElement>(
        "[data-testid='weekday-header'] > *"
      )
    ).map((node) => node.textContent);
    expect(weekdays).toEqual(["L", "M", "X", "J", "V", "S", "D"]);

    const all = cells();
    expect(all.length % 7).toBe(0);
    // 1 Nov 2026 is a Sunday: 6 filler days before it, 30 after, 42 cells.
    expect(all.length).toBe(42);
    expect(all[0].getAttribute("data-testid")).toBe("day-2026-10-26");
    expect(all[41].getAttribute("data-testid")).toBe("day-2026-12-06");
  });

  it("los días de relleno están apagados y no responden al toque", async () => {
    await freshLeague();
    await renderCalendario("2026-11");

    const filler = cell("2026-10-26");
    expect(filler.getAttribute("data-in-month")).toBe("false");
    expect((filler as HTMLButtonElement).disabled).toBe(true);
    expect(Number(filler.style.opacity)).toBeLessThan(1);

    fireEvent.click(filler);
    expect(screen.queryByTestId("day-detail")).toBeNull();

    expect(cell("2026-11-01").getAttribute("data-in-month")).toBe("true");
  });
});

// ---------------------------------------------------------------------------
// AC-2
// ---------------------------------------------------------------------------

describe("AC-2: la cabecera nombra mes, año, ronda y día de cierre", () => {
  it("noviembre de 2026 es 'Noviembre 2026 · Ronda 2 · cierra el 30'", async () => {
    await freshLeague();
    await renderCalendario("2026-11");
    expect(heading()).toBe("Noviembre 2026 · Ronda 2 · cierra el 30");
  });

  it("octubre de 2026 es 'Octubre 2026 · Ronda 1 · cierra el 31'", async () => {
    await freshLeague();
    await renderCalendario("2026-10");
    expect(heading()).toBe("Octubre 2026 · Ronda 1 · cierra el 31");
  });
});

// ---------------------------------------------------------------------------
// AC-3
// ---------------------------------------------------------------------------

describe("AC-3: el día de la celda se resuelve en Europe/Madrid", () => {
  it("una partida del 1 de noviembre a las 00:30 hora española cae en el 1, no en el 31 de octubre", async () => {
    const seeded = await freshLeague();
    const id = await addMatch({
      leagueId: seeded.leagueId,
      roundId: seeded.rounds.r2,
      homeId: seeded.players.alice,
      awayId: seeded.players.carol,
      at: instantOnDay("2026-11-01", "00:30"),
    });

    const november = await renderCalendario("2026-11");
    const firstOfNovember = cell("2026-11-01");
    expect(
      within(firstOfNovember)
        .getAllByTestId("day-dot")
        .map((d) => d.getAttribute("data-match-id"))
    ).toContain(id);
    november.unmount();

    // The same instant is 31 Oct 23:30 UTC — it must NOT show up in October.
    await renderCalendario("2026-10");
    const lastOfOctober = cell("2026-10-31");
    expect(lastOfOctober.getAttribute("data-matches")).toBe("0");
  });
});

// ---------------------------------------------------------------------------
// AC-4
// ---------------------------------------------------------------------------

describe("AC-4: el punto con resultado va en --accent; el que no lo tiene, apagado", () => {
  it("distingue una partida REPORTED de una SCHEDULED en el mismo mes", async () => {
    const seeded = await freshLeague();
    const reported = await addMatch({
      leagueId: seeded.leagueId,
      roundId: seeded.rounds.r2,
      homeId: seeded.players.alice,
      awayId: seeded.players.bob,
      at: instantOnDay("2026-11-07", "18:00"),
      status: "REPORTED",
      resolution: "PLAYED",
    });

    await renderCalendario("2026-11");

    const withResult = within(cell("2026-11-07")).getByTestId("day-dot");
    expect(withResult.getAttribute("data-match-id")).toBe(reported);
    expect(withResult.getAttribute("data-result")).toBe("true");
    expect(withResult.style.background).toBe("var(--accent)");

    // The fixture's `openScheduled` — 14 Nov 20:00, no result.
    const withoutResult = within(cell("2026-11-14")).getByTestId("day-dot");
    expect(withoutResult.getAttribute("data-result")).toBe("false");
    expect(withoutResult.style.background).not.toContain("--accent");
    expect(withoutResult.style.background).toBe("var(--fg-disabled)");
  });
});

// ---------------------------------------------------------------------------
// AC-5
// ---------------------------------------------------------------------------

describe("AC-5: el punto de una partida del jugador de la sesión se distingue", () => {
  it("la partida de Alice lleva anillo y la de Bob contra Carol no", async () => {
    const seeded = await freshLeague();
    sessionRef.current = {
      sub: "alice",
      role: "PLAYER",
      playerId: seeded.players.alice,
    };
    const mine = await addMatch({
      leagueId: seeded.leagueId,
      roundId: seeded.rounds.r2,
      homeId: seeded.players.alice,
      awayId: seeded.players.bob,
      at: instantOnDay("2026-11-07", "18:00"),
    });

    await renderCalendario("2026-11");

    const mineDot = within(cell("2026-11-07")).getByTestId("day-dot");
    expect(mineDot.getAttribute("data-match-id")).toBe(mine);
    expect(mineDot.getAttribute("data-mine")).toBe("true");
    expect(mineDot.style.boxShadow).not.toBe("none");
    expect(mineDot.style.boxShadow).toContain("0 0 0 2px");

    const theirsDot = within(cell("2026-11-14")).getByTestId("day-dot");
    expect(theirsDot.getAttribute("data-mine")).toBe("false");
    expect(theirsDot.style.boxShadow).toBe("none");
  });
});

// ---------------------------------------------------------------------------
// §4.2 — hoy y el día del cierre
// ---------------------------------------------------------------------------

describe("§4.2: el día de hoy y el día del cierre de la ronda se marcan en la rejilla", () => {
  it("marca el 14 (hoy) y el 30 (cierre de la ronda 2), y solo esos", async () => {
    await freshLeague();
    await renderCalendario("2026-11");

    const today = cell("2026-11-14");
    expect(today.getAttribute("data-today")).toBe("true");
    expect(today.style.boxShadow).not.toBe("none");

    const deadline = cell("2026-11-30");
    expect(deadline.getAttribute("data-deadline")).toBe("true");
    expect(deadline.style.borderColor).not.toBe("var(--border)");

    expect(
      cells().filter((c) => c.getAttribute("data-today") === "true")
    ).toHaveLength(1);
    expect(
      cells().filter((c) => c.getAttribute("data-deadline") === "true")
    ).toHaveLength(1);
    expect(cell("2026-11-07").getAttribute("data-today")).toBe("false");
    expect(cell("2026-11-07").style.boxShadow).toBe("none");
  });

  it("el mes de playoff no marca ningún cierre (§4.11)", async () => {
    await freshLeague();
    await renderCalendario("2027-01");
    expect(
      cells().filter((c) => c.getAttribute("data-deadline") === "true")
    ).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// AC-6
// ---------------------------------------------------------------------------

describe("AC-6: un día con 6 partidas muestra 4 puntos y +2, y su detalle las lista todas", () => {
  it("recorta los puntos de la celda pero no el detalle (§5.3)", async () => {
    const seeded = await freshLeague();
    const pairs: [string, string][] = [
      [seeded.players.alice, seeded.players.bob],
      [seeded.players.bob, seeded.players.carol],
      [seeded.players.carol, seeded.players.admin],
      [seeded.players.admin, seeded.players.alice],
      [seeded.players.alice, seeded.players.carol],
      [seeded.players.bob, seeded.players.admin],
    ];
    for (const [home, away] of pairs) {
      await addMatch({
        leagueId: seeded.leagueId,
        roundId: seeded.rounds.r2,
        homeId: home,
        awayId: away,
        at: instantOnDay("2026-11-21", "17:00"),
      });
    }

    await renderCalendario("2026-11");

    const busy = cell("2026-11-21");
    expect(busy.getAttribute("data-matches")).toBe("6");
    expect(within(busy).getAllByTestId("day-dot")).toHaveLength(4);
    expect(within(busy).getByTestId("day-more").textContent).toBe("+2");

    fireEvent.click(busy);
    const detail = screen.getByTestId("day-detail");
    expect(within(detail).getAllByTestId("match-row")).toHaveLength(6);
    // §5.3: the detail has no scroll of its own.
    expect(detail.className).not.toContain("overflow");
    expect(detail.style.maxHeight).toBe("");
  });
});

// ---------------------------------------------------------------------------
// AC-7
// ---------------------------------------------------------------------------

describe("AC-7: tocar un día despliega su detalle; volver a tocarlo lo cierra; solo uno a la vez", () => {
  it("el detalle trae jugadores, hora, lugar y badge de estado", async () => {
    const seeded = await freshLeague();
    await addMatch({
      leagueId: seeded.leagueId,
      roundId: seeded.rounds.r2,
      homeId: seeded.players.alice,
      awayId: seeded.players.bob,
      at: instantOnDay("2026-11-07", "18:30"),
      location: "Warlotus",
    });

    await renderCalendario("2026-11");
    expect(screen.queryByTestId("day-detail")).toBeNull();

    fireEvent.click(cell("2026-11-07"));
    const detail = screen.getByTestId("day-detail");
    expect(detail.getAttribute("data-day")).toBe("2026-11-07");
    expect(detail.textContent).toContain("Sábado 7 de noviembre");
    expect(detail.textContent).toContain("Alice");
    expect(detail.textContent).toContain("Bob");
    expect(detail.textContent).toContain("18:30");
    expect(detail.textContent).toContain("Warlotus");
    expect(detail.textContent).toContain("Pendiente");
  });

  it("vuelve a tocar el mismo día y se cierra", async () => {
    await freshLeague();
    await renderCalendario("2026-11");

    fireEvent.click(cell("2026-11-14"));
    expect(screen.getByTestId("day-detail")).toBeTruthy();

    fireEvent.click(cell("2026-11-14"));
    expect(screen.queryByTestId("day-detail")).toBeNull();
  });

  it("el botón «Cerrar» del detalle también lo repliega", async () => {
    await freshLeague();
    await renderCalendario("2026-11");

    fireEvent.click(cell("2026-11-14"));
    fireEvent.click(screen.getByTestId("close-day"));
    expect(screen.queryByTestId("day-detail")).toBeNull();
  });

  it("solo hay un día desplegado a la vez", async () => {
    const seeded = await freshLeague();
    await addMatch({
      leagueId: seeded.leagueId,
      roundId: seeded.rounds.r2,
      homeId: seeded.players.alice,
      awayId: seeded.players.bob,
      at: instantOnDay("2026-11-07", "18:30"),
    });

    await renderCalendario("2026-11");

    fireEvent.click(cell("2026-11-07"));
    expect(screen.getByTestId("day-detail").getAttribute("data-day")).toBe(
      "2026-11-07"
    );

    fireEvent.click(cell("2026-11-14"));
    const details = screen.getAllByTestId("day-detail");
    expect(details).toHaveLength(1);
    expect(details[0].getAttribute("data-day")).toBe("2026-11-14");
  });

  it("el detalle monta el selector del día: la cadena MonthGrid → DayDetail → DaySchedulePicker está viva", async () => {
    const seeded = await freshLeague();
    sessionRef.current = {
      sub: "alice",
      role: "PLAYER",
      playerId: seeded.players.alice,
    };

    await renderCalendario("2026-11");
    fireEvent.click(cell("2026-11-14"));

    const detail = screen.getByTestId("day-detail");
    // The real picker, by its real testid. This assertion used to accept a
    // `stub-` testid as an alternative, which means it would have passed
    // against the placeholder the chain was built on — exactly the failure
    // mode the chain test exists to catch.
    const picker = detail.querySelector("[data-testid='day-schedule-picker']");
    expect(picker).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// AC-8
// ---------------------------------------------------------------------------

describe("AC-8: el mes visible vive en ?mes, y un ?mes inválido cae al mes de entrada", () => {
  it("?mes=2026-10 renderiza octubre de 2026 en el servidor", async () => {
    await freshLeague();
    await renderCalendario("2026-10");
    expect(heading()).toContain("Octubre 2026");
    expect(cell("2026-10-17")).toBeTruthy();
  });

  it("las flechas son enlaces que cambian ?mes", async () => {
    await freshLeague();
    await renderCalendario("2026-11");

    const prev = screen.getByTestId("prev-month");
    const next = screen.getByTestId("next-month");
    expect(prev.tagName).toBe("A");
    expect(prev.getAttribute("href")).toBe("/calendario?mes=2026-10");
    expect(next.getAttribute("href")).toBe("/calendario?mes=2026-12");
  });

  it("?mes=patata cae al mes de entrada sin error", async () => {
    await freshLeague();
    await renderCalendario("patata");
    // Today (14 Nov 2026) is inside the navigable range, so it is the entry month.
    expect(heading()).toContain("Noviembre 2026");
  });

  it("un mes fuera del rango navegable cae al mes de entrada sin error", async () => {
    await freshLeague();
    await renderCalendario("2030-05");
    expect(heading()).toContain("Noviembre 2026");
  });
});

// ---------------------------------------------------------------------------
// AC-9
// ---------------------------------------------------------------------------

describe("AC-9: el mes de entrada sin ?mes", () => {
  it("hoy, si cae en el rango navegable", async () => {
    await freshLeague();
    setToday("2026-12-05T10:00:00.000Z");
    await renderCalendario();
    expect(heading()).toContain("Diciembre 2026");
  });

  it("si hoy no cae en el rango, el mes de la primera ronda abierta", async () => {
    await freshLeague();
    // Before the league starts: October is round 1 but it is closed, so the
    // first open round is round 2 — November.
    setToday("2026-09-19T10:00:00.000Z");
    await renderCalendario();
    expect(heading()).toContain("Noviembre 2026");
  });

  it("si no hay ninguna ronda abierta, el mes de la última ronda", async () => {
    const seeded = await freshLeague();
    await prisma.round.updateMany({
      where: { leagueId: seeded.leagueId },
      data: { closedAt: new Date(Date.UTC(2027, 0, 5)) },
    });
    setToday("2026-09-19T10:00:00.000Z");
    await renderCalendario();
    expect(heading()).toContain("Diciembre 2026");
  });
});

// ---------------------------------------------------------------------------
// AC-10
// ---------------------------------------------------------------------------

describe("AC-10: las flechas se deshabilitan en los extremos del rango", () => {
  it("en el primer mes del rango la flecha ← no es un enlace", async () => {
    await freshLeague();
    await renderCalendario("2026-10");

    const prev = screen.getByTestId("prev-month");
    expect(prev.tagName).not.toBe("A");
    expect(prev.getAttribute("aria-disabled")).toBe("true");
    expect(prev.getAttribute("href")).toBeNull();
    expect(screen.getByTestId("next-month").tagName).toBe("A");
  });

  it("en el último mes del rango la flecha → no es un enlace", async () => {
    await freshLeague();
    // The fixture's playoff match (10 Jan 2027) extends the range past round 3.
    await renderCalendario("2027-01");

    const next = screen.getByTestId("next-month");
    expect(next.tagName).not.toBe("A");
    expect(next.getAttribute("aria-disabled")).toBe("true");
    expect(screen.getByTestId("prev-month").tagName).toBe("A");
  });
});

// ---------------------------------------------------------------------------
// AC-11
// ---------------------------------------------------------------------------

describe("AC-11: el bloque «Sin fecha · Ronda N» es el de la ronda del mes visible", () => {
  it("noviembre lista exactamente las partidas sin fecha de la ronda 2", async () => {
    const seeded = await freshLeague();
    await renderCalendario("2026-11");

    const block = screen.getByTestId("unscheduled-block");
    // openNoDate, walkoverNoDate, legacyPlayedNoDate + la partida sin ronda (§5.2).
    expect(block.textContent).toContain("Sin fecha · Ronda 2 (4)");

    const ids = within(block)
      .getAllByTestId("match-row")
      .map((row) => row.getAttribute("data-match-id"));
    expect(new Set(ids)).toEqual(
      new Set([
        seeded.matches.openNoDate,
        seeded.matches.walkoverNoDate,
        seeded.matches.legacyPlayedNoDate,
        seeded.matches.noRound,
      ])
    );
    // Never a match of another round, and never one that already has a date.
    expect(ids).not.toContain(seeded.matches.settledInClosedRound);
    expect(ids).not.toContain(seeded.matches.openScheduled);
  });

  it("al navegar de mes el bloque cambia con él", async () => {
    const seeded = await freshLeague();
    const october = await renderCalendario("2026-10");

    const octoberBlock = screen.getByTestId("unscheduled-block");
    expect(octoberBlock.textContent).toContain("Sin fecha · Ronda 1 (1)");
    expect(
      within(octoberBlock)
        .getAllByTestId("match-row")
        .map((row) => row.getAttribute("data-match-id"))
    ).toEqual([seeded.matches.settledInClosedRound]);
    october.unmount();

    await renderCalendario("2026-11");
    expect(screen.getByTestId("unscheduled-block").textContent).toContain(
      "Sin fecha · Ronda 2 (4)"
    );
  });

  it("si la ronda no tiene ninguna partida sin fecha, el bloque no se pinta", async () => {
    await freshLeague();
    // Round 3's only match (31 Dec) already has a date.
    await renderCalendario("2026-12");
    expect(screen.queryByTestId("unscheduled-block")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// AC-12
// ---------------------------------------------------------------------------

describe("AC-12: los playoffs se pintan, y su mes no tiene ronda ni cierre", () => {
  it("la cabecera del mes de playoff dice «Playoffs», sin ronda ni fecha de cierre", async () => {
    await freshLeague();
    await renderCalendario("2027-01");
    expect(heading()).toBe("Enero 2027 · Playoffs");
    expect(heading()).not.toContain("Ronda");
    expect(heading()).not.toContain("cierra");
  });

  it("la partida de playoff se pinta en su día, marcada como tal", async () => {
    const seeded = await freshLeague();
    await renderCalendario("2027-01");

    const day = cell("2027-01-10");
    expect(day.getAttribute("data-matches")).toBe("1");

    fireEvent.click(day);
    const row = within(screen.getByTestId("day-detail")).getByTestId(
      "match-row"
    );
    expect(row.getAttribute("data-match-id")).toBe(seeded.matches.playoff);
    expect(row.getAttribute("data-phase")).toBe("PLAYOFF");
    expect(within(row).getByTestId("playoff-mark").textContent).toContain(
      "Playoff"
    );
  });

  it("las partidas de playoff sin fecha se listan bajo «Sin fecha · Playoffs»", async () => {
    const seeded = await freshLeague();
    const pending = await addMatch({
      leagueId: seeded.leagueId,
      homeId: seeded.players.carol,
      awayId: seeded.players.admin,
      phase: "PLAYOFF",
      at: null,
    });

    await renderCalendario("2027-01");
    const block = screen.getByTestId("unscheduled-block");
    expect(block.textContent).toContain("Sin fecha · Playoffs (1)");
    expect(
      within(block).getByTestId("match-row").getAttribute("data-match-id")
    ).toBe(pending);
  });

  it("la rejilla ya no filtra por phase = LEAGUE: en un mes de liga conviven ambas", async () => {
    const seeded = await freshLeague();
    const playoffInNovember = await addMatch({
      leagueId: seeded.leagueId,
      homeId: seeded.players.alice,
      awayId: seeded.players.carol,
      phase: "PLAYOFF",
      at: instantOnDay("2026-11-28", "19:00"),
    });

    await renderCalendario("2026-11");
    expect(
      within(cell("2026-11-28"))
        .getByTestId("day-dot")
        .getAttribute("data-match-id")
    ).toBe(playoffInNovember);
  });
});

// ---------------------------------------------------------------------------
// AC-34 (presentation half) — §5.9
// ---------------------------------------------------------------------------

describe("AC-34: el resultado PLAYED sin fecha se ve, marcado «jugada, falta la fecha»", () => {
  it("aparece en el bloque «Sin fecha» de su ronda con la marca", async () => {
    const seeded = await freshLeague();
    await renderCalendario("2026-11");

    const row = screen
      .getByTestId("unscheduled-block")
      .querySelector<HTMLElement>(
        `[data-match-id='${seeded.matches.legacyPlayedNoDate}']`
      );
    expect(row).not.toBeNull();
    expect(within(row!).getByTestId("missing-date").textContent).toBe(
      "jugada, falta la fecha"
    );

    // The others in the block are not marked.
    const openRow = screen
      .getByTestId("unscheduled-block")
      .querySelector<HTMLElement>(
        `[data-match-id='${seeded.matches.openNoDate}']`
      );
    expect(within(openRow!).queryByTestId("missing-date")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// AC-35 — §5.1
// ---------------------------------------------------------------------------

describe("AC-35: una liga sin startMonth pinta la rejilla del mes de hoy, vacía", () => {
  it("rejilla de hoy, mensaje de «todavía no hay partidas» y flechas deshabilitadas", async () => {
    await freshSetupLeague();
    setToday("2026-09-19T10:00:00.000Z");

    await renderCalendario();

    expect(heading()).toBe("Septiembre 2026");
    expect(document.body.textContent).toContain(
      "Todavía no hay partidas generadas"
    );
    expect(screen.getByTestId("prev-month").getAttribute("aria-disabled")).toBe(
      "true"
    );
    expect(screen.getByTestId("next-month").getAttribute("aria-disabled")).toBe(
      "true"
    );
    expect(cells().length).toBe(35); // September 2026: 5 whole weeks.
    expect(cells().every((c) => c.getAttribute("data-matches") === "0")).toBe(
      true
    );
    // Admin keeps the way out that the old page already had.
    expect(document.body.textContent).toContain("Generar emparejamientos");
  });
});

// ---------------------------------------------------------------------------
// AC-36 — §5.2
// ---------------------------------------------------------------------------

describe("AC-36: una partida de liga sin ronda aparece en el bloque de la primera ronda abierta", () => {
  it("se lista en noviembre (ronda 2, la primera abierta) etiquetada «Sin ronda»", async () => {
    const seeded = await freshLeague();
    await renderCalendario("2026-11");

    const row = screen
      .getByTestId("unscheduled-block")
      .querySelector<HTMLElement>(
        `[data-match-id='${seeded.matches.noRound}']`
      );
    expect(row).not.toBeNull();
    expect(row!.textContent).toContain("Sin ronda");
  });

  it("no se cuela en el bloque de la ronda cerrada de octubre", async () => {
    const seeded = await freshLeague();
    await renderCalendario("2026-10");

    expect(
      screen
        .getByTestId("unscheduled-block")
        .querySelector(`[data-match-id='${seeded.matches.noRound}']`)
    ).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// AC-38 (presentation half) — §7
// ---------------------------------------------------------------------------

describe("AC-38: la rejilla y el detalle caben en 390px sin scroll horizontal", () => {
  it("ni la rejilla ni el detalle declaran anchos fijos ni scroll horizontal", async () => {
    const seeded = await freshLeague();
    await addMatch({
      leagueId: seeded.leagueId,
      roundId: seeded.rounds.r2,
      homeId: seeded.players.alice,
      awayId: seeded.players.bob,
      at: instantOnDay("2026-11-07", "18:30"),
      location:
        "Un lugar con un nombre larguísimo para forzar el desbordamiento",
    });

    await renderCalendario("2026-11");
    // Open a day so the detail (and the rows inside it) are in the DOM too.
    fireEvent.click(cell("2026-11-07"));

    const scope = screen.getByTestId("month-grid");
    const nodes = [
      scope,
      ...Array.from(scope.querySelectorAll<HTMLElement>("*")),
    ];

    for (const node of nodes) {
      const className =
        typeof node.className === "string" ? node.className : "";

      // Nothing inside the grid may scroll sideways: the document scrolls.
      expect(className).not.toMatch(/overflow-x-(auto|scroll)/);
      expect(node.style.overflowX).not.toBe("scroll");
      expect(node.style.overflowX).not.toBe("auto");

      // No fixed width wider than the narrowest phone the spec names.
      for (const value of [node.style.width, node.style.minWidth]) {
        const px = /^(\d+)px$/.exec(value ?? "");
        if (px !== null) expect(Number(px[1])).toBeLessThanOrEqual(390);
      }
      const tailwindWidth = /(?:^|\s)(?:min-)?w-\[(\d+)px\]/.exec(className);
      if (tailwindWidth !== null) {
        expect(Number(tailwindWidth[1])).toBeLessThanOrEqual(390);
      }
    }

    // The grid itself is 7 flexible columns, so it shrinks with the viewport
    // instead of pushing a scrollbar.
    expect(screen.getByTestId("grid-cells").style.gridTemplateColumns).toBe(
      "repeat(7, minmax(0, 1fr))"
    );
    // Every cell may shrink below its content's intrinsic width.
    expect(cells().every((c) => c.className.includes("min-w-0"))).toBe(true);
    // The long location wraps instead of widening its row.
    const detail = screen.getByTestId("day-detail");
    expect(detail.className).not.toMatch(/overflow-x-(auto|scroll)/);
    expect(within(detail).getAllByTestId("match-row").length).toBeGreaterThan(
      0
    );
  });
});

// ---------------------------------------------------------------------------
// §7 — la consulta del mes, medida (sin N+1)
// ---------------------------------------------------------------------------

describe("La carga del mes es un número fijo de consultas (sin N+1)", () => {
  it("una liga sembrada se pinta con 1 League + 1 Round + 2 Match", async () => {
    await freshLeague();
    await renderCalendario("2026-11");

    expect(counts.League).toBe(1);
    expect(counts.Round).toBe(1);
    expect(counts.Match).toBe(2);
    expect(counts.Result).toBeUndefined();
    expect(counts.Player).toBeUndefined();
    expect(totalQueries()).toBe(4);
  });

  it("el número de consultas no crece con más partidas ni más días ocupados", async () => {
    const seeded = await freshLeague();
    const pairs: [string, string][] = [
      [seeded.players.alice, seeded.players.bob],
      [seeded.players.bob, seeded.players.carol],
      [seeded.players.carol, seeded.players.admin],
      [seeded.players.admin, seeded.players.alice],
    ];
    for (let day = 2; day <= 25; day++) {
      const [home, away] = pairs[day % pairs.length];
      await addMatch({
        leagueId: seeded.leagueId,
        roundId: seeded.rounds.r2,
        homeId: home,
        awayId: away,
        at: instantOnDay(`2026-11-${String(day).padStart(2, "0")}`, "18:00"),
      });
    }

    await renderCalendario("2026-11");

    expect(counts.League).toBe(1);
    expect(counts.Round).toBe(1);
    expect(counts.Match).toBe(2);
    expect(totalQueries()).toBe(4);
  });
});
