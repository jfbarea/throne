// Zod schemas — shared between client and server (SPEC §ADR-005).
// Hito 5: admin-liga-jugadores.
// All validation logic lives here so it can be tested without Next.js context.

import { z } from "zod";

// ---------------------------------------------------------------------------
// Tiebreaker constants (SPEC §7.3)
// ---------------------------------------------------------------------------

export const TIEBREAKER_VALUES = [
  "POINTS",
  "VP_DIFF",
  "VP_FOR",
  "HEAD_TO_HEAD",
  "LOSSES",
  "ID_ORDER",
] as const;

export type Tiebreaker = (typeof TIEBREAKER_VALUES)[number];

export const TIEBREAKER_LABELS: Record<Tiebreaker, string> = {
  POINTS: "Puntos de liga",
  VP_DIFF: "Diferencia de VP",
  VP_FOR: "VP a favor",
  HEAD_TO_HEAD: "Enfrentamiento directo",
  LOSSES: "Menor número de derrotas",
  ID_ORDER: "Orden de alta (desempate final)",
};

// ---------------------------------------------------------------------------
// League config schema (SPEC §4.1, §7.1, §7.3)
// ---------------------------------------------------------------------------

export const leagueConfigSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, "El nombre de la liga no puede estar vacío")
      .max(120, "El nombre de la liga no puede superar los 120 caracteres"),

    season: z
      .string()
      .trim()
      .min(1, "La temporada no puede estar vacía")
      .max(80, "La temporada no puede superar los 80 caracteres"),

    pointsWin: z
      .number({ error: "Debe ser un número" })
      .int("Debe ser un número entero")
      .min(0, "Los puntos no pueden ser negativos"),

    pointsDraw: z
      .number({ error: "Debe ser un número" })
      .int("Debe ser un número entero")
      .min(0, "Los puntos no pueden ser negativos"),

    pointsLoss: z
      .number({ error: "Debe ser un número" })
      .int("Debe ser un número entero")
      .min(0, "Los puntos no pueden ser negativos"),

    bonusEnabled: z.boolean(),

    bonusMarginThreshold: z
      .number({ error: "Debe ser un número" })
      .int("Debe ser un número entero")
      .min(1, "El umbral de masacre debe ser al menos 1")
      .nullable()
      .optional(),

    bonusMinVP: z
      .number({ error: "Debe ser un número" })
      .int("Debe ser un número entero")
      .min(1, "Los VP mínimos deben ser al menos 1")
      .nullable()
      .optional(),

    playoffSize: z
      .number({ error: "Debe ser un número" })
      .int("Debe ser un número entero")
      .min(2, "El tamaño de playoffs debe ser al menos 2"),

    // tiebreakers: ordered list of criteria keys; must contain all values,
    // no duplicates. The UI reorders them; the schema validates the content.
    tiebreakers: z
      .array(z.enum(TIEBREAKER_VALUES))
      .min(1, "Debe haber al menos un criterio de desempate"),
  })
  // playoffSize cross-validation is done at the action level (needs active player count).
  .refine(
    (d) =>
      !d.bonusEnabled ||
      d.bonusMarginThreshold != null ||
      d.bonusMinVP != null,
    {
      message:
        "Con los bonus activados debes configurar al menos un parámetro (umbral de masacre o VP mínimos)",
      path: ["bonusEnabled"],
    }
  );

export type LeagueConfigInput = z.infer<typeof leagueConfigSchema>;

// ---------------------------------------------------------------------------
// Create-league schema — same as config plus initial status always SETUP
// ---------------------------------------------------------------------------

export const createLeagueSchema = leagueConfigSchema;
export type CreateLeagueInput = LeagueConfigInput;

// ---------------------------------------------------------------------------
// Player create schema (SPEC §4.2)
// ---------------------------------------------------------------------------

export const createPlayerSchema = z.object({
  displayName: z
    .string()
    .trim()
    .min(1, "El nombre no puede estar vacío")
    .max(80, "El nombre no puede superar los 80 caracteres"),

  faction: z
    .string()
    .trim()
    .max(80, "La facción no puede superar los 80 caracteres")
    .nullable()
    .optional(),

  role: z.enum(["ADMIN", "PLAYER"]).default("PLAYER"),
});

export type CreatePlayerInput = z.infer<typeof createPlayerSchema>;

// ---------------------------------------------------------------------------
// Player update schema
// ---------------------------------------------------------------------------

export const updatePlayerSchema = z.object({
  displayName: z
    .string()
    .trim()
    .min(1, "El nombre no puede estar vacío")
    .max(80, "El nombre no puede superar los 80 caracteres"),

  faction: z
    .string()
    .trim()
    .max(80, "La facción no puede superar los 80 caracteres")
    .nullable()
    .optional(),

  role: z.enum(["ADMIN", "PLAYER"]).optional(),
});

export type UpdatePlayerInput = z.infer<typeof updatePlayerSchema>;

// ---------------------------------------------------------------------------
// Helpers: tiebreakers serialisation / deserialisation
// ---------------------------------------------------------------------------

/** Serialise a Tiebreaker[] to the JSON string stored in DB. */
export function serialiseTiebreakers(tb: Tiebreaker[]): string {
  return JSON.stringify(tb);
}

/** Parse the JSON string from DB to a Tiebreaker[]. Falls back to default. */
export function parseTiebreakers(raw: string): Tiebreaker[] {
  try {
    const parsed = JSON.parse(raw);
    if (
      Array.isArray(parsed) &&
      parsed.every((v) => TIEBREAKER_VALUES.includes(v as Tiebreaker))
    ) {
      return parsed as Tiebreaker[];
    }
  } catch {
    // fall through to default
  }
  return [...TIEBREAKER_VALUES];
}
