// Hito 12 (`guia-de-usuario`): unit coverage for the pure content behind
// /guia. The page itself is exercised end-to-end (tests/e2e/full-journey.spec.ts),
// but the five required sections and their plain-language wording are a
// data-only concern that belongs in Vitest (SPEC's "no criterion checked by
// eye" — CLAUDE.md `plan/rondas-con-fecha/PLAN.md` requisitos globales).
//
// H12-AC3 required five sections and pinned their order. Later player-facing
// features append their own sections, so the AC is asserted as a *prefix*
// (labels 01-05, same titles, same order) rather than as an exact length: the
// criterion was "these five are covered, in this order", not "the guide never
// grows".

import { describe, it, expect } from "vitest";
import { GUIDE_SECTIONS } from "@/app/guia/sections";

describe("H12-AC3: la guía cubre las cinco secciones exigidas", () => {
  it("abre con esas cinco secciones, en orden, y numera todas de forma correlativa", () => {
    expect(GUIDE_SECTIONS.length).toBeGreaterThanOrEqual(5);
    expect(GUIDE_SECTIONS.slice(0, 5).map((s) => s.label)).toEqual([
      "01",
      "02",
      "03",
      "04",
      "05",
    ]);
    // Las secciones añadidas después siguen la misma numeración de dos dígitos.
    expect(GUIDE_SECTIONS.map((s) => s.label)).toEqual(
      GUIDE_SECTIONS.map((_, i) => String(i + 1).padStart(2, "0"))
    );
  });

  it("cubre cómo entrar, apuntar resultado, incomparecencia/0-0, cupo y cierre de ronda", () => {
    const titles = GUIDE_SECTIONS.map((s) => s.title);
    expect(titles.slice(0, 5)).toEqual([
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

  it("explica que la fecha se pone desde Mis partidas y que no mueve el cierre de la ronda", () => {
    const fecha = GUIDE_SECTIONS.find((s) => /fecha a una partida/i.test(s.title));
    expect(fecha).toBeDefined();
    const text = fecha!.bullets.join(" ");
    expect(text).toMatch(/mis partidas/i);
    expect(text).toMatch(/calendario/i);
    expect(text).toMatch(/cualquiera de los dos/i);
    expect(text).toMatch(/no mueve el cierre/i);
  });

  it("explica que el jugador elige sus propias facciones, varias, desde Mi perfil", () => {
    const facciones = GUIDE_SECTIONS.find((s) => /facciones/i.test(s.title));
    expect(facciones).toBeDefined();
    const text = facciones!.bullets.join(" ");
    expect(text).toMatch(/mi perfil/i);
    expect(text).toMatch(/varias/i);
    // El nombre, el rol y el código siguen siendo admin-only (SPEC §4.2, §5).
    expect(text).toMatch(/cosa del admin/i);
  });
});
