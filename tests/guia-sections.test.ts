// Hito 12 (`guia-de-usuario`): unit coverage for the pure content behind
// /guia. The page itself is exercised end-to-end (tests/e2e/full-journey.spec.ts),
// but the five required sections and their plain-language wording are a
// data-only concern that belongs in Vitest (SPEC's "no criterion checked by
// eye" — CLAUDE.md `plan/rondas-con-fecha/PLAN.md` requisitos globales).

import { describe, it, expect } from "vitest";
import { GUIDE_SECTIONS } from "@/app/guia/sections";

describe("H12-AC3: la guía cubre las cinco secciones exigidas", () => {
  it("expone exactamente cinco secciones, en orden", () => {
    expect(GUIDE_SECTIONS).toHaveLength(5);
    expect(GUIDE_SECTIONS.map((s) => s.label)).toEqual([
      "01",
      "02",
      "03",
      "04",
      "05",
    ]);
  });

  it("cubre cómo entrar, apuntar resultado, incomparecencia/0-0, cupo y cierre de ronda", () => {
    const titles = GUIDE_SECTIONS.map((s) => s.title);
    expect(titles).toEqual([
      "Cómo entrar",
      "Apuntar un resultado",
      "Incomparecencia y 0-0",
      "Tu cupo de la ronda",
      "Qué pasa al cerrarse la ronda",
    ]);
  });

  it("cada sección tiene al menos un punto y ningún texto vacío", () => {
    for (const section of GUIDE_SECTIONS) {
      expect(section.bullets.length).toBeGreaterThan(0);
      for (const bullet of section.bullets) {
        expect(bullet.trim().length).toBeGreaterThan(0);
      }
    }
  });

  it("no confirma resultados: no hay paso de rival confirmando ni disputas", () => {
    const allText = GUIDE_SECTIONS.flatMap((s) => s.bullets).join(" ");
    expect(allText).toMatch(/no hace falta que el rival/i);
    expect(allText).toMatch(/no hay disputas/i);
  });

  it("explica que la incomparecencia es 80-0 sin bonus y que solo el admin la aplica sobre una partida ya jugada", () => {
    const incomparecencia = GUIDE_SECTIONS[2].bullets.join(" ");
    expect(incomparecencia).toMatch(/80-0/);
    expect(incomparecencia).toMatch(/no da el punto de bonus|no da el bono|no lleva bonus/i);
    expect(incomparecencia).toMatch(/0-0/);
    expect(incomparecencia).toMatch(/solo lo hace el admin/i);
  });

  it("explica que adelantar partidas no exime del cupo de la ronda actual", () => {
    const cupo = GUIDE_SECTIONS[3].bullets.join(" ");
    expect(cupo).toMatch(/adelantar/i);
    expect(cupo).toMatch(/no te libra/i);
  });
});
