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
import { redistributePending } from "@/server/round-actions";
import { WALKOVER_VICTORY_POINTS } from "@/server/result-logic";

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
      // Rondas-con-fecha (PLAN.md H3): fixed explicitly, never left to an
      // implicit DB default. `startMonth` is either the value the admin
      // configured or a deliberate `null` (D1) — never a guessed timestamp.
      matchesPerRound: d.matchesPerRound,
      startMonth: d.startMonth ?? null,
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

  // Read the previous value to detect a real matchesPerRound change below —
  // rondas-con-fecha §5.5 (Hito 8, criterios 34-35) only recomputes the
  // reparto when this specific field actually changes, not on every league
  // settings save.
  const previousLeague = await prisma.league.findUnique({
    where: { id: leagueId },
    select: { matchesPerRound: true },
  });

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
      // Rondas-con-fecha (PLAN.md H3): persisted as-is, normalised to the
      // first day of the month at UTC midnight by the schema.
      matchesPerRound: d.matchesPerRound,
      startMonth: d.startMonth ?? null,
    },
  });

  // Rondas-con-fecha §5.5 (Hito 8, criterios 34-35): a real change to
  // matchesPerRound recomputes the reparto of every still-pending match
  // across the open rounds — raising it shrinks the league (surplus trailing
  // rounds get dropped if they end up empty), lowering it grows it (new
  // rounds appended). Closed rounds and matches that already have a Result
  // are never touched, same as every other trigger of this hito.
  if (
    previousLeague !== null &&
    previousLeague.matchesPerRound !== d.matchesPerRound
  ) {
    const redistributeResult = await redistributePending(leagueId);
    if (!redistributeResult.ok) {
      return {
        ok: false,
        error: `La configuración se guardó, pero no se pudo recalcular el reparto de rondas: ${redistributeResult.error}`,
      };
    }
  }

  revalidatePath("/admin");
  revalidatePath("/admin/liga");
  revalidatePath("/admin/rondas");
  revalidatePath("/mis-partidas");
  revalidatePath("/rondas");
  revalidatePath("/calendario");
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

  if (isDeactivating) {
    const redistributeResult = await redistributePending(player.leagueId);
    if (!redistributeResult.ok) {
      return {
        ok: false,
        error: `El jugador se dio de baja y sus partidas pendientes se saldaron, pero no se pudo recalcular el reparto de rondas: ${redistributeResult.error}`,
      };
    }
  }

  revalidatePath("/admin/jugadores");
  if (isDeactivating) {
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

// ---------------------------------------------------------------------------
// League: reset (wipe the competition, keep players and config)
// ---------------------------------------------------------------------------

/**
 * Reset the competition: delete all matches, results and the playoff bracket,
 * and return the league to SETUP. Players and league configuration (points,
 * bonus, playoffSize, tiebreakers) are preserved so the admin can re-generate
 * pairings and start the season over with the same roster.
 *
 * Destructive and irreversible. Admin only.
 */
export async function resetLeague(leagueId: string): Promise<ActionResult> {
  const session = await requireAdmin();

  const league = await prisma.league.findUnique({ where: { id: leagueId } });
  if (!league) {
    return { ok: false, error: "Liga no encontrada" };
  }

  await prisma.$transaction(async (tx) => {
    // 1. Delete results, then matches (Result → Match FK; Match → BracketSlot FK).
    const matches = await tx.match.findMany({
      where: { leagueId },
      select: { id: true },
    });
    const matchIds = matches.map((m) => m.id);
    if (matchIds.length > 0) {
      await tx.result.deleteMany({ where: { matchId: { in: matchIds } } });
      await tx.match.deleteMany({ where: { id: { in: matchIds } } });
    }

    // 2. Break the bracket slots' self-references before deleting them, then
    //    delete slots and brackets for this league.
    await tx.bracketSlot.updateMany({
      where: { bracket: { leagueId } },
      data: { feedsIntoSlotId: null },
    });
    await tx.bracketSlot.deleteMany({ where: { bracket: { leagueId } } });
    await tx.bracket.deleteMany({ where: { leagueId } });

    // 3. Back to SETUP.
    await tx.league.update({
      where: { id: leagueId },
      data: { status: "SETUP" },
    });

    // 4. Audit trail (best-effort: requires an admin player in the session).
    if (session.playerId) {
      await tx.auditLog.create({
        data: {
          actorId: session.playerId,
          action: "RESET_LEAGUE",
          entityType: "League",
          entityId: leagueId,
          payload: JSON.stringify({
            deletedMatches: matchIds.length,
            previousStatus: league.status,
          }),
        },
      });
    }
  });

  revalidatePath("/admin");
  revalidatePath("/admin/liga");
  revalidatePath("/admin/emparejamientos");
  revalidatePath("/admin/playoffs");
  revalidatePath("/calendario");
  revalidatePath("/clasificacion");
  revalidatePath("/bracket");
  revalidatePath("/mis-partidas");

  return { ok: true, data: undefined };
}
