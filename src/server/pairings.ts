// Pure domain function: round-robin pairing generation.
// SPEC §7.2, ADR-007.
// No DB access — pure and fully testable.

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Minimal player data needed to generate pairings. */
export interface PairingPlayer {
  id: string;
  displayName: string;
}

/** A single unique pairing: always homeId < awayId lexicographically (stable). */
export interface Pairing {
  homeId: string;
  awayId: string;
}

// ---------------------------------------------------------------------------
// generatePairings
// ---------------------------------------------------------------------------

/**
 * Generate all unique pairs for a round-robin league phase.
 *
 * Rules (SPEC §7.2, ADR-007):
 * - Returns exactly C(n, 2) = n*(n-1)/2 pairs for n players.
 * - No player is paired with themselves.
 * - Each pair {A, B} appears exactly once.
 * - No rounds, no circle method, no byes (league phase has none).
 * - Home/away assignment is deterministic: lexicographic order of player IDs
 *   ensures stable assignment across calls (the player whose ID comes first
 *   alphabetically is home). This is arbitrary but consistent and fair for W40k
 *   where home/away has minimal mechanical impact.
 *
 * @param players - Array of active players to pair. Duplicates (by id) are
 *   silently de-duplicated. Must have at least 2 players.
 * @returns Array of Pairing objects (order: home-first iteration over sorted IDs).
 */
export function generatePairings(players: PairingPlayer[]): Pairing[] {
  // De-duplicate by id, then sort by id for determinism.
  const seen = new Set<string>();
  const unique: PairingPlayer[] = [];
  for (const p of players) {
    if (!seen.has(p.id)) {
      seen.add(p.id);
      unique.push(p);
    }
  }
  unique.sort((a, b) => a.id.localeCompare(b.id));

  const n = unique.length;
  if (n < 2) return [];

  const pairings: Pairing[] = [];

  for (let i = 0; i < n - 1; i++) {
    for (let j = i + 1; j < n; j++) {
      // unique[i].id < unique[j].id because array is sorted → stable home/away.
      pairings.push({ homeId: unique[i].id, awayId: unique[j].id });
    }
  }

  return pairings;
}

// ---------------------------------------------------------------------------
// Utility: expected count for validation / testing
// ---------------------------------------------------------------------------

/** C(n, 2) = n * (n - 1) / 2 — expected number of pairings for n players. */
export function expectedPairingCount(n: number): number {
  if (n < 2) return 0;
  return (n * (n - 1)) / 2;
}
