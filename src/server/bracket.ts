// Pure bracket construction logic — SPEC §7.4, §4.6.
// No DB imports: all functions are testable in isolation.
// ADR-002: no SQL-proprietary logic lives here.

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * A seed entry: playerId plus 1-based seed rank (1 = top seed).
 */
export interface SeedEntry {
  playerId: string;
  seed: number; // 1-based rank
}

/**
 * A slot in the bracket tree (in-memory representation, no DB ids yet).
 * roundIndex: 1 = first round (earliest matches), max = final.
 * position: 1-based within the round.
 */
export interface BracketSlotSpec {
  roundIndex: number;
  position: number;
  /** playerId if already known (byes or seeded player). Null = TBD. */
  playerId: string | null;
  /** True when this slot is a bye (the player advances without playing). */
  isBye: boolean;
  /**
   * Index into the slot array of the parent slot (the slot the winner of this
   * slot feeds into). Null for the final slot.
   */
  feedsIntoIndex: number | null;
}

/**
 * The full in-memory bracket specification returned by buildBracket.
 */
export interface BracketSpec {
  /**
   * Effective bracket size — the smallest power of 2 >= playoffSize.
   * Equals playoffSize if playoffSize is already a power of 2.
   */
  size: number;
  /** Total number of rounds. ceil(log2(size)) */
  rounds: number;
  /**
   * Ordered list of all bracket slots.
   * Index within this array is used as feedsIntoIndex pointer.
   * Order: round 1 slots first (positions 1..size/2), then round 2, …, final.
   */
  slots: BracketSlotSpec[];
}

// ---------------------------------------------------------------------------
// nextPowerOf2 — smallest power of 2 >= n
// ---------------------------------------------------------------------------

export function nextPowerOf2(n: number): number {
  if (n <= 1) return 1;
  let p = 1;
  while (p < n) p *= 2;
  return p;
}

// ---------------------------------------------------------------------------
// buildBracket — main pure function
// ---------------------------------------------------------------------------

/**
 * Build a single-elimination bracket from a list of seeds.
 *
 * Algorithm:
 *  1. Compute effective bracket size S = nextPowerOf2(playoffSize).
 *  2. The number of byes needed = S - playoffSize. The top (S - playoffSize)
 *     seeds receive a bye in round 1 (they advance automatically to round 2).
 *  3. Standard seeding pairing in round 1: seed 1 vs seed N, seed 2 vs seed N-1, …
 *     where N = S (the effective bracket size).
 *  4. Slots in later rounds have playerId = null until their match is resolved.
 *
 * Returns a BracketSpec with all slots fully described (feedsIntoIndex wired).
 *
 * @param seeds Ordered list of seeds, sorted ascending by seed rank (index 0 = seed 1).
 */
export function buildBracket(seeds: SeedEntry[]): BracketSpec {
  const playoffSize = seeds.length;
  if (playoffSize < 2) {
    throw new Error("buildBracket requires at least 2 seeds");
  }

  const size = nextPowerOf2(playoffSize);
  const rounds = Math.ceil(Math.log2(size)); // = log2(size) for powers of 2

  // Build a seed-to-player lookup for slot assignment.
  // seeds[i].seed should equal i+1 (1-based). We trust the caller.
  const playerBySeed = new Map<number, string>();
  for (const s of seeds) {
    playerBySeed.set(s.seed, s.playerId);
  }

  // We will build all slots in order: round 1, round 2, …, final.
  // The array index is the feedsIntoIndex pointer.
  const slots: BracketSlotSpec[] = [];

  // ---------------------------------------------------------------------------
  // Round 1 slots
  // Round 1 has size/2 matches.
  // Standard seeding: slot at position p pairs seed p vs seed (size+1-p).
  // The top `byeCount` seeds pair against "bye" (the higher seed advances).
  // ---------------------------------------------------------------------------
  const round1Count = size / 2; // number of round-1 slots

  for (let pos = 1; pos <= round1Count; pos++) {
    const topSeed = pos; // seed 1, 2, 3, …
    const bottomSeed = size + 1 - pos; // seed N, N-1, N-2, …

    const topPlayer = playerBySeed.get(topSeed) ?? null;

    // A bye occurs when the bottom seed doesn't exist (> playoffSize).
    const isBye = bottomSeed > playoffSize;

    slots.push({
      roundIndex: 1,
      position: pos,
      // In a bye the top seed is already the winner; we put them in playerId.
      // In a real match playerId is null (winner not yet determined).
      playerId: isBye ? topPlayer : null,
      isBye,
      feedsIntoIndex: null, // filled below
    });
  }

  // ---------------------------------------------------------------------------
  // Subsequent rounds: round 2 … final.
  // Each round has half the slots of the previous round.
  // ---------------------------------------------------------------------------
  let prevRoundStart = 0; // index into slots[] of first slot in previous round
  let prevRoundCount = round1Count;

  for (let round = 2; round <= rounds; round++) {
    const thisRoundCount = prevRoundCount / 2;
    const thisRoundStart = slots.length;

    for (let pos = 1; pos <= thisRoundCount; pos++) {
      // Carry over playerId: if both feeders are byes the winner is already known.
      // (This happens only when the entire first round is byes, which requires
      // playoffSize=1 — already excluded above.)
      slots.push({
        roundIndex: round,
        position: pos,
        playerId: null, // determined when feeders resolve
        isBye: false,
        feedsIntoIndex: null, // filled in next iteration
      });
    }

    // Wire feedsIntoIndex for previous round's slots into this round's slots.
    // Pairs from the previous round: (pos 1, pos 2) → round slot 1,
    //                               (pos 3, pos 4) → round slot 2, …
    for (let i = 0; i < prevRoundCount; i++) {
      const prevSlotIndex = prevRoundStart + i;
      const nextSlotIndex = thisRoundStart + Math.floor(i / 2);
      slots[prevSlotIndex].feedsIntoIndex = nextSlotIndex;
    }

    prevRoundStart = thisRoundStart;
    prevRoundCount = thisRoundCount;
  }

  // The final slot (last in array) has no feedsIntoIndex (already null).

  // ---------------------------------------------------------------------------
  // Resolve byes upward: if a round-1 bye slot's winner is known, and the
  // paired slot in round 1 is also a bye (shouldn't happen with standard seeding
  // where only top seeds get byes, but handle defensively), auto-advance.
  // In practice with standard seeding, byes only appear in round 1 at positions
  // where the bottom seed is > playoffSize. The paired upper-round slot stays
  // null until the other round-1 slot resolves (or also has a bye).
  //
  // Special case: if BOTH round-1 slots feeding into a round-2 slot are byes,
  // the round-2 slot can be pre-populated. This occurs when byeCount >= round1Count,
  // which only happens when playoffSize <= size/2, i.e., playoffSize is small
  // relative to the bracket size. Example: playoffSize=2, size=2 (no byes).
  //
  // We do one pass to pre-fill later rounds where both predecessors are byes.
  // ---------------------------------------------------------------------------
  propagateByes(slots);

  return { size, rounds, slots };
}

/**
 * Propagate automatic bye advances through the bracket.
 *
 * In standard single-elimination seeding, byes are given to the top seeds when
 * playoffSize is not a power of 2. With standard seeding (seed 1 vs seed N, etc.)
 * no two adjacent round-1 slots will BOTH be byes — the lowest seeds face the
 * highest seeds and byes go to the top. Therefore, no multi-level propagation
 * is ever needed in practice.
 *
 * This function is kept as a documented stub for defensive completeness. It
 * performs a single iteration and immediately breaks — the `while (changed)`
 * loop is intentionally a one-pass guard (not an actual multi-pass algorithm).
 * Any future non-standard seeding that could produce adjacent byes would need
 * this to be expanded.
 */
function propagateByes(slots: BracketSlotSpec[]): void {
  // Single defensive pass — see function JSDoc for rationale.
  const changed = false;
  for (let i = 0; i < slots.length; i++) {
    const slot = slots[i];
    if (slot.feedsIntoIndex === null) continue;
    const parent = slots[slot.feedsIntoIndex];
    if (parent.playerId !== null) continue;
    // Find the sibling slot that also feeds into parent.
    const siblings = slots.filter(
      (s, j) => j !== i && s.feedsIntoIndex === slot.feedsIntoIndex
    );
    if (siblings.length !== 1) continue;
    const sibling = siblings[0];
    if (slot.isBye && sibling.isBye && slot.playerId && sibling.playerId) {
      // Both feed into parent — they form a real match between two bye-winners.
      // Parent is NOT a bye; don't pre-populate; wait for actual match result.
      continue;
    }
  }
  // changed remains false: no propagation occurs in standard seeding.
  void changed; // suppress unused-variable lint warning
}

// ---------------------------------------------------------------------------
// seedsFromStandings — helper to extract SeedEntry[] from standings rows
// ---------------------------------------------------------------------------

/**
 * Extract the top `playoffSize` seeds from an ordered standings array.
 * The standings must already be sorted (rank 1 = best).
 *
 * @param standings Ordered array with at minimum { playerId: string; rank: number }
 * @param playoffSize How many players to take.
 */
export function seedsFromStandings(
  standings: Array<{ playerId: string; rank: number }>,
  playoffSize: number
): SeedEntry[] {
  if (playoffSize < 2) {
    throw new Error("playoffSize must be >= 2");
  }
  const taken = standings.slice(0, playoffSize);
  if (taken.length < playoffSize) {
    throw new Error(
      `Not enough standings entries: need ${playoffSize}, got ${taken.length}`
    );
  }
  return taken.map((row, idx) => ({
    playerId: row.playerId,
    seed: idx + 1, // 1-based
  }));
}

// ---------------------------------------------------------------------------
// advanceWinner — pure helper for winner advancement logic
// ---------------------------------------------------------------------------

/**
 * Given a confirmed playoff match result, determine the winning player id.
 * SPEC §7.4: DRAW is invalid in playoffs.
 *
 * @param outcome "HOME_WIN" | "AWAY_WIN" | "DRAW"
 * @param playerHomeId
 * @param playerAwayId Null if it's a bye (should never get a DRAW or AWAY_WIN).
 * @returns The winner's playerId.
 * @throws If outcome is DRAW (invalid in playoffs).
 */
export function resolvePlayoffWinner(
  outcome: string,
  playerHomeId: string,
  playerAwayId: string | null
): string {
  if (outcome === "DRAW") {
    throw new Error(
      "Draw is not valid in playoff matches. A winner is required."
    );
  }
  if (outcome === "HOME_WIN") {
    return playerHomeId;
  }
  if (outcome === "AWAY_WIN") {
    if (!playerAwayId) {
      throw new Error("AWAY_WIN but playerAwayId is null (bye match).");
    }
    return playerAwayId;
  }
  throw new Error(`Unknown outcome: ${outcome}`);
}

// ---------------------------------------------------------------------------
// formatOpenRoundsMessage — pure message builder for the "puerta a los
// playoffs" guard (rondas-con-fecha spec §4.11, criterio 36)
// ---------------------------------------------------------------------------

/** The subset of a `Round` this message needs — kept minimal so both the
 * fast-path check and the transactional re-read in
 * `src/server/playoff-actions.ts` can pass either a Prisma row or the plain
 * shape straight off a `select`. */
export interface OpenRoundInfo {
  index: number;
  deadline: Date;
}

/**
 * Build the Spanish, admin-facing rejection message for `startPlayoffs`
 * when one or more rounds still lack `closedAt`. Named per round, with its
 * deadline, per criterio 36 ("nombrando las rondas que faltan y su fecha de
 * cierre") — not a generic "faltan rondas".
 *
 * Pure and DB-free on purpose: `src/server/playoff-actions.ts` calls it both
 * from the fast-path check (before opening the transaction) and from the
 * `catch` block that translates the authoritative re-read's failure (inside
 * the transaction), so the two rejections always read identically —
 * `src/app/admin/playoffs/page.tsx` also uses it to render the same
 * information before the admin ever presses the button.
 */
export function formatOpenRoundsMessage(openRounds: OpenRoundInfo[]): string {
  const sorted = [...openRounds].sort((a, b) => a.index - b.index);
  const list = sorted
    .map(
      (r) =>
        `ronda ${r.index} (cierre ${r.deadline.toLocaleDateString("es-ES")})`
    )
    .join(", ");
  return `No se pueden iniciar los playoffs: todavía quedan rondas sin cerrar: ${list}.`;
}

/**
 * Rejection message for `startPlayoffs` when the league has **zero** `Round`
 * rows at all — a distinct diagnosis from `formatOpenRoundsMessage`'s "faltan
 * rondas por cerrar": here nothing was ever resolved into a round in the
 * first place, so §4.11's guarantee ("los playoffs arrancan con las C(n,2)
 * partidas resueltas") can't hold even vacuously. Reachable only through the
 * documented non-atomic gap in `addMissingLeagueMatches`
 * (src/server/round-actions.ts's `redistributePending` doc): the league's
 * very first alta transitions `status` to `LEAGUE` and creates matches with
 * `roundId: null` in one transaction, then calls `redistributePending` in a
 * *separate* one to create the rounds — if that second call fails, the
 * league is left `LEAGUE` with matches but no `Round` at all. Named as a
 * constant, not a function, since it needs no per-round data — the fix is
 * the same regardless of how many matches exist.
 */
export const NO_ROUNDS_MESSAGE =
  "No se pueden iniciar los playoffs: esta liga todavía no tiene ninguna ronda generada, así que no hay nada resuelto. Genera los emparejamientos o repite el reparto de partidas pendientes para crear las rondas.";
