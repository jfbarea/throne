// Server actions for Round management.
// Hito 3 (generar-con-rondas): editing a round's deadline.
// Hito 4 (cierre-de-ronda): closing a round.
// SPEC §4.4, §4.7, §5.7, §5.8, §7.1.

"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/guards";
import { z } from "zod";

export type ActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: string };

// ---------------------------------------------------------------------------
// closeRound TOCTOU sentinel (H5b sweep, plan/rondas-con-fecha/PLAN.md)
// ---------------------------------------------------------------------------

/**
 * Internal sentinel thrown inside `closeRound`'s transaction to abort it
 * when the authoritative re-read of the round (with `tx`) finds it already
 * closed or its deadline no longer due — see the docstring on `closeRound`.
 * Caught right outside `prisma.$transaction` and turned into the same
 * user-facing rejection the corresponding fast-path check above returns;
 * scoped with `instanceof` so a real DB failure inside the transaction is
 * never mistaken for one of these two guards.
 */
class CloseRoundGuardFailedError extends Error {
  constructor(
    public readonly reason: "not_found" | "already_closed" | "not_due"
  ) {
    super();
  }
}

// ---------------------------------------------------------------------------
// Schema: edit a round's deadline
// ---------------------------------------------------------------------------

/**
 * Accepts a plain "YYYY-MM-DD" date (the shape a native <input type="date">
 * sends) and turns it into a UTC-midnight Date, same convention as
 * `deriveDeadlines` (src/server/rounds.ts) uses for the derived deadlines.
 */
const updateRoundDeadlineSchema = z.object({
  deadline: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha de cierre inválida")
    .transform((val) => {
      const [year, month, day] = val.split("-").map(Number);
      return new Date(Date.UTC(year, month - 1, day));
    }),
});

export type UpdateRoundDeadlineInput = z.input<
  typeof updateRoundDeadlineSchema
>;

// ---------------------------------------------------------------------------
// Admin action: updateRoundDeadline
// ---------------------------------------------------------------------------

/**
 * Edit the deadline of a single round (SPEC §4.4: "el admin puede editar la
 * fecha de cualquier ronda a mano").
 *
 * Deliberately does NOT:
 *   - Reassign any Match to a different round (SPEC §4.3, §8 criterio 14 —
 *     the round of a match is fixed by the pairing algorithm and nobody,
 *     admin included, can move it from here or anywhere else).
 *   - Touch any Match's `scheduledAt` (§8 criterio 8).
 *   - Require the new deadline to keep the rounds in chronological order
 *     (§4.4: "que las fechas queden ordenadas es responsabilidad del
 *     admin").
 *
 * Guard (SPEC §7.1): requires ADMIN session.
 */
export async function updateRoundDeadline(
  roundId: string,
  input: UpdateRoundDeadlineInput
): Promise<ActionResult> {
  const session = await requireAdmin();

  const parsed = updateRoundDeadlineSchema.safeParse(input);
  if (!parsed.success) {
    const message = parsed.error.issues[0]?.message ?? "Fecha inválida";
    return { ok: false, error: message };
  }

  const round = await prisma.round.findUnique({ where: { id: roundId } });
  if (!round) {
    return { ok: false, error: "Ronda no encontrada" };
  }

  const newDeadline = parsed.data.deadline;

  await prisma.$transaction(async (tx) => {
    await tx.round.update({
      where: { id: roundId },
      data: { deadline: newDeadline },
    });

    // Best-effort audit trail (requires an admin player in the session,
    // same convention as resetLeague — src/server/league-actions.ts).
    if (session.playerId) {
      await tx.auditLog.create({
        data: {
          actorId: session.playerId,
          action: "UPDATE_ROUND_DEADLINE",
          entityType: "Round",
          entityId: roundId,
          payload: JSON.stringify({
            leagueId: round.leagueId,
            roundIndex: round.index,
            previousDeadline: round.deadline.toISOString(),
            newDeadline: newDeadline.toISOString(),
          }),
        },
      });
    }
  });

  revalidatePath("/admin/rondas");

  return { ok: true, data: undefined };
}

// ---------------------------------------------------------------------------
// Admin action: closeRound
// ---------------------------------------------------------------------------

/**
 * Close a round: every match in it that still has no `Result` gets settled
 * as a 0-0 draw (SPEC §4.7, §4.8, §4.9, criterio 18):
 *   homeVictoryPoints = 0, awayVictoryPoints = 0, outcome = DRAW,
 *   resolution = UNPLAYED_DRAW, bonusHome = bonusAway = 0.
 *
 * Deliberately does NOT go through `calculateBonus` (§4.8: the 0-0 never
 * earns bonus, unlike a real 0-0 draw someone plays out and reports, which
 * would still be checked against the bonus config via `reportResult`).
 *
 * Matches that already have a `Result` are left untouched (criterio 19) —
 * the query below only selects matches with `result: null`.
 *
 * Guards (SPEC §5.7, §7.1):
 *   - `requireAdmin()` first.
 *   - Refuses if the round doesn't exist, is already closed, or its
 *     `deadline` hasn't arrived yet. There is no separate "force close"
 *     path (§5.7): moving the deadline (`updateRoundDeadline`) is the only
 *     way to close early.
 *
 * No ordering precondition (§5.8, criterio 22): closing round 4 while round
 * 3 is still open is allowed and doesn't touch round 3 at all.
 *
 * Everything — settling the pending matches, sealing `closedAt`, and the
 * `AuditLog` entry — happens in one `prisma.$transaction` (SPEC §7.1).
 *
 * TOCTOU hardening (H5b sweep, plan/rondas-con-fecha/PLAN.md): `closedAt`
 * and `deadline` are read once above for a fast, friendly rejection, then
 * re-read with `tx` as the very first thing inside the transaction. This
 * closes an admin-vs-admin race (only admin actions ever touch `Round`):
 * two overlapping `closeRound` calls on the same round would otherwise both
 * pass the outer checks and the second would silently "succeed" again
 * (`settledCount: 0`, `closedAt` overwritten with a later timestamp, a
 * redundant `CLOSE_ROUND` audit entry) instead of being rejected as
 * "ya está cerrada" — the exact double-close `updateRoundDeadline` and this
 * docstring both say can't happen. Per-match settlement (criterio 18) was
 * already race-safe: `unresolvedMatches` below is read with `tx`, not from a
 * stale snapshot, so a match a participant reports mid-race is correctly
 * excluded either way. Behavior in the non-racing path is unchanged — same
 * checks, same messages, same happy path.
 */
export async function closeRound(
  roundId: string
): Promise<ActionResult<{ settledCount: number }>> {
  const session = await requireAdmin();

  const round = await prisma.round.findUnique({ where: { id: roundId } });
  if (!round) {
    return { ok: false, error: "Ronda no encontrada" };
  }

  if (round.closedAt !== null) {
    return { ok: false, error: "La ronda ya está cerrada" };
  }

  if (round.deadline.getTime() > Date.now()) {
    return {
      ok: false,
      error:
        "No se puede cerrar la ronda antes de su fecha de cierre. Si quieres cerrarla antes, mueve primero la fecha.",
    };
  }

  // Admin sessions must have a playerId for DB writes (same convention as
  // reportResult — src/server/result-actions.ts).
  if (!session.playerId) {
    return {
      ok: false,
      error:
        "La sesión de administrador no tiene un jugador asociado. Usa un jugador con rol ADMIN.",
    };
  }
  const actorId = session.playerId;

  let settledCount: number;
  try {
    settledCount = await prisma.$transaction(async (tx) => {
      // Authoritative re-read (H5b, TOCTOU): the outer checks above are a
      // fast-path shortcut and can be stale by the time the transaction
      // actually runs — re-verify against `tx`, the transaction's own
      // client, as the very first thing it does.
      const currentRound = await tx.round.findUnique({
        where: { id: roundId },
        select: { closedAt: true, deadline: true },
      });
      if (!currentRound) {
        throw new CloseRoundGuardFailedError("not_found");
      }
      if (currentRound.closedAt !== null) {
        throw new CloseRoundGuardFailedError("already_closed");
      }
      if (currentRound.deadline.getTime() > Date.now()) {
        throw new CloseRoundGuardFailedError("not_due");
      }

      // Only matches of this round without a Result yet — matches that already
      // have one are never touched (criterio 19). Read with `tx`, not from a
      // stale snapshot, so a match a participant reported mid-race is
      // correctly excluded either way (already race-safe before H5b).
      const unresolvedMatches = await tx.match.findMany({
        where: { roundId, result: null },
        select: { id: true },
      });
      const ids = unresolvedMatches.map((m) => m.id);

      if (ids.length > 0) {
        await tx.result.createMany({
          data: ids.map((matchId) => ({
            matchId,
            homeVictoryPoints: 0,
            awayVictoryPoints: 0,
            outcome: "DRAW" as const,
            resolution: "UNPLAYED_DRAW" as const,
            reportedById: actorId,
            bonusHome: 0,
            bonusAway: 0,
          })),
        });

        // A Match with a Result counts for standings via isConfirmedForStandings
        // (src/server/standings.ts), which requires status REPORTED/CONFIRMED
        // AND a Result — so the settled matches must transition too.
        await tx.match.updateMany({
          where: { id: { in: ids } },
          data: { status: "REPORTED" },
        });
      }

      await tx.round.update({
        where: { id: roundId },
        data: { closedAt: new Date() },
      });

      await tx.auditLog.create({
        data: {
          actorId,
          action: "CLOSE_ROUND",
          entityType: "Round",
          entityId: roundId,
          payload: JSON.stringify({
            leagueId: round.leagueId,
            roundIndex: round.index,
            settledCount: ids.length,
          }),
        },
      });

      return ids.length;
    });
  } catch (err) {
    if (err instanceof CloseRoundGuardFailedError) {
      if (err.reason === "not_found") {
        return { ok: false, error: "Ronda no encontrada" };
      }
      if (err.reason === "already_closed") {
        return { ok: false, error: "La ronda ya está cerrada" };
      }
      return {
        ok: false,
        error:
          "No se puede cerrar la ronda antes de su fecha de cierre. Si quieres cerrarla antes, mueve primero la fecha.",
      };
    }
    throw err;
  }

  revalidatePath("/admin/rondas");
  revalidatePath("/mis-partidas");
  revalidatePath("/clasificacion");
  revalidatePath("/rondas");
  revalidatePath("/calendario");

  return { ok: true, data: { settledCount } };
}
