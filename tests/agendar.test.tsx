// @vitest-environment jsdom
//
// t03 · `agendar` — el selector del día (§4.5) y los límites del formulario de
// fecha (§4.7, §4.9). Cierra los criterios 13, 14, 15, 16, 17, 22, 33 y la
// mitad de UI de 29 y de 38.
//
// **Los componentes se montan y se clican de verdad.** Nada de invocar el
// handler a mano: en la PR #1 de este repo cuatro componentes pasaron sus tests
// sin haber estado nunca montados, porque el test verificaba la función y no el
// camino. Por eso AC-15 monta `DayDetail` (el consumidor real) en vez de dar
// por hecho el montaje.
//
// **t07 (`selector-navegable`)** añade aquí la forma de la lista —agrupada por
// ronda y filtrable por nombre— que salió del feedback de la revisión. Es
// forma, no elegibilidad: §9.2 dejó abierta la forma del selector y esos tests
// afirman el agrupado, el buscador y su umbral, nunca quién es candidata.
//
// **La elegibilidad no se reimplementa aquí**: los candidatos que recibe el
// selector salen de `eligibleForDay` (src/server/result-logic.ts), igual que
// saldrán en producción. Los tests de 13, 17 y 33 comprueban por tanto el
// camino completo regla → props → pantalla, no la regla sola (eso ya lo hace
// tests/calendar.test.ts).

import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// `setMatchSchedule` es un server action ("use server" + Prisma): en un test de
// montaje se dobla. Lo que aquí se verifica es que el selector lo llama con el
// instante correcto; que lo *acepte* o no es de t01 (tests/guardas-fecha).
const setMatchSchedule = vi.fn();
vi.mock("@/server/match-actions", () => ({
  setMatchSchedule: (...args: unknown[]) => setMatchSchedule(...args),
}));

import { DaySchedulePicker } from "@/app/calendario/DaySchedulePicker";
import { DayDetail } from "@/app/calendario/DayDetail";
import { MatchRow } from "@/app/calendario/MatchRow";
import { ScheduleForm } from "@/components/ScheduleForm";
import {
  dayKeyOf,
  dayLabel,
  instantOnDay,
  scheduleBounds,
  type MonthKey,
  type RoundRef,
  type SchedulableMatch,
} from "@/server/calendar";
import { eligibleForDay, type EligibilityInput } from "@/server/result-logic";
import {
  FIXTURE_DEADLINES,
  FIXTURE_ON_DEADLINE_DAY_AT,
  FIXTURE_PLAYED_AT,
  FIXTURE_PLAYOFF_AT,
  FIXTURE_START_MONTH,
  makeCalendarMatch,
  makeSchedulableMatch,
} from "./helpers/calendario";

// ---------------------------------------------------------------------------
// El catálogo de partidas: la fixture compartida, proyectada en las dos formas
// que necesita el selector (la de la regla y la de la pantalla).
// ---------------------------------------------------------------------------

const ALICE = "p-alice";
const BOB = "p-bob";
const CAROL = "p-carol";

/** Las tres rondas de la fixture: la 1 cerrada, la 2 y la 3 abiertas. */
const ROUNDS: RoundRef[] = [
  {
    index: 1,
    deadline: FIXTURE_DEADLINES.r1,
    closedAt: new Date(Date.UTC(2026, 10, 1)),
  },
  { index: 2, deadline: FIXTURE_DEADLINES.r2, closedAt: null },
  { index: 3, deadline: FIXTURE_DEADLINES.r3, closedAt: null },
];

const OCTOBER: MonthKey = { year: 2026, month: 10 }; // ronda 1, cerrada
const NOVEMBER: MonthKey = { year: 2026, month: 11 }; // ronda 2, abierta
const DECEMBER: MonthKey = { year: 2026, month: 12 }; // ronda 3, abierta

interface CatalogueEntry {
  rule: EligibilityInput;
  view: SchedulableMatch;
}

/**
 * Cinco partidas que cubren las cinco situaciones que el selector distingue:
 * ronda cerrada, ronda del mes, partida ajena, ronda posterior ya agendada, y
 * playoff sin ronda. Cada pareja de nombres es única para poder buscarla en
 * pantalla sin ambigüedad.
 */
const CATALOGUE: CatalogueEntry[] = [
  {
    // Ronda 1 (CERRADA) · de Alice · con fecha. §4.14, criterio 33.
    rule: {
      id: "m-r1",
      playerHomeId: ALICE,
      playerAwayId: BOB,
      roundIndex: 1,
      roundClosedAt: ROUNDS[0].closedAt,
    },
    view: makeSchedulableMatch({
      id: "m-r1",
      playerHomeName: "Alice",
      playerAwayName: "Bob",
      roundIndex: 1,
      scheduledAt: FIXTURE_PLAYED_AT.toISOString(),
    }),
  },
  {
    // Ronda 2 (abierta) · de Alice · sin fecha.
    rule: {
      id: "m-r2-mia",
      playerHomeId: ALICE,
      playerAwayId: CAROL,
      roundIndex: 2,
      roundClosedAt: null,
    },
    view: makeSchedulableMatch({
      id: "m-r2-mia",
      playerHomeName: "Alice",
      playerAwayName: "Carol",
      roundIndex: 2,
      scheduledAt: null,
    }),
  },
  {
    // Ronda 2 (abierta) · NO es de Alice. Solo el admin la ve (criterio 17).
    rule: {
      id: "m-r2-ajena",
      playerHomeId: BOB,
      playerAwayId: CAROL,
      roundIndex: 2,
      roundClosedAt: null,
    },
    view: makeSchedulableMatch({
      id: "m-r2-ajena",
      playerHomeName: "Bob",
      playerAwayName: "Carol",
      roundIndex: 2,
      scheduledAt: null,
    }),
  },
  {
    // Ronda 3 (abierta, posterior) · de Alice · YA AGENDADA el 31 de diciembre.
    // Es la partida que el criterio 14 mueve.
    rule: {
      id: "m-r3-agendada",
      playerHomeId: ALICE,
      playerAwayId: "p-dana",
      roundIndex: 3,
      roundClosedAt: null,
    },
    view: makeSchedulableMatch({
      id: "m-r3-agendada",
      playerHomeName: "Alice",
      playerAwayName: "Dana",
      roundIndex: 3,
      scheduledAt: FIXTURE_ON_DEADLINE_DAY_AT.toISOString(),
    }),
  },
  {
    // Playoff (sin ronda, §4.11) · de Alice · agendada en enero.
    rule: {
      id: "m-playoff",
      playerHomeId: ALICE,
      playerAwayId: "p-erin",
      roundIndex: null,
      roundClosedAt: null,
    },
    view: makeSchedulableMatch({
      id: "m-playoff",
      playerHomeName: "Alice",
      playerAwayName: "Erin",
      roundIndex: null,
      scheduledAt: FIXTURE_PLAYOFF_AT.toISOString(),
    }),
  },
];

const VIEW_BY_ID = new Map(CATALOGUE.map((e) => [e.view.id, e.view]));

/**
 * Lo que el servidor le pasaría al selector para ese día: `eligibleForDay`
 * aplicado al catálogo y proyectado sobre los view models. Consumir la regla en
 * vez de reescribirla es el encargo de t03.
 */
function candidatesFor(
  month: MonthKey,
  who: { playerId: string | null; isAdmin: boolean }
): SchedulableMatch[] {
  const ids = eligibleForDay(
    CATALOGUE.map((e) => e.rule),
    { month, rounds: ROUNDS, playerId: who.playerId, isAdmin: who.isAdmin }
  );
  return ids.map((id) => VIEW_BY_ID.get(id)!);
}

const ALICE_SESSION = { playerId: ALICE, isAdmin: false };
const ADMIN_SESSION = { playerId: null, isAdmin: true };

/** Abre el selector (paso 1: la lista de candidatas). */
async function openPicker(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: /Agendar aquí/i }));
}

/** Los nombres accesibles de las filas de la lista de candidatas. */
function candidateNames(): string[] {
  const list = screen.getByRole("list");
  return within(list)
    .getAllByRole("button")
    .map((b) => b.textContent ?? "");
}

/**
 * La lista tal y como se lee de arriba abajo: las cabeceras de grupo y las
 * filas intercaladas, en el orden en que están en el DOM. Es lo que permite
 * afirmar el orden *entre* grupos y *dentro* de cada grupo con una sola lista.
 */
function listOutline(): string[] {
  const list = screen.getByRole("list");
  return Array.from(list.children).map((li) => {
    const button = li.querySelector("button");
    if (button === null) return li.textContent ?? "";
    // "Alice vs Carol" — el título, sin la segunda línea de la fecha.
    return button.firstElementChild?.textContent ?? "";
  });
}

/** El campo de búsqueda, o `null` si el selector no lo ofrece. */
function searchBox(): HTMLElement | null {
  return screen.queryByLabelText("Buscar jugador");
}

beforeEach(() => {
  setMatchSchedule.mockReset();
  setMatchSchedule.mockResolvedValue({ ok: true, data: undefined });
});

// ---------------------------------------------------------------------------
// Criterio 13
// ---------------------------------------------------------------------------

describe("AC-13: el selector ofrece la ronda del mes y las posteriores, con su fecha actual, nunca las anteriores", () => {
  it("en un día de noviembre (ronda 2) Alice ve la 2, la 3 y el playoff", async () => {
    const user = userEvent.setup();
    render(
      <DaySchedulePicker
        dayKey="2026-11-14"
        dayLabel={dayLabel("2026-11-14")}
        candidates={candidatesFor(NOVEMBER, ALICE_SESSION)}
      />
    );

    await openPicker(user);

    const names = candidateNames();
    expect(names.join(" | ")).toMatch(/Alice vs Carol/); // ronda 2, la del mes
    expect(names.join(" | ")).toMatch(/Alice vs Dana/); // ronda 3, posterior
    expect(names.join(" | ")).toMatch(/Alice vs Erin/); // playoff, sin ronda
    expect(names).toHaveLength(3);
  });

  it("la partida que ya tiene fecha la muestra, para que elegirla se lea como moverla (§4.5)", async () => {
    const user = userEvent.setup();
    render(
      <DaySchedulePicker
        dayKey="2026-11-14"
        dayLabel={dayLabel("2026-11-14")}
        candidates={candidatesFor(NOVEMBER, ALICE_SESSION)}
      />
    );

    await openPicker(user);

    const row = screen.getByRole("button", { name: /Alice vs Dana/ });
    // 31 dic 2026 a las 20:00 hora española, leída en Europe/Madrid (§4.12).
    expect(row.textContent).toContain("Jueves 31 de diciembre");
    expect(row.textContent).toContain("20:00");

    // Y la que no tiene fecha lo dice.
    const pending = screen.getByRole("button", { name: /Alice vs Carol/ });
    expect(pending.textContent).toContain("Sin fecha");
  });

  it("en un día de diciembre (ronda 3) no ofrece la partida de la ronda 2, que es anterior", async () => {
    const user = userEvent.setup();
    render(
      <DaySchedulePicker
        dayKey="2026-12-05"
        dayLabel={dayLabel("2026-12-05")}
        candidates={candidatesFor(DECEMBER, ALICE_SESSION)}
      />
    );

    await openPicker(user);

    const names = candidateNames().join(" | ");
    expect(names).toMatch(/Alice vs Dana/);
    expect(names).toMatch(/Alice vs Erin/);
    // La ronda 2 está abierta y es de Alice, pero es anterior: retrasar no.
    expect(names).not.toMatch(/Alice vs Carol/);
  });
});

// ---------------------------------------------------------------------------
// Criterio 14
// ---------------------------------------------------------------------------

describe("AC-14: elegir una partida que ya tenía fecha la mueve a ese día", () => {
  it("pide la hora y llama a setMatchSchedule con ese día en Europe/Madrid", async () => {
    const user = userEvent.setup();
    const onScheduled = vi.fn();
    render(
      <DaySchedulePicker
        dayKey="2026-11-14"
        dayLabel={dayLabel("2026-11-14")}
        candidates={candidatesFor(NOVEMBER, ALICE_SESSION)}
        onScheduled={onScheduled}
      />
    );

    await openPicker(user);
    await user.click(screen.getByRole("button", { name: /Alice vs Dana/ }));

    // Paso 2: la hora (§4.5, "se le fija ese día y se pide la hora").
    const timeInput = screen.getByLabelText("Hora");
    expect(timeInput).toHaveProperty("type", "time");
    await user.clear(timeInput);
    await user.type(timeInput, "18:30");

    await user.click(screen.getByRole("button", { name: /^Agendar aquí$/ }));

    await waitFor(() => expect(setMatchSchedule).toHaveBeenCalledTimes(1));

    const [matchId, payload] = setMatchSchedule.mock.calls[0] as [
      string,
      { scheduledAt: string },
    ];
    expect(matchId).toBe("m-r3-agendada");
    expect(payload.scheduledAt).toBe(
      instantOnDay("2026-11-14", "18:30").toISOString()
    );
    // El instante cae en el día de destino leído en Europe/Madrid, no en el del
    // navegador: el test vale igual bajo TZ=UTC que bajo America/New_York.
    expect(dayKeyOf(new Date(payload.scheduledAt))).toBe("2026-11-14");
    // No se envía `location`: mover una partida no borra dónde se jugaba (§5.6).
    expect(payload).not.toHaveProperty("location");

    await waitFor(() => expect(onScheduled).toHaveBeenCalledTimes(1));
  });

  it("si el servidor rechaza, enseña su mensaje y no cierra el selector", async () => {
    const user = userEvent.setup();
    setMatchSchedule.mockResolvedValue({
      ok: false,
      error: "Esta partida es de la ronda 2, que cierra el 30 de noviembre.",
    });

    render(
      <DaySchedulePicker
        dayKey="2026-11-14"
        dayLabel={dayLabel("2026-11-14")}
        candidates={candidatesFor(NOVEMBER, ALICE_SESSION)}
      />
    );

    await openPicker(user);
    await user.click(screen.getByRole("button", { name: /Alice vs Carol/ }));
    await user.click(screen.getByRole("button", { name: /^Agendar aquí$/ }));

    expect(await screen.findByRole("alert")).toHaveProperty(
      "textContent",
      "Esta partida es de la ronda 2, que cierra el 30 de noviembre."
    );
  });
});

// ---------------------------------------------------------------------------
// Criterio 15
// ---------------------------------------------------------------------------

describe("AC-15: el selector está en el día vacío y también al pie del detalle de un día con partidas", () => {
  it("un día vacío (solo el selector) lo ofrece", () => {
    render(
      <DaySchedulePicker
        dayKey="2026-11-18"
        dayLabel={dayLabel("2026-11-18")}
        candidates={candidatesFor(NOVEMBER, ALICE_SESSION)}
      />
    );

    expect(screen.getByRole("button", { name: /Agendar aquí/i })).toBeTruthy();
  });

  it("un día con partidas lo ofrece igual, montado por DayDetail", () => {
    // Se monta el consumidor real, no el selector suelto: es el eslabón que
    // este repo ha dejado suelto antes (PLAN.md t05).
    render(
      <DayDetail
        dayKey="2026-11-14"
        dayLabel={dayLabel("2026-11-14")}
        matches={[makeCalendarMatch({ id: "m-dia", isMine: true })]}
        schedulable={candidatesFor(NOVEMBER, ALICE_SESSION)}
      />
    );

    expect(screen.getByRole("button", { name: /Agendar aquí/i })).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Criterio 16
// ---------------------------------------------------------------------------

describe("AC-16: un día sin ninguna partida agendable no abre selector", () => {
  it("sin candidatas no pinta nada, ni siquiera el disparador", () => {
    const { container } = render(
      <DaySchedulePicker
        dayKey="2026-11-14"
        dayLabel={dayLabel("2026-11-14")}
        candidates={[]}
      />
    );

    expect(container.innerHTML).toBe("");
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("una sesión sin partidas propias en ese mes se queda sin selector (§4.5)", () => {
    // Carol solo juega la ronda 2, y en diciembre esa ronda ya es anterior.
    const candidates = candidatesFor(DECEMBER, {
      playerId: CAROL,
      isAdmin: false,
    });
    expect(candidates).toHaveLength(0);

    const { container } = render(
      <DaySchedulePicker
        dayKey="2026-12-05"
        dayLabel={dayLabel("2026-12-05")}
        candidates={candidates}
      />
    );

    expect(container.innerHTML).toBe("");
  });
});

// ---------------------------------------------------------------------------
// Criterio 17
// ---------------------------------------------------------------------------

describe("AC-17: el selector de un admin ofrece partidas de cualquier ronda", () => {
  it("en noviembre le ofrece las cinco, incluidas la ronda 1 cerrada y las ajenas", async () => {
    const user = userEvent.setup();
    render(
      <DaySchedulePicker
        dayKey="2026-11-14"
        dayLabel={dayLabel("2026-11-14")}
        candidates={candidatesFor(NOVEMBER, ADMIN_SESSION)}
      />
    );

    await openPicker(user);

    const names = candidateNames().join(" | ");
    expect(names).toMatch(/Alice vs Bob/); // ronda 1, anterior y CERRADA
    expect(names).toMatch(/Alice vs Carol/); // ronda 2
    expect(names).toMatch(/Bob vs Carol/); // ronda 2, ajena (§5.11)
    expect(names).toMatch(/Alice vs Dana/); // ronda 3
    expect(names).toMatch(/Alice vs Erin/); // playoff
    expect(candidateNames()).toHaveLength(5);
  });
});

// ---------------------------------------------------------------------------
// Criterio 33
// ---------------------------------------------------------------------------

describe("AC-33: a un jugador no se le ofrecen partidas de rondas cerradas", () => {
  it("en octubre (ronda 1, cerrada) Alice no ve su partida de esa ronda", async () => {
    const user = userEvent.setup();
    render(
      <DaySchedulePicker
        dayKey="2026-10-17"
        dayLabel={dayLabel("2026-10-17")}
        candidates={candidatesFor(OCTOBER, ALICE_SESSION)}
      />
    );

    await openPicker(user);

    const names = candidateNames().join(" | ");
    expect(names).not.toMatch(/Alice vs Bob/); // ronda 1, cerrada
    // Ni la fila ni la cabecera de grupo: la ronda 1 no existe en esta lista.
    expect(screen.getByTestId("day-schedule-picker").textContent).not.toMatch(
      /Ronda 1/
    );
    // Las abiertas de esa ronda en adelante sí siguen estando.
    expect(names).toMatch(/Alice vs Carol/);
  });

  it("el admin sí la ve el mismo día (§4.14)", async () => {
    const user = userEvent.setup();
    render(
      <DaySchedulePicker
        dayKey="2026-10-17"
        dayLabel={dayLabel("2026-10-17")}
        candidates={candidatesFor(OCTOBER, ADMIN_SESSION)}
      />
    );

    await openPicker(user);
    expect(candidateNames().join(" | ")).toMatch(/Alice vs Bob/);
  });
});

// ---------------------------------------------------------------------------
// t07 · el selector navegable (feedback de HUMAN_REVIEW, §9.2)
// ---------------------------------------------------------------------------

/**
 * Ocho candidatas, **construidas a mano y a propósito**: aquí no se prueba la
 * elegibilidad —eso es `candidatesFor`, arriba— sino la forma de la lista, y
 * para eso hacen falta más candidatas de las que la fixture de cinco da. El
 * orden de llegada está mezclado (ronda 3, sin ronda, 2, 2, 3, 2, 4, 3) para
 * que el agrupado tenga algo que ordenar y algo que conservar. `Martín` e
 * `Íñigo` llevan acento porque es el caso real del grupo.
 */
const MANY: SchedulableMatch[] = [
  makeSchedulableMatch({
    id: "g-1",
    playerHomeName: "Martín",
    playerAwayName: "Zoe",
    roundIndex: 3,
  }),
  makeSchedulableMatch({
    id: "g-2",
    playerHomeName: "Íñigo",
    playerAwayName: "Bruno",
    roundIndex: null,
  }),
  makeSchedulableMatch({
    id: "g-3",
    playerHomeName: "Alice",
    playerAwayName: "Carol",
    roundIndex: 2,
  }),
  makeSchedulableMatch({
    id: "g-4",
    playerHomeName: "Bob",
    playerAwayName: "Dana",
    roundIndex: 2,
  }),
  makeSchedulableMatch({
    id: "g-5",
    playerHomeName: "Erin",
    playerAwayName: "Frank",
    roundIndex: 3,
  }),
  makeSchedulableMatch({
    id: "g-6",
    playerHomeName: "Gus",
    playerAwayName: "Hana",
    roundIndex: 2,
  }),
  makeSchedulableMatch({
    id: "g-7",
    playerHomeName: "Iris",
    playerAwayName: "Jon",
    roundIndex: 4,
  }),
  makeSchedulableMatch({
    id: "g-8",
    playerHomeName: "Kim",
    playerAwayName: "Martina",
    roundIndex: 3,
  }),
];

function renderPicker(candidates: SchedulableMatch[]) {
  return render(
    <DaySchedulePicker
      dayKey="2026-11-14"
      dayLabel={dayLabel("2026-11-14")}
      candidates={candidates}
    />
  );
}

describe("t07: las candidatas salen agrupadas por ronda, en orden ascendente y con las de sin ronda al final", () => {
  it("cabecera por grupo, rondas de menor a mayor y «Sin ronda» al final", async () => {
    const user = userEvent.setup();
    renderPicker(MANY);
    await openPicker(user);

    expect(
      screen.getAllByTestId("candidate-group").map((h) => h.textContent)
    ).toEqual(["Ronda 2", "Ronda 3", "Ronda 4", "Sin ronda"]);
  });

  it("dentro de cada grupo conserva el orden en que llegan, que lo decide eligibleForDay", async () => {
    const user = userEvent.setup();
    renderPicker(MANY);
    await openPicker(user);

    // La ronda 2 llegó como Alice, Bob, Gus; la 3 como Martín, Erin, Kim.
    // Ni se reordena por nombre ni por id: se agrupa y se deja estar.
    expect(listOutline()).toEqual([
      "Ronda 2",
      "Alice vs Carol",
      "Bob vs Dana",
      "Gus vs Hana",
      "Ronda 3",
      "Martín vs Zoe",
      "Erin vs Frank",
      "Kim vs Martina",
      "Ronda 4",
      "Iris vs Jon",
      "Sin ronda",
      "Íñigo vs Bruno",
    ]);
  });

  it("una partida sin ronda no se cuela en ningún grupo de ronda", async () => {
    const user = userEvent.setup();
    renderPicker(MANY);
    await openPicker(user);

    const outline = listOutline();
    expect(outline.indexOf("Íñigo vs Bruno")).toBe(
      outline.indexOf("Sin ronda") + 1
    );
  });
});

describe("t07: el buscador filtra por cualquiera de los dos jugadores, sin acentos ni mayúsculas", () => {
  it("«martin» encuentra a Martín, y el grupo que se queda vacío no se pinta", async () => {
    const user = userEvent.setup();
    renderPicker(MANY);
    await openPicker(user);

    await user.type(searchBox()!, "martin");

    // Martín (ronda 3) y Martina (ronda 3): las dos llevan "martin" dentro.
    expect(listOutline()).toEqual([
      "Ronda 3",
      "Martín vs Zoe",
      "Kim vs Martina",
    ]);
    // Las rondas 2 y 4 y el grupo sin ronda desaparecen enteros.
    expect(
      screen.getAllByTestId("candidate-group").map((h) => h.textContent)
    ).toEqual(["Ronda 3"]);
  });

  it("busca también por el jugador visitante y da igual cómo se escriba en mayúsculas", async () => {
    const user = userEvent.setup();
    renderPicker(MANY);
    await openPicker(user);

    await user.type(searchBox()!, "ZOE"); // visitante, en mayúsculas
    expect(listOutline()).toEqual(["Ronda 3", "Martín vs Zoe"]);

    await user.clear(searchBox()!);
    await user.type(searchBox()!, "inigo"); // local, con la Í sin acento
    expect(listOutline()).toEqual(["Sin ronda", "Íñigo vs Bruno"]);
  });

  it("borrar lo escrito devuelve las ocho", async () => {
    const user = userEvent.setup();
    renderPicker(MANY);
    await openPicker(user);

    await user.type(searchBox()!, "martin");
    expect(candidateNames()).toHaveLength(2);

    await user.clear(searchBox()!);
    expect(candidateNames()).toHaveLength(8);
  });

  it("filtrar y elegir lleva al paso de la hora igual que sin filtrar (criterio 14)", async () => {
    const user = userEvent.setup();
    renderPicker(MANY);
    await openPicker(user);

    await user.type(searchBox()!, "iris");
    await user.click(screen.getByRole("button", { name: /Iris vs Jon/ }));

    expect(screen.getByLabelText("Hora")).toBeTruthy();
  });
});

describe("t07: el buscador sólo aparece cuando la lista es larga (más de 6 candidatas)", () => {
  it("con 6 no lo pinta: la lista agrupada cabe de un vistazo", async () => {
    const user = userEvent.setup();
    renderPicker(MANY.slice(0, 6));
    await openPicker(user);

    expect(candidateNames()).toHaveLength(6);
    expect(searchBox()).toBeNull();
  });

  it("con 7 sí", async () => {
    const user = userEvent.setup();
    renderPicker(MANY.slice(0, 7));
    await openPicker(user);

    expect(candidateNames()).toHaveLength(7);
    expect(searchBox()).not.toBeNull();
  });

  it("las cinco de la fixture (admin, criterio 17) siguen sin buscador, pero agrupadas", async () => {
    const user = userEvent.setup();
    render(
      <DaySchedulePicker
        dayKey="2026-11-14"
        dayLabel={dayLabel("2026-11-14")}
        candidates={candidatesFor(NOVEMBER, ADMIN_SESSION)}
      />
    );
    await openPicker(user);

    expect(searchBox()).toBeNull();
    expect(
      screen.getAllByTestId("candidate-group").map((h) => h.textContent)
    ).toEqual(["Ronda 1", "Ronda 2", "Ronda 3", "Sin ronda"]);
  });
});

describe("t07: filtrar hasta cero resultados lo dice, no deja la lista en blanco", () => {
  it("enseña un estado vacío con lo buscado y ninguna lista", async () => {
    const user = userEvent.setup();
    renderPicker(MANY);
    await openPicker(user);

    await user.type(searchBox()!, "nadie");

    const empty = screen.getByTestId("candidates-empty");
    expect(empty.textContent).toContain("nadie");
    expect(screen.queryByRole("list")).toBeNull();
    expect(screen.queryAllByTestId("candidate-group")).toHaveLength(0);
    // Y se puede volver atrás: el buscador y el Cancelar siguen ahí.
    expect(searchBox()).not.toBeNull();
    expect(screen.getByRole("button", { name: /Cancelar/i })).toBeTruthy();
  });

  it("borrar la búsqueda recupera la lista", async () => {
    const user = userEvent.setup();
    renderPicker(MANY);
    await openPicker(user);

    await user.type(searchBox()!, "nadie");
    expect(screen.queryByTestId("candidates-empty")).not.toBeNull();

    await user.clear(searchBox()!);
    expect(screen.queryByTestId("candidates-empty")).toBeNull();
    expect(candidateNames()).toHaveLength(8);
  });
});

// ---------------------------------------------------------------------------
// Criterio 22 — min/max del datetime-local
// ---------------------------------------------------------------------------

/**
 * La misma aritmética que `ScheduleForm`, escrita aparte a propósito: el
 * `datetime-local` habla **hora local del navegador**, así que el test formatea
 * con `getFullYear`/`getHours` igual que el componente. Si alguien "arreglara"
 * el componente formateando en `Europe/Madrid`, este test lo caza bajo `TZ=UTC`.
 */
function toLocalInputValue(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

describe("AC-22: el datetime-local lleva min y max coherentes con los dos extremos (§4.7)", () => {
  it("una partida de ronda toma el suelo de la liga y el techo de su ronda", () => {
    render(
      <ScheduleForm
        matchId="m-r2-mia"
        currentScheduledAt={null}
        currentLocation={null}
        leagueStartMonth={FIXTURE_START_MONTH.toISOString()}
        roundDeadline={FIXTURE_DEADLINES.r3.toISOString()}
      />
    );

    const input = screen.getByLabelText("Fecha y hora") as HTMLInputElement;
    const bounds = scheduleBounds(FIXTURE_START_MONTH, FIXTURE_DEADLINES.r3);

    expect(input.getAttribute("min")).toBe(toLocalInputValue(bounds.min!));
    expect(input.getAttribute("max")).toBe(toLocalInputValue(bounds.max!));
  });

  it("el techo es el FINAL del día del cierre, así que el 31 de diciembre a las 20:00 entra (§9.5)", () => {
    render(
      <ScheduleForm
        matchId="m-deadline-day"
        currentScheduledAt={FIXTURE_ON_DEADLINE_DAY_AT.toISOString()}
        currentLocation={null}
        leagueStartMonth={FIXTURE_START_MONTH.toISOString()}
        roundDeadline={FIXTURE_DEADLINES.r3.toISOString()}
      />
    );

    const input = screen.getByLabelText("Fecha y hora") as HTMLInputElement;
    const max = input.getAttribute("max")!;
    const value = input.value;

    // Las cadenas de datetime-local se ordenan lexicográficamente igual que
    // los instantes que representan (ambas en hora local del navegador).
    expect(value).toBe(toLocalInputValue(FIXTURE_ON_DEADLINE_DAY_AT));
    expect(value <= max).toBe(true);
    expect(input.getAttribute("min")!).toBeTruthy();
    expect(value >= input.getAttribute("min")!).toBe(true);
  });

  it("una partida sin ronda (playoff, §4.11) no lleva max, pero sí min", () => {
    render(
      <ScheduleForm
        matchId="m-playoff"
        currentScheduledAt={null}
        currentLocation={null}
        leagueStartMonth={FIXTURE_START_MONTH.toISOString()}
        roundDeadline={null}
      />
    );

    const input = screen.getByLabelText("Fecha y hora") as HTMLInputElement;
    expect(input.getAttribute("max")).toBeNull();
    expect(input.getAttribute("min")).toBe(
      toLocalInputValue(scheduleBounds(FIXTURE_START_MONTH, null).min!)
    );
  });

  it("una liga sin startMonth no lleva ninguno de los dos", () => {
    render(
      <ScheduleForm
        matchId="m-sin-liga"
        currentScheduledAt={null}
        currentLocation={null}
      />
    );

    const input = screen.getByLabelText("Fecha y hora") as HTMLInputElement;
    expect(input.getAttribute("min")).toBeNull();
    expect(input.getAttribute("max")).toBeNull();
  });
});

/**
 * Los cuatro tests de arriba le pasan las cotas al formulario **a mano**, que
 * es exactamente lo que dejó el criterio 22 «probado pero no vivo»: hasta t05
 * ningún call site de `src/` se las pasaba, así que en producción eran siempre
 * `undefined`. Estos montan el consumidor real del calendario —`MatchRow`— y
 * clican su botón «Fecha», que es el único camino por el que ese formulario
 * aparece en pantalla. La otra mitad (la página entera, con las cotas salidas
 * de la base de datos) está en tests/montaje.test.tsx.
 */
describe("AC-22 (vivo): MatchRow le pasa las cotas al formulario que monta", () => {
  async function openScheduleForm(
    match: Parameters<typeof makeCalendarMatch>[0]
  ): Promise<HTMLInputElement> {
    const user = userEvent.setup();
    render(<MatchRow match={makeCalendarMatch(match)} />);
    await user.click(screen.getByRole("button", { name: /Fecha/i }));
    return screen.getByLabelText("Fecha y hora") as HTMLInputElement;
  }

  it("una partida de ronda llega al input con min y max, no con undefined", async () => {
    const input = await openScheduleForm({
      roundIndex: 3,
      roundDeadline: FIXTURE_DEADLINES.r3.toISOString(),
      leagueStartMonth: FIXTURE_START_MONTH.toISOString(),
    });

    const bounds = scheduleBounds(FIXTURE_START_MONTH, FIXTURE_DEADLINES.r3);
    expect(input.getAttribute("min")).toBe(toLocalInputValue(bounds.min!));
    expect(input.getAttribute("max")).toBe(toLocalInputValue(bounds.max!));
  });

  it("una partida de playoff llega con suelo pero sin techo (§4.11)", async () => {
    const input = await openScheduleForm({
      phase: "PLAYOFF",
      roundIndex: null,
      roundDeadline: null,
      leagueStartMonth: FIXTURE_START_MONTH.toISOString(),
    });

    expect(input.getAttribute("max")).toBeNull();
    expect(input.getAttribute("min")).toBe(
      toLocalInputValue(scheduleBounds(FIXTURE_START_MONTH, null).min!)
    );
  });

  it("una partida de liga sin ronda (§5.2) tampoco lleva techo", async () => {
    const input = await openScheduleForm({
      roundIndex: null,
      roundDeadline: null,
      leagueStartMonth: FIXTURE_START_MONTH.toISOString(),
    });

    expect(input.getAttribute("max")).toBeNull();
    expect(input.getAttribute("min")).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Criterio 29 (mitad de UI)
// ---------------------------------------------------------------------------

describe("AC-29 (UI): con resolution = PLAYED el botón «Limpiar fecha» no se pinta (§4.9)", () => {
  const withResolution = (resolution: string | null) =>
    render(
      <ScheduleForm
        matchId="m-1"
        currentScheduledAt={FIXTURE_PLAYED_AT.toISOString()}
        currentLocation="Warlotus"
        resolution={resolution}
      />
    );

  it("PLAYED: no hay botón de limpiar, pero sí de guardar (cambiarla sigue permitido)", () => {
    withResolution("PLAYED");
    expect(screen.queryByRole("button", { name: /Limpiar fecha/i })).toBeNull();
    expect(screen.getByRole("button", { name: /Guardar fecha/i })).toBeTruthy();
  });

  it("sin Result, WALKOVER y UNPLAYED_DRAW conservan el botón (criterio 30)", () => {
    for (const resolution of [null, "WALKOVER", "UNPLAYED_DRAW"]) {
      const { unmount } = withResolution(resolution);
      expect(
        screen.getByRole("button", { name: /Limpiar fecha/i })
      ).toBeTruthy();
      unmount();
    }
  });

  it("sin fecha no hay nada que limpiar, con o sin resultado", () => {
    render(
      <ScheduleForm
        matchId="m-1"
        currentScheduledAt={null}
        currentLocation={null}
        resolution={null}
      />
    );
    expect(screen.queryByRole("button", { name: /Limpiar fecha/i })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Criterio 38 (mitad de UI: el selector y el formulario)
// ---------------------------------------------------------------------------

/**
 * jsdom no maquetea, así que «cabe en 390px» no se puede medir aquí: lo que se
 * comprueba son las causas de desbordamiento horizontal que sí son estáticas —
 * anchos fijos mayores que el viewport, contenedores con scroll horizontal
 * propio (§7: el que scrollea es el documento) y texto largo que no puede
 * partirse. La medida de verdad es de t05/e2e.
 */
function overflowRisks(root: HTMLElement): string[] {
  const risks: string[] = [];
  const all = [root, ...Array.from(root.querySelectorAll<HTMLElement>("*"))];
  for (const el of all) {
    const cls = el.getAttribute("class") ?? "";
    const style = el.getAttribute("style") ?? "";
    if (/overflow-x-(auto|scroll)/.test(cls)) {
      risks.push(`scroll horizontal propio: ${cls}`);
    }
    for (const m of cls.matchAll(/\b(?:min-)?w-\[(\d+)px\]/g)) {
      if (Number(m[1]) > 390) risks.push(`ancho fijo ${m[0]}`);
    }
    for (const m of style.matchAll(/\b(?:min-)?width:\s*(\d+)px/g)) {
      if (Number(m[1]) > 390) risks.push(`ancho fijo ${m[0]}`);
    }
  }
  return risks;
}

describe("AC-38 (UI): el selector y el formulario de fecha caben en 390px y son tocables", () => {
  it("la lista de candidatas apila en vertical, sin anchos fijos ni scroll horizontal", async () => {
    const user = userEvent.setup();
    const { container } = render(
      <DaySchedulePicker
        dayKey="2026-11-14"
        dayLabel={dayLabel("2026-11-14")}
        candidates={candidatesFor(NOVEMBER, ADMIN_SESSION)}
      />
    );

    await openPicker(user);

    expect(overflowRisks(container)).toEqual([]);
    expect(screen.getByRole("list").getAttribute("class")).toMatch(/flex-col/);
  });

  it("cada fila de la lista es un objetivo táctil de 44px y su texto largo puede partirse", async () => {
    const user = userEvent.setup();
    render(
      <DaySchedulePicker
        dayKey="2026-11-14"
        dayLabel={dayLabel("2026-11-14")}
        candidates={candidatesFor(NOVEMBER, ALICE_SESSION)}
      />
    );

    await openPicker(user);

    const rows = within(screen.getByRole("list")).getAllByRole("button");
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      const cls = row.getAttribute("class") ?? "";
      expect(cls).toMatch(/min-h-\[44px\]/);
      expect(cls).not.toMatch(/whitespace-nowrap/);
    }

    // "Ahora: Jueves 31 de diciembre · 20:00 — se mueve aquí" es la cadena más
    // larga de la pantalla: tiene que poder romperse.
    const longest = screen.getByRole("button", { name: /Alice vs Dana/ });
    const wrappable = longest.querySelector(".break-words");
    expect(wrappable).not.toBeNull();
  });

  it("la lista agrupada y su buscador tampoco desbordan ni scrollean por su cuenta (t07)", async () => {
    const user = userEvent.setup();
    const { container } = renderPicker(MANY);

    await openPicker(user);
    expect(searchBox()).not.toBeNull();
    expect(screen.getAllByTestId("candidate-group").length).toBeGreaterThan(1);

    // §7: el que scrollea es el documento, no el selector — ni siquiera con
    // ocho candidatas y cuatro cabeceras dentro.
    expect(overflowRisks(container)).toEqual([]);
    expect(container.innerHTML).not.toMatch(/overflow-y-(auto|scroll)/);
    expect(container.innerHTML).not.toMatch(/max-h-\[/);
  });

  it("el paso de la hora tampoco introduce anchos fijos", async () => {
    const user = userEvent.setup();
    const { container } = render(
      <DaySchedulePicker
        dayKey="2026-11-14"
        dayLabel={dayLabel("2026-11-14")}
        candidates={candidatesFor(NOVEMBER, ALICE_SESSION)}
      />
    );

    await openPicker(user);
    await user.click(screen.getByRole("button", { name: /Alice vs Carol/ }));

    expect(screen.getByLabelText("Hora")).toBeTruthy();
    expect(overflowRisks(container)).toEqual([]);
  });

  it("el formulario de fecha con min/max sigue sin anchos fijos", () => {
    const { container } = render(
      <ScheduleForm
        matchId="m-r2-mia"
        currentScheduledAt={FIXTURE_ON_DEADLINE_DAY_AT.toISOString()}
        currentLocation="Warlotus"
        leagueStartMonth={FIXTURE_START_MONTH.toISOString()}
        roundDeadline={FIXTURE_DEADLINES.r3.toISOString()}
        resolution="PLAYED"
      />
    );

    expect(overflowRisks(container)).toEqual([]);
  });
});
