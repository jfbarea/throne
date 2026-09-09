// Pure, presentation-adjacent helpers extracted from the UI so they can be
// tested in Vitest instead of only exercised through rendered pages (SPEC
// §7.3: "el cupo de una ronda, el orden de los bloques de Mis partidas y el
// texto ... son cálculo, no presentación... y van a src/server/"). Hito 6
// (ui-cupo-y-rondas, plan/rondas-con-fecha/PLAN.md).
//
// Deliberately a separate module from rounds.ts (Hito 2, closed and at 100%
// coverage, off-limits for this hito) even though this is the same kind of
// pure calculation — it only *depends on* rounds.ts's exports (roundQuota,
// quotaLabel, consumed directly by callers), never the other way round.

// ---------------------------------------------------------------------------
// sortRoundBlocks — SPEC §4.6, criterio 9
// ---------------------------------------------------------------------------

/** The minimal round shape `sortRoundBlocks` needs. */
export interface RoundBlockOrderInput {
  deadline: Date;
  closedAt: Date | null;
}

/**
 * Order round blocks the way "Mis partidas" presents them (SPEC §4.6,
 * criterio 9): open rounds first — closest deadline first — and closed
 * rounds afterwards. Generic so any round-shaped object (a Prisma `Round`
 * row, a DTO built for a page) can be sorted without copying this logic
 * into every caller.
 *
 * Stable with respect to ties (same deadline): `Array.prototype.sort` is
 * stable in every JS engine this project targets, and the spec says
 * nothing about ordering two rounds that share a deadline beyond "open
 * before closed".
 */
export function sortRoundBlocks<T extends RoundBlockOrderInput>(
  rounds: T[]
): T[] {
  return [...rounds].sort((a, b) => {
    const aClosed = a.closedAt !== null;
    const bClosed = b.closedAt !== null;
    if (aClosed !== bClosed) return aClosed ? 1 : -1;
    return a.deadline.getTime() - b.deadline.getTime();
  });
}

// ---------------------------------------------------------------------------
// resolveMatchStatusLabel — SPEC §4.9, hueco detectado en la review de H4
// ---------------------------------------------------------------------------

export type MatchLabelVariant = "brass" | "moss" | "ash" | "ember" | "neutral";

export interface MatchStatusLabel {
  label: string;
  variant: MatchLabelVariant;
}

export type MatchStatusValue = "SCHEDULED" | "REPORTED" | "CONFIRMED" | "DISPUTED";
export type ResolutionValue = "PLAYED" | "WALKOVER" | "UNPLAYED_DRAW";

/**
 * Resolve the badge a match should show, honoring `Result.resolution`
 * (SPEC §4.9) instead of collapsing every REPORTED match into "played"
 * regardless of how the Result came to be — the gap the H4 review found:
 * `calendario/MatchRow.tsx` and `mis-partidas/MatchCard.tsx` labeled every
 * REPORTED match "Jugada"/"Apuntada" and neither read `resolution`
 * (`grep -rn "resolution" src/app` returned nothing before this module).
 * Consequence: a match nobody played, settled 0-0 by `closeRound`, showed
 * up looking identical to one actually played.
 *
 * `resolution` is `null` for a match with no Result yet (status
 * SCHEDULED) — irrelevant in that branch, kept nullable so callers never
 * have to fabricate a fake value just to call this.
 *
 * `playedLabel` is the caller's own wording for the ordinary case (status
 * REPORTED, resolution PLAYED): "Jugada" in calendario, "Apuntada" in mis
 * partidas. Kept as a parameter rather than hardcoded, because the
 * criterion "el caso PLAYED no cambia lo que ve el usuario hoy" means the
 * two views are allowed — and meant — to keep saying different words for
 * that same case; only the WALKOVER/UNPLAYED_DRAW branches are new and
 * shared.
 */
export function resolveMatchStatusLabel(
  status: MatchStatusValue,
  resolution: ResolutionValue | null,
  playedLabel: string
): MatchStatusLabel {
  if (status === "REPORTED") {
    if (resolution === "WALKOVER") {
      return { label: "Incomparecencia", variant: "ember" };
    }
    if (resolution === "UNPLAYED_DRAW") {
      return { label: "Saldada sin jugar", variant: "ash" };
    }
    return { label: playedLabel, variant: "brass" };
  }
  if (status === "SCHEDULED") return { label: "Pendiente", variant: "neutral" };
  if (status === "CONFIRMED") return { label: "Confirmada", variant: "moss" };
  if (status === "DISPUTED") return { label: "Disputada", variant: "ember" };
  // Exhaustive per MatchStatusValue; kept as a defensive fallback in case a
  // legacy or corrupted row ever holds something outside the enum.
  return { label: status, variant: "neutral" };
}
