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
 * SPEC §4.2 states `rounds = ceil((n - 1) / matchesPerRound)`, reasoning
 * that every player plays exactly `n - 1` matches over the whole league.
 * That per-player lower bound is always necessary, but it is only
 * **sufficient** — i.e. actually achievable together with §8 criterio 2
 * ("ningún jugador tiene más de k partidas por ronda") — when `n` is even,
 * or when `n` is odd and `matchesPerRound` is even. It is sometimes
 * unreachable when both `n` and `matchesPerRound` are odd: see the long
 * comment below for the proof. This function returns the true minimum in
 * every case — the spec's own formula whenever it is achievable, one round
 * more only in the narrow, proven-infeasible corner.
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

  const n = playerCount;
  const k = matchesPerRound;

  /**
   * `perPlayerBound` is SPEC §4.2's own formula: a necessary lower bound
   * for any `n`, `k` (each player has `n - 1` matches to fit at `k` per
   * round). It is even the exact right answer whenever it is achievable:
   *
   * - `n` even: K_n's chromatic index is exactly `n - 1` (a clean
   *   1-factorization into perfect matchings), so grouping those `n - 1`
   *   matchings `k` at a time hits `ceil((n - 1) / k)` exactly.
   * - `n` odd, `k` even: K_n decomposes into `(n - 1) / 2` Hamiltonian
   *   cycles (Walecki decomposition — see `waleckiFactors`), each a
   *   2-regular graph. Grouping `k / 2` of those cycles per round gives a
   *   round where *every* player has exactly `k` matches (no exceptions,
   *   no resting player), and `ceil(((n - 1) / 2) / (k / 2))` is the same
   *   number as `ceil((n - 1) / k)` (scaling numerator and denominator by
   *   the same factor never changes a ratio's ceiling).
   *
   * Only when `n` **and** `k` are both odd can `perPlayerBound` be
   * unreachable: achieving it would require every one of those rounds to
   * be an exactly-`k`-regular graph on `n` (odd) vertices, which needs
   * `n * k` to be even (handshake lemma: sum of degrees is always even).
   * `n * k` is odd whenever both factors are odd, so on the rounds where
   * the per-player budget leaves no slack, no valid `k`-regular round
   * exists at all — this is a hard graph-theoretic fact about K_n, not a
   * limitation of any one algorithm (concrete minimal witness: K_3, the
   * triangle — 3 edges, degree 2 each; 2 "rounds" of `k = 1` would need 2
   * proper-matching colors, but any 2 of the triangle's 3 edges share a
   * vertex, so 2 colors is not enough; it provably needs 3).
   *
   * `capacityBound` is the general, construction-independent lower bound
   * that also catches this: a round can never hold more than
   * `floor(n * k / 2)` matches (each of the `n` players contributes at
   * most `k` match-slots, and every match consumes 2 slots), so covering
   * all `C(n, 2)` matches needs at least
   * `ceil(C(n, 2) / floor(n * k / 2))` rounds. This coincides with
   * `perPlayerBound` in every achievable case (verified computationally
   * for n up to 41, every k up to 15 — see the builder's report) and is
   * strictly larger exactly in the odd-`n`-odd-`k` corner above, where the
   * exact bye-rotation construction (`oddCompleteGraphJourneys`) is what
   * actually achieves it (grouping its `n` single-match journeys `k` at a
   * time, `ceil(n / k)`, which numerically equals this bound in that
   * corner).
   *
   * Taking the max of the two therefore returns the spec's own number
   * whenever it is reachable, and the true, still-minimal, one-round-more
   * figure only where it is provably not — never invented, never silently
   * short of what criterio 2 demands.
   */
  const perPlayerBound = Math.ceil((n - 1) / k);
  const capacityBound = Math.ceil(completePairCount(n) / Math.floor((n * k) / 2));
  return Math.max(perPlayerBound, capacityBound);
}

// ---------------------------------------------------------------------------
// Circle method — internal building block for both public entry points.
// ---------------------------------------------------------------------------

/**
 * Classic round-robin circle method for **even** `n`: one fixed player, the
 * rest rotating around it, `n - 1` journeys, each a perfect matching (every
 * player appears exactly once per journey — SPEC §4.3). Only ever called
 * with even `n` — odd `n` uses `waleckiFactors` (even `matchesPerRound`) or
 * `oddCompleteGraphJourneys` (odd `matchesPerRound`) instead, see
 * `decomposeCompleteGraph`, so there is no bye/resting-player case to handle
 * here at all.
 *
 * Deterministic: `sortedIds` must already be in a stable order (callers
 * sort by id, same convention as `generatePairings`), and the rotation
 * itself has no randomness.
 *
 * Journeys are an implementation detail of the algorithm (SPEC §6.1: "no se
 * muestra la jornada") — this function is not exported.
 */
function circleMethodJourneys(sortedIds: string[]): Pairing[][] {
  const m = sortedIds.length; // always even, guaranteed by the only caller.
  const fixed = sortedIds[0];
  let rotating = sortedIds.slice(1);

  const journeys: Pairing[][] = [];
  for (let round = 0; round < m - 1; round++) {
    const arranged: string[] = [fixed, ...rotating];
    const journey: Pairing[] = [];
    for (let i = 0; i < m / 2; i++) {
      const a = arranged[i];
      const b = arranged[m - 1 - i];
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

/**
 * Bye-rotation circle method for **odd** `n`: same fixed-point-and-rotation
 * idea as `circleMethodJourneys`, but with an extra sentinel "bye" seat so
 * `n + 1` (even) positions rotate through `n` journeys. Whoever lands on the
 * bye seat in a given journey simply has no match that journey — no bye
 * `Match` is ever created (SPEC §5.3, ADR-007 "sin byes de liga").
 *
 * This is the exact construction for the one case with no K_n-wide
 * 2-factorization available: `n` odd, `matchesPerRound` odd (see
 * `roundsCount`'s proof). It sidesteps `misraGriesColoring` entirely for
 * this case, on purpose: it always produces exactly `n` journeys,
 * deterministically, matching `roundsCount`'s `ceil(n / matchesPerRound)`
 * for this case exactly, with no need to even invoke the general algorithm.
 *
 * `misraGriesColoring` stays reserved for what it is actually needed for:
 * genuine, irregular subgraphs (Hito 8's pending-matches recalculation),
 * never the full K_n.
 */
function oddCompleteGraphJourneys(sortedIds: string[]): Pairing[][] {
  const BYE = Symbol("bye");
  type Seat = string | typeof BYE;

  const seats: Seat[] = [...sortedIds, BYE];
  const m = seats.length; // n + 1, even.
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
    journey.sort((x, y) => x.homeId.localeCompare(y.homeId));
    journeys.push(journey);
    rotating = [rotating[rotating.length - 1], ...rotating.slice(0, -1)];
  }
  return journeys; // exactly n journeys (m - 1 = n).
}

/**
 * Walecki decomposition: splits K_n (odd `n`) into `(n - 1) / 2` edge-disjoint
 * Hamiltonian cycles, each a 2-regular spanning subgraph (every player
 * appears exactly twice). Together they cover every one of the `C(n, 2)`
 * matches exactly once — no bye, no rest, no exceptions (unlike
 * `circleMethodJourneys`, which is 1-regular per journey and needs one
 * resting player per journey when `n` is odd).
 *
 * This is what lets odd `n` with even `matchesPerRound` hit the spec's exact
 * `ceil((n - 1) / k)` round count (see `roundsCount`): grouping `k / 2` of
 * these cycles per round gives every player precisely `k` matches, in every
 * round including the last one that divides evenly.
 *
 * Construction (fixed point + zigzag, a standard 1-factorization-adjacent
 * technique for odd complete graphs): arrange `n - 1` of the players on a
 * circle (indices `0..n-2`), keep the last player fixed as `∞`. For each
 * `s` in `0..(n-3)/2`, cycle `s` visits `∞`, then walks the circle
 * zigzagging outward from position `s`: `s, s+1, s-1, s+2, s-2, ...`
 * (indices mod `n - 1`), back to `∞`. Every cycle is Hamiltonian and the
 * `(n - 1) / 2` cycles partition all of K_n's edges (verified
 * computationally for n = 3..19 — see the builder's report).
 */
function waleckiFactors(sortedIds: string[]): Pairing[][] {
  const n = sortedIds.length;
  const inf = sortedIds[n - 1];
  const circle = sortedIds.slice(0, n - 1);
  const m = circle.length; // even

  const factors: Pairing[][] = [];
  for (let s = 0; s < m / 2; s++) {
    // Zigzag offsets from s: 0, +1, -1, +2, -2, ..., +(m/2 - 1), -(m/2 - 1),
    // then the single "opposite" point m/2 (since +m/2 and -m/2 are the same
    // residue mod m, an even m has exactly one of it, visited once).
    const offsets = [0];
    for (let j = 1; j < m / 2; j++) {
      offsets.push(j, -j);
    }
    offsets.push(m / 2);

    const circleOrder = offsets.map((o) => circle[(((s + o) % m) + m) % m]);
    const cycleVertices = [inf, ...circleOrder];

    const factor: Pairing[] = [];
    for (let i = 0; i < cycleVertices.length; i++) {
      const a = cycleVertices[i];
      const b = cycleVertices[(i + 1) % cycleVertices.length];
      const [homeId, awayId] = a < b ? [a, b] : [b, a];
      factor.push({ homeId, awayId });
    }
    // Unlike a matching, a 2-regular factor can legitimately repeat a
    // homeId (the same player can be the lexicographically-smaller side of
    // both of their two matches in this factor), so the tie-break on
    // awayId is not dead code here — keep it.
    factor.sort(
      (x, y) => x.homeId.localeCompare(y.homeId) || x.awayId.localeCompare(y.awayId)
    );
    factors.push(factor);
  }
  return factors;
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
 * `assignPairsToRounds` can delegate to an exact `K_n` construction or must
 * fall back to the general-purpose Misra & Gries coloring (SPEC §4.3: "el
 * caso general se reduce a él [circle method] sobre K_n").
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
 * A K_n edge-coloring split into equal-degree "factors" (color classes),
 * plus how many of them make up one round. `unitDegree` is how many matches
 * each factor contributes per player it touches: 1 for a matching (circle
 * method, bye rotation), 2 for a Walecki Hamiltonian cycle. A round is
 * always `matchesPerRound / unitDegree` factors, chosen so every full round
 * gives exactly `matchesPerRound` matches per player.
 */
interface FactorDecomposition {
  factors: Pairing[][];
  unitDegree: 1 | 2;
}

/**
 * Pick the right exact construction for a *complete* graph over `sortedIds`,
 * for the given `matchesPerRound` (SPEC §4.3, and the proof on `roundsCount`
 * for why the odd-`n` case branches on the parity of `matchesPerRound`):
 *
 * - `n` even → circle method: `n - 1` matchings (SPEC §5.3 doesn't apply).
 * - `n` odd, `matchesPerRound` even → Walecki: `(n - 1) / 2` Hamiltonian
 *   cycles, grouped `matchesPerRound / 2` at a time. Every round gives every
 *   player exactly `matchesPerRound` matches; nobody ever rests.
 * - `n` odd, `matchesPerRound` odd → no `matchesPerRound`-regular
 *   construction is guaranteed to exist (see `roundsCount`'s proof), so the
 *   round count itself is one more than the per-player bound in the
 *   narrowest cases. `oddCompleteGraphJourneys` still constructs it exactly
 *   (not via `misraGriesColoring` — see that function's own doc for why a
 *   general-purpose algorithm is unnecessary, and would need care, on a
 *   fully symmetric graph like K_n).
 */
function decomposeCompleteGraph(
  sortedIds: string[],
  matchesPerRound: number
): FactorDecomposition {
  const n = sortedIds.length;
  if (n % 2 === 0) {
    return { factors: circleMethodJourneys(sortedIds), unitDegree: 1 };
  }
  if (matchesPerRound % 2 === 0) {
    return { factors: waleckiFactors(sortedIds), unitDegree: 2 };
  }
  return { factors: oddCompleteGraphJourneys(sortedIds), unitDegree: 1 };
}

/** Group `factors` into rounds of `matchesPerRound / unitDegree` at a time. */
function groupFactorsIntoRounds(
  { factors, unitDegree }: FactorDecomposition,
  matchesPerRound: number
): Pairing[][] {
  const groupSize = matchesPerRound / unitDegree;
  const rounds: Pairing[][] = [];
  for (let i = 0; i < factors.length; i += groupSize) {
    rounds.push(factors.slice(i, i + groupSize).flat());
  }
  return rounds;
}

/**
 * Generate the whole league round-robin already split into rounds (SPEC
 * §4.3). This is the entry point for generating a brand-new league (Hito 3)
 * — always exactly `roundsCount` rounds, always `C(n, 2)` matches in total,
 * and never more than `matchesPerRound` matches per player per round
 * (SPEC §8, criterios 1-5). See `decomposeCompleteGraph` for which exact
 * construction is used depending on the parity of `n` and `matchesPerRound`.
 *
 * `playerIds` does not need to be pre-sorted; it is sorted lexicographically
 * before running the construction so the result is deterministic and uses
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
  if (sortedIds.length < 2) return [];
  return groupFactorsIntoRounds(
    decomposeCompleteGraph(sortedIds, matchesPerRound),
    matchesPerRound
  );
}

// ---------------------------------------------------------------------------
// Misra & Gries edge coloring — for arbitrary subgraphs (Hito 8).
// ---------------------------------------------------------------------------

/**
 * Misra & Gries edge coloring: a constructive proof of Vizing's theorem,
 * `O(V·E)`. This is the one algorithm actually used here that is *proven* to
 * never need more than `Δ + 1` colors, `Δ` being the highest number of
 * pending pairs any single player has.
 *
 * This replaces an earlier version of this function that picked edges by
 * descending combined degree and greedily assigned the smallest available
 * color at each step. That reads like "the greedy Vizing bound" but is not
 * one: a plain greedy edge coloring (any fixed order, always taking the
 * smallest legal color) is only guaranteed `2Δ - 1` colors in the worst
 * case, and K_n-minus-a-few-edges — exactly the shape of the pending
 * matches after a Hito 8 recalculation (SPEC §5.1, §5.5) — hits that worst
 * case in practice: K_12 minus one edge needed 15 colors with the old
 * function (Δ + 1 = 12). SPEC §4.3 itself asserts the `Δ + 1` bound for "a
 * greedy coloring by descending degree", which is the same conflation; that
 * assertion doesn't hold for any plain greedy, and is corrected in SPEC.md
 * at Hito 10 (deviation D4, PLAN.md). This function is what actually
 * delivers the guarantee the spec meant.
 *
 * Reference algorithm, for each uncolored edge `(x, y)`:
 *   1. Build a maximal **fan** of `x` starting at `y`: a sequence of
 *      distinct neighbors `y = f₁, f₂, …, fₖ` where every `(x, fᵢ)` for
 *      `i ≥ 2` is already colored with a color free at `f_{i-1}`.
 *   2. Pick `c` free at `x` and `d` free at the fan's last vertex `fₖ`.
 *   3. Find the maximal `c`/`d` alternating path (Kempe chain) starting at
 *      `x` and invert it (swap `c` and `d` along it) — this frees `d` at
 *      `x` without breaking properness anywhere else.
 *   4. Scan the fan from the start for the (possibly new, if the inversion
 *      touched the fan) vertex `w` where `d` is now free, rotate the fan up
 *      to `w` (each edge takes the color of the next one in the sequence),
 *      and color `(x, w)` with `d`. Since `w` is (or defaults to) `y`
 *      itself, this always ends up coloring the original edge.
 *
 * Deterministic: vertices are processed in the fixed lexicographic id
 * order established by the caller; fan candidates and the Kempe-chain walk
 * are chosen by ascending vertex index whenever more than one option
 * exists (properness guarantees at most one exists when walking the
 * chain — only the fan-building step ever has a real tie to break).
 */
function misraGriesColoring(pairs: Pairing[], sortedIds: string[]): Pairing[][] {
  const index = new Map(sortedIds.map((id, i) => [id, i]));
  const n = sortedIds.length;

  const adjacency: number[][] = Array.from({ length: n }, () => []);
  const edges: [number, number][] = pairs
    .map((p): [number, number] => [index.get(p.homeId)!, index.get(p.awayId)!])
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  for (const [u, v] of edges) {
    adjacency[u].push(v);
    adjacency[v].push(u);
  }
  for (const list of adjacency) list.sort((a, b) => a - b);

  const maxDegree = adjacency.reduce((max, list) => Math.max(max, list.length), 0);
  if (maxDegree === 0) return []; // no edges at all.
  const colorCount = maxDegree + 1;
  const allColors = Array.from({ length: colorCount }, (_, i) => i);

  // color[x] maps neighbor index -> color index (0..colorCount - 1).
  const color: Map<number, number>[] = Array.from({ length: n }, () => new Map());

  function smallestFreeColor(x: number): number {
    const used = new Set(color[x].values());
    // Vizing's premise guarantees a free color always exists here:
    // |used| <= degree(x) <= maxDegree < colorCount. A non-null assertion
    // documents that guarantee instead of a defensive branch that could
    // never actually run (and so could never be covered honestly).
    return allColors.find((c) => !used.has(c))!;
  }

  function isFreeAt(x: number, c: number): boolean {
    for (const usedColor of color[x].values()) {
      if (usedColor === c) return false;
    }
    return true;
  }

  function setColor(a: number, b: number, c: number): void {
    color[a].set(b, c);
    color[b].set(a, c);
  }

  /** The maximal c/d-alternating path starting at `x`, inverted in place. */
  function invertKempeChain(x: number, c: number, d: number): void {
    if (c === d) return; // d is already free at x — nothing to invert.
    const path = [x];
    let current = x;
    let want = d; // c is free at x, so the first edge (if any) must be `d`.
    for (;;) {
      // At most one neighbor can have color `want` (proper coloring), so
      // whichever one the scan finds first is the only one there is.
      const next = adjacency[current].find((z) => color[current].get(z) === want);
      if (next === undefined) break;
      path.push(next);
      current = next;
      want = want === c ? d : c;
    }
    for (let i = 0; i < path.length - 1; i++) {
      const a = path[i];
      const b = path[i + 1];
      const previous = color[a].get(b)!;
      setColor(a, b, previous === c ? d : c);
    }
  }

  /** Maximal fan of `x` starting at `y` (SPEC-independent graph theory). */
  function buildMaximalFan(x: number, y: number): number[] {
    const fan = [y];
    const used = new Set([y]);
    for (;;) {
      const last = fan[fan.length - 1];
      const candidates = adjacency[x].filter(
        (z) => !used.has(z) && color[x].has(z) && isFreeAt(last, color[x].get(z)!)
      );
      if (candidates.length === 0) break;
      const next = Math.min(...candidates); // deterministic tie-break.
      fan.push(next);
      used.add(next);
    }
    return fan;
  }

  function colorEdge(x: number, y: number): void {
    const fan = buildMaximalFan(x, y);
    const c = smallestFreeColor(x);
    const d = smallestFreeColor(fan[fan.length - 1]);
    invertKempeChain(x, c, d);

    // The inversion may have changed colors on some fan edges, so the
    // vertex where `d` is now free might not be the fan's last vertex
    // anymore — scan from the start for the first one where it is.
    const wIndex = fan.findIndex((f) => isFreeAt(f, d));
    for (let i = 0; i < wIndex; i++) {
      setColor(x, fan[i], color[x].get(fan[i + 1])!);
    }
    setColor(x, fan[wIndex], d);
  }

  for (const [u, v] of edges) {
    if (!color[u].has(v)) colorEdge(u, v);
  }

  const matchings: Pairing[][] = Array.from({ length: colorCount }, () => []);
  for (const p of pairs) {
    const u = index.get(p.homeId)!;
    const v = index.get(p.awayId)!;
    matchings[color[u].get(v)!].push(p);
  }
  // A color class is a matching by definition — every homeId in it is
  // already unique, same reasoning as circleMethodJourneys, so sorting by
  // homeId alone is enough to make the output order deterministic.
  for (const matching of matchings) {
    matching.sort((x, y) => x.homeId.localeCompare(y.homeId));
  }
  return matchings.filter((m) => m.length > 0);
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
 * Formulated as edge coloring (SPEC §4.3): each "factor" is a color, a round
 * is a fixed number of consecutive factors, and the invariant is that no
 * player has more than `matchesPerRound` pairs in the same round. Grouping
 * whole factors together guarantees that invariant by construction, for any
 * factor-producing strategy — the real work is making sure every factor is
 * internally valid (no player exceeding `factor`'s own per-player degree).
 *
 * - When `pairs` is exactly the full round-robin over `playerIds` (K_n),
 *   this delegates to the same exact construction `roundRobinRounds` uses
 *   (`decomposeCompleteGraph`), so it is optimal and matches `roundsCount`.
 * - Otherwise (an arbitrary subgraph — e.g. the pending matches left after
 *   a Hito 8 recalculation) it falls back to `misraGriesColoring`, which is
 *   *proven* to never need more than `Δ + 1` matchings (unlike a plain
 *   greedy — see that function's doc).
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
  const { factors, unitDegree } = isCompleteGraph(pairs, sortedIds)
    ? decomposeCompleteGraph(sortedIds, matchesPerRound)
    : { factors: misraGriesColoring(pairs, sortedIds), unitDegree: 1 as const };
  const groupSize = matchesPerRound / unitDegree;

  const sortedRoundIndexes = [...openRoundIndexes].sort((a, b) => a - b);
  const neededRounds = Math.ceil(factors.length / groupSize);
  if (neededRounds > sortedRoundIndexes.length) {
    throw new Error(
      `assignPairsToRounds: need ${neededRounds} round(s) to place every pair, only ${sortedRoundIndexes.length} open`
    );
  }

  const assignments: RoundAssignment[] = [];
  for (let i = 0; i < factors.length; i += groupSize) {
    const roundIndex = sortedRoundIndexes[i / groupSize];
    for (const factor of factors.slice(i, i + groupSize)) {
      for (const pair of factor) {
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
// roundQuota — SPEC §4.6, §5.2
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
   * `matchesPerRound`: the last round can require less (SPEC §5.2), and
   * — with an odd number of players and an odd `matchesPerRound` — a
   * player can have one match fewer in some rounds too (the bye-rotation
   * construction used for that specific case, see `oddCompleteGraphJourneys`
   * in this module). Deliberately **not** derived from `matchesPerRound`:
   * with an even `matchesPerRound` the Walecki decomposition gives every
   * player exactly `matchesPerRound` matches in every full round, nobody
   * ever rests, so computing `required` from the constant instead of from
   * the matches themselves would be wrong in that regime and right in the
   * other. Deriving it from the matches actually assigned works
   * identically in both.
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
 * covers the 0-required edge case of a player with no match at all in a
 * given round — nothing owed, nothing missing).
 */
export function quotaLabel(resolved: number, required: number): string {
  const missing = required - resolved;
  if (missing <= 0) return "cumplido";
  if (missing === 1) return `falta 1 de ${required}`;
  return `faltan ${missing} de ${required}`;
}
