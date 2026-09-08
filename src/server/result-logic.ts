// Pure domain logic for result reporting.
// No DB imports — all functions are testable in isolation.
// SPEC §7.1 (bonus), §7.5 (result flow), §4.5 (Result).
// Hito 15: confirmación del rival y disputas eliminadas. Un participante (o admin)
// apunta los VP y la partida cuenta de inmediato (status REPORTED).

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Outcome = "HOME_WIN" | "AWAY_WIN" | "DRAW";

// ---------------------------------------------------------------------------
// Walkover constant (rondas-con-fecha spec §4.8, §4.9, Hito 5)
// ---------------------------------------------------------------------------

/**
 * Fixed victory-point score credited to the winner of a walkover
 * (incomparecencia): the loser is credited 0. Not derived from any real VP —
 * the match was never played. Named so `declareWalkover`
 * (src/server/result-actions.ts) never hardcodes the number inline.
 */
export const WALKOVER_VICTORY_POINTS = 80;

export interface BonusConfig {
  bonusEnabled: boolean;
  // VP margin the winner must exceed over the loser to earn the massacre bonus.
  bonusMarginThreshold: number | null;
  // Minimum VP a player must score (even in defeat) to earn the min-VP bonus.
  bonusMinVP: number | null;
}

export interface BonusResult {
  bonusHome: number;
  bonusAway: number;
}

// ---------------------------------------------------------------------------
// calculateBonus — pure function (SPEC §7.1)
// ---------------------------------------------------------------------------

/**
 * Calculate resolved bonus points for home and away players.
 *
 * Rules (SPEC §7.1):
 *  - Massacre bonus: awarded to the WINNER if their VP margin over the loser
 *    is >= bonusMarginThreshold. DRAW produces no massacre bonus for either side.
 *  - Min-VP bonus: awarded to any player who reaches >= bonusMinVP VP,
 *    regardless of outcome (premia playing aggressively even in defeat).
 *
 * Returns {bonusHome: 0, bonusAway: 0} when bonus is disabled or config values
 * are null.
 *
 * This function is intentionally pure: no side effects, no DB access.
 * Stored at report time so standings are reproducible even if config changes.
 */
export function calculateBonus(
  homeVP: number,
  awayVP: number,
  outcome: Outcome,
  config: BonusConfig
): BonusResult {
  if (!config.bonusEnabled) {
    return { bonusHome: 0, bonusAway: 0 };
  }

  let bonusHome = 0;
  let bonusAway = 0;

  // Massacre bonus: winner VP margin >= threshold.
  if (config.bonusMarginThreshold !== null) {
    const margin = Math.abs(homeVP - awayVP);
    if (outcome === "HOME_WIN" && margin >= config.bonusMarginThreshold) {
      bonusHome += 1;
    } else if (outcome === "AWAY_WIN" && margin >= config.bonusMarginThreshold) {
      bonusAway += 1;
    }
    // DRAW: no massacre bonus (margin may be 0 or undefined winner).
  }

  // Min-VP bonus: any player reaching the threshold, regardless of outcome.
  if (config.bonusMinVP !== null) {
    if (homeVP >= config.bonusMinVP) {
      bonusHome += 1;
    }
    if (awayVP >= config.bonusMinVP) {
      bonusAway += 1;
    }
  }

  return { bonusHome, bonusAway };
}

// ---------------------------------------------------------------------------
// validateOutcomeVsVP — sanity check (non-blocking, purely advisory)
// ---------------------------------------------------------------------------

/**
 * Verify that the reported outcome is consistent with the VP scores.
 *
 * W40k allows rule-defined draws even when VPs differ, so this is not enforced
 * at the DB level. We surface a warning when there is an obvious mismatch:
 *  - HOME_WIN but homeVP <= awayVP
 *  - AWAY_WIN but awayVP <= homeVP
 *  - DRAW but homeVP !== awayVP (advisory only — mission rules may differ)
 *
 * Returns null if consistent, or a Spanish-language warning string.
 */
export function validateOutcomeVsVP(
  homeVP: number,
  awayVP: number,
  outcome: Outcome
): string | null {
  if (outcome === "HOME_WIN" && homeVP <= awayVP) {
    return "Aviso: resultado es Victoria Local pero los VP del local no superan los del visitante. Confirma si es correcto según las reglas de misión.";
  }
  if (outcome === "AWAY_WIN" && awayVP <= homeVP) {
    return "Aviso: resultado es Victoria Visitante pero los VP del visitante no superan los del local. Confirma si es correcto según las reglas de misión.";
  }
  return null;
}

// ---------------------------------------------------------------------------
// deriveOutcome — infer the outcome from the VP scores (SPEC §4.5)
// ---------------------------------------------------------------------------

/**
 * Derive the match outcome purely from the victory points.
 *
 * In the common case the result is fully implied by the VP: whoever scores more
 * wins, equal VP is a draw. Reporting no longer asks the player to pick the
 * outcome — it is computed here from the numbers they enter.
 *
 * The rare W40k case of a mission-rules draw despite unequal VP is handled
 * explicitly upstream (a "force draw" flag at report time), not by this function.
 */
export function deriveOutcome(homeVP: number, awayVP: number): Outcome {
  if (homeVP > awayVP) return "HOME_WIN";
  if (awayVP > homeVP) return "AWAY_WIN";
  return "DRAW";
}

// ---------------------------------------------------------------------------
// Authorization helpers (pure — receive data, return boolean)
// ---------------------------------------------------------------------------

/**
 * Can this player report (or edit) a result for this match?
 * Both home and away players, as well as admin, can report/edit (Hito 15).
 * SPEC §5 (participant or admin).
 */
export function canReport(
  playerId: string | null,
  role: string,
  homeId: string,
  awayId: string | null
): boolean {
  if (role === "ADMIN") return true;
  if (playerId === null) return false;
  return playerId === homeId || playerId === awayId;
}

// ---------------------------------------------------------------------------
// Status transition guards
// ---------------------------------------------------------------------------

/**
 * Valid statuses for reporting/editing a result (Hito 15):
 *   SCHEDULED → REPORTED (fresh report)
 *   REPORTED  → REPORTED (edit/overwrite by any participant or admin)
 *
 * Admin override: can act on any status (including CONFIRMED/DISPUTED legacy data).
 *
 * Note: DISPUTED is kept for legacy data compatibility but is not produced by
 * the new flow. Admin can always override.
 */
export function canReportInStatus(status: string, isAdmin: boolean): boolean {
  if (isAdmin) return true; // Admin override: any status.
  return status === "SCHEDULED" || status === "REPORTED";
}

/**
 * Can this player report/edit a result given the closed state of the match's
 * round? Rondas-con-fecha spec §4.7, §5.9, §7.5 (admin override), criteria
 * 21 and 22.
 *
 * - A participant CANNOT act once their round is closed (`closedAt` set).
 * - The admin can always override (edits a closed round's result without
 *   reopening it — closing/reopening is a separate action entirely; this
 *   guard never writes to `Round`).
 * - `roundClosedAt === null` covers both "round still open" and "match has
 *   no round at all" (playoff matches, §4.5's rounds are league-only):
 *   neither case blocks reporting.
 */
export function canReportGivenRoundClosed(
  roundClosedAt: Date | null,
  isAdmin: boolean
): boolean {
  if (isAdmin) return true;
  return roundClosedAt === null;
}
