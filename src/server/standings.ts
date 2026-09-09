// Pure standings computation — SPEC §7.3.
// No DB imports: computes standings from in-memory match data.
// ADR-002: no SQL-proprietary logic; all tiebreaker logic lives here.

import { parseTiebreakers } from "@/lib/schemas";
import type { Tiebreaker } from "@/lib/schemas";

// ---------------------------------------------------------------------------
// Input types
// ---------------------------------------------------------------------------

/**
 * Minimal match data needed to compute standings.
 * Caller queries the DB and maps to this shape.
 */
export interface StandingsMatch {
  /** Match primary key — used to deduplicate. */
  id: string;
  /** Match lifecycle status. Only CONFIRMED matches count. */
  status: string;
  /** Match phase. Only LEAGUE matches are counted for league standings. */
  phase: string;
  /** Home player id. */
  playerHomeId: string;
  /** Away player id. Null means a bye (irrelevant for league phase). */
  playerAwayId: string | null;
  /** Result exists only when status >= REPORTED. */
  result: {
    homeVictoryPoints: number;
    awayVictoryPoints: number;
    /** Stored outcome (HOME_WIN | AWAY_WIN | DRAW). */
    outcome: string;
    /** Resolved bonus points stored at report time. */
    bonusHome: number;
    bonusAway: number;
    /**
     * How the match was resolved — `PLAYED` | `WALKOVER` | `UNPLAYED_DRAW`
     * (SPEC §4.9). Optional so existing callers/tests that predate Hito 7
     * (`rondas-con-fecha`) keep compiling unchanged; absent is treated as
     * `PLAYED`, mirroring `Result.resolution`'s DB default (Hito 1). Read
     * ONLY by the settled-count tally below (criterio 27) — never by the
     * points/VP/tiebreaker arithmetic (criterio 28).
     */
    resolution?: string;
  } | null;
}

/**
 * League config fields needed by computeStandings.
 */
export interface StandingsConfig {
  /** League points awarded for a win. */
  pointsWin: number;
  /** League points awarded for a draw. */
  pointsDraw: number;
  /** League points awarded for a loss. */
  pointsLoss: number;
  /**
   * Ordered tiebreaker criteria (JSON-encoded string as stored in DB).
   * Parsed via parseTiebreakers from src/lib/schemas.
   */
  tiebreakers: string;
  /**
   * How many top players qualify for playoffs.
   * Used only for the playoffZone flag — no ranking logic changes.
   */
  playoffSize: number;
}

// ---------------------------------------------------------------------------
// Output types
// ---------------------------------------------------------------------------

/**
 * Standings row for a single player.
 */
export interface StandingsRow {
  playerId: string;
  /** Number of confirmed league matches played. */
  played: number;
  /**
   * Subset of `played` that was settled without being played — `resolution`
   * `WALKOVER` or `UNPLAYED_DRAW` (SPEC §4.6/§4.9, criterio 27). A purely
   * informational tally: it never feeds `points`, `vpFor`, `vpAgainst`,
   * `vpDiff` or the tiebreaker chain (criterio 28) — see AC-28 tests.
   */
  settled: number;
  /** Wins. */
  wins: number;
  /** Draws. */
  draws: number;
  /** Losses. */
  losses: number;
  /** Total league points (pointsWin/Draw/Loss + resolved bonus). */
  points: number;
  /** Total VP scored by this player across confirmed matches. */
  vpFor: number;
  /** Total VP conceded by this player across confirmed matches. */
  vpAgainst: number;
  /** vpFor - vpAgainst. */
  vpDiff: number;
  /** 1-based rank after tiebreakers. */
  rank: number;
  /** True if rank <= playoffSize. */
  inPlayoffZone: boolean;
}

// ---------------------------------------------------------------------------
// isConfirmedForStandings — re-exported guard
// ---------------------------------------------------------------------------

/**
 * A match counts for standings when:
 *  - result is not null  (a result has been recorded)
 *  - status is REPORTED (new flow, Hito 15) or CONFIRMED (legacy data compatibility)
 *  - phase === 'LEAGUE'  (standings are league-only in this function)
 *
 * Hito 15: matches count as soon as they have a Result (status REPORTED).
 * CONFIRMED is kept for backward compatibility with data created under the
 * old confirmation flow. DISPUTED/SCHEDULED do not count.
 *
 * SPEC §4.5 / §7.3.
 */
export function isConfirmedForStandings(match: StandingsMatch): boolean {
  return (
    (match.status === "REPORTED" || match.status === "CONFIRMED") &&
    match.result !== null &&
    match.phase === "LEAGUE"
  );
}

// ---------------------------------------------------------------------------
// computeStandings — main pure function
// ---------------------------------------------------------------------------

/**
 * Compute league standings from a list of matches and league config.
 *
 * Pure, deterministic, no DB access.
 *
 * Algorithm:
 *  1. Filter to CONFIRMED LEAGUE matches only.
 *  2. Accumulate per-player stats.
 *  3. Sort by the configurable tiebreaker chain (config.tiebreakers).
 *     HEAD_TO_HEAD is resolved lazily between groups of players tied on
 *     all preceding criteria.
 *  4. Assign ranks; mark playoff zone.
 *
 * @param matches   All league matches (caller passes all; we filter internally).
 * @param config    League configuration including points and tiebreaker order.
 * @param playerIds Explicit set of player ids to include.
 *                  If omitted, derived from the confirmed matches.
 *                  Pass this when a player with 0 matches should still appear.
 */
export function computeStandings(
  matches: StandingsMatch[],
  config: StandingsConfig,
  playerIds?: string[]
): StandingsRow[] {
  const tiebreakers = parseTiebreakers(config.tiebreakers);

  // 1. Collect confirmed league matches only.
  const confirmed = matches.filter(isConfirmedForStandings);

  // 2. Accumulate per-player stats.
  //    We build a map keyed by playerId.
  type MutableRow = Omit<StandingsRow, "rank" | "inPlayoffZone">;
  const statsMap = new Map<string, MutableRow>();

  function ensureRow(pid: string): MutableRow {
    if (!statsMap.has(pid)) {
      statsMap.set(pid, {
        playerId: pid,
        played: 0,
        settled: 0,
        wins: 0,
        draws: 0,
        losses: 0,
        points: 0,
        vpFor: 0,
        vpAgainst: 0,
        vpDiff: 0,
      });
    }
    return statsMap.get(pid)!;
  }

  // Seed explicit playerIds (so players with 0 matches appear).
  if (playerIds) {
    for (const pid of playerIds) {
      ensureRow(pid);
    }
  }

  for (const m of confirmed) {
    const r = m.result!; // guaranteed non-null by isConfirmedForStandings
    const homeId = m.playerHomeId;
    const awayId = m.playerAwayId;

    if (!awayId) continue; // should never happen in LEAGUE phase

    const home = ensureRow(homeId);
    const away = ensureRow(awayId);

    home.played += 1;
    away.played += 1;

    // Settled-without-play tally (criterio 27) — informational only, reads
    // `resolution` but never influences points/VP below (criterio 28: a
    // WALKOVER or UNPLAYED_DRAW Result is scored with EXACTLY the same
    // arithmetic as a PLAYED one, no branch here changes that).
    if ((r.resolution ?? "PLAYED") !== "PLAYED") {
      home.settled += 1;
      away.settled += 1;
    }

    home.vpFor += r.homeVictoryPoints;
    home.vpAgainst += r.awayVictoryPoints;
    away.vpFor += r.awayVictoryPoints;
    away.vpAgainst += r.homeVictoryPoints;

    if (r.outcome === "HOME_WIN") {
      home.wins += 1;
      away.losses += 1;
      home.points += config.pointsWin + r.bonusHome;
      away.points += config.pointsLoss + r.bonusAway;
    } else if (r.outcome === "AWAY_WIN") {
      away.wins += 1;
      home.losses += 1;
      away.points += config.pointsWin + r.bonusAway;
      home.points += config.pointsLoss + r.bonusHome;
    } else {
      // DRAW
      home.draws += 1;
      away.draws += 1;
      home.points += config.pointsDraw + r.bonusHome;
      away.points += config.pointsDraw + r.bonusAway;
    }
  }

  // Compute vpDiff for all rows.
  for (const row of statsMap.values()) {
    row.vpDiff = row.vpFor - row.vpAgainst;
  }

  // 3. Sort players using the configurable tiebreaker chain.
  const rows = Array.from(statsMap.values());

  rows.sort((a, b) => compareRows(a, b, tiebreakers, confirmed));

  // 4. Assign ranks and playoff zone flag.
  const result: StandingsRow[] = rows.map((row, idx) => ({
    ...row,
    rank: idx + 1,
    inPlayoffZone: idx + 1 <= config.playoffSize,
  }));

  return result;
}

// ---------------------------------------------------------------------------
// Comparison logic
// ---------------------------------------------------------------------------

/**
 * Compare two player rows using the ordered tiebreaker chain.
 * Returns negative if a should rank above b, positive if b above a, 0 if equal.
 *
 * HEAD_TO_HEAD is handled as a bilateral comparison between exactly these two
 * players using the full confirmed match list.
 */
function compareRows(
  a: Omit<StandingsRow, "rank" | "inPlayoffZone">,
  b: Omit<StandingsRow, "rank" | "inPlayoffZone">,
  tiebreakers: Tiebreaker[],
  confirmed: StandingsMatch[]
): number {
  for (const criterion of tiebreakers) {
    const delta = applyCriterion(criterion, a, b, confirmed);
    if (delta !== 0) return delta;
  }
  // After the full configured chain (which may include ID_ORDER), return 0.
  // In practice ID_ORDER should always be the last configured tiebreaker.
  return 0;
}

/**
 * Apply a single tiebreaker criterion between two rows.
 * Returns <0 if a should rank above b, >0 if b above a, 0 if tied on this criterion.
 */
function applyCriterion(
  criterion: Tiebreaker,
  a: Omit<StandingsRow, "rank" | "inPlayoffZone">,
  b: Omit<StandingsRow, "rank" | "inPlayoffZone">,
  confirmed: StandingsMatch[]
): number {
  switch (criterion) {
    case "POINTS":
      // Descending: higher is better.
      return b.points - a.points;

    case "VP_DIFF":
      // Descending.
      return b.vpDiff - a.vpDiff;

    case "VP_FOR":
      // Descending.
      return b.vpFor - a.vpFor;

    case "HEAD_TO_HEAD":
      return compareHeadToHead(a.playerId, b.playerId, confirmed);

    case "LOSSES":
      // Ascending: fewer losses is better.
      return a.losses - b.losses;

    case "ID_ORDER":
      // Deterministic final tiebreaker: lexicographic by playerId (ascending).
      // Ensures a stable and reproducible ordering regardless of input order.
      return a.playerId < b.playerId ? -1 : a.playerId > b.playerId ? 1 : 0;
  }
}

/**
 * Head-to-head comparison between two players.
 *
 * Looks for confirmed LEAGUE matches where both players faced each other.
 * Computes a mini-standing (points, then VP diff, then VP for) for just those
 * two players from those matches.
 *
 * Returns <0 if a ranks above b in h2h, >0 if b above a, 0 if tied.
 *
 * SPEC §7.3 criterion 4: "resultado del enfrentamiento directo entre los empatados".
 * This bilateral version correctly handles the general case where `computeStandings`
 * is called with the full player list and Array.sort's pairwise comparisons.
 */
function compareHeadToHead(
  aId: string,
  bId: string,
  confirmed: StandingsMatch[]
): number {
  // Find all confirmed matches between these two players.
  const h2hMatches = confirmed.filter(
    (m) =>
      (m.playerHomeId === aId && m.playerAwayId === bId) ||
      (m.playerHomeId === bId && m.playerAwayId === aId)
  );

  if (h2hMatches.length === 0) return 0;

  // Compute mini-standings for these two players from h2h matches only.
  // We intentionally re-use a simplified accumulation rather than calling
  // computeStandings recursively (avoids infinite recursion risk, keeps it pure).
  let aPoints = 0,
    aVpFor = 0,
    aVpAgainst = 0;
  let bPoints = 0,
    bVpFor = 0,
    bVpAgainst = 0;

  // Use fixed point values (3/1/0) for h2h: the config points are irrelevant
  // for ordering; only the relative standing matters. But to be faithful to
  // SPEC and config, we pass pointsWin/Draw/Loss through the closure approach.
  // Since we don't have config here, we compute only win/draw/loss outcomes
  // and produce comparable totals. For purity we use outcome-based counts
  // and then compare on a synthetic comparable score.
  // Note: bonus is NOT applied in h2h mini-standing, per common sports rules.
  for (const m of h2hMatches) {
    const r = m.result!;
    const isAHome = m.playerHomeId === aId;

    if (r.outcome === "HOME_WIN") {
      if (isAHome) {
        aPoints += 3;
        bPoints += 0;
      } else {
        bPoints += 3;
        aPoints += 0;
      }
    } else if (r.outcome === "AWAY_WIN") {
      if (isAHome) {
        aPoints += 0;
        bPoints += 3;
      } else {
        aPoints += 3;
        bPoints += 0;
      }
    } else {
      // DRAW
      aPoints += 1;
      bPoints += 1;
    }

    if (isAHome) {
      aVpFor += r.homeVictoryPoints;
      aVpAgainst += r.awayVictoryPoints;
      bVpFor += r.awayVictoryPoints;
      bVpAgainst += r.homeVictoryPoints;
    } else {
      aVpFor += r.awayVictoryPoints;
      aVpAgainst += r.homeVictoryPoints;
      bVpFor += r.homeVictoryPoints;
      bVpAgainst += r.awayVictoryPoints;
    }
  }

  // Compare: first h2h points, then h2h VP diff, then h2h VP for.
  if (bPoints !== aPoints) return bPoints - aPoints; // descending
  const aDiff = aVpFor - aVpAgainst;
  const bDiff = bVpFor - bVpAgainst;
  if (bDiff !== aDiff) return bDiff - aDiff; // descending
  return bVpFor - aVpFor; // descending
}

// ---------------------------------------------------------------------------
// formatPlayedCount — SPEC §4.6, criterio 27 (cálculo, no presentación)
// ---------------------------------------------------------------------------

/**
 * Spanish text for the "PJ" (partidas jugadas) column of `/clasificacion`,
 * surfacing settled-without-play matches inline: `formatPlayedCount(11, 2)`
 * → `"11 (2 saldadas)"` (SPEC §4.6: "PJ 11 (2 saldadas)"). Zero settled
 * matches renders as a bare number — no "(0 saldadas)", no empty
 * parenthetical.
 *
 * Pure presentation-adjacent helper, kept in `src/server/` so it's
 * testable in Vitest instead of only eyeballed on the page (SPEC §7.3),
 * same pattern as `quotaLabel` (rounds.ts, Hito 2) and
 * `resolveMatchStatusLabel` (round-ui.ts, Hito 6).
 */
export function formatPlayedCount(played: number, settled: number): string {
  if (settled <= 0) return String(played);
  const word = settled === 1 ? "saldada" : "saldadas";
  return `${played} (${settled} ${word})`;
}
