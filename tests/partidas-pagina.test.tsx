// @vitest-environment jsdom
//
// t02 (pagina-y-pestanas) · plan/partidas-por-jornada/PLAN.md.
// Spec: plan/specs/partidas-por-jornada.md — §4.1/§4.1b/§4.4/§4.5 (CA-1,
// CA-2, CA-4, CA-5, CA-19ᵃ).

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import {
  buildBrowserBlocks,
  type BrowserMatchInput,
} from "@/server/partidas-blocks";
import { VistaTabs } from "@/app/mis-partidas/VistaTabs";
import { TEST_IDS, LABELS } from "@/app/mis-partidas/browser-contract";

const ALICE = "p-alice";
const BOB = "p-bob";
const CAROL = "p-carol";

function match(overrides: Partial<BrowserMatchInput> & { id: string }): BrowserMatchInput {
  return {
    status: "SCHEDULED",
    scheduledAt: null,
    location: null,
    playerHomeId: ALICE,
    playerAwayId: BOB,
    playerHomeName: "Alice",
    playerAwayName: "Bob",
    roundId: "r1",
    round: { index: 1, deadline: new Date("2026-11-30"), closedAt: null },
    result: null,
    ...overrides,
  };
}

describe("buildBrowserBlocks: orden de bloques", () => {
  it("rondas abiertas por deadline ascendente, la cerrada al final, sin ronda y luego historial", () => {
    const matches: BrowserMatchInput[] = [
      match({
        id: "m-r2",
        roundId: "r2",
        round: { index: 2, deadline: new Date("2026-12-31"), closedAt: null },
      }),
      match({
        id: "m-r1-closed",
        roundId: "r1",
        round: { index: 1, deadline: new Date("2026-10-31"), closedAt: new Date("2026-11-01") },
      }),
      match({
        id: "m-r3",
        roundId: "r3",
        round: { index: 3, deadline: new Date("2026-11-15"), closedAt: null },
      }),
      match({ id: "m-unassigned", roundId: null, round: null }),
      match({ id: "m-legacy", status: "CONFIRMED", roundId: null, round: null }),
    ];

    const { blocks } = buildBrowserBlocks({
      matches,
      vista: "TODAS",
      currentPlayerId: ALICE,
      currentRoundId: null,
      leagueStartMonth: null,
    });

    expect(blocks.map((b) => b.key)).toEqual([
      "round-3", // open, closest deadline (15 nov)
      "round-2", // open, later deadline (31 dic)
      "round-1", // closed, always last among rounds
      "unassigned",
      "legacy",
    ]);
    expect(blocks.map((b) => b.kind)).toEqual([
      "ROUND",
      "ROUND",
      "ROUND",
      "UNASSIGNED",
      "LEGACY",
    ]);
  });

  it("omite el bloque de sin-ronda y el de historial cuando no hay partidas de ese tipo", () => {
    const { blocks } = buildBrowserBlocks({
      matches: [match({ id: "m1" })],
      vista: "TODAS",
      currentPlayerId: ALICE,
      currentRoundId: null,
      leagueStartMonth: null,
    });

    expect(blocks.map((b) => b.kind)).toEqual(["ROUND"]);
  });
});

describe("buildBrowserBlocks: título y subtítulo", () => {
  it("«Ronda N» con el cierre y el cupo del jugador en MIAS", () => {
    const matches: BrowserMatchInput[] = [
      match({
        id: "m1",
        playerHomeId: ALICE,
        playerAwayId: BOB,
        round: { index: 3, deadline: new Date("2026-11-30"), closedAt: null },
      }),
      match({
        id: "m2",
        playerHomeId: ALICE,
        playerAwayId: CAROL,
        result: {
          homeVictoryPoints: 40,
          awayVictoryPoints: 20,
          outcome: "HOME_WIN",
          reportedById: ALICE,
          bonusHome: 0,
          bonusAway: 0,
          resolution: "PLAYED",
        },
        round: { index: 3, deadline: new Date("2026-11-30"), closedAt: null },
      }),
    ];

    const { blocks } = buildBrowserBlocks({
      matches,
      vista: "MIAS",
      currentPlayerId: ALICE,
      currentRoundId: null,
      leagueStartMonth: null,
    });

    expect(blocks[0].title).toBe("Ronda 3");
    expect(blocks[0].subtitle).toBe("cierra 30 nov 2026 · falta 1 de 2");
  });

  it("en TODAS el subtítulo es el agregado «N de M jugadas», no el cupo", () => {
    const matches: BrowserMatchInput[] = [
      match({ id: "m1", playerHomeId: ALICE, playerAwayId: BOB }),
      match({
        id: "m2",
        playerHomeId: CAROL,
        playerAwayId: BOB,
        result: {
          homeVictoryPoints: 40,
          awayVictoryPoints: 20,
          outcome: "HOME_WIN",
          reportedById: CAROL,
          bonusHome: 0,
          bonusAway: 0,
          resolution: "PLAYED",
        },
      }),
    ];

    const { blocks } = buildBrowserBlocks({
      matches,
      vista: "TODAS",
      currentPlayerId: ALICE,
      currentRoundId: null,
      leagueStartMonth: null,
    });

    expect(blocks[0].subtitle).toBe("cierra 30 nov 2026 · 1 de 2 jugadas");
  });

  it("una ronda cerrada muestra «cerrada el ...» en vez de «cierra ...»", () => {
    const { blocks } = buildBrowserBlocks({
      matches: [
        match({
          id: "m1",
          round: { index: 1, deadline: new Date("2026-10-31"), closedAt: new Date("2026-11-02") },
        }),
      ],
      vista: "TODAS",
      currentPlayerId: ALICE,
      currentRoundId: null,
      leagueStartMonth: null,
    });

    expect(blocks[0].subtitle).toMatch(/^cerrada el /);
  });

  it("«Sin ronda asignada» e «Historial» llevan título fijo y subtítulo vacío", () => {
    const { blocks } = buildBrowserBlocks({
      matches: [
        match({ id: "m-unassigned", roundId: null, round: null }),
        match({ id: "m-legacy", status: "DISPUTED", roundId: null, round: null }),
      ],
      vista: "TODAS",
      currentPlayerId: ALICE,
      currentRoundId: null,
      leagueStartMonth: null,
    });

    const unassigned = blocks.find((b) => b.kind === "UNASSIGNED")!;
    const legacy = blocks.find((b) => b.kind === "LEGACY")!;
    expect(unassigned.title).toBe("Sin ronda asignada");
    expect(unassigned.subtitle).toBe("");
    expect(legacy.title).toBe("Historial");
    expect(legacy.subtitle).toBe("");
  });
});

describe("buildBrowserBlocks: currentBlockKey (§4.1)", () => {
  it("resuelve la key del bloque cuya ronda es la actual", () => {
    const { currentBlockKey } = buildBrowserBlocks({
      matches: [
        match({ id: "m1", roundId: "r-current", round: { index: 5, deadline: new Date(), closedAt: null } }),
      ],
      vista: "TODAS",
      currentPlayerId: ALICE,
      currentRoundId: "r-current",
      leagueStartMonth: null,
    });

    expect(currentBlockKey).toBe("round-5");
  });

  it("null si la ronda actual no tiene ningún bloque en esta lista", () => {
    const { currentBlockKey } = buildBrowserBlocks({
      matches: [match({ id: "m1", roundId: "r-other" })],
      vista: "MIAS",
      currentPlayerId: ALICE,
      currentRoundId: "r-current",
      leagueStartMonth: null,
    });

    expect(currentBlockKey).toBeNull();
  });

  it("null si no hay ronda actual", () => {
    const { currentBlockKey } = buildBrowserBlocks({
      matches: [match({ id: "m1" })],
      vista: "TODAS",
      currentPlayerId: ALICE,
      currentRoundId: null,
      leagueStartMonth: null,
    });

    expect(currentBlockKey).toBeNull();
  });
});

describe("buildBrowserBlocks: recuentos de cabecera (CA-5)", () => {
  it("cuenta pendientes, apuntadas, incomparecencias, saldadas y legado sobre la lista recibida", () => {
    const matches: BrowserMatchInput[] = [
      match({ id: "m-pending" }),
      match({
        id: "m-played",
        status: "REPORTED",
        result: {
          homeVictoryPoints: 40,
          awayVictoryPoints: 20,
          outcome: "HOME_WIN",
          reportedById: ALICE,
          bonusHome: 0,
          bonusAway: 0,
          resolution: "PLAYED",
        },
      }),
      match({
        id: "m-walkover",
        status: "REPORTED",
        result: {
          homeVictoryPoints: 40,
          awayVictoryPoints: 0,
          outcome: "HOME_WIN",
          reportedById: ALICE,
          bonusHome: 0,
          bonusAway: 0,
          resolution: "WALKOVER",
        },
      }),
      match({
        id: "m-unplayed-draw",
        status: "REPORTED",
        result: {
          homeVictoryPoints: 0,
          awayVictoryPoints: 0,
          outcome: "DRAW",
          reportedById: ALICE,
          bonusHome: 0,
          bonusAway: 0,
          resolution: "UNPLAYED_DRAW",
        },
      }),
      match({ id: "m-legacy", status: "CONFIRMED", roundId: null, round: null }),
    ];

    const { counts } = buildBrowserBlocks({
      matches,
      vista: "TODAS",
      currentPlayerId: ALICE,
      currentRoundId: null,
      leagueStartMonth: null,
    });

    expect(counts).toEqual({
      total: 5,
      pending: 1,
      played: 1,
      walkover: 1,
      unplayedDraw: 1,
      legacy: 1,
    });
  });
});

describe("VistaTabs (CA-19ᵃ)", () => {
  it("«Mis partidas» y «Toda la liga», con aria-current en la activa", () => {
    render(<VistaTabs vista="MIAS" />);

    const mias = screen.getByTestId(TEST_IDS.tabMias);
    const todas = screen.getByTestId(TEST_IDS.tabTodas);

    expect(mias.textContent).toBe(LABELS.tabMias);
    expect(todas.textContent).toBe(LABELS.tabTodas);
    expect(mias.getAttribute("aria-current")).toBe("page");
    expect(todas.getAttribute("aria-current")).toBeNull();
    expect(mias.getAttribute("href")).toBe("/mis-partidas");
    expect(todas.getAttribute("href")).toBe("/mis-partidas?vista=todas");
  });

  it("con vista TODAS la activa es «Toda la liga»", () => {
    render(<VistaTabs vista="TODAS" />);

    expect(screen.getByTestId(TEST_IDS.tabTodas).getAttribute("aria-current")).toBe(
      "page"
    );
    expect(screen.getByTestId(TEST_IDS.tabMias).getAttribute("aria-current")).toBeNull();
  });
});
