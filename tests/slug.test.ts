// Tests for Hito C0 (modelo-liga-slug-archivado, multi-liga).
// Pure functions, no DB access. Covers spec criterios 19, 20.

import { describe, it, expect } from "vitest";
import { slugify, uniqueSlug } from "@/server/slug";

describe("slugify", () => {
  it("produces kebab-case ASCII from name + season (criterio 19)", () => {
    expect(slugify("Liga de los Martes", "Primavera 2026")).toBe(
      "liga-de-los-martes-primavera-2026"
    );
  });

  it("strips accents", () => {
    expect(slugify("Liga Capítulo Hierro", "2026")).toBe(
      "liga-capitulo-hierro-2026"
    );
  });

  it("strips other diacritics (ñ, ü)", () => {
    expect(slugify("Peña Güemes", "2026")).toBe("pena-guemes-2026");
  });

  it("collapses punctuation and whitespace runs into a single dash", () => {
    expect(slugify("Liga Warhammer 40K — Capítulo Hierro", "2026")).toBe(
      "liga-warhammer-40k-capitulo-hierro-2026"
    );
  });

  it("has no leading or trailing dash", () => {
    expect(slugify("¡Liga!", "2026")).toBe("liga-2026");
  });

  it("lowercases", () => {
    expect(slugify("LIGA MAYÚSCULA", "TEMPORADA")).toBe(
      "liga-mayuscula-temporada"
    );
  });
});

describe("uniqueSlug", () => {
  it("returns the base slug unchanged when it's free", () => {
    expect(uniqueSlug("liga-2026", [])).toBe("liga-2026");
  });

  it("appends -2 when the base slug is taken (criterio 20)", () => {
    expect(uniqueSlug("liga-2026", ["liga-2026"])).toBe("liga-2026-2");
  });

  it("appends -3 when the base slug and -2 are both taken (criterio 20)", () => {
    expect(uniqueSlug("liga-2026", ["liga-2026", "liga-2026-2"])).toBe(
      "liga-2026-3"
    );
  });

  it("accepts a Set as well as an array", () => {
    expect(uniqueSlug("liga-2026", new Set(["liga-2026"]))).toBe(
      "liga-2026-2"
    );
  });

  it("does not mutate the taken collection", () => {
    const taken = ["liga-2026"];
    uniqueSlug("liga-2026", taken);
    expect(taken).toEqual(["liga-2026"]);
  });
});
