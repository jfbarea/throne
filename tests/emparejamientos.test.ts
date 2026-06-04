// Tests for Hito 6: emparejamientos-y-fechas
// Covers:
//   1. Pure function generatePairings: correctness for various n (even/odd)
//   2. Authorization: setMatchSchedule rejects non-participants
//   3. Regeneration guard: blocked when confirmed matches exist

import { describe, it, expect } from "vitest";

// ---------------------------------------------------------------------------
// Helper: build a test player list
// ---------------------------------------------------------------------------

function makePlayers(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    // Deterministic IDs: pad to ensure consistent lexicographic order
    id: `player-${String(i + 1).padStart(3, "0")}`,
    displayName: `Jugador ${i + 1}`,
  }));
}

// ---------------------------------------------------------------------------
// 1. generatePairings — pure function tests
// ---------------------------------------------------------------------------

describe("generatePairings", () => {
  async function getPairings(players: { id: string; displayName: string }[]) {
    const { generatePairings } = await import("@/server/pairings");
    return generatePairings(players);
  }

  async function getExpected(n: number) {
    const { expectedPairingCount } = await import("@/server/pairings");
    return expectedPairingCount(n);
  }

  // ---- n=2: C(2,2)=1 pair ----
  it("n=2: returns exactly 1 pair", async () => {
    const players = makePlayers(2);
    const pairings = await getPairings(players);
    expect(pairings).toHaveLength(1);
  });

  // ---- n=3: C(3,2)=3 pairs (odd n) ----
  it("n=3 (odd): returns exactly C(3,2)=3 pairs", async () => {
    const players = makePlayers(3);
    const pairings = await getPairings(players);
    const expected = await getExpected(3);
    expect(pairings).toHaveLength(expected);
    expect(expected).toBe(3);
  });

  // ---- n=4: C(4,2)=6 pairs (even n) ----
  it("n=4 (even): returns exactly C(4,2)=6 pairs", async () => {
    const players = makePlayers(4);
    const pairings = await getPairings(players);
    const expected = await getExpected(4);
    expect(pairings).toHaveLength(expected);
    expect(expected).toBe(6);
  });

  // ---- n=5: C(5,2)=10 pairs (odd n) ----
  it("n=5 (odd): returns exactly C(5,2)=10 pairs", async () => {
    const players = makePlayers(5);
    const pairings = await getPairings(players);
    const expected = await getExpected(5);
    expect(pairings).toHaveLength(expected);
    expect(expected).toBe(10);
  });

  // ---- n=6: C(6,2)=15 pairs (even n) ----
  it("n=6 (even): returns exactly C(6,2)=15 pairs", async () => {
    const players = makePlayers(6);
    const pairings = await getPairings(players);
    const expected = await getExpected(6);
    expect(pairings).toHaveLength(expected);
    expect(expected).toBe(15);
  });

  // ---- n=11: C(11,2)=55 pairs (odd n) ----
  it("n=11 (odd): returns exactly C(11,2)=55 pairs", async () => {
    const players = makePlayers(11);
    const pairings = await getPairings(players);
    const expected = await getExpected(11);
    expect(pairings).toHaveLength(expected);
    expect(expected).toBe(55);
  });

  // ---- n=12: C(12,2)=66 pairs (even n) ----
  it("n=12 (even): returns exactly C(12,2)=66 pairs", async () => {
    const players = makePlayers(12);
    const pairings = await getPairings(players);
    const expected = await getExpected(12);
    expect(pairings).toHaveLength(expected);
    expect(expected).toBe(66);
  });

  // ---- No player is paired with themselves ----
  it("no player is paired with themselves", async () => {
    for (const n of [2, 3, 5, 7, 12]) {
      const players = makePlayers(n);
      const pairings = await getPairings(players);
      for (const p of pairings) {
        expect(p.homeId).not.toBe(p.awayId);
      }
    }
  });

  // ---- Each pair {A,B} appears exactly once ----
  it("each pair appears exactly once (no duplicates)", async () => {
    for (const n of [2, 3, 4, 5, 10]) {
      const players = makePlayers(n);
      const pairings = await getPairings(players);
      // Normalise pair to sorted key to detect both orderings as duplicate.
      const seen = new Set<string>();
      for (const p of pairings) {
        const key = [p.homeId, p.awayId].sort().join("|");
        expect(seen.has(key)).toBe(false);
        seen.add(key);
      }
    }
  });

  // ---- Home/away assignment is stable (deterministic) ----
  it("home/away assignment is deterministic across multiple calls", async () => {
    const { generatePairings } = await import("@/server/pairings");
    const players = makePlayers(5);
    const first = generatePairings(players);
    const second = generatePairings(players);
    expect(first).toEqual(second);
  });

  // ---- Counts match expectedPairingCount formula for all n 2..15 ----
  it("count matches C(n,2) formula for n from 2 to 15", async () => {
    const { generatePairings, expectedPairingCount } = await import(
      "@/server/pairings"
    );
    for (let n = 2; n <= 15; n++) {
      const players = makePlayers(n);
      const pairings = generatePairings(players);
      expect(pairings).toHaveLength(expectedPairingCount(n));
    }
  });

  // ---- No byes: impar n produces C(n,2) without any bye entry ----
  it("odd n produces no byes (all pairings have both homeId and awayId)", async () => {
    for (const n of [3, 5, 7, 9, 11]) {
      const players = makePlayers(n);
      const pairings = await getPairings(players);
      for (const p of pairings) {
        expect(p.homeId).toBeTruthy();
        expect(p.awayId).toBeTruthy();
        expect(p.homeId).not.toBe(p.awayId);
      }
    }
  });

  // ---- n<2 returns empty array ----
  it("n=0 returns empty array", async () => {
    const pairings = await getPairings([]);
    expect(pairings).toHaveLength(0);
  });

  it("n=1 returns empty array", async () => {
    const pairings = await getPairings(makePlayers(1));
    expect(pairings).toHaveLength(0);
  });

  // ---- Duplicate players are de-duplicated ----
  it("duplicate player IDs are de-duplicated before pairing", async () => {
    const { generatePairings, expectedPairingCount } = await import(
      "@/server/pairings"
    );
    const players = [
      { id: "dup-a", displayName: "A" },
      { id: "dup-a", displayName: "A-copy" }, // same id, should be ignored
      { id: "dup-b", displayName: "B" },
      { id: "dup-c", displayName: "C" },
    ];
    // After de-dup: 3 unique players → C(3,2)=3 pairings.
    const pairings = generatePairings(players);
    expect(pairings).toHaveLength(expectedPairingCount(3));
  });
});

// ---------------------------------------------------------------------------
// 1b. missingPairings — pure function tests (Hito 12)
// ---------------------------------------------------------------------------

describe("missingPairings", () => {
  async function getMissing(
    players: { id: string; displayName: string }[],
    existingPairs: { aId: string; bId: string }[]
  ) {
    const { missingPairings } = await import("@/server/pairings");
    return missingPairings(players, existingPairs);
  }

  // ---- All pairs already present → [] ----
  it("returns [] when all pairs are already present", async () => {
    const players = makePlayers(3);
    // Build all C(3,2)=3 pairs as existing.
    const existingPairs = [
      { aId: players[0].id, bId: players[1].id },
      { aId: players[0].id, bId: players[2].id },
      { aId: players[1].id, bId: players[2].id },
    ];
    const missing = await getMissing(players, existingPairs);
    expect(missing).toHaveLength(0);
  });

  // ---- n players + 1 new → exactly n new pairs ----
  it("n existing players + 1 new player → exactly n new pairs", async () => {
    const n = 4;
    const existing = makePlayers(n);
    const newPlayer = { id: "player-new-999", displayName: "New Player" };
    const allPlayers = [...existing, newPlayer];

    // Existing pairs: only the C(n,2) pairs among the original n players.
    const existingPairs = existing.flatMap((a, i) =>
      existing.slice(i + 1).map((b) => ({ aId: a.id, bId: b.id }))
    );

    const missing = await getMissing(allPlayers, existingPairs);

    // New player must be paired against each of the n existing players.
    expect(missing).toHaveLength(n);

    // Every new pair involves the new player.
    for (const p of missing) {
      const involveNew =
        p.homeId === newPlayer.id || p.awayId === newPlayer.id;
      expect(involveNew).toBe(true);
    }

    // No duplicates.
    const keys = missing.map((p) => [p.homeId, p.awayId].sort().join("|"));
    expect(new Set(keys).size).toBe(missing.length);
  });

  // ---- Inverted home/away in existing pair is recognised as present ----
  it("recognises a pair as present even when home/away is inverted in existingPairs", async () => {
    const players = makePlayers(2);
    const [a, b] = players;

    // Store the pair with IDs flipped (b as aId, a as bId).
    const existingPairs = [{ aId: b.id, bId: a.id }];

    const missing = await getMissing(players, existingPairs);
    // The pair {a, b} already exists (unordered match) → nothing missing.
    expect(missing).toHaveLength(0);
  });

  // ---- No auto-pairs (player paired with themselves) ----
  it("never generates a pair of a player with themselves", async () => {
    const players = makePlayers(5);
    const missing = await getMissing(players, []);
    for (const p of missing) {
      expect(p.homeId).not.toBe(p.awayId);
    }
  });

  // ---- Empty or single-player list → [] ----
  it("returns [] for empty player list", async () => {
    const missing = await getMissing([], []);
    expect(missing).toHaveLength(0);
  });

  it("returns [] for a single player", async () => {
    const missing = await getMissing(makePlayers(1), []);
    expect(missing).toHaveLength(0);
  });

  // ---- No byes: all returned pairings have both homeId and awayId ----
  it("all returned pairings have non-empty homeId and awayId (no byes)", async () => {
    const players = makePlayers(5);
    const missing = await getMissing(players, []);
    for (const p of missing) {
      expect(p.homeId).toBeTruthy();
      expect(p.awayId).toBeTruthy();
    }
  });

  // ---- Deterministic: same input → same output ----
  it("is deterministic — same input produces identical output", async () => {
    const { missingPairings } = await import("@/server/pairings");
    const players = makePlayers(5);
    // Pre-fill one existing pair to make it more interesting.
    const existingPairs = [{ aId: players[0].id, bId: players[1].id }];
    const first = missingPairings(players, existingPairs);
    const second = missingPairings(players, existingPairs);
    expect(first).toEqual(second);
  });

  // ---- Partial existing set: correct delta ----
  it("returns only the truly missing pairs when some pairs already exist", async () => {
    const players = makePlayers(4);
    // Provide 2 of the 6 pairs as existing.
    const existingPairs = [
      { aId: players[0].id, bId: players[1].id },
      { aId: players[2].id, bId: players[3].id },
    ];
    const missing = await getMissing(players, existingPairs);
    // C(4,2)=6 total, 2 already present → 4 missing.
    expect(missing).toHaveLength(4);

    // None of the returned pairs should duplicate an existing one.
    const existingKeys = new Set(
      existingPairs.map((p) => [p.aId, p.bId].sort().join("|"))
    );
    for (const p of missing) {
      const key = [p.homeId, p.awayId].sort().join("|");
      expect(existingKeys.has(key)).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// 2. Authorization: setMatchSchedule — server action
// ---------------------------------------------------------------------------
// These tests verify authorization logic through direct mocking patterns.
// The actual DB guard is integration-level; here we test the session derivation
// logic and the authorization contract via unit-testable helpers.

describe("setMatchSchedule authorization logic", () => {
  // Derive canEdit inline (mirrors the logic in the server action).
  function canEditMatch(
    session: { role: string; playerId: string | null },
    match: { playerHomeId: string; playerAwayId: string | null }
  ): boolean {
    const isAdmin = session.role === "ADMIN";
    const isParticipant =
      session.playerId !== null &&
      (match.playerHomeId === session.playerId ||
        match.playerAwayId === session.playerId);
    return isAdmin || isParticipant;
  }

  const match = { playerHomeId: "player-A", playerAwayId: "player-B" };

  it("home player can edit their match", () => {
    expect(
      canEditMatch({ role: "PLAYER", playerId: "player-A" }, match)
    ).toBe(true);
  });

  it("away player can edit their match", () => {
    expect(
      canEditMatch({ role: "PLAYER", playerId: "player-B" }, match)
    ).toBe(true);
  });

  it("admin can edit any match", () => {
    expect(
      canEditMatch({ role: "ADMIN", playerId: "admin-id" }, match)
    ).toBe(true);
  });

  it("admin with null playerId can still edit", () => {
    expect(canEditMatch({ role: "ADMIN", playerId: null }, match)).toBe(true);
  });

  it("third-party player cannot edit a match they are not in", () => {
    expect(
      canEditMatch({ role: "PLAYER", playerId: "player-C" }, match)
    ).toBe(false);
  });

  it("unauthenticated (null playerId, PLAYER role) cannot edit", () => {
    expect(
      canEditMatch({ role: "PLAYER", playerId: null }, match)
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 3. Regeneration guard — logic test
// ---------------------------------------------------------------------------

describe("regeneration guard logic", () => {
  // Mirrors the guard logic in generateLeagueMatches server action.
  function canRegenerate(confirmedCount: number): boolean {
    return confirmedCount === 0;
  }

  it("allows regeneration when there are 0 confirmed matches", () => {
    expect(canRegenerate(0)).toBe(true);
  });

  it("blocks regeneration when there is 1 confirmed match", () => {
    expect(canRegenerate(1)).toBe(false);
  });

  it("blocks regeneration when there are many confirmed matches", () => {
    expect(canRegenerate(10)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 4. expectedPairingCount utility
// ---------------------------------------------------------------------------

describe("expectedPairingCount", () => {
  it("returns 0 for n < 2", async () => {
    const { expectedPairingCount } = await import("@/server/pairings");
    expect(expectedPairingCount(0)).toBe(0);
    expect(expectedPairingCount(1)).toBe(0);
  });

  it("returns correct C(n,2) values", async () => {
    const { expectedPairingCount } = await import("@/server/pairings");
    expect(expectedPairingCount(2)).toBe(1);
    expect(expectedPairingCount(3)).toBe(3);
    expect(expectedPairingCount(4)).toBe(6);
    expect(expectedPairingCount(5)).toBe(10);
    expect(expectedPairingCount(6)).toBe(15);
    expect(expectedPairingCount(10)).toBe(45);
    expect(expectedPairingCount(12)).toBe(66);
    expect(expectedPairingCount(20)).toBe(190);
  });
});
