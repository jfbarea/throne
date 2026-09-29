// @vitest-environment jsdom
//
// t01 (`navegador`) · plan/partidas-por-jornada/PLAN.md, CA-8 a CA-18.
//
// MatchCard's three forms reach for real server actions; doubled the same
// way as tests/periferia.test.tsx.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/components/ScheduleForm", () => ({
  ScheduleForm: () => null,
}));
vi.mock("@/app/mis-partidas/ReportForm", () => ({
  ReportForm: () => null,
}));
vi.mock("@/app/mis-partidas/WalkoverForm", () => ({
  WalkoverForm: () => null,
}));

import { PartidasBrowser } from "@/app/mis-partidas/PartidasBrowser";
import {
  LABELS,
  TEST_IDS,
  blockTestId,
  blockToggleTestId,
  statusFilterOptionTestId,
  type BrowserBlock,
  type PartidasBrowserProps,
} from "@/app/mis-partidas/browser-contract";
import type { MatchCardMatch } from "@/app/mis-partidas/MatchCard";

const PLAYED_RESULT: MatchCardMatch["result"] = {
  homeVP: 80,
  awayVP: 20,
  outcome: "HOME_WIN",
  reportedById: "p-home",
  bonusHome: 0,
  bonusAway: 0,
  resolution: "PLAYED",
};

function makeMatch(
  id: string,
  homeName: string,
  awayName: string | null,
  opts: { played?: boolean } = {}
): MatchCardMatch {
  return {
    id,
    playerHomeId: `p-${homeName}`,
    playerAwayId: awayName ? `p-${awayName}` : null,
    playerHomeName: homeName,
    playerAwayName: awayName,
    scheduledAt: null,
    location: null,
    status: opts.played ? "REPORTED" : "SCHEDULED",
    roundDeadline: null,
    leagueStartMonth: null,
    result: opts.played ? PLAYED_RESULT : null,
  };
}

function makeBlock(
  key: string,
  kind: BrowserBlock["kind"],
  title: string,
  matches: MatchCardMatch[],
  subtitle = "subtítulo"
): BrowserBlock {
  return { key, kind, title, subtitle, matches };
}

function renderBrowser(props: Partial<PartidasBrowserProps> = {}) {
  const defaults: PartidasBrowserProps = {
    blocks: [],
    currentBlockKey: null,
    currentPlayerId: "p-me",
    isAdmin: false,
    vista: "MIAS",
    scope: "PLAYER",
  };
  return render(<PartidasBrowser {...defaults} {...props} />);
}

function isOpen(key: string): boolean {
  return screen.getByTestId(blockTestId(key)).hasAttribute("open");
}

async function toggle(user: ReturnType<typeof userEvent.setup>, key: string) {
  await user.click(screen.getByTestId(blockToggleTestId(key)));
}

const searchInput = () => screen.getByTestId(TEST_IDS.searchInput) as HTMLInputElement;

beforeEach(() => {
  document.documentElement.style.removeProperty("--app-header-height");
});

describe("CA-8: plegado inicial", () => {
  it("sólo el bloque de la jornada actual sale desplegado; Sin ronda e Historial plegados", () => {
    const blocks = [
      makeBlock("round-1", "ROUND", "Ronda 1", [makeMatch("m1", "Alice", "Bob")]),
      makeBlock("round-2", "ROUND", "Ronda 2", [makeMatch("m2", "Carol", "Dana")]),
      makeBlock("unassigned", "UNASSIGNED", "Sin ronda asignada", [
        makeMatch("m3", "Erin", "Frank"),
      ]),
      makeBlock("legacy", "LEGACY", "Historial", [makeMatch("m4", "Gus", "Hana")]),
    ];
    renderBrowser({ blocks, currentBlockKey: "round-2" });

    expect(isOpen("round-1")).toBe(false);
    expect(isOpen("round-2")).toBe(true);
    expect(isOpen("unassigned")).toBe(false);
    expect(isOpen("legacy")).toBe(false);
  });

  it("si la lista no tiene bloque para la jornada actual, todo sale plegado", () => {
    const blocks = [
      makeBlock("round-1", "ROUND", "Ronda 1", [makeMatch("m1", "Alice", "Bob")]),
    ];
    renderBrowser({ blocks, currentBlockKey: "round-9" });

    expect(isOpen("round-1")).toBe(false);
  });
});

describe("§4.5: la cabecera no dobla el separador cuando el subtítulo está vacío (UNASSIGNED/LEGACY)", () => {
  it("«Sin ronda asignada · 1 partida», sin hueco de subtítulo, con el buscador vacío", () => {
    const blocks = [
      makeBlock(
        "unassigned",
        "UNASSIGNED",
        "Sin ronda asignada",
        [makeMatch("m1", "Alice", "Bob")],
        ""
      ),
    ];
    renderBrowser({ blocks, currentBlockKey: null });

    expect(screen.getByTestId(blockToggleTestId("unassigned")).textContent).toBe(
      "Sin ronda asignada · 1 partida"
    );
  });

  it("«Historial · 1 de 2 partidas», sin hueco de subtítulo, con el buscador activo", async () => {
    const user = userEvent.setup();
    const blocks = [
      makeBlock(
        "legacy",
        "LEGACY",
        "Historial",
        [makeMatch("m1", "Martín", "Bob"), makeMatch("m2", "Carol", "Dana")],
        ""
      ),
    ];
    renderBrowser({ blocks, currentBlockKey: null });

    await user.type(searchInput(), "martin");

    expect(screen.getByTestId(blockToggleTestId("legacy")).textContent).toBe(
      "Historial · 1 de 2 partidas"
    );
  });
});

describe("CA-9: la cabecera pliega y despliega; un bloque plegado no pinta ni deja pulsar sus tarjetas", () => {
  it("un bloque cerrado no muestra sus partidas ni sus botones", () => {
    const blocks = [
      makeBlock("round-1", "ROUND", "Ronda 1", [makeMatch("m1", "Alice", "Bob")]),
    ];
    renderBrowser({ blocks, currentBlockKey: null });

    expect(screen.queryByText("Alice")).toBeNull();
    expect(screen.queryByRole("button", { name: /Apuntar resultado/i })).toBeNull();
  });

  it("pulsar la cabecera despliega, y pulsarla otra vez pliega de nuevo", async () => {
    const user = userEvent.setup();
    const blocks = [
      makeBlock("round-1", "ROUND", "Ronda 1", [makeMatch("m1", "Alice", "Bob")]),
    ];
    renderBrowser({ blocks, currentBlockKey: null });

    await toggle(user, "round-1");
    expect(isOpen("round-1")).toBe(true);
    expect(screen.getByText("Alice")).toBeTruthy();

    await toggle(user, "round-1");
    expect(isOpen("round-1")).toBe(false);
    expect(screen.queryByText("Alice")).toBeNull();
  });
});

describe("CA-10: el plegado a mano se conserva tras una revalidación", () => {
  it("una revalidación (nuevas props, mismas keys) no cierra el bloque abierto a mano", async () => {
    const user = userEvent.setup();
    const blocks = [
      makeBlock("round-1", "ROUND", "Ronda 1", [makeMatch("m1", "Alice", "Bob")]),
    ];
    const { rerender } = renderBrowser({ blocks, currentBlockKey: null });

    await toggle(user, "round-1");
    expect(isOpen("round-1")).toBe(true);

    const revalidated = [
      makeBlock("round-1", "ROUND", "Ronda 1", [
        makeMatch("m1", "Alice", "Bob", { played: true }),
      ]),
    ];
    rerender(
      <PartidasBrowser
        blocks={revalidated}
        currentBlockKey={null}
        currentPlayerId="p-me"
        isAdmin={false}
        vista="MIAS"
        scope="PLAYER"
      />
    );

    expect(isOpen("round-1")).toBe(true);
  });

  it("un bloque nuevo que llega en la revalidación sigue la regla de §4.1; los demás conservan su plegado", async () => {
    const user = userEvent.setup();
    const blocks = [
      makeBlock("round-1", "ROUND", "Ronda 1", [makeMatch("m1", "Alice", "Bob")]),
    ];
    const { rerender } = renderBrowser({ blocks, currentBlockKey: "round-1" });

    await toggle(user, "round-1");
    expect(isOpen("round-1")).toBe(false);

    const withNewBlock = [
      makeBlock("round-1", "ROUND", "Ronda 1", [makeMatch("m1", "Alice", "Bob")]),
      makeBlock("round-2", "ROUND", "Ronda 2", [makeMatch("m2", "Carol", "Dana")]),
    ];
    rerender(
      <PartidasBrowser
        blocks={withNewBlock}
        currentBlockKey="round-1"
        currentPlayerId="p-me"
        isAdmin={false}
        vista="MIAS"
        scope="PLAYER"
      />
    );

    expect(isOpen("round-1")).toBe(false);
    expect(isOpen("round-2")).toBe(false);
  });
});

describe("CA-11: el buscador filtra por jugador, sin acentos ni mayúsculas", () => {
  it("«martin» deja sólo los bloques y partidas donde juega un «Martín», todos desplegados, con «N de M»", async () => {
    const user = userEvent.setup();
    const blocks = [
      makeBlock("round-1", "ROUND", "Ronda 1", [
        makeMatch("m1", "Martín", "Bob"),
        makeMatch("m2", "Carol", "Dana"),
      ]),
      makeBlock("round-2", "ROUND", "Ronda 2", [makeMatch("m3", "Erin", "Frank")]),
    ];
    renderBrowser({ blocks, currentBlockKey: null });

    await user.type(searchInput(), "martin");

    expect(screen.queryByTestId(blockTestId("round-2"))).toBeNull();
    expect(isOpen("round-1")).toBe(true);
    expect(screen.getByText("Martín")).toBeTruthy();
    expect(screen.queryByText("Carol")).toBeNull();
    expect(
      screen.getByTestId(blockToggleTestId("round-1")).textContent
    ).toContain("1 de 2 partidas");
  });
});

describe("CA-12: al vaciar el buscador, cada bloque vuelve al plegado que tenía antes de escribir", () => {
  it("un bloque cerrado a mano antes de buscar sigue cerrado al borrar la búsqueda", async () => {
    const user = userEvent.setup();
    const blocks = [
      makeBlock("round-1", "ROUND", "Ronda 1", [makeMatch("m1", "Martín", "Bob")]),
    ];
    renderBrowser({ blocks, currentBlockKey: "round-1" });

    await toggle(user, "round-1");
    expect(isOpen("round-1")).toBe(false);

    await user.type(searchInput(), "martin");
    expect(isOpen("round-1")).toBe(true);

    await user.clear(searchInput());
    expect(isOpen("round-1")).toBe(false);
  });
});

describe("CA-13: una búsqueda sin coincidencias muestra el aviso y su botón vacía el buscador", () => {
  it("muestra «Ninguna partida casa con «texto»» y el botón limpia la búsqueda", async () => {
    const user = userEvent.setup();
    const blocks = [
      makeBlock("round-1", "ROUND", "Ronda 1", [makeMatch("m1", "Alice", "Bob")]),
    ];
    renderBrowser({ blocks, currentBlockKey: "round-1" });

    await user.type(searchInput(), "nadie");

    expect(screen.getByTestId(TEST_IDS.noSearchResults).textContent).toContain(
      LABELS.noSearchResults("nadie")
    );

    await user.click(screen.getByTestId(TEST_IDS.noSearchResultsClear));

    expect(searchInput().value).toBe("");
    expect(screen.queryByTestId(TEST_IDS.noSearchResults)).toBeNull();
    expect(screen.getByTestId(blockTestId("round-1"))).toBeTruthy();
  });
});

describe("CA-14: el buscador se conserva tras una revalidación y al cambiar de vista; el plegado no", () => {
  it("sobrevive a una revalidación (misma vista, nuevas props)", () => {
    const blocks = [
      makeBlock("round-1", "ROUND", "Ronda 1", [makeMatch("m1", "Alice", "Bob")]),
    ];
    const { rerender } = renderBrowser({ blocks, currentBlockKey: "round-1" });

    return userEvent.setup().type(searchInput(), "alice").then(() => {
      const revalidated = [
        makeBlock("round-1", "ROUND", "Ronda 1", [
          makeMatch("m1", "Alice", "Bob", { played: true }),
        ]),
      ];
      rerender(
        <PartidasBrowser
          blocks={revalidated}
          currentBlockKey="round-1"
          currentPlayerId="p-me"
          isAdmin={false}
          vista="MIAS"
          scope="PLAYER"
        />
      );
      expect(searchInput().value).toBe("alice");
    });
  });

  it("sobrevive a un cambio de vista, que en cambio reinicia el plegado a mano", async () => {
    const user = userEvent.setup();
    const blocksMias = [
      makeBlock("mias-round-1", "ROUND", "Ronda 1", [makeMatch("m1", "Alice", "Bob")]),
    ];
    const { rerender } = renderBrowser({
      blocks: blocksMias,
      currentBlockKey: "mias-round-1",
      vista: "MIAS",
    });

    await toggle(user, "mias-round-1");
    expect(isOpen("mias-round-1")).toBe(false);

    await user.type(searchInput(), "zzz-sin-coincidencias");
    expect(screen.getByTestId(TEST_IDS.noSearchResults)).toBeTruthy();

    const blocksTodas = [
      makeBlock("todas-round-1", "ROUND", "Ronda 1", [makeMatch("m2", "Carol", "Dana")]),
    ];
    rerender(
      <PartidasBrowser
        blocks={blocksTodas}
        currentBlockKey="todas-round-1"
        currentPlayerId="p-me"
        isAdmin={true}
        vista="TODAS"
        scope="LEAGUE"
      />
    );

    expect(searchInput().value).toBe("zzz-sin-coincidencias");

    await user.clear(searchInput());
    expect(isOpen("todas-round-1")).toBe(true);
  });

  it("el filtro de estado también sobrevive a un cambio de vista", async () => {
    const user = userEvent.setup();
    const blocksMias = [
      makeBlock("mias-round-1", "ROUND", "Ronda 1", [
        makeMatch("m1", "Alice", "Bob", { played: true }),
      ]),
    ];
    const { rerender } = renderBrowser({
      blocks: blocksMias,
      currentBlockKey: "mias-round-1",
      vista: "MIAS",
    });

    await user.click(screen.getByTestId(statusFilterOptionTestId("JUGADAS")));
    expect(
      screen.getByTestId(statusFilterOptionTestId("JUGADAS")).getAttribute("aria-pressed")
    ).toBe("true");

    const blocksTodas = [
      makeBlock("todas-round-1", "ROUND", "Ronda 1", [
        makeMatch("m2", "Carol", "Dana", { played: true }),
      ]),
    ];
    rerender(
      <PartidasBrowser
        blocks={blocksTodas}
        currentBlockKey="todas-round-1"
        currentPlayerId="p-me"
        isAdmin={true}
        vista="TODAS"
        scope="LEAGUE"
      />
    );

    expect(
      screen.getByTestId(statusFilterOptionTestId("JUGADAS")).getAttribute("aria-pressed")
    ).toBe("true");
  });
});

describe("CA-15: el filtro por defecto (Pendientes) oculta bloques vacíos y no despliega nada", () => {
  it("oculta un bloque sin ninguna pendiente y dentro de uno mixto sólo cuenta lo pendiente", () => {
    const blocks = [
      makeBlock("round-1", "ROUND", "Ronda 1", [
        makeMatch("m1", "Alice", "Bob"),
        makeMatch("m2", "Carol", "Dana", { played: true }),
      ]),
      makeBlock("round-2", "ROUND", "Ronda 2", [
        makeMatch("m3", "Erin", "Frank", { played: true }),
      ]),
    ];
    renderBrowser({ blocks, currentBlockKey: "round-1" });

    expect(screen.getByTestId(statusFilterOptionTestId("PENDIENTES")).getAttribute("aria-pressed")).toBe("true");
    expect(screen.queryByTestId(blockTestId("round-2"))).toBeNull();
    expect(
      screen.getByTestId(blockToggleTestId("round-1")).textContent
    ).toContain("1 de 2 partidas");
    expect(screen.getByText("Alice")).toBeTruthy();
    expect(screen.queryByText("Carol")).toBeNull();
  });

  it("el filtro no despliega nada por su cuenta: un bloque no-actual con pendientes sigue plegado", () => {
    const blocks = [
      makeBlock("round-1", "ROUND", "Ronda 1", [makeMatch("m1", "Alice", "Bob")]),
      makeBlock("round-2", "ROUND", "Ronda 2", [makeMatch("m2", "Carol", "Dana")]),
    ];
    renderBrowser({ blocks, currentBlockKey: "round-1" });

    expect(isOpen("round-1")).toBe(true);
    expect(isOpen("round-2")).toBe(false);
  });
});

describe("CA-16: Jugadas / Todas, combinadas con el buscador", () => {
  it("Jugadas deja sólo las que tienen resultado (incluido Historial); Todas las deja todas", async () => {
    const user = userEvent.setup();
    const blocks = [
      makeBlock("round-1", "ROUND", "Ronda 1", [
        makeMatch("m1", "Alice", "Bob"),
        makeMatch("m2", "Carol", "Dana", { played: true }),
      ]),
      makeBlock("legacy", "LEGACY", "Historial", [
        makeMatch("m3", "Erin", "Frank", { played: true }),
      ]),
    ];
    renderBrowser({ blocks, currentBlockKey: "round-1" });

    await user.click(screen.getByTestId(statusFilterOptionTestId("JUGADAS")));
    // "Historial" starts collapsed (§4.1b) and the status filter never opens
    // anything (§4.6), so it must be opened by hand to assert its content.
    await toggle(user, "legacy");

    expect(screen.queryByText("Alice")).toBeNull();
    expect(screen.getByText("Carol")).toBeTruthy();
    expect(screen.getByText("Erin")).toBeTruthy();

    await user.click(screen.getByTestId(statusFilterOptionTestId("TODAS")));

    expect(screen.getByText("Alice")).toBeTruthy();
    expect(screen.getByText("Carol")).toBeTruthy();
    expect(screen.getByText("Erin")).toBeTruthy();
  });

  it("se combina con el buscador (Y)", async () => {
    const user = userEvent.setup();
    const blocks = [
      makeBlock("round-1", "ROUND", "Ronda 1", [
        makeMatch("m1", "Martín", "Bob", { played: true }),
        makeMatch("m2", "Martín", "Carol"),
      ]),
    ];
    renderBrowser({ blocks, currentBlockKey: "round-1" });

    await user.click(screen.getByTestId(statusFilterOptionTestId("JUGADAS")));
    await user.type(searchInput(), "martin");

    const block = within(screen.getByTestId(blockTestId("round-1")));
    expect(block.getByText("Bob")).toBeTruthy();
    expect(block.queryByText("Carol")).toBeNull();
  });
});

describe("CA-17: una partida resuelta mientras se mira no desaparece bajo Pendientes", () => {
  it("sigue visible tras la revalidación, y desaparece al reentrar en Pendientes", async () => {
    const user = userEvent.setup();
    const blocks = [
      makeBlock("round-1", "ROUND", "Ronda 1", [makeMatch("m1", "Alice", "Bob")]),
    ];
    const { rerender } = renderBrowser({ blocks, currentBlockKey: "round-1" });

    expect(screen.getByText("Alice")).toBeTruthy();

    const revalidated = [
      makeBlock("round-1", "ROUND", "Ronda 1", [
        makeMatch("m1", "Alice", "Bob", { played: true }),
      ]),
    ];
    rerender(
      <PartidasBrowser
        blocks={revalidated}
        currentBlockKey="round-1"
        currentPlayerId="p-me"
        isAdmin={false}
        vista="MIAS"
        scope="PLAYER"
      />
    );

    expect(screen.getByText("Alice")).toBeTruthy();

    await user.click(screen.getByTestId(statusFilterOptionTestId("JUGADAS")));
    await user.click(screen.getByTestId(statusFilterOptionTestId("PENDIENTES")));

    expect(screen.queryByText("Alice")).toBeNull();
  });
});

describe("CA-18: Pendientes sin nada pendiente ofrece «Ver jugadas»", () => {
  it("el aviso lleva el texto de PLAYER y su botón cambia el filtro a Jugadas", async () => {
    const user = userEvent.setup();
    const blocks = [
      makeBlock("round-1", "ROUND", "Ronda 1", [
        makeMatch("m1", "Alice", "Bob", { played: true }),
      ]),
    ];
    renderBrowser({ blocks, currentBlockKey: "round-1", scope: "PLAYER" });

    expect(screen.getByTestId(TEST_IDS.noPending).textContent).toContain(
      LABELS.noPending.PLAYER
    );

    await user.click(screen.getByTestId(TEST_IDS.noPendingSeeJugadas));

    expect(
      screen.getByTestId(statusFilterOptionTestId("JUGADAS")).getAttribute("aria-pressed")
    ).toBe("true");
    expect(screen.getByText("Alice")).toBeTruthy();
  });

  it("usa el texto de LEAGUE cuando scope es LEAGUE", () => {
    renderBrowser({ blocks: [], currentBlockKey: null, scope: "LEAGUE" });

    expect(screen.getByTestId(TEST_IDS.noPending).textContent).toContain(
      LABELS.noPending.LEAGUE
    );
  });
});

describe("CA-19 (filtro): las tres opciones son Pendientes / Jugadas / Todas", () => {
  it("las tres opciones llevan aria-label con el nombre completo", () => {
    renderBrowser({ blocks: [] });

    expect(screen.getByTestId(statusFilterOptionTestId("PENDIENTES")).getAttribute("aria-label")).toBe("Pendientes");
    expect(screen.getByTestId(statusFilterOptionTestId("JUGADAS")).getAttribute("aria-label")).toBe("Jugadas");
    expect(screen.getByTestId(statusFilterOptionTestId("TODAS")).getAttribute("aria-label")).toBe("Todas");
  });
});

describe("CA-22 (componente): la fila de buscador y filtro", () => {
  it("es una sola fila que contiene el buscador y el segmentado", () => {
    renderBrowser({ blocks: [] });

    const row = screen.getByTestId("partidas-search-row");
    expect(within(row).getByTestId(TEST_IDS.searchInput)).toBeTruthy();
    expect(within(row).getByTestId(TEST_IDS.statusFilter)).toBeTruthy();
  });

  it("el buscador es type=search y no lleva autoFocus", () => {
    renderBrowser({ blocks: [] });

    const input = searchInput();
    expect(input.type).toBe("search");
    expect(input.hasAttribute("autofocus")).toBe(false);
    expect(document.activeElement).not.toBe(input);
  });

  it("las opciones del filtro llevan una etiqueta abreviada oculta por encima de 400px", () => {
    renderBrowser({ blocks: [] });

    const option = screen.getByTestId(statusFilterOptionTestId("PENDIENTES"));
    const short = within(option).getByText(LABELS.statusFilter.PENDIENTES.short);
    const full = within(option).getByText(LABELS.statusFilter.PENDIENTES.full);
    expect(short.className).toMatch(/min-\[400px\]:hidden/);
    expect(full.className).toMatch(/min-\[400px\]:inline|hidden/);
  });
});
