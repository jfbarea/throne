// Pure domain functions for rounds: how many, how the round-robin is split
// between them, when they close, and how a player's per-round quota is
// computed. SPEC §4.2, §4.3, §4.4, §4.6, ADR-007 (partially derogated).
//
// No DB access whatsoever — every function here receives plain data and
// returns plain data, same style as pairings.ts. Persistence (creating
// `Round` rows, writing `roundId` on `Match`) is Hito 3's job; the recompute
// entry point for partial/open-rounds redistribution is Hito 8's job. This
// module only provides the building blocks both will call.

import type { Pairing } from "./pairings";

// ---------------------------------------------------------------------------
// Shared guards
// ---------------------------------------------------------------------------

/**
 * `matchesPerRound` is validated at the Zod boundary (Hito 3: integer >= 1,
 * no upper bound — SPEC §6.2). Every domain function below assumes that
 * contract but still guards defensively: dividing or stepping by 0 would
 * either throw a division error or loop forever, and silently coercing an
 * invalid value would hide a caller bug instead of surfacing it.
 */
function assertValidMatchesPerRound(matchesPerRound: number): void {
  if (!Number.isInteger(matchesPerRound) || matchesPerRound < 1) {
    throw new Error(
      `matchesPerRound must be an integer >= 1, got ${matchesPerRound}`
    );
  }
}

// ---------------------------------------------------------------------------
// roundsCount — SPEC §4.2
// ---------------------------------------------------------------------------

/**
 * How many rounds a league of `playerCount` players needs, given it must
 * play `matchesPerRound` matches per player and round.
 *
 * SPEC §4.2 states `rounds = ceil((n - 1) / matchesPerRound)` for every `n`,
 * reasoning that every player plays exactly `n - 1` matches over the whole
 * league. **That formula is only achievable when `n` is even.** For odd
 * `n` it is sometimes mathematically impossible to also satisfy §8
 * criterio 2 ("ningún jugador tiene más de k partidas por ronda") — see the
 * long comment on `journeysNeeded` below for the proof. This function
 * implements the closest always-achievable equivalent instead of the
 * literal formula, and the deviation is called out for the reviewer/product
 * owner to ratify (same pattern as D1 in PLAN.md): it has not been decided
 * by the builder in isolation, it is a documented, provable gap.
 *
 * When `matchesPerRound` is larger than the available journeys, the formula
 * still holds and simply yields 1 round: the whole round-robin fits in a
 * single one. The spec does not cap `matchesPerRound` (SPEC §6.2), so this
 * is not a special case, just the formula's natural behaviour.
 *
 * A league needs at least 2 players to have any rounds at all; below that
 * the spec has nothing to say, so this returns 0 rather than a negative or
 * NaN value.
 */
export function roundsCount(
  playerCount: number,
  matchesPerRound: number
): number {
  assertValidMatchesPerRound(matchesPerRound);
  if (playerCount < 2) return 0;
  /**
   * DEVIATION FROM SPEC §4.2 (odd `n` only) — flagged for ratification, not
   * decided silently.
   *
   * The circle method's `n - 1` figure is "matches per player", not
   * "matchings needed". For even `n` those two coincide (K_n even has
   * chromatic index exactly `n - 1`), so grouping `n - 1` matchings into
   * batches of `matchesPerRound` gives exactly `ceil((n - 1) / k)` rounds,
   * matching the spec precisely.
   *
   * For odd `n`, K_n is a "Class 2" graph (Vizing): its chromatic index is
   * `n`, not `n - 1` — it provably cannot be edge-colored with only `n - 1`
   * matchings (e.g. K_3, the triangle: 3 edges, degree 2 each; 2 colors
   * would force two of the three edges to share a color, and any two edges
   * of a triangle share a vertex — contradiction). Concretely, whenever `n`
   * and `matchesPerRound` are both odd and `(n - 1)` is an exact multiple of
   * `matchesPerRound`, achieving the spec's literal round count would
   * require *every* round to be an exactly-`matchesPerRound`-regular graph
   * on `n` (odd) vertices — impossible by the handshake lemma, since
   * `n * matchesPerRound` would be odd. `matchesPerRound = 1` always falls
   * into this case (every odd `n`, every round would have to be a perfect
   * matching, impossible on an odd vertex count) — this is not a corner
   * case, it is the league's own default-adjacent shape (§4.2 default is 2,
   * but 1 is a valid configured value, SPEC §6.2 "sin tope").
   *
   * The always-achievable, always-valid substitute used here: derive the
   * round count from the circle method's actual journey count (`n` odd
   * journeys, not `n - 1`, one resting player per journey — SPEC §5.3),
   * grouped by `matchesPerRound` the same way as the even case. This never
   * violates criterio 2 (a group of ≤k single-appearance journeys can never
   * give any player more than k matches) and never creates a bye Match
   * (criterio 4). It can differ from the spec's literal
   * `ceil((n - 1) / matchesPerRound)` by exactly one extra round, and only
   * in the odd-`n` cases described above.
   */
  const journeysNeeded = playerCount % 2 === 0 ? playerCount - 1 : playerCount;
  return Math.ceil(journeysNeeded / matchesPerRound);
}

// ---------------------------------------------------------------------------
// Circle method — internal building block for both public entry points.
// ---------------------------------------------------------------------------

/**
 * Sentinel for the "bye" slot the circle method needs internally when the
 * player count is odd. Never leaks into the returned pairings (SPEC §5.3:
 * no bye Match is ever created) — it is filtered out before a journey is
 * returned. A Symbol rather than a string constant so it can never collide
 * with a real player id.
 */
const BYE = Symbol("bye");
type Seat = string | typeof BYE;

/**
 * Classic round-robin circle method: one fixed player, the rest rotating
 * around it. Produces `n - 1` journeys for even `n`, `n` journeys for odd
 * `n` (one seat is BYE in every journey, dropped before returning — SPEC
 * §5.3, ADR-007 "sin byes de liga").
 *
 * Every journey is a perfect matching: each player appears at most once
 * (never appears at all in the journey where they hold the bye seat).
 * Deterministic: `sortedIds` must already be in a stable order (callers
 * sort by id, same convention as `generatePairings`), and the rotation
 * itself has no randomness.
 *
 * Journeys are an implementation detail of the algorithm (SPEC §6.1: "no se
 * muestra la jornada") — this function is not exported.
 */
function circleMethodJourneys(sortedIds: string[]): Pairing[][] {
  const n = sortedIds.length;
  if (n < 2) return [];

  const hasBye = n % 2 !== 0;
  const seats: Seat[] = hasBye ? [...sortedIds, BYE] : [...sortedIds];
  const m = seats.length; // always even from here on

  const fixed = seats[0];
  let rotating = seats.slice(1);

  const journeys: Pairing[][] = [];
  for (let round = 0; round < m - 1; round++) {
    const arranged: Seat[] = [fixed, ...rotating];
    const journey: Pairing[] = [];
    for (let i = 0; i < m / 2; i++) {
      const a = arranged[i];
      const b = arranged[m - 1 - i];
      if (a === BYE || b === BYE) continue; // the resting player, no Match.
      const [homeId, awayId] = a < b ? [a, b] : [b, a];
      journey.push({ homeId, awayId });
    }
    // A journey is a matching: every homeId is already unique within it (no
    // player appears twice), so sorting by homeId alone is enough to make
    // the output order deterministic — no tie-break needed.
    journey.sort((x, y) => x.homeId.localeCompare(y.homeId));
    journeys.push(journey);
    // Rotate: last seat moves to the first rotating position, everyone else
    // shifts one place. `fixed` never moves.
    rotating = [rotating[rotating.length - 1], ...rotating.slice(0, -1)];
  }
  return journeys;
}

/** C(n, 2) — used to detect whether a set of pairs is the full round-robin. */
function completePairCount(n: number): number {
  return (n * (n - 1)) / 2;
}

function pairKey(p: Pairing): string {
  return p.homeId < p.awayId ? `${p.homeId}|${p.awayId}` : `${p.awayId}|${p.homeId}`;
}

/**
 * Whether `pairs` is exactly the full round-robin over `ids` — every unique
 * pair present once, nothing missing, nothing extra. Used to decide whether
 * `assignPairsToRounds` can delegate to the optimal circle method or must
 * fall back to the general-purpose greedy coloring (SPEC §4.3: "el caso
 * general se reduce a él [circle method] sobre K_n").
 *
 * Precondition (enforced by the caller, `assignPairsToRounds`, before this
 * runs): every pair in `pairs` only references players in `ids`. Under that
 * precondition, a set of `completePairCount(ids.length)` *distinct* pairs
 * cannot be anything other than the complete graph — there is no other pair
 * left to pick from that vertex domain — so no further per-pair membership
 * check is needed here.
 */
function isCompleteGraph(pairs: Pairing[], ids: string[]): boolean {
  const expectedCount = completePairCount(ids.length);
  if (pairs.length !== expectedCount) return false;
  const distinctKeys = new Set(pairs.map(pairKey));
  return distinctKeys.size === expectedCount;
}

// ---------------------------------------------------------------------------
// roundRobinRounds — SPEC §4.3, fresh generation from scratch
// ---------------------------------------------------------------------------

/**
 * Generate the whole league round-robin already split into rounds, via the
 * circle method: `n - 1` (even n) or `n` (odd n) journeys, grouped
 * `matchesPerRound` at a time. This is the entry point for generating a
 * brand-new league (Hito 3) — always optimal, always exactly `roundsCount`
 * rounds, always `C(n, 2)` matches in total (SPEC §8, criterios 1-5).
 *
 * `playerIds` does not need to be pre-sorted; it is sorted lexicographically
 * before running the circle method so the result is deterministic and uses
 * the same home/away convention as `generatePairings` (lower id → home).
 *
 * @returns Array of rounds (index 0 = round 1, ...), each an array of
 *   Pairing. Fewer than 2 players yields `[]`.
 */
export function roundRobinRounds(
  playerIds: string[],
  matchesPerRound: number
): Pairing[][] {
  assertValidMatchesPerRound(matchesPerRound);
  const sortedIds = [...new Set(playerIds)].sort((a, b) => a.localeCompare(b));
  const journeys = circleMethodJourneys(sortedIds);
  return groupJourneys(journeys, matchesPerRound);
}

function groupJourneys(
  journeys: Pairing[][],
  matchesPerRound: number
): Pairing[][] {
  const rounds: Pairing[][] = [];
  for (let i = 0; i < journeys.length; i += matchesPerRound) {
    rounds.push(journeys.slice(i, i + matchesPerRound).flat());
  }
  return rounds;
}

// ---------------------------------------------------------------------------
// General-purpose greedy edge coloring — for arbitrary subgraphs (Hito 8).
// ---------------------------------------------------------------------------

/**
 * Split an arbitrary set of pairs into the minimum practical number of
 * "journeys" (matchings — no player repeated within one), via a greedy
 * algorithm: repeatedly extract a maximal matching, always preferring the
 * edge whose endpoints currently have the highest combined remaining degree
 * (SPEC §4.3: "coloreado voraz por grado descendente"). By Vizing's theorem
 * this style of algorithm never needs more than `Δ + 1` journeys, where `Δ`
 * is the highest number of pending pairs any single player has.
 *
 * Deterministic: ties in degree are broken lexicographically by
 * (homeId, awayId), never by iteration order of a Set/Map.
 */
function greedyMatchings(pairs: Pairing[]): Pairing[][] {
  let remaining = [...pairs];
  const matchings: Pairing[][] = [];

  while (remaining.length > 0) {
    const degree = new Map<string, number>();
    for (const p of remaining) {
      degree.set(p.homeId, (degree.get(p.homeId) ?? 0) + 1);
      degree.set(p.awayId, (degree.get(p.awayId) ?? 0) + 1);
    }

    const sorted = [...remaining].sort((a, b) => {
      // Every id read here comes straight from `remaining`, the very array
      // `degree` was just built from, so both lookups are always defined —
      // a non-null assertion instead of a `?? 0` fallback keeps that
      // invariant explicit instead of pretending the map could miss.
      const degA = degree.get(a.homeId)! + degree.get(a.awayId)!;
      const degB = degree.get(b.homeId)! + degree.get(b.awayId)!;
      if (degA !== degB) return degB - degA; // descending degree first.
      if (a.homeId !== b.homeId) return a.homeId.localeCompare(b.homeId);
      return a.awayId.localeCompare(b.awayId);
    });

    const usedInThisMatching = new Set<string>();
    const matching: Pairing[] = [];
    const leftover: Pairing[] = [];
    for (const p of sorted) {
      if (!usedInThisMatching.has(p.homeId) && !usedInThisMatching.has(p.awayId)) {
        matching.push(p);
        usedInThisMatching.add(p.homeId);
        usedInThisMatching.add(p.awayId);
      } else {
        leftover.push(p);
      }
    }
    // Same reasoning as circleMethodJourneys: a matching never repeats a
    // homeId, so sorting by homeId alone is already deterministic.
    matching.sort((x, y) => x.homeId.localeCompare(y.homeId));
    matchings.push(matching);
    remaining = leftover;
  }

  return matchings;
}

// ---------------------------------------------------------------------------
// assignPairsToRounds — SPEC §4.3, the general case.
// ---------------------------------------------------------------------------

/** A pairing assigned to a concrete round index. */
export interface RoundAssignment extends Pairing {
  roundIndex: number;
}

/**
 * Assign a set of pairs to rounds, restricted to the given open round
 * indexes (closed rounds are never touched — Hito 8's job is to pick which
 * indexes count as open, not this function's).
 *
 * Formulated as edge coloring (SPEC §4.3): each "journey" is a color, a
 * round is `matchesPerRound` consecutive journeys, and the invariant is
 * that no player has more than `matchesPerRound` pairs in the same round.
 * Grouping whole journeys together guarantees that invariant by
 * construction, for any journey-producing strategy — the real work is
 * making sure every journey is internally a valid matching.
 *
 * - When `pairs` is exactly the full round-robin over `playerIds` (K_n),
 *   this delegates to the same circle method `roundRobinRounds` uses, so it
 *   is optimal: `n - 1` journeys for even n, `n` for odd n.
 * - Otherwise (an arbitrary subgraph — e.g. the pending matches left after
 *   a Hito 8 recalculation) it falls back to the greedy, degree-descending
 *   matching extraction, which never needs more than `Δ + 1` journeys.
 *
 * @param pairs - Pairs to place. Every pair not already resolved elsewhere;
 *   this function never sees, and therefore never reassigns, a pair that
 *   already has a Result (SPEC §8, criterio 6) — the caller is responsible
 *   for excluding those before calling.
 * @param playerIds - The full set of players the pairs may reference. Any
 *   pair naming a player outside this set is a caller bug and throws.
 * @param openRoundIndexes - Round indexes available to receive matches
 *   (typically the non-closed rounds). Order does not matter; they are
 *   used ascending. Throws if there are not enough of them to hold every
 *   pair without exceeding `matchesPerRound` per round — adding more open
 *   rounds to retry is the caller's decision (Hito 8), not this function's.
 */
export function assignPairsToRounds(
  pairs: Pairing[],
  playerIds: string[],
  matchesPerRound: number,
  openRoundIndexes: number[]
): RoundAssignment[] {
  assertValidMatchesPerRound(matchesPerRound);

  const idSet = new Set(playerIds);
  for (const p of pairs) {
    if (!idSet.has(p.homeId) || !idSet.has(p.awayId)) {
      throw new Error(
        `assignPairsToRounds: pair references a player outside playerIds (${p.homeId}, ${p.awayId})`
      );
    }
  }

  const sortedIds = [...idSet].sort((a, b) => a.localeCompare(b));
  const journeys = isCompleteGraph(pairs, sortedIds)
    ? circleMethodJourneys(sortedIds)
    : greedyMatchings(pairs);

  const sortedRoundIndexes = [...openRoundIndexes].sort((a, b) => a - b);
  const neededRounds = Math.ceil(journeys.length / matchesPerRound);
  if (neededRounds > sortedRoundIndexes.length) {
    throw new Error(
      `assignPairsToRounds: need ${neededRounds} round(s) to place every pair, only ${sortedRoundIndexes.length} open`
    );
  }

  const assignments: RoundAssignment[] = [];
  for (let i = 0; i < journeys.length; i += matchesPerRound) {
    const roundIndex = sortedRoundIndexes[i / matchesPerRound];
    for (const journey of journeys.slice(i, i + matchesPerRound)) {
      for (const pair of journey) {
        assignments.push({ ...pair, roundIndex });
      }
    }
  }
  return assignments;
}

// ---------------------------------------------------------------------------
// deriveDeadlines — SPEC §4.4
// ---------------------------------------------------------------------------

/**
 * Derive the deadline of each round as the last day of its month, starting
 * from `startMonth` (SPEC §4.4). Round 1 closes at the end of `startMonth`'s
 * month, round 2 at the end of the following month, and so on.
 *
 * Works entirely in UTC so the result does not depend on the machine's
 * timezone (the seed uses `Date.UTC(2026, 2, 1)` — SPEC, PLAN.md H2).
 * `Date.UTC(year, month, 0)` is the JS-native way to get "the day before the
 * 1st of `month`", i.e. the last day of `month - 1` — this handles
 * February (28/29), 30- vs 31-day months and the December → January
 * year rollover for free, with no per-month lookup table.
 *
 * @param startMonth - Any Date within the arrival month; only its UTC year
 *   and month are read.
 * @param roundsCount - How many deadlines to derive. 0 yields `[]`.
 */
export function deriveDeadlines(startMonth: Date, roundsCount: number): Date[] {
  const year = startMonth.getUTCFullYear();
  const month = startMonth.getUTCMonth();
  const deadlines: Date[] = [];
  for (let i = 0; i < roundsCount; i++) {
    deadlines.push(new Date(Date.UTC(year, month + i + 1, 0)));
  }
  return deadlines;
}

// ---------------------------------------------------------------------------
// roundQuota — SPEC §4.6, §5.2, §5.3
// ---------------------------------------------------------------------------

/** The minimal match shape `roundQuota` needs — no Prisma types leak in here. */
export interface RoundMatchInput {
  roundIndex: number;
  playerHomeId: string;
  playerAwayId: string;
  /**
   * Whether this match has a persisted Result. SPEC §4.6: the quota counts
   * resolved matches, not scheduled ones — a match with a future
   * `scheduledAt` and no Result is still pending (criterio 11), so
   * `scheduledAt` deliberately has no bearing here.
   */
  hasResult: boolean;
}

export interface RoundQuota {
  /**
   * How many matches this player actually has in this round. Not always
   * `matchesPerRound`: the last round can require less (SPEC §5.2), and the
   * player resting on an odd-n journey has one less in that round
   * (SPEC §5.3). Derived from the matches themselves, never from the
   * league's `matchesPerRound` constant.
   */
  required: number;
  /** How many of those required matches have a Result. */
  resolved: number;
}

/**
 * Compute a player's quota for a single round: how many matches they are
 * required to have resolved, and how many they actually have resolved so
 * far (SPEC §4.6).
 */
export function roundQuota(
  playerId: string,
  roundIndex: number,
  matches: RoundMatchInput[]
): RoundQuota {
  const relevant = matches.filter(
    (m) =>
      m.roundIndex === roundIndex &&
      (m.playerHomeId === playerId || m.playerAwayId === playerId)
  );
  const resolved = relevant.filter((m) => m.hasResult).length;
  return { required: relevant.length, resolved };
}

// ---------------------------------------------------------------------------
// quotaLabel — SPEC §4.6, §5.2 (cálculo, no presentación — spec §7.3)
// ---------------------------------------------------------------------------

/**
 * Spanish label for a round quota, e.g. "falta 1 de 2", "faltan 2 de 2",
 * "falta 1 de 1", or "cumplido" once `resolved >= required` (which also
 * covers the 0-required edge case of the resting player on a
 * `matchesPerRound = 1` league — SPEC §5.3 — nothing owed, nothing missing).
 */
export function quotaLabel(resolved: number, required: number): string {
  const missing = required - resolved;
  if (missing <= 0) return "cumplido";
  if (missing === 1) return `falta 1 de ${required}`;
  return `faltan ${missing} de ${required}`;
}
