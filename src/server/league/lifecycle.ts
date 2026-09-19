// Server-side domain actions for league lifecycle: create, archive/
// unarchive, duplicate, delete, reset. Split out of
// src/server/league-actions.ts (multi-liga C1, contexto-de-liga-y-modulos)
// — pure move, no logic change at the time of that split. league-actions.ts
// re-exports this module so no existing import breaks.
// Hito 5: admin-liga-jugadores. SPEC §4.1, §4.2, §5.
// Multi-liga D1 (archivado-de-ligas) and D2 (crear-duplicar-borrar): archive/
// unarchive/duplicate/delete, and createLeague extended to always create the
// league's own ADMIN Player row. multi-liga spec §2.7, §2.8, §2.9, §2.10,
// §4.7, §4.8, §4.9, §5.4, §5.6, §5.7.

"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import {
  leagueConfigSchema,
  serialiseTiebreakers,
  adminDisplayNameSchema,
  duplicateLeagueSchema,
  type CreateLeagueInput,
  type DuplicateLeagueInput,
} from "@/lib/schemas";
import { requireAdmin } from "@/lib/guards";
import { generateHashedPasscode } from "@/lib/passcode";
import { slugify, uniqueSlug } from "@/server/slug";
import {
  assertLeagueWritable,
  resolveActingPlayerId,
  LeagueArchivedError,
} from "@/lib/league-context";
import { findDisplayNameConflict } from "./players";
import { DEFAULT_RULES_MARKDOWN } from "./default-rules";
import type { ActionResult } from "./action-result";

/**
 * Fallback for the ADMIN Player's `displayName` when nothing better is
 * available: `createLeague` callers that don't pass `adminDisplayName` (see
 * `CreateLeagueInput`'s docstring in src/lib/schemas.ts), and
 * `duplicateLeague` when the origin league has no ADMIN Player row to copy
 * the name from at all (a fixture/edge case — every league created through
 * the app always has one, spec criterio 13).
 */
const DEFAULT_ADMIN_DISPLAY_NAME = "Admin";

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
 * Create a new league in SETUP status, together with its own ADMIN `Player`
 * row (multi-liga spec §4.9, criterio 13) — created in the same transaction
 * so a league can never exist without one. Also computes and persists a
 * real `slug` (spec §2.6, §4.6) and seeds `rulesMarkdown` with the default
 * bases template (spec §2.9) — `League.slug`'s `@default(cuid())` and
 * `rulesMarkdown`'s `@default("")` in the schema are safety nets for direct
 * `prisma.league.create` calls (tests, fixtures), never relied on here
 * (plan/multi-liga/PLAN.md, "Hallazgos de los cimientos" #1).
 *
 * Not guarded by `assertLeagueWritable` (multi-liga spec §5.6): the guard
 * protects writes *to an existing* league, and creating a brand-new one
 * can't be blocked by an archived state that doesn't apply to it yet.
 */
export async function createLeague(
  input: CreateLeagueInput
): Promise<ActionResult<{ id: string; slug: string }>> {
  await requireAdmin();

  const parsed = leagueConfigSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Datos de configuración inválidos",
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    };
  }

  // adminDisplayName is validated only when present — see CreateLeagueInput's
  // docstring for why it's optional at the type level.
  let adminDisplayName = DEFAULT_ADMIN_DISPLAY_NAME;
  if (input.adminDisplayName !== undefined) {
    const adminNameParsed = adminDisplayNameSchema.safeParse(
      input.adminDisplayName
    );
    if (!adminNameParsed.success) {
      return {
        ok: false,
        error: "Nombre de administrador inválido",
        fieldErrors: {
          adminDisplayName: adminNameParsed.error.flatten().formErrors,
        },
      };
    }
    adminDisplayName = adminNameParsed.data;
  }

  const d = parsed.data;

  const takenSlugs = (
    await prisma.league.findMany({ select: { slug: true } })
  ).map((l) => l.slug);
  const slug = uniqueSlug(slugify(d.name, d.season), takenSlugs);

  // bcrypt hashing is CPU-bound; done before opening the transaction so the
  // transaction itself stays a couple of plain inserts.
  const { hash: adminPasscodeHash } = await generateHashedPasscode();

  const league = await prisma.$transaction(async (tx) => {
    const created = await tx.league.create({
      data: {
        name: d.name,
        season: d.season,
        slug,
        rulesMarkdown: DEFAULT_RULES_MARKDOWN,
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

    // Multi-liga spec §4.9, criterio 13: every league is born with exactly
    // one ADMIN Player. Its passcode is never used to log in (the admin
    // authenticates with ADMIN_PASSCODE, spec §4.4) but the column is
    // NOT NULL, so it gets a real generated one, same as any other player.
    const adminPlayer = await tx.player.create({
      data: {
        leagueId: created.id,
        displayName: adminDisplayName,
        role: "ADMIN",
        passcodeHash: adminPasscodeHash,
        active: true,
      },
    });

    // Actor is the league's own freshly created ADMIN Player (spec §2.4,
    // §4.9: the actor of an admin action is always a Player of that same
    // league) — always available here, unlike resolveActingPlayerId's
    // session-based lookup elsewhere, since this Player didn't exist before
    // this very transaction.
    await tx.auditLog.create({
      data: {
        actorId: adminPlayer.id,
        action: "CREATE_LEAGUE",
        entityType: "League",
        entityId: created.id,
        payload: JSON.stringify({}),
      },
    });

    return created;
  });

  revalidatePath("/admin");
  return { ok: true, data: { id: league.id, slug: league.slug } };
}

// ---------------------------------------------------------------------------
// League: suggest the admin's own name for the /admin/nueva form
// ---------------------------------------------------------------------------

/**
 * Suggests a starting value for the ADMIN player name field on
 * `/admin/nueva` (spec §4.9: "el nombre de jugador del admin, precargado con
 * el que use en la liga en circulación más reciente"). The admin can still
 * edit it before submitting — this only computes the default.
 *
 * Returns `""` when there's no league in circulation yet (the very first
 * league ever created): there's nothing to suggest from, so the admin types
 * a name from scratch, same as every other field on that form.
 */
export async function suggestAdminDisplayName(): Promise<string> {
  const mostRecent = await prisma.league.findFirst({
    where: { archivedAt: null },
    orderBy: { createdAt: "desc" },
    select: {
      players: {
        where: { role: "ADMIN" },
        take: 1,
        select: { displayName: true },
      },
    },
  });

  return mostRecent?.players[0]?.displayName ?? "";
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
// League: duplicate (multi-liga D2, crear-duplicar-borrar)
// ---------------------------------------------------------------------------

/**
 * Duplicate an existing league into a brand-new one in SETUP (spec §2.9,
 * §4.8). Always copies the origin's configuration
 * (pointsWin/Draw/Loss, bonus*, playoffSize, matchesPerRound, tiebreakers)
 * and its bases prose (`rulesMarkdown`); never copies matches, results,
 * rounds, bracket, audit log or `startMonth` (criterio 27 — the destination
 * is born with zero of each, same as any brand-new league).
 *
 * Whether the roster is copied depends entirely on the origin's own
 * `archivedAt` (spec §2.7: `displayName` is unique only among leagues in
 * circulation, so copying a live roster would collide on the very first
 * name):
 *   - origin **archived**: one `Player` row per **active** origin player,
 *     same `displayName`/`faction`/`role`, brand-new passcode each
 *     (criterio 26, 28).
 *   - origin **in circulation**: no roster copied at all (criterio 29).
 *
 * Either way the destination always ends up with exactly one ADMIN Player
 * (criterio 13): if the archived origin's active roster already includes
 * one (the normal case), it's simply the copied row; otherwise — an
 * in-circulation origin (no roster copied) or an archived origin whose own
 * ADMIN happens to be deactivated — one is created fresh, named after the
 * origin's ADMIN row if it has one at all, regardless of that row's
 * `active` flag, or `DEFAULT_ADMIN_DISPLAY_NAME` failing that.
 *
 * Every created player's plaintext passcode is returned once, alongside its
 * `displayName` (spec §2.9: "termina en una pantalla que lista, una sola
 * vez, los pares displayName + passcode") — never persisted in the clear,
 * same convention as `createPlayer`/`resetPlayerPasscode`.
 *
 * Atomic (criterio 30): the league row and every player row are created
 * inside a single `prisma.$transaction` — if it fails partway, none of it
 * is left behind. Name-collision conflicts (spec §5.4) are checked *before*
 * opening that transaction and before hashing any passcode, so a doomed
 * duplication never creates anything nor burns bcrypt cycles for nothing.
 */
export async function duplicateLeague(
  originLeagueId: string,
  input: DuplicateLeagueInput
): Promise<
  ActionResult<{
    id: string;
    slug: string;
    generatedPasscodes: { displayName: string; plainPasscode: string }[];
  }>
> {
  await requireAdmin();

  const parsed = duplicateLeagueSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Datos inválidos",
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    };
  }
  const { name, season } = parsed.data;

  const origin = await prisma.league.findUnique({
    where: { id: originLeagueId },
  });
  if (!origin) {
    return { ok: false, error: "Liga de origen no encontrada" };
  }

  const isOriginArchived = origin.archivedAt !== null;

  // Roster to copy — active players only, and only from an archived origin
  // (spec §2.9). `role` comes along so the copied ADMIN row (if the origin's
  // is active) counts toward criterio 13 below without a separate step.
  const originActivePlayers = isOriginArchived
    ? await prisma.player.findMany({
        where: { leagueId: originLeagueId, active: true },
        select: { displayName: true, faction: true, role: true },
      })
    : [];

  const rowsToCreate = [...originActivePlayers];

  if (!rowsToCreate.some((p) => p.role === "ADMIN")) {
    // Guarantees criterio 13 regardless of path (see docstring above).
    const originAdmin = await prisma.player.findFirst({
      where: { leagueId: originLeagueId, role: "ADMIN" },
      select: { displayName: true },
    });
    rowsToCreate.push({
      displayName: originAdmin?.displayName ?? DEFAULT_ADMIN_DISPLAY_NAME,
      faction: null,
      role: "ADMIN",
    });
  }

  // Name-collision check (spec §5.4, criterio "falla antes de crear nada"):
  // only the copied role=PLAYER rows count (§2.7's admin exception) — the
  // ADMIN row built above, whichever branch it came from, is never checked.
  // `findDisplayNameConflict` is C4's single point (src/server/league/
  // players.ts) — same one createPlayer/updatePlayer already use.
  const regularPlayerNames = originActivePlayers
    .filter((p) => p.role === "PLAYER")
    .map((p) => p.displayName);
  const conflicts: string[] = [];
  for (const displayName of regularPlayerNames) {
    const conflict = await findDisplayNameConflict(displayName);
    if (conflict) conflicts.push(displayName);
  }
  if (conflicts.length > 0) {
    return {
      ok: false,
      error: `No se puede duplicar: los siguientes nombres ya están en uso en una liga en circulación — ${conflicts.join(", ")}.`,
    };
  }

  // Fresh passcode per created row (never copy passcodeHash, spec §2.9).
  // Hashed outside the transaction — see this function's own docstring.
  const hashedRows = await Promise.all(
    rowsToCreate.map(async (row) => ({
      ...row,
      ...(await generateHashedPasscode()),
    }))
  );

  const takenSlugs = (
    await prisma.league.findMany({ select: { slug: true } })
  ).map((l) => l.slug);
  const slug = uniqueSlug(slugify(name, season), takenSlugs);

  const newLeague = await prisma.$transaction(async (tx) => {
    const created = await tx.league.create({
      data: {
        name,
        season,
        slug,
        rulesMarkdown: origin.rulesMarkdown,
        status: "SETUP",
        pointsWin: origin.pointsWin,
        pointsDraw: origin.pointsDraw,
        pointsLoss: origin.pointsLoss,
        bonusEnabled: origin.bonusEnabled,
        bonusMarginThreshold: origin.bonusMarginThreshold,
        bonusMinVP: origin.bonusMinVP,
        playoffSize: origin.playoffSize,
        tiebreakers: origin.tiebreakers,
        matchesPerRound: origin.matchesPerRound,
        // Never copied (spec §2.9): the destination is a fresh SETUP league
        // with no starting month configured yet, same as any other.
        startMonth: null,
      },
    });

    let adminPlayerId: string | null = null;
    for (const row of hashedRows) {
      const player = await tx.player.create({
        data: {
          leagueId: created.id,
          displayName: row.displayName,
          faction: row.faction,
          role: row.role,
          passcodeHash: row.hash,
          active: true,
        },
      });
      if (row.role === "ADMIN") {
        adminPlayerId = player.id;
      }
    }

    // Actor is the destination's own ADMIN Player (spec §2.4, §4.9) — always
    // present at this point (criterio 13, guaranteed above by `rowsToCreate`).
    if (adminPlayerId) {
      await tx.auditLog.create({
        data: {
          actorId: adminPlayerId,
          action: "DUPLICATE_LEAGUE",
          entityType: "League",
          entityId: created.id,
          payload: JSON.stringify({ originLeagueId }),
        },
      });
    }

    return created;
  });

  revalidatePath("/admin");

  return {
    ok: true,
    data: {
      id: newLeague.id,
      slug: newLeague.slug,
      generatedPasscodes: hashedRows.map((r) => ({
        displayName: r.displayName,
        plainPasscode: r.plain,
      })),
    },
  };
}

// ---------------------------------------------------------------------------
// League: delete (multi-liga D2, crear-duplicar-borrar)
// ---------------------------------------------------------------------------

/**
 * Permanently delete a league (spec §2.10, §5.7). Only ever allowed for a
 * league still in `SETUP` with zero `Match` rows — "he creado esta liga por
 * error", nothing more. Any other league can only be archived (spec §2.8);
 * this action refuses and says so rather than offering a name-confirmation
 * dance.
 *
 * Deletes the league's `Player` rows and their `AuditLog` entries in the
 * same transaction, same as `deletePlayer`
 * (src/server/league/players.ts). `Round` rows are cleared defensively too
 * even though `status: SETUP` + zero `Match` should already imply zero of
 * them (round generation always creates matches alongside their round) —
 * cheap insurance against that invariant ever drifting. No `AuditLog` entry
 * is written for the deletion itself: the league and every one of its
 * Player rows (the only valid actors for it) are gone by the time the
 * transaction commits, so there is nothing left for such an entry to
 * meaningfully point `actorId` at.
 */
export async function deleteLeague(leagueId: string): Promise<ActionResult> {
  await requireAdmin();

  const league = await prisma.league.findUnique({ where: { id: leagueId } });
  if (!league) {
    return { ok: false, error: "Liga no encontrada" };
  }

  if (league.status !== "SETUP") {
    return {
      ok: false,
      error:
        "Solo se puede borrar una liga en configuración (SETUP). Archívala en su lugar.",
    };
  }

  const matchCount = await prisma.match.count({ where: { leagueId } });
  if (matchCount > 0) {
    return {
      ok: false,
      error: "No se puede borrar: la liga tiene partidas. Archívala en su lugar.",
    };
  }

  await prisma.$transaction(async (tx) => {
    const players = await tx.player.findMany({
      where: { leagueId },
      select: { id: true },
    });
    const playerIds = players.map((p) => p.id);

    if (playerIds.length > 0) {
      await tx.auditLog.deleteMany({ where: { actorId: { in: playerIds } } });
    }
    await tx.player.deleteMany({ where: { leagueId } });
    await tx.round.deleteMany({ where: { leagueId } });
    await tx.league.delete({ where: { id: leagueId } });
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
