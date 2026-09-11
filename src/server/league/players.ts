// Server-side domain actions for player management.
// Split out of src/server/league-actions.ts (multi-liga C1,
// contexto-de-liga-y-modulos) — pure move, no logic change. league-actions.ts
// re-exports this module so no existing import breaks.
// Hito 5: admin-liga-jugadores. SPEC §4.1, §4.2, §5.

"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import {
  createPlayerSchema,
  updatePlayerSchema,
  type CreatePlayerInput,
  type UpdatePlayerInput,
} from "@/lib/schemas";
import { generateHashedPasscode } from "@/lib/passcode";
import { requireAdmin } from "@/lib/guards";
import { redistributePending } from "@/server/round-actions";
import { WALKOVER_VICTORY_POINTS } from "@/server/result-logic";
import {
  assertLeagueWritable,
  LeagueArchivedError,
} from "@/lib/league-context";
import type { ActionResult } from "./action-result";

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

  // Multi-liga spec §5.6, criterio 23: no altas on an archived league. Skips
  // silently (falls through to the pre-existing behaviour) if `leagueId`
  // doesn't resolve at all — same as before this guard existed, that case
  // was left to the FK constraint on `prisma.player.create` below.
  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: { archivedAt: true },
  });
  if (league) {
    try {
      assertLeagueWritable(league);
    } catch (err) {
      if (err instanceof LeagueArchivedError) {
        return { ok: false, error: err.message };
      }
      throw err;
    }
  }

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

  // Multi-liga spec §5.6, criterio 23. Skips silently (same fallback as
  // createPlayer above) if `playerId` doesn't resolve — the update below
  // already handled that case on its own before this guard existed.
  const player = await prisma.player.findUnique({
    where: { id: playerId },
    select: { league: { select: { archivedAt: true } } },
  });
  if (player) {
    try {
      assertLeagueWritable(player.league);
    } catch (err) {
      if (err instanceof LeagueArchivedError) {
        return { ok: false, error: err.message };
      }
      throw err;
    }
  }

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
// Player: soft deactivate / reactivate (SPEC §4.2 — active flag for history;
// rondas-con-fecha §5.6 — Hito 8, criterios 32-33)
// ---------------------------------------------------------------------------

/**
 * Deactivate or reactivate a player.
 *
 * Deactivating (`active: false`, rondas-con-fecha §5.6, criterio 32): before
 * flipping the flag, every one of this player's `phase = LEAGUE` matches that
 * has no `Result` yet and belongs to an open round (or no round at all) is
 * settled as an 80-0 walkover **in favor of the opponent** —
 * `resolution = WALKOVER`, `bonusHome = bonusAway = 0` forced (never through
 * `calculateBonus`, same reasoning as `declareWalkover`), with an `AuditLog`
 * entry — all inside one transaction. Matches that already had a `Result`
 * are left untouched. Afterwards, `redistributePending` recomputes the
 * reparto of whatever is still pending (§5.1): those settled matches just
 * vanished from the open rounds' bookkeeping.
 *
 * Reactivating (`active: true`) deliberately does none of this — it is a
 * plain flag flip. Reactivating a deactivated player does **not** revert the
 * walkovers their deactivation produced (criterio 33): the admin would have
 * to edit those results by hand, via the usual §7.5 override.
 *
 * No settlement (and no redistribute) happens if the player was already in
 * the target state — this only fires on a genuine `true → false` edge.
 *
 * **Not atomic end-to-end**, in a smaller way than `addMissingLeagueMatches`
 * (Hito 8 review, plan/rondas-con-fecha/reviews/recalculo-alta-baja-y-cupo.md):
 * the walkover settlement and the `active` flag flip commit before
 * `redistributePending` opens its own separate transaction. If that call
 * fails, the player is already inactive and their pendings already saldadas
 * — only the reparto recompute is missing. Unlike `addMissingLeagueMatches`,
 * this one **is** self-repairing by simply retrying: the redistribute call
 * below is gated on the *target* state (`!active`), not on whether the
 * settlement actually ran, so calling `setPlayerActive(playerId, false)`
 * again on an already-inactive player skips the (already-done) settlement
 * but still retries `redistributePending`.
 */
export async function setPlayerActive(
  playerId: string,
  active: boolean
): Promise<ActionResult> {
  const session = await requireAdmin();

  const player = await prisma.player.findUnique({ where: { id: playerId } });
  if (!player) {
    return { ok: false, error: "Jugador no encontrado" };
  }

  // Multi-liga spec §5.6, criterio 23: no baja/alta toggling on an archived
  // league — same rejection as every other write action in this file.
  const league = await prisma.league.findUnique({
    where: { id: player.leagueId },
    select: { archivedAt: true },
  });
  if (league) {
    try {
      assertLeagueWritable(league);
    } catch (err) {
      if (err instanceof LeagueArchivedError) {
        return { ok: false, error: err.message };
      }
      throw err;
    }
  }

  const isDeactivating = !active && player.active;

  if (isDeactivating) {
    if (!session.playerId) {
      return {
        ok: false,
        error:
          "La sesión de administrador no tiene un jugador asociado. Usa un jugador con rol ADMIN.",
      };
    }
    const actorId = session.playerId;

    await prisma.$transaction(async (tx) => {
      const pendingMatches = await tx.match.findMany({
        where: {
          leagueId: player.leagueId,
          phase: "LEAGUE",
          result: null,
          OR: [{ playerHomeId: playerId }, { playerAwayId: playerId }],
          AND: [{ OR: [{ roundId: null }, { round: { closedAt: null } }] }],
        },
        select: { id: true, playerHomeId: true, playerAwayId: true },
      });

      if (pendingMatches.length === 0) return;

      await tx.result.createMany({
        data: pendingMatches.map((m) => {
          const deactivatedIsHome = m.playerHomeId === playerId;
          const outcome: "HOME_WIN" | "AWAY_WIN" = deactivatedIsHome
            ? "AWAY_WIN"
            : "HOME_WIN";
          return {
            matchId: m.id,
            homeVictoryPoints: deactivatedIsHome ? 0 : WALKOVER_VICTORY_POINTS,
            awayVictoryPoints: deactivatedIsHome ? WALKOVER_VICTORY_POINTS : 0,
            outcome,
            resolution: "WALKOVER" as const,
            reportedById: actorId,
            bonusHome: 0,
            bonusAway: 0,
          };
        }),
      });

      await tx.match.updateMany({
        where: { id: { in: pendingMatches.map((m) => m.id) } },
        data: { status: "REPORTED" },
      });

      await tx.auditLog.create({
        data: {
          actorId,
          action: "SETTLE_PLAYER_DEACTIVATION",
          entityType: "Player",
          entityId: playerId,
          payload: JSON.stringify({
            leagueId: player.leagueId,
            settledCount: pendingMatches.length,
          }),
        },
      });
    });
  }

  await prisma.player.update({
    where: { id: playerId },
    data: { active },
  });

  // Gated on the *target* state (`!active`), not `isDeactivating`: retrying
  // this action on a player that is already inactive skips the settlement
  // (already done, `isDeactivating` is false) but still retries the
  // redistribution — the actual recovery path if a previous call's
  // `redistributePending` failed after the flag and the walkovers had
  // already committed (see the docstring above).
  if (!active) {
    const redistributeResult = await redistributePending(player.leagueId);
    if (!redistributeResult.ok) {
      return {
        ok: false,
        error: `El jugador se dio de baja y sus partidas pendientes se saldaron, pero no se pudo recalcular el reparto de rondas: ${redistributeResult.error}`,
      };
    }
  }

  revalidatePath("/admin/jugadores");
  if (!active) {
    revalidatePath("/mis-partidas");
    revalidatePath("/clasificacion");
    revalidatePath("/rondas");
    revalidatePath("/calendario");
    revalidatePath("/admin/rondas");
  }
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

  // Multi-liga spec §5.6, criterio 23. Same fallback as updatePlayer above
  // for a `playerId` that doesn't resolve.
  const player = await prisma.player.findUnique({
    where: { id: playerId },
    select: { league: { select: { archivedAt: true } } },
  });
  if (player) {
    try {
      assertLeagueWritable(player.league);
    } catch (err) {
      if (err instanceof LeagueArchivedError) {
        return { ok: false, error: err.message };
      }
      throw err;
    }
  }

  const { plain, hash } = await generateHashedPasscode();

  await prisma.player.update({
    where: { id: playerId },
    data: { passcodeHash: hash },
  });

  revalidatePath("/admin/jugadores");
  return { ok: true, data: { plainPasscode: plain } };
}

// ---------------------------------------------------------------------------
// Player: hard delete — removes the player entirely
// ---------------------------------------------------------------------------

/**
 * Permanently delete a player. Refuses if the player is referenced by any
 * match or result, since deleting them would corrupt league history — in that
 * case the admin should deactivate (setPlayerActive) instead, which preserves
 * the record. AuditLog entries (actor-only references) are removed in the same
 * transaction so the FK constraint is satisfied.
 */
export async function deletePlayer(playerId: string): Promise<ActionResult> {
  await requireAdmin();

  // Multi-liga spec §5.6, criterio 23. Same fallback as updatePlayer above
  // for a `playerId` that doesn't resolve.
  const player = await prisma.player.findUnique({
    where: { id: playerId },
    select: { league: { select: { archivedAt: true } } },
  });
  if (player) {
    try {
      assertLeagueWritable(player.league);
    } catch (err) {
      if (err instanceof LeagueArchivedError) {
        return { ok: false, error: err.message };
      }
      throw err;
    }
  }

  const [homeMatches, awayMatches, reported, confirmed] = await Promise.all([
    prisma.match.count({ where: { playerHomeId: playerId } }),
    prisma.match.count({ where: { playerAwayId: playerId } }),
    prisma.result.count({ where: { reportedById: playerId } }),
    prisma.result.count({ where: { confirmedById: playerId } }),
  ]);

  if (homeMatches + awayMatches + reported + confirmed > 0) {
    return {
      ok: false,
      error:
        "No se puede borrar: el jugador tiene partidas o resultados en la liga. Dalo de baja para conservar el histórico.",
    };
  }

  await prisma.$transaction([
    // Actor-only references; safe to remove for a player with no match history.
    prisma.auditLog.deleteMany({ where: { actorId: playerId } }),
    prisma.player.delete({ where: { id: playerId } }),
  ]);

  revalidatePath("/admin/jugadores");
  return { ok: true, data: undefined };
}
