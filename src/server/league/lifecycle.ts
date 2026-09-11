// Server-side domain actions for league lifecycle (create, archive/
// unarchive, reset). Split out of src/server/league-actions.ts (multi-liga
// C1, contexto-de-liga-y-modulos) — pure move, no logic change at the time
// of that split. league-actions.ts re-exports this module so no existing
// import breaks.
// Hito 5: admin-liga-jugadores. SPEC §4.1, §4.2, §5.
// Multi-liga D1 (archivado-de-ligas): archiveLeague, unarchiveLeague.
// multi-liga spec §2.7, §2.8, §4.7, §5.4, §5.6.

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
  resolveActingPlayerId,
  LeagueArchivedError,
} from "@/lib/league-context";
import { findDisplayNameConflict } from "./players";
import type { ActionResult } from "./action-result";

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/**
 * Checks a batch of candidate `displayName`s against the single
 * global-uniqueness point (`findDisplayNameConflict`,
 * src/server/league/players.ts, lane C's C4) and returns every one that
 * conflicts, in order (spec §5.4: `unarchiveLeague` below needs the *full*
 * list of conflicts, not just the first, before it can fail).
 */
async function findAllConflictingDisplayNames(
  displayNames: string[]
): Promise<string[]> {
  const conflicting: string[] = [];
  for (const name of displayNames) {
    const conflict = await findDisplayNameConflict(name);
    if (conflict) conflicting.push(name);
  }
  return conflicting;
}

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
// League: archive / unarchive (multi-liga D1, archivado-de-ligas)
// ---------------------------------------------------------------------------

/**
 * Archive a league (spec §2.8, §4.7, criterio 22): sets `archivedAt = now()`.
 * Deliberately does NOT touch `status` — archiving is orthogonal to it, same
 * relationship as `Round.closedAt` to `Round`.
 *
 * From this point on: `assertLeagueWritable` (already wired into every
 * write action listed in spec §5.6, multi-liga C1) rejects every write on
 * this league; `verifyPlayerPasscode` (lane C, C4) will stop letting its
 * players log in; and `requireLeagueAccess` (multi-liga C1,
 * src/lib/league-context.ts) already redirects a PLAYER session whose own
 * league turns out to be archived to `/login` (spec §5.3, criterio 24) — no
 * further action needed here for that to take effect on that player's next
 * request.
 *
 * Idempotent: archiving an already-archived league is a no-op success that
 * leaves the original `archivedAt` untouched, rather than bumping it to a
 * new timestamp for no product reason.
 */
export async function archiveLeague(leagueId: string): Promise<ActionResult> {
  const session = await requireAdmin();

  const league = await prisma.league.findUnique({ where: { id: leagueId } });
  if (!league) {
    return { ok: false, error: "Liga no encontrada" };
  }

  if (league.archivedAt !== null) {
    return { ok: true, data: undefined };
  }

  // Resolved before the transaction: session.playerId is always null for an
  // ADMIN session (spec §4.4) — the actor is this league's own ADMIN Player.
  const actorId = await resolveActingPlayerId(leagueId, session);

  await prisma.$transaction(async (tx) => {
    await tx.league.update({
      where: { id: leagueId },
      data: { archivedAt: new Date() },
    });

    // Best-effort, same convention as resetLeague below: a league somehow
    // missing its ADMIN Player (spec criterio 13 says this shouldn't
    // happen) still gets archived — it just doesn't leave a trail.
    if (actorId) {
      await tx.auditLog.create({
        data: {
          actorId,
          action: "ARCHIVE_LEAGUE",
          entityType: "League",
          entityId: leagueId,
          payload: JSON.stringify({}),
        },
      });
    }
  });

  revalidatePath("/admin");
  return { ok: true, data: undefined };
}

/**
 * Unarchive a league (spec §2.8, §4.7): sets `archivedAt = null`, putting its
 * players back into the global `displayName`-uniqueness pool (spec §2.7) and
 * letting them log in again.
 *
 * Fails without changing anything (spec §5.4, criterio 25) if any of this
 * league's `role: "PLAYER"` names collides with a `role: "PLAYER"` row in
 * some OTHER league that's currently in circulation — checked against every
 * `PLAYER` row of this league regardless of `active`, matching how the
 * intra-league check already works (`createPlayer`,
 * src/server/league/players.ts): a deactivated player still "owns" their
 * name. Every conflicting name is listed in the error, not just the first.
 *
 * Idempotent: unarchiving a league already in circulation is a no-op
 * success (nothing to check against, nothing to change).
 */
export async function unarchiveLeague(
  leagueId: string
): Promise<ActionResult> {
  const session = await requireAdmin();

  const league = await prisma.league.findUnique({ where: { id: leagueId } });
  if (!league) {
    return { ok: false, error: "Liga no encontrada" };
  }

  if (league.archivedAt === null) {
    return { ok: true, data: undefined };
  }

  const players = await prisma.player.findMany({
    where: { leagueId, role: "PLAYER" },
    select: { displayName: true },
  });

  // This league is still archived at this point (we haven't flipped it
  // yet), so `findDisplayNameConflict`'s own `archivedAt: null` filter
  // already excludes this league's own rows from matching themselves — no
  // separate "exclude this league" plumbing needed.
  const conflicts = await findAllConflictingDisplayNames(
    players.map((p) => p.displayName)
  );

  if (conflicts.length > 0) {
    return {
      ok: false,
      error: `No se puede desarchivar: los siguientes nombres ya están en uso en una liga en circulación — ${conflicts.join(", ")}.`,
    };
  }

  const actorId = await resolveActingPlayerId(leagueId, session);

  await prisma.$transaction(async (tx) => {
    await tx.league.update({
      where: { id: leagueId },
      data: { archivedAt: null },
    });

    if (actorId) {
      await tx.auditLog.create({
        data: {
          actorId,
          action: "UNARCHIVE_LEAGUE",
          entityType: "League",
          entityId: leagueId,
          payload: JSON.stringify({}),
        },
      });
    }
  });

  revalidatePath("/admin");
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

  // Multi-liga spec §5.6, criterio 23: no reset on an archived league.
  try {
    assertLeagueWritable(league);
  } catch (err) {
    if (err instanceof LeagueArchivedError) {
      return { ok: false, error: err.message };
    }
    throw err;
  }

  // Resolved before the transaction, same convention as archiveLeague above:
  // for an ADMIN session, session.playerId is always null (spec §4.4) —
  // resolveActingPlayerId (src/lib/league-context.ts) derives the actor as
  // this league's own ADMIN Player instead of leaving the audit trail empty.
  const actorId = await resolveActingPlayerId(leagueId, session);

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

    // 4. Audit trail (best-effort: requires an ADMIN Player for this league).
    if (actorId) {
      await tx.auditLog.create({
        data: {
          actorId,
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

  // Slug-based routes (multi-liga): the un-slugged paths this used to
  // revalidate (`/admin/liga`, `/calendario`, …) don't render this league's
  // data anymore — they're the redirect-only routes (spec §5.10).
  revalidatePath("/admin");
  revalidatePath(`/admin/${league.slug}/liga`);
  revalidatePath(`/admin/${league.slug}/emparejamientos`);
  revalidatePath(`/admin/${league.slug}/playoffs`);
  revalidatePath(`/liga/${league.slug}/calendario`);
  revalidatePath(`/liga/${league.slug}/clasificacion`);
  revalidatePath(`/liga/${league.slug}/bracket`);
  revalidatePath(`/liga/${league.slug}/mis-partidas`);

  return { ok: true, data: undefined };
}
