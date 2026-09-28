// Pure domain logic for result reporting.
// No DB imports — all functions are testable in isolation.
// SPEC §7.1 (bonus), §7.5 (result flow), §4.5 (Result).
// Hito 15: confirmación del rival y disputas eliminadas. Un participante (o admin)
// apunta los VP y la partida cuenta de inmediato (status REPORTED).
//
// "calendario-de-verdad" (plan/specs/calendario-de-verdad.md) adds the
// scheduling guards at the bottom of this file: they live here, next to the
// reporting guards, because §7 requires every new guard to be a pure predicate
// the server action calls — never a check that only the client performs.

import {
  scheduleBounds,
  monthKeyOf,
  monthKeyEquals,
  type MonthKey,
  type RoundRef,
} from "./calendar";

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

/**
 * Can this actor declare a walkover given the match's *existing* Result (if
 * any)? Rondas-con-fecha spec D5 (plan/rondas-con-fecha/PLAN.md), fixed after
 * H5's first review found the hole: without this guard, a participant could
 * unilaterally turn a real, already-played result (`resolution = PLAYED`)
 * into an 80-0 walkover in their own favor — none of the other reused guards
 * (canReport, canReportInStatus, canReportGivenRoundClosed) look at the
 * existing Result's `resolution` at all.
 *
 * - A participant CANNOT declare a walkover over a match whose current
 *   Result has `resolution = PLAYED` — that would fabricate an
 *   incomparecencia over a game that was actually played, which §4.10 never
 *   authorizes (it only authorizes overwriting a *previous* walkover).
 * - The admin CAN, via the usual §7.5 override.
 * - Declaring a walkover when there is no Result yet (`existingResolution
 *   === null`), or overwriting an existing WALKOVER or UNPLAYED_DRAW
 *   (changing the winner, or later correcting it back to PLAYED via
 *   `reportResult`), is unaffected — those aren't "fabricating" anything
 *   over a played game.
 */
export function canDeclareWalkoverOverExistingResult(
  existingResolution: string | null,
  isAdmin: boolean
): boolean {
  if (isAdmin) return true;
  return existingResolution !== "PLAYED";
}

// ---------------------------------------------------------------------------
// Scheduling guards — calendario-de-verdad spec §4.6, §4.7, §4.8, §4.9, §4.14
// ---------------------------------------------------------------------------

/**
 * Why a write to `Match.scheduledAt` was refused. The caller
 * (`setMatchSchedule`) turns each of these into the Spanish message of §5.5 —
 * the reason is the fact, the wording is presentation.
 */
export type ScheduleRejection =
  /** §4.6: later than the round's deadline. Admin is exempt. */
  | "AFTER_ROUND_DEADLINE"
  /** §4.7: earlier than the 1st of `League.startMonth`. Nobody is exempt. */
  | "BEFORE_LEAGUE_START"
  /** §4.14: the match's round is closed. Admin is exempt. */
  | "ROUND_CLOSED"
  /** §4.9: clearing the date of a `PLAYED` match. Nobody is exempt. */
  | "CLEARING_PLAYED_MATCH";

/** Everything `canScheduleAt` needs about the match being rescheduled. */
export interface ScheduleContext {
  /**
   * `Round.deadline` of the match's round. **null means no ceiling**: a
   * playoff match (§4.11) or a league match with no round yet (§5.2).
   */
  roundDeadline: Date | null;
  /** `Round.closedAt`; null both when the round is open and when there is none. */
  roundClosedAt: Date | null;
  /** `League.startMonth`; null for a league still in SETUP — then no floor. */
  leagueStartMonth: Date | null;
  /** Whether the match already has a Result with `resolution = "PLAYED"`. */
  hasPlayedResult: boolean;
}

export type ScheduleDecision =
  | { ok: true }
  | { ok: false; reason: ScheduleRejection };

/**
 * Can this actor write this `scheduledAt` onto this match?
 * calendario-de-verdad spec §4.6, §4.7, §4.9, §4.14 (criteria 18-21, 23,
 * 29-32).
 *
 * `scheduledAt === null` means "clear the date", which is a different question
 * from "is this date in range" — hence the early branch.
 *
 * The role only buys two things, and never more: acting on a closed round
 * (§4.14) and going past the round's deadline (§4.6, the match the group
 * agrees to drag along). It buys **no** exemption from the league-start floor
 * (a date before the league existed is a typo, not a decision, §4.7) nor from
 * the ban on clearing a played match's date (§4.9, §4.8: the admin escape
 * there would reopen exactly the hole the rule closes).
 *
 * The round-closed check reuses `canReportGivenRoundClosed` verbatim (§4.14
 * says "el mismo predicado"): the rule is not restated here.
 */
export function canScheduleAt(
  scheduledAt: Date | null,
  ctx: ScheduleContext,
  isAdmin: boolean
): ScheduleDecision {
  // §4.14 — a closed round freezes the date for participants, admin aside.
  // Checked first because it governs both setting and clearing.
  if (!canReportGivenRoundClosed(ctx.roundClosedAt, isAdmin)) {
    return { ok: false, reason: "ROUND_CLOSED" };
  }

  // §4.9 — clearing. Allowed for anything but a PLAYED result, for any role.
  if (scheduledAt === null) {
    if (ctx.hasPlayedResult) {
      return { ok: false, reason: "CLEARING_PLAYED_MATCH" };
    }
    return { ok: true };
  }

  const { min, max } = scheduleBounds(ctx.leagueStartMonth, ctx.roundDeadline);

  // §4.7 — the floor. No admin escape.
  if (min !== null && scheduledAt.getTime() < min.getTime()) {
    return { ok: false, reason: "BEFORE_LEAGUE_START" };
  }

  // §4.6 — the ceiling, with the admin escape. `max === null` = playoff match
  // or a match with no round: no ceiling at all.
  if (!isAdmin && max !== null && scheduledAt.getTime() > max.getTime()) {
    return { ok: false, reason: "AFTER_ROUND_DEADLINE" };
  }

  return { ok: true };
}

/**
 * §4.8: no date, no result. A match with `scheduledAt === null` cannot get a
 * `reportResult` — and this one does **not** take a role, on purpose: the
 * admin does not get around it either, or the exception would reintroduce
 * through the back door precisely what the rule closes.
 *
 * Only `reportResult` (`resolution = PLAYED`) asks this. `declareWalkover` and
 * `closeRound` resolve matches that were never played and stay exempt
 * (criteria 26, 27).
 */
export function canReportGivenSchedule(scheduledAt: Date | null): boolean {
  return scheduledAt !== null;
}

/** The minimal match shape the day picker's filter needs (§4.5). */
export interface EligibilityInput {
  id: string;
  playerHomeId: string;
  /** null for a playoff bye. */
  playerAwayId: string | null;
  /**
   * `Round.index` (1-based) of the match's round; null for a playoff match or
   * a league match not yet assigned to one (§5.2).
   */
  roundIndex: number | null;
  /** `Round.closedAt` of that round; null when open or when there is none. */
  roundClosedAt: Date | null;
}

/** Who is picking, and for which month (§4.5). */
export interface EligibilityContext {
  /** The month the day belongs to — the visible month of the grid. */
  month: MonthKey;
  /** Every round of the league, to locate which one covers `month`. */
  rounds: RoundRef[];
  /** The session's player, or null (an admin with no Player, §5.11). */
  playerId: string | null;
  isAdmin: boolean;
}

/**
 * Which of these matches this actor may drag onto a day of `ctx.month`
 * (§4.5, §4.14). Returns their ids, in input order.
 *
 * The rule, in one line: **adelantar sí, retrasar no**. For a day of the month
 * covered by round M, a player is offered their matches of round M and of any
 * *later* round — never an earlier one, because a round-2 match cannot end up
 * played in round 4's month (§4.6). Matches that already have a date are
 * included: choosing one *moves* it (criterio 14).
 *
 * Special cases, all of them from the spec:
 *  - `roundIndex === null` (playoff, or a league match with no round yet):
 *    no round rule applies, it can go on any navigable day (§4.11, §5.2).
 *  - a month with no round of its own (a playoff month): a player is offered
 *    only the round-less matches; a league match there would be past its
 *    round's deadline (§4.11).
 *  - closed rounds are not offered to a player, only to the admin (§4.14,
 *    criterio 33) — via `canReportGivenRoundClosed`, the same predicate again.
 *  - the admin is offered any round (criterio 17).
 */
export function eligibleForDay(
  matches: EligibilityInput[],
  ctx: EligibilityContext
): string[] {
  const monthRound = ctx.rounds.find((r) =>
    monthKeyEquals(monthKeyOf(r.deadline), ctx.month)
  );
  const monthRoundIndex = monthRound === undefined ? null : monthRound.index;

  const eligible: string[] = [];
  for (const match of matches) {
    const isParticipant =
      ctx.playerId !== null &&
      (match.playerHomeId === ctx.playerId ||
        match.playerAwayId === ctx.playerId);
    if (!ctx.isAdmin && !isParticipant) continue;

    if (!canReportGivenRoundClosed(match.roundClosedAt, ctx.isAdmin)) continue;

    if (match.roundIndex !== null && !ctx.isAdmin) {
      if (monthRoundIndex === null) continue;
      if (match.roundIndex < monthRoundIndex) continue;
    }

    eligible.push(match.id);
  }
  return eligible;
}
