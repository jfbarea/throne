// Shared test helper: the invariant every reparto (round assignment) has to
// satisfy (SPEC §4.3, §8 criterio 2), extracted from tests/rondas.test.ts
// (Hito 2) so tests/recalculo-alta-baja-y-cupo.test.ts (Hito 8) — and any
// future test that builds a reparto — reuse the exact same, already-proven
// check instead of a weaker ad-hoc one. Not a `*.test.ts` file on purpose:
// vitest's `include` pattern (vitest.config.ts) only picks up test files, so
// this module never runs as its own suite, only as an import.
//
// Origin: H8's first review (plan/rondas-con-fecha/reviews/recalculo-alta-baja-y-cupo.md)
// found that H8's own `assertQuotaInvariant` (a from-scratch, weaker
// re-implementation) didn't reliably catch every way a reparto could go
// wrong, unlike this one — reusing it instead of duplicating it is the fix
// for that gap, not just for the coverage sugerencia.

import { expect } from "vitest";
import type { Pairing } from "@/server/pairings";

export function pairKey(p: Pairing): string {
  return p.homeId < p.awayId ? `${p.homeId}|${p.awayId}` : `${p.awayId}|${p.homeId}`;
}

/**
 * The two properties that actually make a reparto correct, not just "the
 * right number of rounds" or "within Δ+1 colors" (SPEC §4.3, §8 criterio 2):
 *
 *   1. No round has any player appearing more than `maxPerRound` times —
 *      with `maxPerRound = 1` this literally means "no repeated player in
 *      the round" (the property a bare color-count assertion can miss
 *      entirely: a coloring can respect Δ+1 colors and still double-book a
 *      player if a round is built from the wrong color classes).
 *   2. The exact multiset of `expectedPairs` is covered by the output:
 *      every one of them appears exactly once, and nothing else does — no
 *      duplicate, nothing missing, nothing invented.
 *
 * Every test that builds a reparto (via `roundRobinRounds` or
 * `assignPairsToRounds`) should run its result through this, instead of
 * repeating ad-hoc loops that usually only check one of the two.
 *
 * `rounds` here means "all the pairs actually landing in the same round",
 * regardless of source — Hito 8 callers pass a round's *combined* pairs
 * (pending ones just assigned **plus** any already-resolved pairs already
 * sitting there), because the invariant is about the round's total
 * occupancy, not just what one particular call happened to place.
 */
export function assertValidReparto(
  rounds: Pairing[][],
  expectedPairs: Pairing[],
  maxPerRound: number
): void {
  for (const round of rounds) {
    const appearances = new Map<string, number>();
    for (const p of round) {
      appearances.set(p.homeId, (appearances.get(p.homeId) ?? 0) + 1);
      appearances.set(p.awayId, (appearances.get(p.awayId) ?? 0) + 1);
    }
    for (const count of appearances.values()) {
      expect(count).toBeLessThanOrEqual(maxPerRound);
    }
  }

  const outputKeys = rounds.flat().map(pairKey).sort();
  const expectedKeys = expectedPairs.map(pairKey).sort();
  expect(outputKeys).toEqual(expectedKeys);
}

/** Groups a flat list of round-indexed pairings back into per-round arrays. */
export function groupByRoundIndex(
  assigned: { roundIndex: number; homeId: string; awayId: string }[]
): Pairing[][] {
  const byIndex = new Map<number, Pairing[]>();
  for (const a of assigned) {
    const list = byIndex.get(a.roundIndex) ?? [];
    list.push({ homeId: a.homeId, awayId: a.awayId });
    byIndex.set(a.roundIndex, list);
  }
  return [...byIndex.values()];
}
