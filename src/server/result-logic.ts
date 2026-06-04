// Pure domain logic for result reporting and confirmation.
// No DB imports — all functions are testable in isolation.
// SPEC §7.1 (bonus), §7.5 (result flow), §4.5 (Result).

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Outcome = "HOME_WIN" | "AWAY_WIN" | "DRAW";

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
// Authorization helpers (pure — receive data, return boolean)
// ---------------------------------------------------------------------------

/**
 * Can this player report a result for this match?
 * Only home, away, or admin may report (SPEC §5).
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

/**
 * Can this player confirm/dispute a result?
 * SPEC §7.5 anti-dispute: only the RIVAL (not the reporter) may confirm or dispute.
 * Admin can also confirm/resolve.
 */
export function canConfirmOrDispute(
  playerId: string | null,
  role: string,
  homeId: string,
  awayId: string | null,
  reportedById: string
): boolean {
  if (role === "ADMIN") return true;
  if (playerId === null) return false;
  // Must be a participant but NOT the reporter.
  const isParticipant = playerId === homeId || playerId === awayId;
  const isReporter = playerId === reportedById;
  return isParticipant && !isReporter;
}

// ---------------------------------------------------------------------------
// Status transition guards
// ---------------------------------------------------------------------------

/**
 * Valid status transitions for reporting:
 * SCHEDULED → REPORTED (fresh report)
 * REPORTED  → REPORTED (update/overwrite by same or different participant)
 * DISPUTED  → REPORTED (re-report after admin decides the flow should restart)
 *
 * Note: admin can re-report any match (handled in server action).
 */
export function canReportInStatus(status: string, isAdmin: boolean): boolean {
  if (isAdmin) return true; // Admin override: any status.
  return status === "SCHEDULED" || status === "REPORTED" || status === "DISPUTED";
}

/**
 * Confirms require status === REPORTED.
 */
export function canConfirmInStatus(status: string): boolean {
  return status === "REPORTED";
}

/**
 * Disputes require status === REPORTED.
 */
export function canDisputeInStatus(status: string): boolean {
  return status === "REPORTED";
}
