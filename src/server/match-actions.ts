// Server actions for match management: pairing generation and schedule setting.
// Hito 6: emparejamientos-y-fechas.
// SPEC §7.2, §5, §4.4, ADR-007.

"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireAdmin, requireAuth } from "@/lib/guards";
import { missingPairings } from "@/server/pairings";
import { roundRobinRounds, deriveDeadlines } from "@/server/rounds";
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
 * Generate (or regenerate) all round-robin league matches for the given league,
 * split into monthly rounds (rondas-con-fecha spec §4.2, §4.3, §4.4).
 *
 * Guard (SPEC §5): requires ADMIN session.
 *
 * Rounds guard (rondas-con-fecha spec §4.4, PLAN.md H3): refuses to generate
 * — creating neither a Round nor a Match — while `league.startMonth` is
 * `null`. Without a starting month there is nothing to derive round
 * deadlines from (D1, PLAN.md): a league in SETUP can legitimately have no
 * starting month yet, and that must stay an explicit blocker, not an
 * invented default.
 *
 * Regeneration guard (SPEC §7.2, §9):
 *   - Blocked if any existing league match has status CONFIRMED (games already played).
 *   - If no confirmed matches exist, previous SCHEDULED/REPORTED/DISPUTED league
 *     matches (and their Round rows) are deleted and replaced with fresh ones
 *     (dates discarded).
 *
 * Postcondition: all new matches have phase=LEAGUE, status=SCHEDULED,
 *   scheduledAt=null, isBye=false, roundId pointing at a freshly created Round.
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

  // Rounds guard: nothing to derive deadlines from without a starting month.
  // Checked before any other read/write so a league missing this config
  // never ends up with a partial, DB-inconsistent generation.
  if (league.startMonth === null) {
    return {
      ok: false,
      error:
        "La liga no tiene un mes de arranque configurado. Fíjalo en la configuración de la liga antes de generar los emparejamientos.",
    };
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

  // Generate the pure round-robin, already split into rounds (before the
  // transaction — pure computation, no DB). SPEC §4.3: the circle method
  // over the complete graph is the exact construction used here.
  const rounds = roundRobinRounds(
    players.map((p) => p.id),
    league.matchesPerRound
  );
  const deadlines = deriveDeadlines(league.startMonth, rounds.length);
  const totalMatchCount = rounds.reduce((sum, r) => sum + r.length, 0);

  // Transactionally: check regeneration guard, delete old rounds/matches,
  // create the new ones. TOCTOU fix: the confirmed-count check now lives
  // INSIDE the transaction so the read and the delete/create are atomic (no
  // race between two concurrent requests).
  const guardResult = await prisma.$transaction(async (tx) => {
    // Regeneration guard (Hito 15): block if any league match has a result
    // apuntado (status REPORTED or CONFIRMED). REPORTED is the new active status;
    // CONFIRMED is kept for legacy data compatibility.
    const confirmedCount = await tx.match.count({
      where: {
        leagueId,
        phase: "LEAGUE",
        status: { in: ["REPORTED", "CONFIRMED"] },
      },
    });

    if (confirmedCount > 0) {
      // Return the count so the caller can build the error message.
      return { blocked: true, confirmedCount } as const;
    }

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

    // Delete existing Round rows for this league — matches referencing them
    // are already gone, and @@unique([leagueId, index]) would otherwise
    // collide with the fresh rounds created below.
    await tx.round.deleteMany({ where: { leagueId } });

    // Create the new Round rows one at a time (not createMany) so we get
    // each generated id back to assign as Match.roundId below.
    const roundIds: string[] = [];
    for (let i = 0; i < rounds.length; i++) {
      const round = await tx.round.create({
        data: { leagueId, index: i + 1, deadline: deadlines[i] },
      });
      roundIds.push(round.id);
    }

    // Create new matches, each tied to the round it was assigned to.
    await tx.match.createMany({
      data: rounds.flatMap((roundPairs, i) =>
        roundPairs.map((p) => ({
          leagueId,
          phase: "LEAGUE" as const,
          status: "SCHEDULED" as const,
          playerHomeId: p.homeId,
          playerAwayId: p.awayId,
          scheduledAt: null,
          location: null,
          isBye: false,
          roundId: roundIds[i],
        }))
      ),
    });

    // If the league is still in SETUP, transition it to LEAGUE phase.
    if (league.status === "SETUP") {
      await tx.league.update({
        where: { id: leagueId },
        data: { status: "LEAGUE" },
      });
    }

    return { blocked: false } as const;
  });

  if (guardResult.blocked) {
    const count = guardResult.confirmedCount;
    return {
      ok: false,
      error: `No se pueden regenerar los emparejamientos: hay ${count} partida${count !== 1 ? "s" : ""} con resultado apuntado. Usa "Añadir los que faltan" en su lugar para no perder resultados existentes.`,
    };
  }

  revalidatePath("/admin/emparejamientos");
  revalidatePath("/admin/rondas");
  revalidatePath("/calendario");
  revalidatePath("/admin");

  return { ok: true, data: { count: totalMatchCount } };
}

// ---------------------------------------------------------------------------
// Admin action: addMissingLeagueMatches
// ---------------------------------------------------------------------------

/**
 * Incrementally add only the league match pairs that are not yet present.
 *
 * Unlike `generateLeagueMatches`, this action:
 *   - NEVER deletes any existing matches, dates, or results.
 *   - Works even when confirmed matches exist (no regeneration guard).
 *   - Only creates pairs between currently ACTIVE players.
 *   - If the league is still in SETUP and at least one new match is created,
 *     transitions the league status to LEAGUE (same pattern as full generation).
 *
 * Guard (SPEC §5): requires ADMIN session.
 *
 * @returns { count } — number of new matches created (0 if none were missing).
 */
export async function addMissingLeagueMatches(
  leagueId: string
): Promise<ActionResult<{ count: number }>> {
  await requireAdmin();

  // Load league.
  const league = await prisma.league.findUnique({
    where: { id: leagueId },
  });

  if (!league) {
    return { ok: false, error: "Liga no encontrada" };
  }

  // Load active players.
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

  // Read existing pairs, compute what's missing, and create the new matches all
  // INSIDE one transaction so the read and the create are atomic. Otherwise two
  // concurrent calls could both read "pair {A,B} missing" and each create it,
  // producing duplicates (negligible on SQLite, real on Postgres).
  const createdCount = await prisma.$transaction(async (tx) => {
    // Load existing LEAGUE pairs (home/away IDs only).
    const existingMatches = await tx.match.findMany({
      where: { leagueId, phase: "LEAGUE" },
      select: { playerHomeId: true, playerAwayId: true },
    });

    // Map to ExistingPair shape (aId = home, bId = away — order is irrelevant for
    // the unordered comparison inside missingPairings).
    // playerAwayId is nullable in the schema (playoff byes); league matches always
    // have an away player, but we guard with a filter to keep types clean.
    const existingPairs = existingMatches
      .filter(
        (m): m is typeof m & { playerAwayId: string } => m.playerAwayId !== null
      )
      .map((m) => ({
        aId: m.playerHomeId,
        bId: m.playerAwayId,
      }));

    // Compute the pairs that are not yet present.
    const newPairings = missingPairings(players, existingPairs);

    if (newPairings.length === 0) {
      // Nothing to create — leave league status untouched.
      return 0;
    }

    await tx.match.createMany({
      data: newPairings.map((p) => ({
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

    // If the league is still in SETUP, transition it to LEAGUE.
    if (league.status === "SETUP") {
      await tx.league.update({
        where: { id: leagueId },
        data: { status: "LEAGUE" },
      });
    }

    return newPairings.length;
  });

  if (createdCount > 0) {
    revalidatePath("/admin/emparejamientos");
    revalidatePath("/calendario");
    revalidatePath("/admin");
  }

  return { ok: true, data: { count: createdCount } };
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
