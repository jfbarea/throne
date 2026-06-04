// Server actions for result reporting and confirmation.
// Hito 7: reportar-confirmar-resultados.
// SPEC §7.5 (anti-dispute flow), §4.5 (Result), §4.7 (AuditLog), §5 (permisos).

"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireAuth, requireAdmin } from "@/lib/guards";
import { z } from "zod";
import {
  calculateBonus,
  canReport,
  canConfirmOrDispute,
  canReportInStatus,
  canConfirmInStatus,
  canDisputeInStatus,
  validateOutcomeVsVP,
} from "@/server/result-logic";
import { advancePlayoffWinner } from "@/server/playoff-actions";

// ---------------------------------------------------------------------------
// ActionResult type (shared with match-actions)
// ---------------------------------------------------------------------------

export type ActionResult<T = void> =
  | { ok: true; data: T; warning?: string }
  | { ok: false; error: string };

// ---------------------------------------------------------------------------
// Input schemas
// ---------------------------------------------------------------------------

const outcomeEnum = z.enum(["HOME_WIN", "AWAY_WIN", "DRAW"]);

const reportResultSchema = z.object({
  homeVictoryPoints: z
    .number({ error: "Los VP del local son requeridos" })
    .int("Los VP deben ser un número entero")
    .min(0, "Los VP no pueden ser negativos"),
  awayVictoryPoints: z
    .number({ error: "Los VP del visitante son requeridos" })
    .int("Los VP deben ser un número entero")
    .min(0, "Los VP no pueden ser negativos"),
  outcome: outcomeEnum,
});

export type ReportResultInput = z.infer<typeof reportResultSchema>;

// ---------------------------------------------------------------------------
// Helper: write an AuditLog entry inside or outside a transaction
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
// reportResult — SPEC §7.5 step 1
// ---------------------------------------------------------------------------

/**
 * A participant (home or away) or an admin reports the result of a match.
 *
 * - Identity from signed session cookie (never from client body).
 * - Creates or replaces the Result record.
 * - Transitions Match.status to REPORTED.
 * - Calculates and stores bonus at report time (SPEC §7.1).
 * - Writes AuditLog entry.
 * - The reporter cannot auto-confirm (SPEC anti-dispute: rival or admin must confirm).
 */
export async function reportResult(
  matchId: string,
  input: ReportResultInput
): Promise<ActionResult<{ resultId: string; warning?: string }>> {
  const session = await requireAuth();

  // Validate input.
  const parsed = reportResultSchema.safeParse(input);
  if (!parsed.success) {
    const flat = parsed.error.flatten();
    const firstErr =
      Object.values(flat.fieldErrors).flat()[0] ?? flat.formErrors[0];
    return { ok: false, error: firstErr ?? "Datos inválidos" };
  }
  const { homeVictoryPoints, awayVictoryPoints, outcome } = parsed.data;

  // Load match + league config in one query.
  const match = await prisma.match.findUnique({
    where: { id: matchId },
    include: {
      league: true,
    },
  });

  if (!match) {
    return { ok: false, error: "Partida no encontrada" };
  }

  const isAdmin = session.role === "ADMIN";
  const actorId = session.playerId;

  // Authorization.
  if (
    !canReport(actorId, session.role, match.playerHomeId, match.playerAwayId)
  ) {
    return {
      ok: false,
      error: "No eres participante de esta partida ni admin",
    };
  }

  // Status guard.
  if (!canReportInStatus(match.status, isAdmin)) {
    return {
      ok: false,
      error: `No se puede reportar una partida en estado ${match.status}`,
    };
  }

  // SPEC §7.4: DRAW is invalid in playoff matches.
  if (match.phase === "PLAYOFF" && outcome === "DRAW") {
    return {
      ok: false,
      error: "Los empates no están permitidos en partidas de playoffs. Se requiere un ganador.",
    };
  }

  // Advisory VP/outcome consistency check.
  const warning = validateOutcomeVsVP(homeVictoryPoints, awayVictoryPoints, outcome) ?? undefined;

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

  // We need a resolved actorId for the Result and AuditLog.
  // Admin sessions may have playerId = null; in that case use a sentinel string
  // that still references a real admin player. If there is truly no playerId we
  // reject — admin should always have a playerId in this system (admin IS a player).
  if (!actorId) {
    return {
      ok: false,
      error:
        "La sesión de administrador no tiene un jugador asociado. Usa un jugador con rol ADMIN.",
    };
  }

  let resultId: string;

  await prisma.$transaction(async (tx) => {
    // Upsert Result (create or replace).
    const existing = await tx.result.findUnique({
      where: { matchId },
      select: { id: true },
    });

    if (existing) {
      // Update existing result — reset confirmation fields.
      await tx.result.update({
        where: { matchId },
        data: {
          homeVictoryPoints,
          awayVictoryPoints,
          outcome,
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
      // Create fresh result.
      const created = await tx.result.create({
        data: {
          matchId,
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

    // Transition Match to REPORTED.
    await tx.match.update({
      where: { id: matchId },
      data: { status: "REPORTED" },
    });

    // AuditLog.
    await writeAuditLog(tx, actorId, "REPORT_RESULT", "Match", matchId, {
      matchId,
      resultId,
      homeVictoryPoints,
      awayVictoryPoints,
      outcome,
      bonusHome,
      bonusAway,
      previousStatus: match.status,
    });
  });

  revalidatePath("/mis-partidas");
  revalidatePath("/calendario");
  revalidatePath("/admin/disputas");

  return {
    ok: true,
    data: { resultId: resultId!, warning },
    warning,
  };
}

// ---------------------------------------------------------------------------
// confirmResult — SPEC §7.5 step 2a
// ---------------------------------------------------------------------------

/**
 * The RIVAL (not the reporter) confirms the result.
 * Admin may also confirm any match.
 *
 * - Match transitions to CONFIRMED.
 * - Writes AuditLog entry.
 * - Only confirmed matches count for standings (SPEC §7.3, §4.5 note).
 */
export async function confirmResult(
  matchId: string
): Promise<ActionResult> {
  const session = await requireAuth();

  const match = await prisma.match.findUnique({
    where: { id: matchId },
    include: { result: true },
  });

  if (!match) {
    return { ok: false, error: "Partida no encontrada" };
  }

  if (!match.result) {
    return { ok: false, error: "Esta partida no tiene resultado reportado" };
  }

  const actorId = session.playerId;
  if (!actorId) {
    return {
      ok: false,
      error:
        "La sesión de administrador no tiene un jugador asociado.",
    };
  }

  // Authorization: rival or admin (not the reporter).
  if (
    !canConfirmOrDispute(
      actorId,
      session.role,
      match.playerHomeId,
      match.playerAwayId,
      match.result.reportedById
    )
  ) {
    return {
      ok: false,
      error:
        "Solo el rival (no quien reportó) o el admin pueden confirmar el resultado",
    };
  }

  // Status guard.
  if (!canConfirmInStatus(match.status)) {
    return {
      ok: false,
      error: `No se puede confirmar una partida en estado ${match.status}`,
    };
  }

  // SPEC §7.4: DRAW is invalid in playoff matches (also validated at report time,
  // but re-check here in case of data inconsistency).
  if (match.phase === "PLAYOFF" && match.result.outcome === "DRAW") {
    return {
      ok: false,
      error: "Los empates no están permitidos en partidas de playoffs. Se requiere un ganador.",
    };
  }

  const now = new Date();

  await prisma.$transaction(async (tx) => {
    await tx.result.update({
      where: { matchId },
      data: {
        confirmedById: actorId,
        confirmedAt: now,
      },
    });

    await tx.match.update({
      where: { id: matchId },
      data: { status: "CONFIRMED" },
    });

    await writeAuditLog(tx, actorId, "CONFIRM_RESULT", "Match", matchId, {
      matchId,
      resultId: match.result!.id,
      confirmedById: actorId,
      confirmedAt: now.toISOString(),
    });

    // SPEC §7.4: advance winner in playoff bracket after confirmation.
    if (match.phase === "PLAYOFF" && !match.isBye) {
      await advancePlayoffWinner(
        tx,
        matchId,
        match.result!.outcome,
        match.leagueId,
        match.playerHomeId,
        match.playerAwayId
      );
    }
  });

  revalidatePath("/mis-partidas");
  revalidatePath("/calendario");
  revalidatePath("/admin/disputas");
  revalidatePath("/bracket");

  return { ok: true, data: undefined };
}

// ---------------------------------------------------------------------------
// disputeResult — SPEC §7.5 step 2b
// ---------------------------------------------------------------------------

/**
 * The RIVAL disputes the reported result.
 * Match transitions to DISPUTED; requires admin resolution.
 */
export async function disputeResult(
  matchId: string
): Promise<ActionResult> {
  const session = await requireAuth();

  const match = await prisma.match.findUnique({
    where: { id: matchId },
    include: { result: true },
  });

  if (!match) {
    return { ok: false, error: "Partida no encontrada" };
  }

  if (!match.result) {
    return { ok: false, error: "Esta partida no tiene resultado reportado" };
  }

  const actorId = session.playerId;
  if (!actorId) {
    return { ok: false, error: "La sesión no tiene jugador asociado." };
  }

  // Authorization: rival only (not the reporter, not admin for dispute — admin resolves instead).
  const isAdmin = session.role === "ADMIN";
  if (isAdmin) {
    return {
      ok: false,
      error:
        "El admin usa 'Resolver disputa' en lugar de disputar. Solo el rival puede disputar.",
    };
  }

  if (
    !canConfirmOrDispute(
      actorId,
      session.role,
      match.playerHomeId,
      match.playerAwayId,
      match.result.reportedById
    )
  ) {
    return {
      ok: false,
      error: "Solo el rival (no quien reportó) puede disputar el resultado",
    };
  }

  // Status guard.
  if (!canDisputeInStatus(match.status)) {
    return {
      ok: false,
      error: `No se puede disputar una partida en estado ${match.status}`,
    };
  }

  await prisma.$transaction(async (tx) => {
    await tx.match.update({
      where: { id: matchId },
      data: { status: "DISPUTED" },
    });

    await writeAuditLog(tx, actorId, "DISPUTE_RESULT", "Match", matchId, {
      matchId,
      resultId: match.result!.id,
      disputedById: actorId,
    });
  });

  revalidatePath("/mis-partidas");
  revalidatePath("/calendario");
  revalidatePath("/admin/disputas");

  return { ok: true, data: undefined };
}

// ---------------------------------------------------------------------------
// adminResolveResult — SPEC §7.5 step 3 (admin override)
// ---------------------------------------------------------------------------

/**
 * Admin resolves a disputed (or any) match, optionally editing the result.
 * If input is provided, the result is updated before confirming.
 * Always leaves a trace in AuditLog.
 */
export async function adminResolveResult(
  matchId: string,
  input: ReportResultInput
): Promise<ActionResult<{ resultId: string }>> {
  const session = await requireAdmin();

  const actorId = session.playerId;
  if (!actorId) {
    return { ok: false, error: "La sesión de administrador no tiene jugador asociado." };
  }

  // Validate input.
  const parsed = reportResultSchema.safeParse(input);
  if (!parsed.success) {
    const flat = parsed.error.flatten();
    const firstErr =
      Object.values(flat.fieldErrors).flat()[0] ?? flat.formErrors[0];
    return { ok: false, error: firstErr ?? "Datos inválidos" };
  }
  const { homeVictoryPoints, awayVictoryPoints, outcome } = parsed.data;

  const match = await prisma.match.findUnique({
    where: { id: matchId },
    include: { league: true, result: true },
  });

  if (!match) {
    return { ok: false, error: "Partida no encontrada" };
  }

  // SPEC §7.4: DRAW is invalid in playoff matches.
  if (match.phase === "PLAYOFF" && outcome === "DRAW") {
    return {
      ok: false,
      error: "Los empates no están permitidos en partidas de playoffs. Se requiere un ganador.",
    };
  }

  // Calculate bonus.
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

  const now = new Date();
  let resultId: string;

  await prisma.$transaction(async (tx) => {
    if (match.result) {
      await tx.result.update({
        where: { matchId },
        data: {
          homeVictoryPoints,
          awayVictoryPoints,
          outcome,
          confirmedById: actorId,
          confirmedAt: now,
          bonusHome,
          bonusAway,
        },
      });
      resultId = match.result.id;
    } else {
      const created = await tx.result.create({
        data: {
          matchId,
          homeVictoryPoints,
          awayVictoryPoints,
          outcome,
          reportedById: actorId,
          confirmedById: actorId,
          confirmedAt: now,
          bonusHome,
          bonusAway,
        },
      });
      resultId = created.id;
    }

    await tx.match.update({
      where: { id: matchId },
      data: { status: "CONFIRMED" },
    });

    await writeAuditLog(tx, actorId, "ADMIN_RESOLVE", "Match", matchId, {
      matchId,
      resultId,
      homeVictoryPoints,
      awayVictoryPoints,
      outcome,
      bonusHome,
      bonusAway,
      previousStatus: match.status,
      resolvedAt: now.toISOString(),
    });

    // SPEC §7.4: advance winner in playoff bracket after admin resolution.
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
  revalidatePath("/admin/disputas");
  revalidatePath("/bracket");

  return { ok: true, data: { resultId: resultId! } };
}
