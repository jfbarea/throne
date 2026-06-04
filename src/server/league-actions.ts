// Server-side domain actions for league configuration and player management.
// Hito 5: admin-liga-jugadores.
// All mutations are protected — callers must have already verified admin identity.
// SPEC §4.1, §4.2, §5.

"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import {
  leagueConfigSchema,
  createPlayerSchema,
  updatePlayerSchema,
  serialiseTiebreakers,
  type LeagueConfigInput,
  type CreatePlayerInput,
  type UpdatePlayerInput,
} from "@/lib/schemas";
import { generateHashedPasscode } from "@/lib/passcode";
import { requireAdmin } from "@/lib/guards";

// ---------------------------------------------------------------------------
// Types returned to the client
// ---------------------------------------------------------------------------

export type ActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: string; fieldErrors?: Record<string, string[]> };

// ---------------------------------------------------------------------------
// League: create
// ---------------------------------------------------------------------------

/**
 * Create a new league in SETUP status.
 * In the MVP there is a single active league; this action does not enforce
 * uniqueness — the UI should guide the admin accordingly.
 */
export async function createLeague(
  input: LeagueConfigInput
): Promise<ActionResult<{ id: string }>> {
  await requireAdmin();

  const parsed = leagueConfigSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Datos de configuración inválidos",
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    };
  }

  const d = parsed.data;
  const league = await prisma.league.create({
    data: {
      name: d.name,
      season: d.season,
      status: "SETUP",
      pointsWin: d.pointsWin,
      pointsDraw: d.pointsDraw,
      pointsLoss: d.pointsLoss,
      bonusEnabled: d.bonusEnabled,
      bonusMarginThreshold: d.bonusEnabled
        ? (d.bonusMarginThreshold ?? null)
        : null,
      bonusMinVP: d.bonusEnabled ? (d.bonusMinVP ?? null) : null,
      playoffSize: d.playoffSize,
      tiebreakers: serialiseTiebreakers(d.tiebreakers),
    },
  });

  revalidatePath("/admin");
  revalidatePath("/admin/liga");
  return { ok: true, data: { id: league.id } };
}

// ---------------------------------------------------------------------------
// League: update config
// ---------------------------------------------------------------------------

/**
 * Update the configuration of an existing league.
 * Cross-validates playoffSize against active player count.
 */
export async function updateLeague(
  leagueId: string,
  input: LeagueConfigInput
): Promise<ActionResult> {
  await requireAdmin();

  const parsed = leagueConfigSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Datos de configuración inválidos",
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    };
  }

  const d = parsed.data;

  // Cross-validate: playoffSize must not exceed active player count.
  const activeCount = await prisma.player.count({
    where: { leagueId, active: true },
  });
  if (d.playoffSize > activeCount && activeCount > 0) {
    return {
      ok: false,
      error: `El tamaño de playoffs (${d.playoffSize}) supera el número de jugadores activos (${activeCount})`,
      fieldErrors: {
        playoffSize: [
          `Debe ser como máximo ${activeCount} (jugadores activos actuales)`,
        ],
      },
    };
  }

  await prisma.league.update({
    where: { id: leagueId },
    data: {
      name: d.name,
      season: d.season,
      pointsWin: d.pointsWin,
      pointsDraw: d.pointsDraw,
      pointsLoss: d.pointsLoss,
      bonusEnabled: d.bonusEnabled,
      bonusMarginThreshold: d.bonusEnabled
        ? (d.bonusMarginThreshold ?? null)
        : null,
      bonusMinVP: d.bonusEnabled ? (d.bonusMinVP ?? null) : null,
      playoffSize: d.playoffSize,
      tiebreakers: serialiseTiebreakers(d.tiebreakers),
    },
  });

  revalidatePath("/admin");
  revalidatePath("/admin/liga");
  return { ok: true, data: undefined };
}

// ---------------------------------------------------------------------------
// Player: create — generates and returns passcode (shown once)
// ---------------------------------------------------------------------------

/**
 * Create a new player in the given league.
 * Generates a random passcode, hashes it (bcrypt), persists the hash,
 * and returns the plain passcode ONE TIME to the admin.
 * After this call the plain passcode is never stored and cannot be retrieved.
 */
export async function createPlayer(
  leagueId: string,
  input: CreatePlayerInput
): Promise<ActionResult<{ id: string; plainPasscode: string }>> {
  await requireAdmin();

  const parsed = createPlayerSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Datos del jugador inválidos",
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    };
  }

  const d = parsed.data;

  // Check displayName uniqueness within the league.
  const existing = await prisma.player.findFirst({
    where: { leagueId, displayName: d.displayName },
  });
  if (existing) {
    return {
      ok: false,
      error: `Ya existe un jugador con el nombre "${d.displayName}" en esta liga`,
      fieldErrors: {
        displayName: [
          `Nombre en uso — elige un nombre diferente o edita el existente`,
        ],
      },
    };
  }

  const { plain, hash } = await generateHashedPasscode();

  const player = await prisma.player.create({
    data: {
      leagueId,
      displayName: d.displayName,
      faction: d.faction ?? null,
      role: d.role ?? "PLAYER",
      passcodeHash: hash,
      active: true,
    },
  });

  revalidatePath("/admin/jugadores");
  return { ok: true, data: { id: player.id, plainPasscode: plain } };
}

// ---------------------------------------------------------------------------
// Player: update displayName / faction / role
// ---------------------------------------------------------------------------

export async function updatePlayer(
  playerId: string,
  input: UpdatePlayerInput
): Promise<ActionResult> {
  await requireAdmin();

  const parsed = updatePlayerSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Datos del jugador inválidos",
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    };
  }

  const d = parsed.data;

  await prisma.player.update({
    where: { id: playerId },
    data: {
      displayName: d.displayName,
      faction: d.faction ?? null,
      ...(d.role ? { role: d.role } : {}),
    },
  });

  revalidatePath("/admin/jugadores");
  return { ok: true, data: undefined };
}

// ---------------------------------------------------------------------------
// Player: soft deactivate / reactivate (SPEC §4.2 — active flag for history)
// ---------------------------------------------------------------------------

export async function setPlayerActive(
  playerId: string,
  active: boolean
): Promise<ActionResult> {
  await requireAdmin();

  await prisma.player.update({
    where: { id: playerId },
    data: { active },
  });

  revalidatePath("/admin/jugadores");
  return { ok: true, data: undefined };
}

// ---------------------------------------------------------------------------
// Player: reset passcode — generate a new one, hash it, return plain once
// ---------------------------------------------------------------------------

/**
 * Reset a player's passcode. Generates a new random passcode, hashes it,
 * persists the hash, and returns the plain text ONE TIME to the admin.
 */
export async function resetPlayerPasscode(
  playerId: string
): Promise<ActionResult<{ plainPasscode: string }>> {
  await requireAdmin();

  const { plain, hash } = await generateHashedPasscode();

  await prisma.player.update({
    where: { id: playerId },
    data: { passcodeHash: hash },
  });

  revalidatePath("/admin/jugadores");
  return { ok: true, data: { plainPasscode: plain } };
}
