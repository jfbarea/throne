// Zod schemas — shared between client and server (SPEC §ADR-005).
// Hito 5: admin-liga-jugadores.
// All validation logic lives here so it can be tested without Next.js context.

import { z } from "zod";
import {
  MAX_FACTIONS_PER_PLAYER,
  MAX_FACTION_FIELD_LENGTH,
  MAX_FACTION_NAME_LENGTH,
} from "./factions";

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

    // Rondas-con-fecha (plan/specs/rondas-con-fecha.md §6.2, §4.2): matches
    // each player must play per round. No upper bound — a value greater
    // than n-1 simply produces a single round (spec §6.2).
    matchesPerRound: z
      .number({ error: "Debe ser un número" })
      .int("Debe ser un número entero")
      .min(1, "El número de partidas por ronda debe ser como mínimo 1")
      .default(2),

    // startMonth: the league's starting month. Accepts a Date or a string
    // (e.g. the "YYYY-MM" value a native <input type="month"> sends), and is
    // always normalised to the first day of that month at UTC midnight
    // (spec §6.2), regardless of which day the input actually carried.
    // Nullable/optional on purpose: a league in SETUP may not have a
    // starting month configured yet (§4.4) — that is an explicit `null`,
    // never a guessed value (D1, PLAN.md).
    startMonth: z
      .union([z.string(), z.date()])
      .nullable()
      .optional()
      .transform((val, ctx) => {
        if (val === null || val === undefined || val === "") return null;
        const date = typeof val === "string" ? new Date(val) : val;
        if (Number.isNaN(date.getTime())) {
          ctx.addIssue({
            code: "custom",
            message: "Fecha de arranque inválida",
          });
          return z.NEVER;
        }
        return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
      }),
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

// The schema's `startMonth` field is a transform (string/Date in, Date|null
// out), so the type callers pass in (before parsing) differs from what
// `.safeParse(...).data` yields afterwards. `LeagueConfigInput` is the
// former — what the client actually sends.
export type LeagueConfigInput = z.input<typeof leagueConfigSchema>;
export type LeagueConfigOutput = z.output<typeof leagueConfigSchema>;

// ---------------------------------------------------------------------------
// Admin's own player name for a brand-new league
// (multi-liga spec §2.9, §4.9 — D2 crear-duplicar-borrar)
// ---------------------------------------------------------------------------

/**
 * Validates the display name for the ADMIN `Player` row created alongside a
 * brand-new league (`/admin/nueva`, `createLeague`). Same length bounds as
 * `createPlayerSchema.displayName` below — it's still a `Player.displayName`
 * row, just never subject to the global-uniqueness check that applies to
 * `role: "PLAYER"` names (spec §2.7's admin exception).
 */
export const adminDisplayNameSchema = z
  .string()
  .trim()
  .min(1, "El nombre del admin no puede estar vacío")
  .max(80, "El nombre del admin no puede superar los 80 caracteres");

/**
 * `createLeague`'s full input: the same league configuration as
 * `LeagueConfigInput` plus the admin's own player name for the league being
 * created (spec §4.9: "El formulario de creación incluye el nombre de
 * jugador del admin, precargado con el que use en la liga en circulación
 * más reciente"). `adminDisplayName` is optional here — not because the
 * product allows skipping it (the `/admin/nueva` form always sends it), but
 * so `createLeague`'s pre-existing callers (direct test fixtures) keep
 * compiling and working unchanged: `createLeague` falls back to a generic
 * admin name when it's missing.
 */
export interface CreateLeagueInput extends LeagueConfigInput {
  adminDisplayName?: string;
}

// ---------------------------------------------------------------------------
// Duplicate league — only name + season for the destination; everything
// else is copied from the origin (multi-liga spec §2.9, §4.8 — D2)
// ---------------------------------------------------------------------------

export const duplicateLeagueSchema = z.object({
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
});

export type DuplicateLeagueInput = z.infer<typeof duplicateLeagueSchema>;

// ---------------------------------------------------------------------------
// Factions (src/lib/factions.ts)
// ---------------------------------------------------------------------------

/**
 * The serialised `Player.faction` column: one or more faction names joined by
 * FACTION_SEPARATOR (src/lib/factions.ts). The cap is on the whole field, not
 * on a single name, because a player may declare several armies.
 */
export const factionFieldSchema = z
  .string()
  .trim()
  .max(
    MAX_FACTION_FIELD_LENGTH,
    `Las facciones no pueden superar los ${MAX_FACTION_FIELD_LENGTH} caracteres en total`
  )
  .nullable()
  .optional();

/**
 * The client-side shape of the same data: the list of picked factions, before
 * `serialiseFactions` joins it. Used by the own-profile action so the server
 * validates the list (count, per-name length) instead of trusting a
 * pre-joined string built in the browser.
 */
export const factionListSchema = z
  .array(
    z
      .string()
      .trim()
      .min(1, "Una facción no puede estar vacía")
      .max(
        MAX_FACTION_NAME_LENGTH,
        `Una facción no puede superar los ${MAX_FACTION_NAME_LENGTH} caracteres`
      )
  )
  .max(
    MAX_FACTIONS_PER_PLAYER,
    `No puedes elegir más de ${MAX_FACTIONS_PER_PLAYER} facciones`
  );

export const updateOwnFactionsSchema = z.object({
  factions: factionListSchema,
});

export type UpdateOwnFactionsInput = z.infer<typeof updateOwnFactionsSchema>;

// ---------------------------------------------------------------------------
// Player create schema (SPEC §4.2)
// ---------------------------------------------------------------------------

export const createPlayerSchema = z.object({
  displayName: z
    .string()
    .trim()
    .min(1, "El nombre no puede estar vacío")
    .max(80, "El nombre no puede superar los 80 caracteres"),

  faction: factionFieldSchema,

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

  faction: factionFieldSchema,

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
