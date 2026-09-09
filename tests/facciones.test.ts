// Unit coverage for the multi-faction encoding of `Player.faction`
// (src/lib/factions.ts) and the schemas that validate it.
//
// The encoding carries the whole feature: there is no schema migration behind
// "a player can have several factions", just a joined string in the existing
// `String?` column. So the round-trip, the tolerance for legacy free text, and
// the guarantee that nothing is silently dropped are exactly what has to be
// checked here rather than by eye.

import { describe, it, expect } from "vitest";
import {
  ALL_FACTIONS,
  FACTION_GROUPS,
  FACTION_SEPARATOR,
  MAX_FACTIONS_PER_PLAYER,
  MAX_FACTION_FIELD_LENGTH,
  formatFactions,
  isKnownFaction,
  parseFactions,
  serialiseFactions,
} from "@/lib/factions";

describe("catálogo de facciones", () => {
  it("no tiene nombres duplicados entre grupos", () => {
    expect(new Set(ALL_FACTIONS).size).toBe(ALL_FACTIONS.length);
  });

  it("ningún nombre contiene el separador — si no, se re-parsearía como dos facciones", () => {
    for (const name of ALL_FACTIONS) {
      expect(name).not.toContain("·");
    }
  });

  it("ningún nombre está vacío ni tiene espacios de sobra", () => {
    for (const name of ALL_FACTIONS) {
      expect(name.length).toBeGreaterThan(0);
      expect(name).toBe(name.trim());
    }
  });

  it("cubre los tres grupos del juego y ninguno está vacío", () => {
    expect(FACTION_GROUPS.map((g) => g.label)).toEqual([
      "Imperium",
      "Caos",
      "Xenos",
    ]);
    for (const group of FACTION_GROUPS) {
      expect(group.factions.length).toBeGreaterThan(0);
    }
  });

  it("el cupo máximo de facciones cabe en el largo máximo del campo", () => {
    // The longest MAX_FACTIONS_PER_PLAYER names, joined, must still validate.
    const longest = [...ALL_FACTIONS]
      .sort((a, b) => b.length - a.length)
      .slice(0, MAX_FACTIONS_PER_PLAYER);
    const serialised = serialiseFactions(longest);
    expect(serialised).not.toBeNull();
    expect(serialised!.length).toBeLessThanOrEqual(MAX_FACTION_FIELD_LENGTH);
  });

  it("isKnownFaction distingue catálogo de texto libre", () => {
    expect(isKnownFaction("Orks")).toBe(true);
    expect(isKnownFaction("  Orks  ")).toBe(true);
    expect(isKnownFaction("Ejército de mi primo")).toBe(false);
  });
});

describe("parseFactions", () => {
  it("devuelve lista vacía para null, undefined y cadena vacía", () => {
    expect(parseFactions(null)).toEqual([]);
    expect(parseFactions(undefined)).toEqual([]);
    expect(parseFactions("")).toEqual([]);
    expect(parseFactions("   ")).toEqual([]);
  });

  it("lee un valor de texto libre antiguo como una sola facción", () => {
    // Written before the catalogue existed (prisma/seed.ts uses these).
    expect(parseFactions("Astra Militarum")).toEqual(["Astra Militarum"]);
    expect(parseFactions("Inquisición")).toEqual(["Inquisición"]);
  });

  it("separa varias facciones y respeta el orden", () => {
    expect(parseFactions("Orks · Death Guard · Necrones")).toEqual([
      "Orks",
      "Death Guard",
      "Necrones",
    ]);
  });

  it("tolera el separador sin espacios o con espaciado irregular", () => {
    expect(parseFactions("Orks·Death Guard")).toEqual(["Orks", "Death Guard"]);
    expect(parseFactions("Orks   ·    Death Guard")).toEqual([
      "Orks",
      "Death Guard",
    ]);
  });

  it("descarta huecos vacíos y duplicados conservando el primero", () => {
    expect(parseFactions("Orks ·  · Orks · Necrones")).toEqual([
      "Orks",
      "Necrones",
    ]);
  });
});

describe("serialiseFactions", () => {
  it("devuelve null para una selección vacía — «sin facción» es null, nunca cadena vacía", () => {
    expect(serialiseFactions([])).toBeNull();
    expect(serialiseFactions(["", "   "])).toBeNull();
  });

  it("une con el separador canónico", () => {
    expect(serialiseFactions(["Orks", "Necrones"])).toBe(
      `Orks${FACTION_SEPARATOR}Necrones`
    );
  });

  it("elimina duplicados y espacios sobrantes", () => {
    expect(serialiseFactions([" Orks ", "Orks", "Necrones"])).toBe(
      "Orks · Necrones"
    );
  });

  it("quita los puntos medios de dentro de un nombre para que no se re-parseen", () => {
    const stored = serialiseFactions(["Orks · Necrones"]);
    // Both halves collapse into one name; parsing it back yields one faction,
    // not two, so the count a caller validated is the count that survives.
    expect(parseFactions(stored)).toHaveLength(1);
  });
});

describe("round-trip parse ↔ serialise", () => {
  it("una selección del catálogo sobrevive intacta al ir y volver", () => {
    const picked = ["Space Marines", "Death Guard", "Imperio T'au"];
    expect(parseFactions(serialiseFactions(picked))).toEqual(picked);
  });

  it("un valor de texto libre antiguo sobrevive intacto", () => {
    const legacy = "Craftworlds Aeldari";
    expect(serialiseFactions(parseFactions(legacy))).toBe(legacy);
  });

  it("formatFactions normaliza un valor mal espaciado sin perder nada", () => {
    expect(formatFactions("Orks·  Necrones ")).toBe("Orks · Necrones");
    expect(formatFactions(null)).toBeNull();
  });
});

describe("factionListSchema (lo que valida el servidor en /mi-perfil)", () => {
  it("acepta una lista vacía — quitar todas las facciones es legítimo", async () => {
    const { factionListSchema } = await import("@/lib/schemas");
    expect(factionListSchema.safeParse([]).success).toBe(true);
  });

  it("acepta hasta el cupo y rechaza pasarse", async () => {
    const { factionListSchema } = await import("@/lib/schemas");
    const atMax = ALL_FACTIONS.slice(0, MAX_FACTIONS_PER_PLAYER);
    const overMax = ALL_FACTIONS.slice(0, MAX_FACTIONS_PER_PLAYER + 1);
    expect(factionListSchema.safeParse(atMax).success).toBe(true);
    expect(factionListSchema.safeParse(overMax).success).toBe(false);
  });

  it("rechaza un nombre vacío o demasiado largo", async () => {
    const { factionListSchema } = await import("@/lib/schemas");
    expect(factionListSchema.safeParse([""]).success).toBe(false);
    expect(factionListSchema.safeParse(["x".repeat(81)]).success).toBe(false);
  });
});

describe("factionFieldSchema (lo que valida el servidor en los formularios de admin)", () => {
  it("acepta varias facciones unidas, que no cabían en el viejo límite de 80", async () => {
    const { updatePlayerSchema } = await import("@/lib/schemas");
    const faction = serialiseFactions([
      "Chaos Space Marines",
      "Emperor's Children",
      "Caballeros Imperiales",
      "Cultos Genestealer",
    ]);
    expect(faction!.length).toBeGreaterThan(80);
    const result = updatePlayerSchema.safeParse({
      displayName: "Jugador",
      faction,
    });
    expect(result.success).toBe(true);
  });

  it("rechaza un campo por encima del largo máximo", async () => {
    const { updatePlayerSchema } = await import("@/lib/schemas");
    const result = updatePlayerSchema.safeParse({
      displayName: "Jugador",
      faction: "x".repeat(MAX_FACTION_FIELD_LENGTH + 1),
    });
    expect(result.success).toBe(false);
  });
});
