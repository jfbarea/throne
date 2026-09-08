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
  canDeclareWalkoverOverExistingResult,
  canReport,
  canReportGivenRoundClosed,
  canReportInStatus,
  deriveOutcome,
  WALKOVER_VICTORY_POINTS,
} from "@/server/result-logic";
import { advancePlayoffWinner } from "@/server/playoff-actions";

// ---------------------------------------------------------------------------
// ActionResult type (shared with match-actions)
// ---------------------------------------------------------------------------

export type ActionResult<T = void> =
  | { ok: true; data: T; warning?: string }
  | { ok: false; error: string };

// ---------------------------------------------------------------------------
// Round-closed guard: TOCTOU sentinel shared by reportResult and
// declareWalkover (H5b, plan/rondas-con-fecha/PLAN.md)
// ---------------------------------------------------------------------------

/**
 * Internal sentinel thrown inside a transaction (by `reportResult` or
 * `declareWalkover`) to abort it when the round-closed guard
 * (`canReportGivenRoundClosed`) fails on the re-read done with `tx` — see the
 * docstrings on each action. Caught right outside the corresponding
 * `prisma.$transaction` call and turned into the same user-facing rejection
 * the fast-path check returns; scoped with `instanceof` so a real DB failure
 * inside the transaction is never mistaken for "the round is closed".
 */
class RoundClosedDuringTransactionError extends Error {}

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
 *
 * Round-closed guard checked TWICE against the same predicate
 * (`canReportGivenRoundClosed`), H5b sweep (plan/rondas-con-fecha/PLAN.md):
 * once below, before opening the transaction (fast-path rejection — good
 * UX, no point opening a transaction just to abort it, and it's where the
 * Spanish error message comes from), and once more INSIDE
 * `prisma.$transaction` with `tx.round.findUnique` as the very first thing
 * the transaction does. The outer read can go stale in the window between
 * it and the transaction opening — a concurrent admin `closeRound` landing
 * in between, which would otherwise let this write land in a round that's
 * now closed, breaking criterio 21. The inner re-read, against the
 * transaction's own client, is the one that actually decides — it aborts
 * the transaction by throwing `RoundClosedDuringTransactionError`, caught
 * right outside and turned into the same rejection.
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
      error:
        "Los empates no están permitidos en partidas de playoffs. Se requiere un ganador.",
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

  try {
    await prisma.$transaction(async (tx) => {
      // Authoritative re-read (H5b, TOCTOU): a concurrent admin `closeRound`
      // could have landed in the window between the fast-path read above and
      // this transaction opening. `match.roundId` itself is immutable once
      // set (nothing in this codebase updates it), so only the Round's
      // `closedAt` needs refreshing — with `tx`, as the very first thing the
      // transaction does. A playoff match (`match.roundId === null`) has no
      // Round to re-check, same as the fast-path check above.
      if (match.roundId) {
        const currentRound = await tx.round.findUnique({
          where: { id: match.roundId },
          select: { closedAt: true },
        });
        if (
          !canReportGivenRoundClosed(currentRound?.closedAt ?? null, isAdmin)
        ) {
          throw new RoundClosedDuringTransactionError();
        }
      }

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
  } catch (err) {
    if (err instanceof RoundClosedDuringTransactionError) {
      return {
        ok: false,
        error:
          "La ronda de esta partida ya está cerrada. Solo el admin puede editar el resultado.",
      };
    }
    throw err;
  }

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

// ---------------------------------------------------------------------------
// declareWalkover — declarar incomparecencia (Hito 5, rondas-con-fecha §4.8-§4.10)
// ---------------------------------------------------------------------------

const declareWalkoverSchema = z.object({
  // The winner is a player id (SPEC §4.10: "cualquiera de los dos ... declara
  // la incomparecencia eligiendo al vencedor"). Validated below against the
  // match's actual two participants — this schema only checks shape, not
  // whether the id belongs to this match, so nobody can crown a third party.
  winnerId: z.string().min(1, "El vencedor es obligatorio"),
});

export type DeclareWalkoverInput = z.infer<typeof declareWalkoverSchema>;

/**
 * Internal sentinel thrown inside the `declareWalkover` transaction to abort
 * it when the D5 guard (`canDeclareWalkoverOverExistingResult`) fails on the
 * re-read done with `tx` (see docstring below). Caught right outside the
 * `prisma.$transaction` call and turned into the same user-facing
 * `ActionResult` the fast-path rejection returns — never leaks past
 * `declareWalkover`.
 */
class WalkoverBlockedByPlayedResultError extends Error {}

/**
 * A participant (home or away) or an admin declares a walkover
 * (incomparecencia): the two players agreed on a winner outside the app and
 * this just records the outcome (SPEC §4.10 — the pact happens elsewhere).
 *
 *  - Result: WALKOVER_VICTORY_POINTS-0 in favor of the winner, `outcome`
 *    HOME_WIN/AWAY_WIN, `resolution = WALKOVER`.
 *  - Bonus is forced to `{0, 0}` WITHOUT going through `calculateBonus`
 *    (SPEC §4.8, criterio 24): a walkover never earns bonus points, no matter
 *    the league's bonus config.
 *  - Same authorization/status/round-closed guards as `reportResult`, reused
 *    as-is (SPEC §4.10: "Reutiliza canReport / canReportInStatus tal cual"):
 *    any participant or admin can declare it, and either participant can
 *    later overwrite it — with a different winner (this action again) or
 *    with the real result if the match does get played (`reportResult`,
 *    which forces `resolution` back to PLAYED on every write). The
 *    round-closed guard is checked twice, same TOCTOU pattern as the D5
 *    guard right below — see `reportResult`'s docstring for the shared
 *    `RoundClosedDuringTransactionError` mechanics (H5b sweep).
 *  - D5 (plan/rondas-con-fecha/PLAN.md, ratified after H5's first review):
 *    a participant CANNOT use this action to turn an already-`PLAYED` result
 *    into a walkover — that would let a legitimate winner unilaterally
 *    inflate their own score to 80-0. `canDeclareWalkoverOverExistingResult`
 *    (src/server/result-logic.ts) blocks it; only the admin overrides
 *    (§7.5). Overwriting an existing WALKOVER (new winner) or a match with
 *    no Result yet is unaffected by this guard.
 *    Checked TWICE against the same predicate (second review of D5, TOCTOU):
 *    once here, before opening the transaction (fast-path rejection — good
 *    UX, no point opening a transaction just to abort it, and it's where the
 *    Spanish error message comes from), and once more INSIDE
 *    `prisma.$transaction` with `tx.result.findUnique` as the very first
 *    thing the transaction does. The outer read can go stale in the window
 *    between it and the transaction opening (a concurrent `reportResult`
 *    landing in between); the inner re-read, against the transaction's own
 *    client, is the one that actually decides — it aborts the transaction by
 *    throwing `WalkoverBlockedByPlayedResultError`, caught right outside and
 *    turned into the same rejection.
 *  - Scoped to `phase = LEAGUE`: incomparecencia is a round-deadline
 *    mechanism (§4.4, §4.7) and playoff matches have no round at all, so the
 *    concept doesn't apply there. Rejected explicitly for PLAYOFF matches
 *    rather than silently generalized.
 *  - Rejected for matches without a real opponent (`playerAwayId === null`,
 *    i.e. playoff byes never reach here anyway given the LEAGUE-only scope,
 *    kept as a defensive guard): there is nobody to declare a walkover
 *    against.
 */
export async function declareWalkover(
  matchId: string,
  input: DeclareWalkoverInput
): Promise<ActionResult<{ resultId: string }>> {
  const session = await requireAuth();

  const parsed = declareWalkoverSchema.safeParse(input);
  if (!parsed.success) {
    const flat = parsed.error.flatten();
    const firstErr =
      Object.values(flat.fieldErrors).flat()[0] ?? flat.formErrors[0];
    return { ok: false, error: firstErr ?? "Datos inválidos" };
  }
  const { winnerId } = parsed.data;

  // Load match + round (to check the round-closed guard), same shape as
  // reportResult. `round` is null for playoff matches and for league matches
  // whose round is still open.
  const match = await prisma.match.findUnique({
    where: { id: matchId },
    include: { round: true },
  });

  if (!match) {
    return { ok: false, error: "Partida no encontrada" };
  }

  if (match.phase !== "LEAGUE") {
    return {
      ok: false,
      error: "La incomparecencia solo aplica a partidas de la fase de liga.",
    };
  }

  if (!match.playerAwayId) {
    return {
      ok: false,
      error: "No se puede declarar incomparecencia en una partida sin rival",
    };
  }

  const isAdmin = session.role === "ADMIN";
  const actorId = session.playerId;

  // Authorization: home player, away player, or admin (reused as-is).
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

  // Round-closed guard (SPEC §4.10: closing the round is the point of no
  // return; only admin can still touch the result afterwards).
  if (!canReportGivenRoundClosed(match.round?.closedAt ?? null, isAdmin)) {
    return {
      ok: false,
      error:
        "La ronda de esta partida ya está cerrada. Solo el admin puede editar el resultado.",
    };
  }

  // The winner must be one of the two real participants — nobody can crown a
  // third party.
  if (winnerId !== match.playerHomeId && winnerId !== match.playerAwayId) {
    return {
      ok: false,
      error: "El vencedor debe ser uno de los dos participantes de la partida",
    };
  }

  // Admin sessions must have a playerId for DB writes.
  if (!actorId) {
    return {
      ok: false,
      error:
        "La sesión de administrador no tiene un jugador asociado. Usa un jugador con rol ADMIN.",
    };
  }

  // Existing-Result guard (D5, plan/rondas-con-fecha/PLAN.md): a participant
  // cannot fabricate a walkover over a match whose Result is already
  // `resolution = PLAYED` — only the admin can.
  //
  // This is the FAST-PATH check only: a quick rejection (good UX, Spanish
  // error message, no transaction opened for nothing) against a read taken
  // before the transaction starts. It is NOT authoritative — see the re-read
  // with `tx` below, which is what actually decides (D5 second review,
  // TOCTOU).
  const existingResultBeforeTx = await prisma.result.findUnique({
    where: { matchId },
    select: { resolution: true },
  });

  if (
    !canDeclareWalkoverOverExistingResult(
      existingResultBeforeTx?.resolution ?? null,
      isAdmin
    )
  ) {
    return {
      ok: false,
      error: "Esta partida ya tiene un resultado jugado. Habla con el admin.",
    };
  }

  const outcome: "HOME_WIN" | "AWAY_WIN" =
    winnerId === match.playerHomeId ? "HOME_WIN" : "AWAY_WIN";
  const homeVictoryPoints =
    outcome === "HOME_WIN" ? WALKOVER_VICTORY_POINTS : 0;
  const awayVictoryPoints =
    outcome === "AWAY_WIN" ? WALKOVER_VICTORY_POINTS : 0;

  let resultId: string;

  try {
    await prisma.$transaction(async (tx) => {
      // Authoritative re-read of the round-closed guard (H5b, TOCTOU sweep):
      // a concurrent admin `closeRound` could have landed in the window
      // between the fast-path check above and this transaction opening,
      // which would otherwise let a walkover land in a round that's now
      // closed (same defect as reportResult, breaking criterio 21).
      // `match.roundId` is immutable once set, so only the Round's
      // `closedAt` needs refreshing — with `tx`, as the very first thing the
      // transaction does.
      if (match.roundId) {
        const currentRound = await tx.round.findUnique({
          where: { id: match.roundId },
          select: { closedAt: true },
        });
        if (
          !canReportGivenRoundClosed(currentRound?.closedAt ?? null, isAdmin)
        ) {
          throw new RoundClosedDuringTransactionError();
        }
      }

      // Authoritative re-read (D5, TOCTOU fix): a concurrent write (e.g. a
      // real `reportResult` from the other participant) could have landed in
      // the window between the fast-path read above and this transaction
      // opening. Re-checking against `tx` — the transaction's own client —
      // as the very first thing inside it is what actually enforces D5;
      // everything above is just a shortcut.
      const existingResult = await tx.result.findUnique({
        where: { matchId },
        select: { id: true, resolution: true },
      });

      if (
        !canDeclareWalkoverOverExistingResult(
          existingResult?.resolution ?? null,
          isAdmin
        )
      ) {
        throw new WalkoverBlockedByPlayedResultError();
      }

      const auditAction = existingResult ? "EDIT_RESULT" : "REPORT_RESULT";

      if (existingResult) {
        // Overwrite (either a previous walkover with a new winner — a played
        // result is already blocked above by canDeclareWalkoverOverExistingResult
        // unless the actor is admin, per D5).
        // Bonus is forced to {0, 0} WITHOUT calculateBonus (criterio 24).
        await tx.result.update({
          where: { matchId },
          data: {
            homeVictoryPoints,
            awayVictoryPoints,
            outcome,
            resolution: "WALKOVER",
            reportedById: actorId,
            reportedAt: new Date(),
            confirmedById: null,
            confirmedAt: null,
            bonusHome: 0,
            bonusAway: 0,
          },
        });
        resultId = existingResult.id;
      } else {
        const created = await tx.result.create({
          data: {
            matchId,
            resolution: "WALKOVER",
            homeVictoryPoints,
            awayVictoryPoints,
            outcome,
            reportedById: actorId,
            confirmedById: null,
            bonusHome: 0,
            bonusAway: 0,
          },
        });
        resultId = created.id;
      }

      // Transition Match to REPORTED (or stay REPORTED on overwrite).
      await tx.match.update({
        where: { id: matchId },
        data: { status: "REPORTED" },
      });

      // AuditLog (criterio 25: REPORT_RESULT on first declaration, EDIT_RESULT
      // on overwrite — same convention as reportResult).
      await writeAuditLog(tx, actorId, auditAction, "Match", matchId, {
        matchId,
        resultId,
        winnerId,
        homeVictoryPoints,
        awayVictoryPoints,
        outcome,
        resolution: "WALKOVER",
        previousStatus: match.status,
      });
    });
  } catch (err) {
    if (err instanceof RoundClosedDuringTransactionError) {
      return {
        ok: false,
        error:
          "La ronda de esta partida ya está cerrada. Solo el admin puede editar el resultado.",
      };
    }
    if (err instanceof WalkoverBlockedByPlayedResultError) {
      return {
        ok: false,
        error: "Esta partida ya tiene un resultado jugado. Habla con el admin.",
      };
    }
    throw err;
  }

  revalidatePath("/mis-partidas");
  revalidatePath("/calendario");
  revalidatePath("/clasificacion");
  revalidatePath("/admin/emparejamientos");

  return {
    ok: true,
    data: { resultId: resultId! },
  };
}
