// Tests for Hito E1 (bases-por-liga, multi-liga lane E) — pure rendering
// helpers in src/app/liga/[slug]/bases/rules-content.tsx. No DB needed: these
// are plain functions over a League-shaped object or a markdown string.
//
// Covers spec criterios 35 and 36 at the unit level (each generated value
// changes independently when its own League field changes, without editing
// any text), plus the markdown parser that backs criterio 38 (empty prose).

import { describe, it, expect } from "vitest";
import {
  parseRulesSections,
  pointsLine,
  bonusLine,
  tiebreakersLine,
  playoffsLine,
  matchesPerRoundLabel,
  type GeneratedRulesLeague,
} from "@/app/liga/[slug]/bases/rules-content";

function baseLeague(
  overrides: Partial<GeneratedRulesLeague> = {}
): GeneratedRulesLeague {
  return {
    pointsWin: 3,
    pointsDraw: 1,
    pointsLoss: 0,
    bonusEnabled: false,
    bonusMarginThreshold: null,
    bonusMinVP: null,
    matchesPerRound: 2,
    playoffSize: 4,
    tiebreakers:
      '["POINTS","VP_DIFF","VP_FOR","HEAD_TO_HEAD","LOSSES","ID_ORDER"]',
    ...overrides,
  };
}

describe("pointsLine (criterio 35)", () => {
  it("renders the default scoring", () => {
    expect(pointsLine(baseLeague())).toBe("Victoria 3 · Empate 1 · Derrota 0.");
  });

  it("changes when pointsWin changes, with no other edit", () => {
    expect(pointsLine(baseLeague({ pointsWin: 2 }))).toBe(
      "Victoria 2 · Empate 1 · Derrota 0."
    );
  });
});

describe("bonusLine (criterio 36)", () => {
  it("states there is no bonus when disabled", () => {
    expect(bonusLine(baseLeague({ bonusEnabled: false }))).toBe(
      "Esta liga no tiene bonus de puntuación activados."
    );
  });

  it("describes both thresholds when enabled", () => {
    const line = bonusLine(
      baseLeague({
        bonusEnabled: true,
        bonusMarginThreshold: 20,
        bonusMinVP: 40,
      })
    );
    expect(line).toContain("20 VP de diferencia");
    expect(line).toContain("40 VP");
    expect(line).not.toBe("Esta liga no tiene bonus de puntuación activados.");
  });

  it("describes only the configured threshold when the other is null", () => {
    const line = bonusLine(
      baseLeague({
        bonusEnabled: true,
        bonusMarginThreshold: 20,
        bonusMinVP: null,
      })
    );
    expect(line).toContain("20 VP de diferencia");
    expect(line).not.toContain("VP, ganes o pierdas");
  });
});

describe("tiebreakersLine (criterio 36)", () => {
  it("lists the default order with human labels", () => {
    const line = tiebreakersLine(baseLeague().tiebreakers);
    expect(line).toBe(
      "Desempates en la tabla, en este orden: Puntos de liga · Diferencia de VP · VP a favor · Enfrentamiento directo · Menor número de derrotas · Orden de alta (desempate final)."
    );
  });

  it("reflects a reordered configuration, with no text edited", () => {
    const reordered = JSON.stringify([
      "HEAD_TO_HEAD",
      "POINTS",
      "VP_FOR",
      "VP_DIFF",
      "LOSSES",
      "ID_ORDER",
    ]);
    const line = tiebreakersLine(reordered);
    expect(line.indexOf("Enfrentamiento directo")).toBeLessThan(
      line.indexOf("Puntos de liga")
    );
  });
});

describe("playoffsLine (criterio 36)", () => {
  it("reflects playoffSize", () => {
    expect(playoffsLine(4)).toBe(
      "Clasifican a playoffs los 4 mejores de la tabla."
    );
    expect(playoffsLine(8)).toBe(
      "Clasifican a playoffs los 8 mejores de la tabla."
    );
  });
});

describe("matchesPerRoundLabel (criterio 36)", () => {
  it("pluralises correctly", () => {
    expect(matchesPerRoundLabel(1)).toBe("1 partida por ronda");
    expect(matchesPerRoundLabel(2)).toBe("2 partidas por ronda");
    expect(matchesPerRoundLabel(3)).toBe("3 partidas por ronda");
  });
});

describe("parseRulesSections", () => {
  it("returns an empty array for empty prose (criterio 38)", () => {
    expect(parseRulesSections("")).toEqual([]);
    expect(parseRulesSections("   \n\n  ")).toEqual([]);
  });

  it("splits headings into sections and paragraphs into bullets", () => {
    const sections = parseRulesSections(
      "## Ejércitos\n\nPrimer párrafo.\n\nSegundo párrafo.\n\n## Convivencia\n\nOtra cosa.\n"
    );
    expect(sections).toEqual([
      { title: "Ejércitos", items: ["Primer párrafo.", "Segundo párrafo."] },
      { title: "Convivencia", items: ["Otra cosa."] },
    ]);
  });

  it("also accepts explicit `-` bullets", () => {
    const sections = parseRulesSections("## Incidencias\n\n- Uno.\n- Dos.\n");
    expect(sections).toEqual([
      { title: "Incidencias", items: ["Uno.", "Dos."] },
    ]);
  });

  it("drops sections that end up with no content", () => {
    const sections = parseRulesSections("## Vacía\n\n## Ejércitos\n\nAlgo.\n");
    expect(sections).toEqual([{ title: "Ejércitos", items: ["Algo."] }]);
  });
});
