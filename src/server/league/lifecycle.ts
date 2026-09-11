// Server-side domain actions for league lifecycle (create, reset).
// Split out of src/server/league-actions.ts (multi-liga C1,
// contexto-de-liga-y-modulos) — pure move, no logic change. league-actions.ts
// re-exports this module so no existing import breaks.
// Hito 5: admin-liga-jugadores. SPEC §4.1, §4.2, §5.

"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import {
  leagueConfigSchema,
  serialiseTiebreakers,
  type LeagueConfigInput,
} from "@/lib/schemas";
import { requireAdmin } from "@/lib/guards";
import {
  assertLeagueWritable,
  LeagueArchivedError,
} from "@/lib/league-context";
import type { ActionResult } from "./action-result";

// ---------------------------------------------------------------------------
// League: create
// ---------------------------------------------------------------------------

/**
 * Create a new league in SETUP status.
 * In the MVP there is a single active league; this action does not enforce
 * uniqueness — the UI should guide the admin accordingly.
 *
 * Not guarded by `assertLeagueWritable` (multi-liga spec §5.6): the guard
 * protects writes *to an existing* league, and creating a brand-new one
 * can't be blocked by an archived state that doesn't apply to it yet.
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

  // Multi-liga spec §5.6, criterio 23: no reset on an archived league.
  try {
    assertLeagueWritable(league);
  } catch (err) {
    if (err instanceof LeagueArchivedError) {
      return { ok: false, error: err.message };
    }
    throw err;
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
