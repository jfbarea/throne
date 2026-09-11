// League context helpers — the contract every lane of the multi-liga feature
// resolves a league and derives an actor from (plan/multi-liga/PLAN.md, C1
// contexto-de-liga-y-modulos). multi-liga spec §4.1, §4.2, §4.9, §5.1, §5.6.
//
// Same convention as src/lib/guards.ts: a `requireX` helper resolves
// identity/authorization and either returns the resolved value or performs
// the redirect itself (never returns in that branch) — callers don't
// duplicate the branching.

import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import type { League } from "@/generated/prisma/client";
import type { SessionPayload } from "@/lib/session";

// ---------------------------------------------------------------------------
// resolveLeagueBySlug
// ---------------------------------------------------------------------------

/** Look up a league by its URL slug. Returns null if no league has it. */
export async function resolveLeagueBySlug(slug: string): Promise<League | null> {
  return prisma.league.findUnique({ where: { slug } });
}

// ---------------------------------------------------------------------------
// requireLeagueAccess
// ---------------------------------------------------------------------------

/**
 * Thrown by `requireLeagueAccess` when an ADMIN session requests a slug that
 * resolves to no league at all (spec §4.2, §5.1: "pantalla «esa liga no
 * existe» que lista las ligas disponibles"). Unlike every other outcome of
 * this guard, this one is NOT a redirect: it's the one case that needs to
 * render its own screen instead of the requested page, so it's surfaced as
 * a catchable error rather than a `redirect()` call. The caller (the
 * `/admin/[slug]` layout, C2) catches it and renders a fallback — today a
 * minimal message, meant to be replaced by the full "lista de ligas
 * disponibles" screen (lane B, B2, spec criterio 21).
 */
export class LeagueNotFoundForAdminError extends Error {
  constructor(public readonly slug: string) {
    super(`No existe ninguna liga con el slug "${slug}"`);
    this.name = "LeagueNotFoundForAdminError";
  }
}

/**
 * Build the `/liga/<slug>/...` path a PLAYER gets redirected to when they
 * request a slug that isn't theirs (spec §4.2, §5.1: "redirección silenciosa
 * a la misma página de su liga"). `samePagePath` is the segment(s) after the
 * slug on the page that triggered the guard (e.g. `"clasificacion"`) —
 * callers that know it (lane A's pages, criterio 5) pass it so the player
 * lands on the exact same page within their own league; callers that don't
 * (C2's bare layout) omit it and the player lands on their league's root.
 */
function buildOwnLeaguePath(ownSlug: string, samePagePath?: string): string {
  return samePagePath
    ? `/liga/${ownSlug}/${samePagePath}`
    : `/liga/${ownSlug}`;
}

/**
 * Resolve the league for `slug` and enforce spec §4.2's access table:
 *
 * | Quién   | Propia            | Ajena                | Archivada        | Inexistente |
 * |---------|--------------------|----------------------|------------------|-------------|
 * | Jugador | acceso completo    | redirección silenciosa a la misma página de su liga | igual que ajena | igual que ajena |
 * | Admin   | acceso completo    | acceso completo      | acceso de solo lectura (enforced at the write-action layer, `assertLeagueWritable`, not here) | `LeagueNotFoundForAdminError` |
 *
 * A PLAYER session is only ever redirected, never left without a resolved
 * league — same convention as `requireAdmin`/`requireAuth`
 * (src/lib/guards.ts): this function returns a `League` on every path that
 * doesn't redirect or throw.
 *
 * If the player's own `Player` row no longer resolves to a league at all
 * (their league was deleted, spec §5.2) this sends them to `/login` as a
 * best effort — it does NOT clear the session cookie (Server Components
 * can't mutate cookies mid-render). Making that redirect terminal (clearing
 * the cookie so a reload doesn't just loop back here) is lane D/C's job when
 * archiving/deleting ships (spec §5.2, §5.3), not this foundational guard.
 *
 * @param samePagePath See `buildOwnLeaguePath`.
 */
export async function requireLeagueAccess(
  slug: string,
  session: SessionPayload,
  samePagePath?: string
): Promise<League> {
  const league = await resolveLeagueBySlug(slug);

  if (session.role === "ADMIN") {
    if (!league) {
      throw new LeagueNotFoundForAdminError(slug);
    }
    // Ajena, propia o archivada: acceso completo de lectura siempre; la
    // escritura sobre una liga archivada la bloquea `assertLeagueWritable`
    // en el punto de la acción, no esta guarda de navegación.
    return league;
  }

  // PLAYER session: derive "their" league from the Player row, never from
  // the requested slug.
  const ownPlayer = session.playerId
    ? await prisma.player.findUnique({
        where: { id: session.playerId },
        select: { league: true },
      })
    : null;

  if (!ownPlayer) {
    // No Player row for this session at all (spec §5.2: their league was
    // deleted). Nothing to redirect them "back" to.
    redirect("/login");
  }

  const ownLeague = ownPlayer.league;

  if (ownLeague.archivedAt !== null) {
    // Spec §4.2's "igual que ajena" for an archived league is qualified by
    // "(no puede tener sesión, §4.4)": the only way a PLAYER session ends up
    // pointing at an archived league is §5.3 (it got archived *after* they
    // logged in), which has its own, different rule — sign them out, don't
    // silently bounce them back to the same (now archived) slug they just
    // requested, which would just redirect to itself in the isOwnLeague case.
    // Does NOT clear the session cookie (Server Components can't mutate
    // cookies mid-render) — making this terminal is lane D's job (D1,
    // spec criterio 24) once archiving itself exists.
    redirect("/login");
  }

  const isOwnLeague = league !== null && league.id === ownLeague.id;

  if (!isOwnLeague) {
    // Covers "ajena" and "inexistente" identically, on purpose (spec §4.2:
    // a nonexistent slug gets the exact same treatment as someone else's
    // league) — the redirect never reveals which one it was.
    redirect(buildOwnLeaguePath(ownLeague.slug, samePagePath));
  }

  return league;
}

// ---------------------------------------------------------------------------
// assertLeagueWritable
// ---------------------------------------------------------------------------

/**
 * Thrown by `assertLeagueWritable` for an archived league. Every write
 * action listed in spec §5.6 catches this and turns it into its own
 * `ActionResult` shape (`{ ok: false, error: err.message }`) — this class
 * only carries the user-facing Spanish message, same convention as the
 * other sentinel error classes in src/server/*-actions.ts
 * (e.g. `RoundClosedDuringTransactionError`).
 */
export class LeagueArchivedError extends Error {
  constructor() {
    super(
      "Esta liga está archivada. Solo se puede leer: ninguna acción de escritura está disponible."
    );
    this.name = "LeagueArchivedError";
  }
}

/**
 * Guard for every write action scoped to a league (spec §5.6, criterio 23).
 * Throws `LeagueArchivedError` if the league is archived; does nothing
 * otherwise. Accepts anything with an `archivedAt` field so callers that
 * already loaded a narrower Prisma `select` don't need to widen it just to
 * call this.
 */
export function assertLeagueWritable(league: { archivedAt: Date | null }): void {
  if (league.archivedAt !== null) {
    throw new LeagueArchivedError();
  }
}

// ---------------------------------------------------------------------------
// resolveActingPlayerId
// ---------------------------------------------------------------------------

/**
 * Resolve the `Player.id` that should be written as the actor of a write
 * action (`Result.reportedById`, `AuditLog.actorId`) for the given league
 * and session (spec §2.4, §4.4, §4.9).
 *
 *  - PLAYER session: it's `session.playerId` itself — a player only ever
 *    acts as themselves. Assumes the caller already established that this
 *    player belongs to `leagueId` (e.g. via `requireLeagueAccess`); this
 *    function does not re-check it.
 *  - ADMIN session: `session.playerId` is always `null` (spec §4.4 — the
 *    admin session carries no fixed player identity), so the actor is
 *    derived by liga: the `Player` with `role = ADMIN` in `leagueId`. Every
 *    league is supposed to have exactly one (spec §4.9, criterio 13), but
 *    this returns `null` rather than throwing if none exists yet — leagues
 *    created before lane D wires that invariant in, or direct test
 *    fixtures, may not have one. Callers keep the existing "la sesión de
 *    administrador no tiene un jugador asociado" rejection for that case
 *    (same message already used throughout src/server/*-actions.ts).
 */
export async function resolveActingPlayerId(
  leagueId: string,
  session: SessionPayload
): Promise<string | null> {
  if (session.role === "PLAYER") {
    return session.playerId;
  }

  const adminPlayer = await prisma.player.findFirst({
    where: { leagueId, role: "ADMIN" },
    select: { id: true },
  });
  return adminPlayer?.id ?? null;
}
