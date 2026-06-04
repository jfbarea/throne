// Server actions for match management: pairing generation and schedule setting.
// Hito 6: emparejamientos-y-fechas.
// SPEC §7.2, §5, §4.4, ADR-007.

"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireAdmin, requireAuth } from "@/lib/guards";
import { generatePairings } from "@/server/pairings";
import { z } from "zod";

// Re-export the ActionResult type consistent with league-actions.
export type ActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: string };

// ---------------------------------------------------------------------------
// Schema: schedule a match (set/clear scheduledAt and optional location)
// ---------------------------------------------------------------------------

const scheduleMatchSchema = z.object({
  // ISO 8601 string or null to clear.
  scheduledAt: z
    .string()
    .datetime({ message: "Fecha inválida" })
    .nullable()
    .optional(),
  location: z
    .string()
    .trim()
    .max(200, "El lugar no puede superar los 200 caracteres")
    .nullable()
    .optional(),
});

export type ScheduleMatchInput = z.infer<typeof scheduleMatchSchema>;

// ---------------------------------------------------------------------------
// Admin action: generateLeagueMatches
// ---------------------------------------------------------------------------

/**
 * Generate (or regenerate) all round-robin league matches for the given league.
 *
 * Guard (SPEC §5): requires ADMIN session.
 *
 * Regeneration guard (SPEC §7.2, §9):
 *   - Blocked if any existing league match has status CONFIRMED (games already played).
 *   - If no confirmed matches exist, previous SCHEDULED/REPORTED/DISPUTED league
 *     matches are deleted and replaced with fresh ones (dates discarded).
 *
 * Postcondition: all new matches have phase=LEAGUE, status=SCHEDULED,
 *   scheduledAt=null, isBye=false.
 */
export async function generateLeagueMatches(
  leagueId: string
): Promise<ActionResult<{ count: number }>> {
  await requireAdmin();

  // Load league and its active players.
  const league = await prisma.league.findUnique({
    where: { id: leagueId },
  });

  if (!league) {
    return { ok: false, error: "Liga no encontrada" };
  }

  // Load active players for this league.
  const players = await prisma.player.findMany({
    where: { leagueId, active: true },
    select: { id: true, displayName: true },
  });

  if (players.length < 2) {
    return {
      ok: false,
      error:
        "Se necesitan al menos 2 jugadores activos para generar emparejamientos",
    };
  }

  // Regeneration guard: block if any league match is CONFIRMED.
  const confirmedCount = await prisma.match.count({
    where: {
      leagueId,
      phase: "LEAGUE",
      status: "CONFIRMED",
    },
  });

  if (confirmedCount > 0) {
    return {
      ok: false,
      error: `No se pueden regenerar los emparejamientos: hay ${confirmedCount} partida${confirmedCount !== 1 ? "s" : ""} con resultado confirmado. Finalizar o editar esas partidas antes de regenerar.`,
    };
  }

  // Generate pure pairings.
  const pairings = generatePairings(players);

  // Transactionally: delete old league matches (and their results via cascade
  // awareness — Result has matchId FK; delete matches deletes orphaned results
  // since Match is the owning side). Then create new ones.
  await prisma.$transaction(async (tx) => {
    // Delete existing league matches for this league.
    // Results are tied to matches; we delete results first due to FK constraints.
    const existingMatchIds = await tx.match.findMany({
      where: { leagueId, phase: "LEAGUE" },
      select: { id: true },
    });

    if (existingMatchIds.length > 0) {
      const ids = existingMatchIds.map((m) => m.id);
      await tx.result.deleteMany({ where: { matchId: { in: ids } } });
      await tx.match.deleteMany({ where: { id: { in: ids } } });
    }

    // Create new matches.
    await tx.match.createMany({
      data: pairings.map((p) => ({
        leagueId,
        phase: "LEAGUE" as const,
        status: "SCHEDULED" as const,
        playerHomeId: p.homeId,
        playerAwayId: p.awayId,
        scheduledAt: null,
        location: null,
        isBye: false,
      })),
    });

    // If the league is still in SETUP, transition it to LEAGUE phase.
    if (league.status === "SETUP") {
      await tx.league.update({
        where: { id: leagueId },
        data: { status: "LEAGUE" },
      });
    }
  });

  revalidatePath("/admin/emparejamientos");
  revalidatePath("/calendario");
  revalidatePath("/admin");

  return { ok: true, data: { count: pairings.length } };
}

// ---------------------------------------------------------------------------
// Participant/admin action: setMatchSchedule
// ---------------------------------------------------------------------------

/**
 * Set, edit, or clear the scheduled date (and optional location) of a match.
 *
 * Authorization (SPEC §5, §7.2):
 *   - The logged-in player must be home or away of the match, OR admin.
 *   - The server reads identity exclusively from the signed session cookie —
 *     no playerId is accepted from the client.
 *
 * Either or both fields may be omitted; omitted fields are not changed.
 * Pass scheduledAt: null explicitly to clear the date.
 */
export async function setMatchSchedule(
  matchId: string,
  input: ScheduleMatchInput
): Promise<ActionResult> {
  const session = await requireAuth();

  // Load the match to authorize.
  const match = await prisma.match.findUnique({
    where: { id: matchId },
    select: {
      id: true,
      leagueId: true,
      playerHomeId: true,
      playerAwayId: true,
      phase: true,
    },
  });

  if (!match) {
    return { ok: false, error: "Partida no encontrada" };
  }

  // Authorization: must be home, away, or admin.
  const isAdmin = session.role === "ADMIN";
  const isParticipant =
    session.playerId !== null &&
    (match.playerHomeId === session.playerId ||
      match.playerAwayId === session.playerId);

  if (!isAdmin && !isParticipant) {
    return {
      ok: false,
      error: "No tienes permiso para modificar la fecha de esta partida",
    };
  }

  // Validate input.
  const parsed = scheduleMatchSchema.safeParse(input);
  if (!parsed.success) {
    const flat = parsed.error.flatten();
    const firstFieldError = Object.values(flat.fieldErrors).flat()[0];
    const firstFormError = flat.formErrors[0];
    return {
      ok: false,
      error: firstFieldError ?? firstFormError ?? "Datos inválidos",
    };
  }

  const d = parsed.data;

  // Build update payload — only include fields that were provided.
  const updateData: {
    scheduledAt?: Date | null;
    location?: string | null;
  } = {};

  if ("scheduledAt" in d) {
    updateData.scheduledAt =
      d.scheduledAt != null ? new Date(d.scheduledAt) : null;
  }
  if ("location" in d) {
    updateData.location = d.location ?? null;
  }

  if (Object.keys(updateData).length === 0) {
    // Nothing to update — no-op success.
    return { ok: true, data: undefined };
  }

  await prisma.match.update({
    where: { id: matchId },
    data: updateData,
  });

  revalidatePath("/calendario");
  revalidatePath("/admin/emparejamientos");

  return { ok: true, data: undefined };
}
