// Server actions for result reporting.
// Hito 15: resultados-directos.
// Un participante (o admin) apunta los VP cuando la partida se ha jugado y puede
// editarlos después. La partida cuenta en standings de inmediato (status REPORTED).
// No hay confirmación del rival, disputas ni validación del admin.
// SPEC §7.5 (simplified), §4.5 (Result), §4.7 (AuditLog), §5 (permisos).

"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireAuth } from "@/lib/guards";
import { z } from "zod";
import {
  calculateBonus,
  canReport,
  canReportGivenRoundClosed,
  canReportInStatus,
  deriveOutcome,
} from "@/server/result-logic";
import { advancePlayoffWinner } from "@/server/playoff-actions";

// ---------------------------------------------------------------------------
// ActionResult type (shared with match-actions)
// ---------------------------------------------------------------------------

export type ActionResult<T = void> =
  | { ok: true; data: T; warning?: string }
  | { ok: false; error: string };

// ---------------------------------------------------------------------------
// Input schema
// ---------------------------------------------------------------------------

const victoryPointsShape = {
  homeVictoryPoints: z
    .number({ error: "Los VP del local son requeridos" })
    .int("Los VP deben ser un número entero")
    .min(0, "Los VP no pueden ser negativos"),
  awayVictoryPoints: z
    .number({ error: "Los VP del visitante son requeridos" })
    .int("Los VP deben ser un número entero")
    .min(0, "Los VP no pueden ser negativos"),
};

// Both participants and admin report: outcome derived from VP (SPEC §4.5).
// `forceDraw` covers the rare mission-rules draw despite unequal VP.
const playerReportSchema = z.object({
  ...victoryPointsShape,
  forceDraw: z.boolean().optional(),
});

export type PlayerReportInput = z.infer<typeof playerReportSchema>;

// ---------------------------------------------------------------------------
// Helper: write an AuditLog entry inside a transaction
// ---------------------------------------------------------------------------

async function writeAuditLog(
  tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
  actorId: string,
  action: string,
  entityType: string,
  entityId: string,
  payload: Record<string, unknown>
): Promise<void> {
  await tx.auditLog.create({
    data: {
      actorId,
      action,
      entityType,
      entityId,
      payload: JSON.stringify(payload),
    },
  });
}

// ---------------------------------------------------------------------------
// reportResult — apuntar o editar el resultado de una partida (Hito 15)
// ---------------------------------------------------------------------------

/**
 * A participant (home or away) or an admin reports or edits the result of a match.
 *
 * New model (Hito 15):
 *  - Any participant or admin can appoint/edit VP, as many times as needed.
 *  - The match counts for standings as soon as it has a Result (status REPORTED).
 *  - No rival confirmation, no disputes, no admin resolution step.
 *  - Identity always from the signed session cookie (never from client body).
 *  - Creates or overwrites the Result record (SCHEDULED → REPORTED or REPORTED → REPORTED).
 *  - Recalculates and persists bonus on every edit.
 *  - Writes AuditLog entry (REPORT_RESULT for fresh, EDIT_RESULT for overwrite).
 *  - DRAW is invalid in playoff matches (SPEC §7.4).
 *  - If phase=PLAYOFF and !isBye, advances the winner within the transaction.
 */
export async function reportResult(
  matchId: string,
  input: PlayerReportInput
): Promise<ActionResult<{ resultId: string }>> {
  const session = await requireAuth();

  // Validate input.
  const parsed = playerReportSchema.safeParse(input);
  if (!parsed.success) {
    const flat = parsed.error.flatten();
    const firstErr =
      Object.values(flat.fieldErrors).flat()[0] ?? flat.formErrors[0];
    return { ok: false, error: firstErr ?? "Datos inválidos" };
  }
  const { homeVictoryPoints, awayVictoryPoints, forceDraw } = parsed.data;

  // Outcome is derived from the VP (SPEC §4.5); forceDraw covers the rare
  // mission-rules draw despite unequal VP.
  const outcome = forceDraw
    ? "DRAW"
    : deriveOutcome(homeVictoryPoints, awayVictoryPoints);

  // Load match + league config + round (to check the round-closed guard) in
  // one query. `round` is null for playoff matches (no Round) and for league
  // matches whose round is still open — both are treated as "not closed"
  // below.
  const match = await prisma.match.findUnique({
    where: { id: matchId },
    include: {
      league: true,
      round: true,
    },
  });

  if (!match) {
    return { ok: false, error: "Partida no encontrada" };
  }

  const isAdmin = session.role === "ADMIN";
  const actorId = session.playerId;

  // Authorization: home player, away player, or admin.
  if (
    !canReport(actorId, session.role, match.playerHomeId, match.playerAwayId)
  ) {
    return {
      ok: false,
      error: "No eres participante de esta partida ni admin",
    };
  }

  // Status guard: SCHEDULED or REPORTED allowed (admin overrides any status).
  if (!canReportInStatus(match.status, isAdmin)) {
    return {
      ok: false,
      error: `No se puede apuntar un resultado en una partida en estado ${match.status}`,
    };
  }

  // Round-closed guard (rondas-con-fecha spec §4.7, §5.9): a participant can't
  // apuntar in a closed round. Admin overrides and editing never reopens the
  // round (this action never writes to Round — see canReportGivenRoundClosed).
  if (!canReportGivenRoundClosed(match.round?.closedAt ?? null, isAdmin)) {
    return {
      ok: false,
      error:
        "La ronda de esta partida ya está cerrada. Solo el admin puede editar el resultado.",
    };
  }

  // SPEC §7.4: DRAW is invalid in playoff matches.
  if (match.phase === "PLAYOFF" && outcome === "DRAW") {
    return {
      ok: false,
      error: "Los empates no están permitidos en partidas de playoffs. Se requiere un ganador.",
    };
  }

  // Calculate bonus at report time (SPEC §7.1, §9).
  const { bonusHome, bonusAway } = calculateBonus(
    homeVictoryPoints,
    awayVictoryPoints,
    outcome,
    {
      bonusEnabled: match.league.bonusEnabled,
      bonusMarginThreshold: match.league.bonusMarginThreshold,
      bonusMinVP: match.league.bonusMinVP,
    }
  );

  // Admin sessions must have a playerId for DB writes.
  if (!actorId) {
    return {
      ok: false,
      error:
        "La sesión de administrador no tiene un jugador asociado. Usa un jugador con rol ADMIN.",
    };
  }

  let resultId: string;

  await prisma.$transaction(async (tx) => {
    // Upsert Result (create or overwrite).
    const existing = await tx.result.findUnique({
      where: { matchId },
      select: { id: true },
    });

    const auditAction = existing ? "EDIT_RESULT" : "REPORT_RESULT";

    if (existing) {
      // Overwrite existing result (edit); confirmedById/confirmedAt reset to null
      // since the confirmation flow no longer exists. These columns are kept in
      // schema for future use but are not populated by the new flow.
      //
      // resolution is forced back to PLAYED here (rondas-con-fecha spec §4.9,
      // §5.9, criterio 21): this action is the "a participant/admin reports a
      // played game" path, as opposed to the incomparecencia action (WALKOVER,
      // Hito 5) or closeRound (UNPLAYED_DRAW, Hito 4). Without this, editing a
      // match that a round-close had settled to UNPLAYED_DRAW — the admin
      // override the round-closed guard exists for — would leave `resolution`
      // stuck at UNPLAYED_DRAW forever, wrongly counting a real, played game as
      // "saldada sin jugar" in the standings (SPEC §4.6, §4.9).
      await tx.result.update({
        where: { matchId },
        data: {
          homeVictoryPoints,
          awayVictoryPoints,
          outcome,
          resolution: "PLAYED",
          reportedById: actorId,
          reportedAt: new Date(),
          confirmedById: null,
          confirmedAt: null,
          bonusHome,
          bonusAway,
        },
      });
      resultId = existing.id;
    } else {
      // Create fresh result. resolution defaults to PLAYED (schema default),
      // set explicitly here for the same reason as the update branch above.
      const created = await tx.result.create({
        data: {
          matchId,
          resolution: "PLAYED",
          homeVictoryPoints,
          awayVictoryPoints,
          outcome,
          reportedById: actorId,
          confirmedById: null,
          bonusHome,
          bonusAway,
        },
      });
      resultId = created.id;
    }

    // Transition Match to REPORTED (or stay REPORTED on edits).
    await tx.match.update({
      where: { id: matchId },
      data: { status: "REPORTED" },
    });

    // AuditLog.
    await writeAuditLog(tx, actorId, auditAction, "Match", matchId, {
      matchId,
      resultId,
      homeVictoryPoints,
      awayVictoryPoints,
      outcome,
      bonusHome,
      bonusAway,
      previousStatus: match.status,
    });

    // SPEC §7.4: advance winner in playoff bracket immediately on reporting.
    if (match.phase === "PLAYOFF" && !match.isBye) {
      await advancePlayoffWinner(
        tx,
        matchId,
        outcome,
        match.leagueId,
        match.playerHomeId,
        match.playerAwayId
      );
    }
  });

  revalidatePath("/mis-partidas");
  revalidatePath("/calendario");
  revalidatePath("/clasificacion");
  revalidatePath("/bracket");
  revalidatePath("/admin/emparejamientos");
  revalidatePath("/admin/playoffs");

  return {
    ok: true,
    data: { resultId: resultId! },
  };
}
