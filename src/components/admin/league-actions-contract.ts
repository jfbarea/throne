// Contract for the admin league-index action components — multi-liga C2
// (andamiaje-de-rutas). Types and prop signatures ONLY, no implementation:
// lane D (D1 archivado-de-ligas, D2 crear-duplicar-borrar) builds the actual
// components against this contract; lane B (B1
// indice-de-ligas-y-pantallas-con-slug) mounts them from `/admin/page.tsx`.
// This is the seam PLAN.md's file-ownership table calls out explicitly:
// "el contrato de esos componentes se fija en C2" so `/admin/page.tsx` keeps
// a single owner (B) even though the actions themselves are D's.
//
// Every prop here is plain data the index page already has (or can get
// without an extra round trip) when it lists a league — none of these
// components should need to re-fetch the league themselves.

/** The subset of League fields every action component needs to identify its
 * target and decide what it can offer (spec §2.8, §2.9, §2.10). Components
 * take this instead of five loose scalar props so the index page has one
 * shape to build per league row, and adding a field later doesn't change
 * every component's signature. */
export interface LeagueActionTarget {
  id: string;
  slug: string;
  name: string;
  season: string;
  /** SETUP | LEAGUE | PLAYOFFS | FINISHED (spec §2.10: only SETUP + zero
   * Match is eligible for hard delete). Kept as `string`, not the Prisma
   * enum type, so this contract has zero dependency on the generated
   * client — it's a UI seam, not a domain one. */
  status: string;
  archivedAt: Date | null;
  /** Active player count (spec §4.5: "los contadores son por liga") —
   * already computed by whatever query the index uses to list leagues,
   * passed through rather than re-queried by the action component. */
  activePlayerCount: number;
  /** Total Match count for this league, regardless of phase or status
   * (spec §2.10, §5.7: the only thing that blocks a hard delete). */
  matchCount: number;
}

/** Archive a league in circulation (spec §2.8, §4.7, D1). Disabled/absent
 * for a league that's already archived — `unarchive` is the opposite
 * action, not a toggle of this one. */
export interface ArchiveLeagueActionProps {
  league: LeagueActionTarget;
  /** Called after the server action succeeds, so the index page can
   * refresh its list without the component needing to know how. */
  onArchived?: () => void;
}

/** Desarchivar a league (spec §2.8, §4.7, §5.4, D1). The action itself can
 * fail with a name-collision error (§5.4: "lista todos los nombres en
 * conflicto"); the component surfaces that, it doesn't resolve it — there
 * is no partial-desarchivado path. */
export interface UnarchiveLeagueActionProps {
  league: LeagueActionTarget;
  onUnarchived?: () => void;
}

/** Duplicate a league — in blank config-only, or with roster if the origin
 * is archived (spec §2.9, §4.8, D2). What gets copied depends entirely on
 * `league.archivedAt`, which is already on `LeagueActionTarget` — this
 * component decides the copy-roster-or-not branch itself from that, the
 * caller doesn't pass a separate flag for it.
 *
 * On success the duplication flow shows the generated passcodes once (spec
 * §2.9: "termina en una pantalla que lista, una sola vez, los pares
 * displayName + passcode") — modelled as data passed to `onDuplicated`
 * rather than the component owning that screen, so lane B decides where
 * that screen lives (modal, dedicated route, etc.) when it mounts this.
 */
export interface DuplicateLeagueActionProps {
  league: LeagueActionTarget;
  onDuplicated?: (result: {
    newLeagueId: string;
    newLeagueSlug: string;
    generatedPasscodes: { displayName: string; plainPasscode: string }[];
  }) => void;
}

/** Hard-delete a league — only ever offered for `status: "SETUP"` and
 * `matchCount: 0` (spec §2.10, §5.7); every other league can only be
 * archived. The component itself decides whether it's eligible from
 * `league.status`/`league.matchCount` — the caller doesn't pass a separate
 * `disabled` flag for that, so the same eligibility rule can't drift
 * between what the button shows and what the server action enforces. */
export interface DeleteLeagueActionProps {
  league: LeagueActionTarget;
  onDeleted?: () => void;
}
