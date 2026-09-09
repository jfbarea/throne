// Tests for Hito 6 (ui-cupo-y-rondas) of the feature "rondas-con-fecha".
// Spec: plan/specs/rondas-con-fecha.md §4.6, §4.9, §7.3, §8.
//
// Pure functions extracted to src/server/round-ui.ts precisely so they can
// be tested here instead of only through rendered pages (§7.3's own
// instruction). Each describe block is named after the acceptance
// criterion it covers, per §7.3's "cada criterio, un test identificable".
//
// Covers:
//  - Criterio 9 (Mis partidas agrupa por ronda: cierre más próximo primero,
//    cerradas al final) — sortRoundBlocks.
//  - The three etiquetado criteria added to H6 after the H4 review found the
//    gap (PLAN.md H6): UNPLAYED_DRAW, WALKOVER and PLAYED — resolveMatchStatusLabel.

import { describe, it, expect } from "vitest";
import {
  sortRoundBlocks,
  resolveMatchStatusLabel,
  type RoundBlockOrderInput,
} from "@/server/round-ui";

// ---------------------------------------------------------------------------
// Criterio 9: orden de los bloques de "Mis partidas"
// ---------------------------------------------------------------------------

describe("AC-9: Mis partidas agrupa por ronda, cierre más próximo primero, cerradas al final", () => {
  it("ordena las rondas abiertas por fecha de cierre ascendente", () => {
    const rounds: RoundBlockOrderInput[] = [
      { deadline: new Date("2026-06-30"), closedAt: null }, // round 4
      { deadline: new Date("2026-05-31"), closedAt: null }, // round 3
      { deadline: new Date("2026-07-31"), closedAt: null }, // round 5
    ];

    const sorted = sortRoundBlocks(rounds);

    expect(sorted.map((r) => r.deadline.toISOString())).toEqual([
      new Date("2026-05-31").toISOString(),
      new Date("2026-06-30").toISOString(),
      new Date("2026-07-31").toISOString(),
    ]);
  });

  it("pone las rondas cerradas al final, sin importar su fecha de cierre", () => {
    const rounds: (RoundBlockOrderInput & { index: number })[] = [
      { index: 3, deadline: new Date("2026-05-31"), closedAt: new Date("2026-06-01") }, // closed, earliest deadline
      { index: 4, deadline: new Date("2026-06-30"), closedAt: null },
      { index: 2, deadline: new Date("2026-04-30"), closedAt: new Date("2026-05-01") }, // closed too
      { index: 5, deadline: new Date("2026-07-31"), closedAt: null },
    ];

    const sorted = sortRoundBlocks(rounds);

    // Open rounds first (closest deadline first: 4 before 5), closed after
    // (kept in deadline order among themselves: 2 before 3).
    expect(sorted.map((r) => r.index)).toEqual([4, 5, 2, 3]);
  });

  it("no muta el array de entrada", () => {
    const rounds: RoundBlockOrderInput[] = [
      { deadline: new Date("2026-06-30"), closedAt: null },
      { deadline: new Date("2026-05-31"), closedAt: null },
    ];
    const original = [...rounds];

    sortRoundBlocks(rounds);

    expect(rounds).toEqual(original);
  });

  it("reproduce el mockup de la spec: ronda 3 abierta, ronda 4 abierta más lejana, ronda 2 cerrada al final", () => {
    // SPEC §4.6:
    //   Ronda 3 · cierra 31 may · falta 1 de 2
    //   Ronda 4 · cierra 30 jun · faltan 2 de 2
    //   Ronda 2 · cerrada
    const rounds = [
      { index: 4, deadline: new Date("2026-06-30"), closedAt: null },
      { index: 2, deadline: new Date("2026-04-30"), closedAt: new Date("2026-05-02") },
      { index: 3, deadline: new Date("2026-05-31"), closedAt: null },
    ];

    const sorted = sortRoundBlocks(rounds);

    expect(sorted.map((r) => r.index)).toEqual([3, 4, 2]);
  });
});

// ---------------------------------------------------------------------------
// Etiquetado por resolution (hueco de la review de H4, cerrado en H6)
// ---------------------------------------------------------------------------

describe("Etiquetado: UNPLAYED_DRAW no se etiqueta Jugada ni Apuntada", () => {
  it("en calendario (playedLabel = Jugada), se distingue como saldada sin jugar", () => {
    const result = resolveMatchStatusLabel("REPORTED", "UNPLAYED_DRAW", "Jugada");
    expect(result.label).not.toBe("Jugada");
    expect(result.label).toBe("Saldada sin jugar");
  });

  it("en mis-partidas (playedLabel = Apuntada), se distingue como saldada sin jugar", () => {
    const result = resolveMatchStatusLabel("REPORTED", "UNPLAYED_DRAW", "Apuntada");
    expect(result.label).not.toBe("Apuntada");
    expect(result.label).toBe("Saldada sin jugar");
  });
});

describe("Etiquetado: WALKOVER se etiqueta «incomparecencia» en las dos vistas", () => {
  it("en calendario", () => {
    const result = resolveMatchStatusLabel("REPORTED", "WALKOVER", "Jugada");
    expect(result.label).toBe("Incomparecencia");
  });

  it("en mis-partidas", () => {
    const result = resolveMatchStatusLabel("REPORTED", "WALKOVER", "Apuntada");
    expect(result.label).toBe("Incomparecencia");
  });
});

describe("Etiquetado: PLAYED mantiene exactamente las etiquetas de hoy", () => {
  it("calendario sigue diciendo Jugada", () => {
    const result = resolveMatchStatusLabel("REPORTED", "PLAYED", "Jugada");
    expect(result).toEqual({ label: "Jugada", variant: "brass" });
  });

  it("mis-partidas sigue diciendo Apuntada", () => {
    const result = resolveMatchStatusLabel("REPORTED", "PLAYED", "Apuntada");
    expect(result).toEqual({ label: "Apuntada", variant: "brass" });
  });

  it("un resultado ausente (status SCHEDULED, resolution null) sigue diciendo Pendiente", () => {
    const result = resolveMatchStatusLabel("SCHEDULED", null, "Apuntada");
    expect(result).toEqual({ label: "Pendiente", variant: "neutral" });
  });

  it("los estados legacy CONFIRMED/DISPUTED no cambian", () => {
    expect(resolveMatchStatusLabel("CONFIRMED", "PLAYED", "Apuntada")).toEqual({
      label: "Confirmada",
      variant: "moss",
    });
    expect(resolveMatchStatusLabel("DISPUTED", "PLAYED", "Apuntada")).toEqual({
      label: "Disputada",
      variant: "ember",
    });
  });
});
