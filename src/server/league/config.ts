// Server-side domain actions for league configuration.
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
import { redistributePending } from "@/server/round-actions";
import {
  assertLeagueWritable,
  LeagueArchivedError,
} from "@/lib/league-context";
import { slugify, uniqueSlug } from "@/server/slug";
import type { ActionResult } from "./action-result";

// ---------------------------------------------------------------------------
// League: update config
// ---------------------------------------------------------------------------

/**
 * Update the configuration of an existing league.
 * Cross-validates playoffSize against active player count.
 *
 * Returns the league's current slug (multi-liga B2,
 * renombrado-y-liga-no-encontrada): unchanged if the rename didn't touch
 * `name`/`season`, the freshly recomputed one otherwise. Callers on a
 * `/admin/[slug]/liga` page use it to navigate to the new URL instead of
 * refreshing the one they're already on, which would otherwise stop
 * resolving right after a successful save (spec §2.6, §5.1).
 */
export async function updateLeague(
  leagueId: string,
  input: LeagueConfigInput
): Promise<ActionResult<{ slug: string }>> {
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
  // settings save. `archivedAt` is fetched in the same query (multi-liga
  // spec §5.6, criterio 23): a league that doesn't exist yet skips the
  // guard exactly like it always skipped the matchesPerRound check below —
  // no new "not found" branch is introduced here. `name`/`season`/`slug` are
  // fetched too (multi-liga B2, renombrado-y-liga-no-encontrada, spec §2.6,
  // §4.6, criterio 21): the slug is only ever recomputed when the rename
  // actually changes one of the two fields it's derived from, not on every
  // save (same "only on real change" convention as matchesPerRound above).
  const previousLeague = await prisma.league.findUnique({
    where: { id: leagueId },
    select: {
      matchesPerRound: true,
      archivedAt: true,
      name: true,
      season: true,
      slug: true,
    },
  });

  if (previousLeague) {
    try {
      assertLeagueWritable(previousLeague);
    } catch (err) {
      if (err instanceof LeagueArchivedError) {
        return { ok: false, error: err.message };
      }
      throw err;
    }
  }

  // Recompute the slug only when the rename actually changes name or season
  // (spec §2.6: "se regenera cada vez que el admin cambia el nombre o la
  // temporada"). No history is kept — the previous slug simply stops
  // resolving (spec §5.1, closed by `LeagueNotFoundScreen`, B2). Collisions
  // with every OTHER league (this league's own current slug is excluded, or
  // renaming to the exact same name/season combo would spuriously gain a
  // "-2" suffix from colliding with itself) are desambiguated the same way
  // `createLeague` will (lane D, `uniqueSlug`, spec §4.6, §5.5, criterio 20).
  let newSlug: string | undefined;
  if (
    previousLeague !== null &&
    (previousLeague.name !== d.name || previousLeague.season !== d.season)
  ) {
    const base = slugify(d.name, d.season);
    const otherSlugs = await prisma.league.findMany({
      where: { id: { not: leagueId } },
      select: { slug: true },
    });
    newSlug = uniqueSlug(
      base,
      otherSlugs.map((l) => l.slug)
    );
  }

  const updated = await prisma.league.update({
    where: { id: leagueId },
    data: {
      name: d.name,
      season: d.season,
      ...(newSlug !== undefined ? { slug: newSlug } : {}),
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
    select: { slug: true },
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
  revalidatePath(`/admin/${updated.slug}/liga`);
  revalidatePath(`/admin/${updated.slug}/rondas`);
  revalidatePath(`/liga/${updated.slug}/mis-partidas`);
  revalidatePath(`/liga/${updated.slug}/rondas`);
  revalidatePath(`/liga/${updated.slug}/calendario`);
  return { ok: true, data: { slug: updated.slug } };
}
