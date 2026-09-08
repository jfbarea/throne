// Server actions for Round management.
// Hito 3 (generar-con-rondas): editing a round's deadline.
// Hito 4 (cierre-de-ronda) adds `closeRound` alongside this.
// SPEC §4.4, §7.1.

"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/guards";
import { z } from "zod";

export type ActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: string };

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

export type UpdateRoundDeadlineInput = z.input<typeof updateRoundDeadlineSchema>;

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
