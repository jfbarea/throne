// Tests for computeStandings — SPEC §7.3, Hito 8.
// Pure unit tests: no DB, no Next.js context.

import { describe, it, expect } from "vitest";
import {
  computeStandings,
  isConfirmedForStandings,
  formatPlayedCount,
  type StandingsMatch,
  type StandingsConfig,
} from "@/server/standings";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeConfig(overrides: Partial<StandingsConfig> = {}): StandingsConfig {
  return {
    pointsWin: 3,
    pointsDraw: 1,
    pointsLoss: 0,
    tiebreakers:
      '["POINTS","VP_DIFF","VP_FOR","HEAD_TO_HEAD","LOSSES","ID_ORDER"]',
    playoffSize: 2,
    ...overrides,
  };
}

let matchCounter = 0;
function makeMatch(
  homeId: string,
  awayId: string,
  outcome: "HOME_WIN" | "AWAY_WIN" | "DRAW",
  homeVP: number,
  awayVP: number,
  opts: {
    status?: string;
    phase?: string;
    bonusHome?: number;
    bonusAway?: number;
    /** SPEC §4.9 (Hito 7, AC-27/28). Omitted keeps the old behaviour of every
     * pre-existing test in this file: no `resolution` in the result object,
     * treated as `PLAYED` by `computeStandings`. */
    resolution?: string;
  } = {}
): StandingsMatch {
  const status = opts.status ?? "CONFIRMED";
  // SCHEDULED and DISPUTED have no result. REPORTED and CONFIRMED have a result.
  const hasResult = status !== "SCHEDULED" && status !== "DISPUTED";
  return {
    id: `match-${++matchCounter}`,
    status,
    phase: opts.phase ?? "LEAGUE",
    playerHomeId: homeId,
    playerAwayId: awayId,
    result: hasResult
      ? {
          homeVictoryPoints: homeVP,
          awayVictoryPoints: awayVP,
          outcome,
          bonusHome: opts.bonusHome ?? 0,
          bonusAway: opts.bonusAway ?? 0,
          ...(opts.resolution !== undefined ? { resolution: opts.resolution } : {}),
        }
      : null,
  };
}

// Shorthand: confirmed home win.
function hw(
  home: string,
  away: string,
  hvp = 10,
  avp = 5
): StandingsMatch {
  return makeMatch(home, away, "HOME_WIN", hvp, avp);
}
// Shorthand: confirmed away win.
function aw(
  home: string,
  away: string,
  hvp = 5,
  avp = 10
): StandingsMatch {
  return makeMatch(home, away, "AWAY_WIN", hvp, avp);
}
// Shorthand: confirmed draw.
function dr(
  home: string,
  away: string,
  hvp = 8,
  avp = 8
): StandingsMatch {
  return makeMatch(home, away, "DRAW", hvp, avp);
}

// ---------------------------------------------------------------------------
// isConfirmedForStandings (Hito 15: REPORTED also counts)
// ---------------------------------------------------------------------------

describe("isConfirmedForStandings", () => {
  it("returns true for CONFIRMED LEAGUE match with result (legacy compatibility)", () => {
    const m = hw("p1", "p2");
    expect(isConfirmedForStandings(m)).toBe(true);
  });

  it("returns true for REPORTED LEAGUE match with result (new flow, Hito 15)", () => {
    // Hito 15: REPORTED is the new active status — counts immediately.
    // makeMatch sets result=null for REPORTED by default, so build manually.
    const m: StandingsMatch = {
      id: "test-reported",
      status: "REPORTED",
      phase: "LEAGUE",
      playerHomeId: "p1",
      playerAwayId: "p2",
      result: {
        homeVictoryPoints: 10,
        awayVictoryPoints: 5,
        outcome: "HOME_WIN",
        bonusHome: 0,
        bonusAway: 0,
      },
    };
    expect(isConfirmedForStandings(m)).toBe(true);
  });

  it("returns false for DISPUTED match (legacy — not counted)", () => {
    const m = makeMatch("p1", "p2", "HOME_WIN", 10, 5, { status: "DISPUTED" });
    expect(isConfirmedForStandings(m)).toBe(false);
  });

  it("returns false for SCHEDULED match (no result)", () => {
    const m = makeMatch("p1", "p2", "HOME_WIN", 10, 5, {
      status: "SCHEDULED",
    });
    expect(isConfirmedForStandings(m)).toBe(false);
  });

  it("returns false for PLAYOFF phase match (REPORTED)", () => {
    const m: StandingsMatch = {
      id: "playoff-reported",
      status: "REPORTED",
      phase: "PLAYOFF",
      playerHomeId: "p1",
      playerAwayId: "p2",
      result: {
        homeVictoryPoints: 10,
        awayVictoryPoints: 5,
        outcome: "HOME_WIN",
        bonusHome: 0,
        bonusAway: 0,
      },
    };
    expect(isConfirmedForStandings(m)).toBe(false);
  });

  it("returns false for PLAYOFF phase match (CONFIRMED)", () => {
    const m = makeMatch("p1", "p2", "HOME_WIN", 10, 5, { phase: "PLAYOFF" });
    expect(isConfirmedForStandings(m)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Basic standings: REPORTED and CONFIRMED count; SCHEDULED/DISPUTED do not
// Hito 15: REPORTED is the new active status — counts immediately.
// ---------------------------------------------------------------------------

describe("computeStandings — REPORTED and CONFIRMED count (Hito 15)", () => {
  it("empty match list returns empty standings", () => {
    expect(computeStandings([], makeConfig())).toEqual([]);
  });

  it("REPORTED match counts for the table (new flow, Hito 15)", () => {
    const reported = makeMatch("p1", "p2", "HOME_WIN", 10, 5, {
      status: "REPORTED",
    });
    const standings = computeStandings([reported], makeConfig());
    // REPORTED now counts — p1 and p2 should appear.
    expect(standings).toHaveLength(2);
    const p1 = standings.find((r) => r.playerId === "p1")!;
    expect(p1.wins).toBe(1);
    expect(p1.points).toBe(3);
  });

  it("CONFIRMED match counts for the table (legacy compatibility)", () => {
    const confirmed = hw("p1", "p2", 10, 5);
    const standings = computeStandings([confirmed], makeConfig());
    expect(standings).toHaveLength(2);
  });

  it("DISPUTED matches do not affect the table (legacy — not gated)", () => {
    const disputed = makeMatch("p1", "p2", "HOME_WIN", 10, 5, {
      status: "DISPUTED",
    });
    const standings = computeStandings([disputed], makeConfig());
    expect(standings).toEqual([]);
  });

  it("SCHEDULED matches do not affect the table (no result)", () => {
    const scheduled = makeMatch("p1", "p2", "HOME_WIN", 10, 5, {
      status: "SCHEDULED",
    });
    const standings = computeStandings([scheduled], makeConfig());
    expect(standings).toEqual([]);
  });

  it("PLAYOFF matches do not count for league standings", () => {
    const playoff = makeMatch("p1", "p2", "HOME_WIN", 10, 5, {
      phase: "PLAYOFF",
    });
    const standings = computeStandings([playoff], makeConfig());
    expect(standings).toEqual([]);
  });

  it("a mix: REPORTED and CONFIRMED both count, SCHEDULED and DISPUTED do not", () => {
    const confirmed = hw("p1", "p2", 10, 5); // status CONFIRMED by default
    const reported = makeMatch("p1", "p3", "HOME_WIN", 10, 5, {
      status: "REPORTED",
    });
    const scheduled = makeMatch("p2", "p3", "HOME_WIN", 10, 5, {
      status: "SCHEDULED",
    });
    const standings = computeStandings(
      [confirmed, reported, scheduled],
      makeConfig()
    );
    // p1 appears in both confirmed+reported; p2 in confirmed; p3 in reported; scheduled excluded.
    const ids = standings.map((r) => r.playerId).sort();
    expect(ids).toEqual(["p1", "p2", "p3"]);
    // p1 wins both matches → 2 wins, 6 pts.
    const p1 = standings.find((r) => r.playerId === "p1")!;
    expect(p1.wins).toBe(2);
    expect(p1.played).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Points accumulation
// ---------------------------------------------------------------------------

describe("computeStandings — points accumulation", () => {
  it("win awards pointsWin, loss awards pointsLoss", () => {
    const standings = computeStandings([hw("p1", "p2")], makeConfig());
    const p1 = standings.find((r) => r.playerId === "p1")!;
    const p2 = standings.find((r) => r.playerId === "p2")!;
    expect(p1.points).toBe(3);
    expect(p2.points).toBe(0);
  });

  it("draw awards pointsDraw to both players", () => {
    const standings = computeStandings([dr("p1", "p2")], makeConfig());
    const p1 = standings.find((r) => r.playerId === "p1")!;
    const p2 = standings.find((r) => r.playerId === "p2")!;
    expect(p1.points).toBe(1);
    expect(p2.points).toBe(1);
  });

  it("bonus points are added to league points", () => {
    const m = makeMatch("p1", "p2", "HOME_WIN", 20, 5, {
      bonusHome: 1,
      bonusAway: 0,
    });
    const standings = computeStandings([m], makeConfig());
    const p1 = standings.find((r) => r.playerId === "p1")!;
    expect(p1.points).toBe(4); // 3 (win) + 1 (bonus)
  });

  it("away win + bonus combo is correct", () => {
    const m = makeMatch("p1", "p2", "AWAY_WIN", 5, 20, {
      bonusHome: 0,
      bonusAway: 2,
    });
    const standings = computeStandings([m], makeConfig());
    const p2 = standings.find((r) => r.playerId === "p2")!;
    expect(p2.points).toBe(5); // 3 (win) + 2 (bonus)
    const p1 = standings.find((r) => r.playerId === "p1")!;
    expect(p1.points).toBe(0); // loss + 0 bonus
  });

  it("custom pointsWin/Draw/Loss are respected", () => {
    const config = makeConfig({ pointsWin: 5, pointsDraw: 2, pointsLoss: 1 });
    const m = dr("p1", "p2");
    const standings = computeStandings([m], config);
    const p1 = standings.find((r) => r.playerId === "p1")!;
    expect(p1.points).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Stats: played, wins, draws, losses, vpFor, vpAgainst, vpDiff
// ---------------------------------------------------------------------------

describe("computeStandings — stat counters", () => {
  it("records played, wins, draws, losses correctly", () => {
    const matches = [
      hw("p1", "p2"), // p1 win, p2 loss
      dr("p1", "p3"), // p1 draw, p3 draw
      aw("p4", "p1"), // p4 loss, p1 win (p1 is home)
    ];
    const standings = computeStandings(matches, makeConfig());
    const p1 = standings.find((r) => r.playerId === "p1")!;
    expect(p1.played).toBe(3);
    expect(p1.wins).toBe(2);
    expect(p1.draws).toBe(1);
    expect(p1.losses).toBe(0);
  });

  it("VP accumulation is correct", () => {
    const matches = [
      makeMatch("p1", "p2", "HOME_WIN", 10, 5),
      makeMatch("p1", "p3", "HOME_WIN", 12, 4),
    ];
    const standings = computeStandings(matches, makeConfig());
    const p1 = standings.find((r) => r.playerId === "p1")!;
    expect(p1.vpFor).toBe(22);
    expect(p1.vpAgainst).toBe(9);
    expect(p1.vpDiff).toBe(13);
  });

  it("away player VP are correctly attributed", () => {
    const m = makeMatch("p1", "p2", "AWAY_WIN", 5, 15);
    const standings = computeStandings([m], makeConfig());
    const p2 = standings.find((r) => r.playerId === "p2")!;
    expect(p2.vpFor).toBe(15);
    expect(p2.vpAgainst).toBe(5);
    expect(p2.vpDiff).toBe(10);
  });
});

// ---------------------------------------------------------------------------
// Tiebreaker: POINTS (primary)
// ---------------------------------------------------------------------------

describe("computeStandings — order by points", () => {
  it("higher points ranks first", () => {
    // p1: 3 pts (win), p2: 0 pts (loss), p3: 1 pt each side (draw)
    const matches = [
      hw("p1", "p2"),
      dr("p3", "p4"),
    ];
    const standings = computeStandings(matches, makeConfig());
    expect(standings[0].playerId).toBe("p1");
    expect(standings[0].rank).toBe(1);
  });

  it("three players with different points are ranked correctly", () => {
    // p1 wins both → 6 pts
    // p2 wins one, loses one → 3 pts
    // p3 loses both → 0 pts
    const matches = [
      hw("p1", "p2"),
      hw("p1", "p3"),
      hw("p2", "p3"),
    ];
    const standings = computeStandings(matches, makeConfig());
    const order = standings.map((r) => r.playerId);
    expect(order).toEqual(["p1", "p2", "p3"]);
  });
});

// ---------------------------------------------------------------------------
// Tiebreaker: VP_DIFF
// ---------------------------------------------------------------------------

describe("computeStandings — tiebreaker VP_DIFF", () => {
  it("when points are equal, higher VP diff ranks first", () => {
    // p1 and p2 both have 3 pts (win each).
    // p1 wins 10-2 → diff +8
    // p2 wins 6-5 → diff +1
    const matches = [
      makeMatch("p1", "p3", "HOME_WIN", 10, 2), // p1 wins, diff +8
      makeMatch("p2", "p4", "HOME_WIN", 6, 5),  // p2 wins, diff +1
    ];
    const config = makeConfig({ playoffSize: 1 });
    const standings = computeStandings(matches, config);
    // p1 should rank above p2
    const p1rank = standings.find((r) => r.playerId === "p1")!.rank;
    const p2rank = standings.find((r) => r.playerId === "p2")!.rank;
    expect(p1rank).toBeLessThan(p2rank);
  });
});

// ---------------------------------------------------------------------------
// Tiebreaker: VP_FOR
// ---------------------------------------------------------------------------

describe("computeStandings — tiebreaker VP_FOR", () => {
  it("when points and VP diff are equal, higher VP for ranks first", () => {
    // p1 and p2 both win with the same margin but p1 scored more.
    // p1: 10-0 (+10 diff, 10 VP for)
    // p2:  8-? but same diff would need equal diff scenario
    // Easier: same diff by different absolute values.
    // p1 wins 12-4 → diff +8, VP for 12
    // p2 wins 10-2 → diff +8, VP for 10
    // But they play different opponents, so equal points.
    const matches = [
      makeMatch("p1", "p3", "HOME_WIN", 12, 4),
      makeMatch("p2", "p4", "HOME_WIN", 10, 2),
    ];
    const standings = computeStandings(matches, makeConfig());
    const p1rank = standings.find((r) => r.playerId === "p1")!.rank;
    const p2rank = standings.find((r) => r.playerId === "p2")!.rank;
    expect(p1rank).toBeLessThan(p2rank);
  });
});

// ---------------------------------------------------------------------------
// Tiebreaker: HEAD_TO_HEAD
// ---------------------------------------------------------------------------

describe("computeStandings — tiebreaker HEAD_TO_HEAD", () => {
  it("head-to-head winner ranks above when all aggregated criteria are equal", () => {
    // p1 and p2 both beat p3 with identical scores, and p1 beat p2 in h2h.
    // Result: p1 > p2 > p3.

    // Setup: all three play each other. p1 > p2 in h2h.
    // We craft it so p1 and p2 have equal aggregate points, vpDiff, vpFor.

    // p1 beats p2: 10-5 (p1 wins, +3 pts each side: p1 +3, p2 +0)
    // p2 beats p3: 10-5 (+3 pts)
    // p1 beats p3: 10-5 (+3 pts)
    // After above: p1=6, p2=3, p3=0 — not equal, skip.

    // Simpler: p1 beats p2 h2h. p1 loses to p3 and p2 loses to p3.
    // Crafted so p1 and p2 end up with same aggregate points and vpDiff and vpFor,
    // but p1 beat p2.
    // p1 vs p2: p1 wins 10-5 (p1: +3pts, +5diff; p2: +0pts, -5diff)
    // p3 vs p1: p3 wins 15-10 (p1: +0pts, -5diff; p3: +3pts)
    // p3 vs p2: p3 wins 15-10 (p2: +0pts, -5diff; p3: +3pts)
    // Aggregate:
    //   p1: 3pts, vpFor=20, vpAgainst=20, diff=0
    //   p2: 0pts
    // Not equal. h2h tiebreaker needs equal aggregate criteria first.

    // To trigger h2h we need to force equal POINTS, VP_DIFF and VP_FOR first.
    // Use a config that only has HEAD_TO_HEAD (skip POINTS for this test by
    // ensuring equal points) or use tiebreakers that start with HEAD_TO_HEAD.
    // Simplest: configure tiebreakers to HEAD_TO_HEAD first.
    const config = makeConfig({
      tiebreakers: '["HEAD_TO_HEAD","ID_ORDER"]',
    });

    // p1 beats p2 (p1 ranked above p2 in h2h).
    const m1 = makeMatch("p1", "p2", "HOME_WIN", 10, 5);
    const standings = computeStandings([m1], config);
    const p1rank = standings.find((r) => r.playerId === "p1")!.rank;
    const p2rank = standings.find((r) => r.playerId === "p2")!.rank;
    expect(p1rank).toBeLessThan(p2rank);
  });

  it("h2h draw: no winner in h2h falls through to next criterion", () => {
    // p1 and p2 draw in h2h → tied on h2h, falls through to ID_ORDER.
    const config = makeConfig({
      tiebreakers: '["HEAD_TO_HEAD","ID_ORDER"]',
    });
    const m1 = makeMatch("p1", "p2", "DRAW", 8, 8);
    const standings = computeStandings([m1], config);
    // Should not crash; both players ranked, stable by ID_ORDER.
    expect(standings).toHaveLength(2);
  });

  it("h2h comparison: player who won direct match ranks above in full standings", () => {
    // Scenario: 4 players in a round-robin where p1 and p2 are tied on
    // POINTS and VP_DIFF and VP_FOR, but p1 beat p2 head-to-head.
    //
    // Design:
    //   p1 vs p2: p1 wins 10-5 (p1 +3pts, +5vpDiff; p2 +0, -5vpDiff)
    //   p1 vs p3: p3 wins 10-5 (p1 +0pts, -5vpDiff; p3 +3pts)
    //   p2 vs p4: p2 wins 10-5 (p2 +3pts)
    //   p3 vs p4: p4 wins 10-5 (p4 +3pts, p3 +0)
    //
    // Standings:
    //   p1: 3 pts, vpFor=15, vpAgainst=15, vpDiff=0
    //   p2: 3 pts, vpFor=15, vpAgainst=15, vpDiff=0
    //   p3: 3 pts, vpFor=15, vpAgainst=15, vpDiff=0
    //   p4: 3 pts, vpFor=15, vpAgainst=15, vpDiff=0
    // Actually this gives all equal in aggregate — better for h2h test!
    // p1 vs p2: p1 wins → p1 above p2 in h2h.
    // p1 vs p3: p3 wins → p3 above p1 in h2h (irrelevant for p1 vs p2).
    // p2 vs p4: p2 wins → p2 above p4 in h2h.
    // p3 vs p4: p4 wins → p4 above p3 in h2h.
    //
    // The full sort order under [POINTS, VP_DIFF, VP_FOR, HEAD_TO_HEAD, LOSSES, ID_ORDER]:
    // All equal on POINTS, VP_DIFF, VP_FOR → fall through to HEAD_TO_HEAD.
    // For p1 vs p2 pair: p1 won → p1 above p2.

    const matches = [
      makeMatch("p1", "p2", "HOME_WIN", 10, 5),  // p1 beats p2
      makeMatch("p3", "p1", "HOME_WIN", 10, 5),  // p3 beats p1
      makeMatch("p2", "p4", "HOME_WIN", 10, 5),  // p2 beats p4
      makeMatch("p4", "p3", "HOME_WIN", 10, 5),  // p4 beats p3
    ];

    const config = makeConfig({
      tiebreakers: '["POINTS","VP_DIFF","VP_FOR","HEAD_TO_HEAD","LOSSES","ID_ORDER"]',
    });
    const standings = computeStandings(matches, config);

    // p1 must rank above p2 (p1 beat p2 in h2h; all other criteria equal).
    const p1rank = standings.find((r) => r.playerId === "p1")!.rank;
    const p2rank = standings.find((r) => r.playerId === "p2")!.rank;
    expect(p1rank).toBeLessThan(p2rank);
  });
});

// ---------------------------------------------------------------------------
// Tiebreaker: LOSSES
// ---------------------------------------------------------------------------

describe("computeStandings — tiebreaker LOSSES", () => {
  it("fewer losses ranks higher when other criteria equal", () => {
    // Use tiebreakers that include LOSSES before ID_ORDER.
    const config = makeConfig({
      tiebreakers: '["LOSSES","ID_ORDER"]',
    });
    // p1: 1 loss (vs p3)
    // p2: 2 losses (vs p3 and p4)
    const matches = [
      makeMatch("p3", "p1", "HOME_WIN", 5, 5),  // p1 loses
      makeMatch("p3", "p2", "HOME_WIN", 5, 5),  // p2 loses
      makeMatch("p4", "p2", "HOME_WIN", 5, 5),  // p2 loses again
    ];
    const standings = computeStandings(matches, config);
    const p1rank = standings.find((r) => r.playerId === "p1")!.rank;
    const p2rank = standings.find((r) => r.playerId === "p2")!.rank;
    expect(p1rank).toBeLessThan(p2rank);
  });
});

// ---------------------------------------------------------------------------
// Tiebreaker: ID_ORDER (deterministic final)
// ---------------------------------------------------------------------------

describe("computeStandings — deterministic final tiebreaker ID_ORDER", () => {
  it("two players tied on everything are separated deterministically by playerId", () => {
    // p1 and p2 never played each other → no h2h. Both have identical stats.
    // p1 beats p3; p2 beats p4 — same score, same margins.
    const matches = [
      makeMatch("p1", "p3", "HOME_WIN", 10, 5),
      makeMatch("p2", "p4", "HOME_WIN", 10, 5),
    ];
    const standings = computeStandings(matches, makeConfig());
    // Both have 3 pts, +5 vpDiff, 10 vpFor, no h2h.
    // ID_ORDER: "p1" < "p2" lexicographically → p1 ranks first.
    const p1rank = standings.find((r) => r.playerId === "p1")!.rank;
    const p2rank = standings.find((r) => r.playerId === "p2")!.rank;
    expect(p1rank).toBeLessThan(p2rank);
  });

  it("order is stable and reproducible regardless of input array order", () => {
    const m1 = makeMatch("p2", "p4", "HOME_WIN", 10, 5);
    const m2 = makeMatch("p1", "p3", "HOME_WIN", 10, 5);
    // Call with reversed order of matches
    const standings1 = computeStandings([m1, m2], makeConfig());
    const standings2 = computeStandings([m2, m1], makeConfig());
    expect(standings1.map((r) => r.playerId)).toEqual(
      standings2.map((r) => r.playerId)
    );
  });
});

// ---------------------------------------------------------------------------
// Tiebreaker order changes the result
// ---------------------------------------------------------------------------

describe("computeStandings — tiebreaker order matters", () => {
  it("changing tiebreaker order changes the relative ranking of tied players", () => {
    // Scenario: pb beat pa in their direct match (h2h winner = pb).
    // Lexicographically pa < pb, so ID_ORDER winner = pa.
    // When HEAD_TO_HEAD comes before ID_ORDER → pb ranks 1.
    // When ID_ORDER comes before HEAD_TO_HEAD → pa ranks 1.
    // This proves that the tiebreaker order genuinely changes the outcome.

    const singleH2HPa = [makeMatch("pb", "pa", "HOME_WIN", 10, 5)];

    // Config A: HEAD_TO_HEAD first — pb (h2h winner) ranks 1.
    const sH2h = computeStandings(
      singleH2HPa,
      makeConfig({ tiebreakers: '["HEAD_TO_HEAD","ID_ORDER"]' })
    );
    expect(sH2h.find((r) => r.playerId === "pb")!.rank).toBe(1);
    expect(sH2h.find((r) => r.playerId === "pa")!.rank).toBe(2);

    // Config B: ID_ORDER first — pa (lexicographically smaller) ranks 1.
    const sId = computeStandings(
      singleH2HPa,
      makeConfig({ tiebreakers: '["ID_ORDER","HEAD_TO_HEAD"]' })
    );
    expect(sId.find((r) => r.playerId === "pa")!.rank).toBe(1);
    expect(sId.find((r) => r.playerId === "pb")!.rank).toBe(2);
  });

  it("VP_FOR before HEAD_TO_HEAD vs HEAD_TO_HEAD first produce different results", () => {
    // pa beats pb with modest VPs (h2h winner = pa).
    // pb beats a separate opponent with massive VPs (more total VP_FOR than pa).
    // So: pa won h2h, but pb has more overall VP_FOR.
    //
    // pa vs pb: pa wins 6-4  → pa: +3pts, vpFor=6; pb: +0pts, vpFor=4
    // pb vs pc: pb wins 20-0 → pb: +3pts, vpFor=24 total; pc: 0 pts
    // pa vs pc: pa wins 10-0 → pa: +3pts, vpFor=16 total; pc: 0 pts
    //
    // Totals:
    //   pa: 6pts, vpFor=16, vpAgainst=4, vpDiff=+12
    //   pb: 3pts, vpFor=24, vpAgainst=6, vpDiff=+18
    // Different POINTS — POINTS criterion separates them first. Not ideal.
    //
    // Use tiebreakers starting at VP_FOR and HEAD_TO_HEAD, skipping POINTS:
    // This tests the criterion ordering in isolation.
    //
    // Scenario: pa vs pb only (single match, pa wins 5-20).
    // pa wins → h2h: pa > pb. But pb scores more VP (20 vs 5).
    // VP_FOR: pb=20 > pa=5 → pb ranks above pa.
    // HEAD_TO_HEAD: pa won → pa ranks above pb.
    //
    // Config VP_FOR first → pb ranks 1.
    // Config H2H first → pa ranks 1.

    // TRUE DIVERGING CASE:
    // pa wins h2h with fewer VP_FOR.
    // pa beats pb: 6-20 — wait, HOME_WIN means home wins, so pa wins with 6 VP and pb gets 20 VP?
    // In W40k, the outcome is explicit: HOME_WIN means home player won even if their VP is lower
    // (mission rules). So:
    const divergingMatch = [makeMatch("pa", "pb", "HOME_WIN", 6, 20)];
    // HOME_WIN: pa wins (h2h winner = pa). vpFor: pa=6, pb=20.
    // VP_FOR: pb=20 > pa=6 → VP_FOR tiebreaker favors pb.
    // HEAD_TO_HEAD: pa won → H2H tiebreaker favors pa.

    const configVpFirst = makeConfig({
      tiebreakers: '["VP_FOR","HEAD_TO_HEAD","ID_ORDER"]',
    });
    const configH2hFirst = makeConfig({
      tiebreakers: '["HEAD_TO_HEAD","VP_FOR","ID_ORDER"]',
    });

    const sVp = computeStandings(divergingMatch, configVpFirst);
    // VP_FOR first: pb has more VP_FOR → pb ranks 1.
    expect(sVp.find((r) => r.playerId === "pb")!.rank).toBe(1);

    const sH2h = computeStandings(divergingMatch, configH2hFirst);
    // HEAD_TO_HEAD first: pa won → pa ranks 1.
    expect(sH2h.find((r) => r.playerId === "pa")!.rank).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Playoff zone
// ---------------------------------------------------------------------------

describe("computeStandings — playoff zone", () => {
  it("marks top N players as inPlayoffZone", () => {
    const matches = [
      makeMatch("p1", "p2", "HOME_WIN", 10, 5),
      makeMatch("p1", "p3", "HOME_WIN", 10, 5),
      makeMatch("p1", "p4", "HOME_WIN", 10, 5),
      makeMatch("p2", "p3", "HOME_WIN", 10, 5),
      makeMatch("p2", "p4", "HOME_WIN", 10, 5),
      makeMatch("p3", "p4", "HOME_WIN", 10, 5),
    ];
    const config = makeConfig({ playoffSize: 2 });
    const standings = computeStandings(matches, config);
    const inZone = standings.filter((r) => r.inPlayoffZone);
    expect(inZone).toHaveLength(2);
    // The top 2 should be in zone.
    expect(standings[0].inPlayoffZone).toBe(true);
    expect(standings[1].inPlayoffZone).toBe(true);
    expect(standings[2].inPlayoffZone).toBe(false);
    expect(standings[3].inPlayoffZone).toBe(false);
  });

  it("inPlayoffZone = false for rank > playoffSize", () => {
    const m = hw("p1", "p2");
    const config = makeConfig({ playoffSize: 1 });
    const standings = computeStandings([m], config);
    const p1 = standings.find((r) => r.playerId === "p1")!;
    const p2 = standings.find((r) => r.playerId === "p2")!;
    expect(p1.inPlayoffZone).toBe(true);
    expect(p2.inPlayoffZone).toBe(false);
  });

  it("playoffSize larger than total players: all players in zone", () => {
    const m = hw("p1", "p2");
    const config = makeConfig({ playoffSize: 10 });
    const standings = computeStandings([m], config);
    expect(standings.every((r) => r.inPlayoffZone)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// playerIds parameter: explicit player list includes 0-match players
// ---------------------------------------------------------------------------

describe("computeStandings — explicit playerIds", () => {
  it("includes players with no confirmed matches when playerIds is provided", () => {
    const m = hw("p1", "p2");
    // p3 has no matches.
    const standings = computeStandings([m], makeConfig(), ["p1", "p2", "p3"]);
    const ids = standings.map((r) => r.playerId).sort();
    expect(ids).toContain("p3");
    const p3 = standings.find((r) => r.playerId === "p3")!;
    expect(p3.played).toBe(0);
    expect(p3.points).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Rank assignments
// ---------------------------------------------------------------------------

describe("computeStandings — rank field", () => {
  it("ranks are 1-based and sequential", () => {
    const matches = [hw("p1", "p2"), hw("p2", "p3"), hw("p3", "p1")];
    const standings = computeStandings(matches, makeConfig());
    const ranks = standings.map((r) => r.rank).sort((a, b) => a - b);
    expect(ranks).toEqual([1, 2, 3]);
  });

  it("winner has rank 1", () => {
    // p1 wins everything → rank 1.
    const matches = [
      hw("p1", "p2"),
      hw("p1", "p3"),
      hw("p2", "p3"),
    ];
    const standings = computeStandings(matches, makeConfig());
    expect(standings.find((r) => r.playerId === "p1")!.rank).toBe(1);
    expect(standings.find((r) => r.playerId === "p3")!.rank).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// H2H 3-player cycle — documents ordering behaviour (Hito 10 deuda)
// ---------------------------------------------------------------------------

describe("computeStandings — H2H 3-player cycle", () => {
  /**
   * When 3 players form an H2H cycle (A beat B, B beat C, C beat A) AND
   * are tied on all preceding criteria (points, vpDiff, vpFor), the
   * bilateral H2H comparator produces non-transitive results:
   *   compare(p1, p2) → p1 wins (H2H: p1 beat p2)
   *   compare(p2, p3) → p2 wins (H2H: p2 beat p3)
   *   compare(p1, p3) → p3 wins (H2H: p3 beat p1)
   *
   * JavaScript's Array.sort is free to produce any result under a
   * non-transitive comparator. In practice, V8's TimSort produces a
   * deterministic output for a given input order, but it is NOT guaranteed
   * to be lexicographic by ID (ID_ORDER is never reached via bilateral H2H
   * because each pair IS distinguished — just not transitively).
   *
   * This test documents this known limitation and the stable observable
   * behaviour: the same inputs always produce the same output in this runtime.
   * See Hito 8 notes and Hito 10 for context.
   */
  it("produces a consistent order for a given input order when H2H forms a 3-way cycle", () => {
    // All players: 1 win, 1 loss, equal VP (60 for, 60 against) on global stats.
    // p1 beats p2, p2 beats p3, p3 beats p1 — classic cycle.
    const matches = [
      makeMatch("p1", "p2", "HOME_WIN", 60, 40),
      makeMatch("p2", "p3", "HOME_WIN", 60, 40),
      makeMatch("p3", "p1", "HOME_WIN", 60, 40),
    ];

    const config = makeConfig({
      tiebreakers:
        '["POINTS","VP_DIFF","VP_FOR","HEAD_TO_HEAD","LOSSES","ID_ORDER"]',
    });

    const standings = computeStandings(matches, config);

    // All 3 players must appear exactly once.
    const ids = standings.map((r) => r.playerId).sort();
    expect(ids).toEqual(["p1", "p2", "p3"]);

    // Each player has: played=2, wins=1, losses=1, points=3, vpDiff=0.
    // (Note: only 2 matches counted per player in the cycle above.)
    for (const row of standings) {
      expect(row.played).toBe(2);
      expect(row.wins).toBe(1);
      expect(row.losses).toBe(1);
      expect(row.points).toBe(3);
      expect(row.vpDiff).toBe(0);
    }

    // The exact order is runtime-deterministic (same inputs → same output).
    const order1 = computeStandings(matches, config).map((r) => r.playerId);
    const order2 = computeStandings(matches, config).map((r) => r.playerId);
    expect(order1).toEqual(order2);
  });

  it("non-cycle H2H correctly distinguishes players (p1 beats both, p2 beats p3)", () => {
    // p1 beats p2 AND p3; p2 beats p3. Clear ordering: p1 > p2 > p3.
    // All players have same vpDiff=0 if we make it symmetric VP:
    // p1: 2 wins (60–40 each) → vpFor=120, vpAgainst=80, vpDiff=40
    // p2: 1 win, 1 loss → vpFor=80, vpAgainst=80... wait, let's make equal vpDiff:
    // Use results with symmetrical VP to force H2H as the deciding criterion.
    const symMatches = [
      makeMatch("p1", "p2", "HOME_WIN", 50, 50), // same VP but p1 wins H2H
      makeMatch("p1", "p3", "HOME_WIN", 50, 50),
      makeMatch("p2", "p3", "HOME_WIN", 50, 50),
    ];
    // After these: p1=6pts, p2=3pts, p3=0pts → POINTS already distinguishes.
    // Use tie scenario:
    const tieMatches = [
      makeMatch("p1", "p2", "HOME_WIN", 60, 60), // p1 wins, same VP
      makeMatch("p2", "p3", "HOME_WIN", 60, 60), // p2 wins, same VP
      makeMatch("p1", "p3", "AWAY_WIN", 60, 60), // p3 wins!
    ];
    // p1: 1 win vs p2, 1 loss vs p3 → 3pts; p2: 1 win vs p3, 1 loss vs p1 → 3pts;
    // p3: 1 win vs p1, 1 loss vs p2 → 3pts. vpDiff=0 for all. H2H cycle again.
    // Instead, let's just test the non-cycle directly:
    const clearMatches = [
      makeMatch("p1", "p2", "HOME_WIN", 60, 40),
      makeMatch("p1", "p3", "HOME_WIN", 60, 40),
      makeMatch("p2", "p3", "HOME_WIN", 60, 40),
    ];
    const config = makeConfig();
    const standings = computeStandings(clearMatches, config);
    // p1 wins both → rank 1; p3 loses both → rank 3.
    expect(standings[0].playerId).toBe("p1");
    expect(standings[2].playerId).toBe("p3");
    expect(standings[1].playerId).toBe("p2");
    void symMatches; void tieMatches; // suppress unused variable warning
  });
});

// ---------------------------------------------------------------------------
// AC-27: la clasificación distingue las saldadas (Hito 7, SPEC §4.6/§8)
// "un jugador con 11 partidas de las que 2 son WALKOVER/UNPLAYED_DRAW
// muestra «PJ 11 (2 saldadas)»".
// ---------------------------------------------------------------------------

describe("AC-27: computeStandings cuenta las saldadas junto a las jugadas", () => {
  it("11 partidas confirmadas con 1 WALKOVER y 1 UNPLAYED_DRAW dan played=11, settled=2", () => {
    const matches: StandingsMatch[] = [];
    for (let i = 0; i < 9; i++) {
      matches.push(
        makeMatch("p1", `opp${i}`, "HOME_WIN", 45, 30, {
          status: "REPORTED",
          resolution: "PLAYED",
        })
      );
    }
    matches.push(
      makeMatch("p1", "oppWalkover", "HOME_WIN", 80, 0, {
        status: "REPORTED",
        resolution: "WALKOVER",
      })
    );
    matches.push(
      makeMatch("p1", "oppUnplayed", "DRAW", 0, 0, {
        status: "REPORTED",
        resolution: "UNPLAYED_DRAW",
      })
    );

    const standings = computeStandings(matches, makeConfig());
    const p1 = standings.find((r) => r.playerId === "p1")!;
    expect(p1.played).toBe(11);
    expect(p1.settled).toBe(2);
  });

  it("una partida sin resolution explícito cuenta como jugada (default PLAYED, Hito 1)", () => {
    // No `opts.resolution` at all — mirrors a Result row created before this
    // hito, where the DB default fills PLAYED.
    const matches = [makeMatch("p1", "p2", "HOME_WIN", 10, 5, { status: "REPORTED" })];
    const standings = computeStandings(matches, makeConfig());
    const p1 = standings.find((r) => r.playerId === "p1")!;
    expect(p1.played).toBe(1);
    expect(p1.settled).toBe(0);
  });

  it("cero saldadas: settled es 0, no negativo ni indefinido", () => {
    const matches = [
      makeMatch("p1", "p2", "HOME_WIN", 10, 5, {
        status: "REPORTED",
        resolution: "PLAYED",
      }),
    ];
    const standings = computeStandings(matches, makeConfig());
    expect(standings.find((r) => r.playerId === "p1")!.settled).toBe(0);
  });
});

describe("AC-27: formatPlayedCount — texto de PJ con saldadas", () => {
  it('con settled=2 devuelve "11 (2 saldadas)"', () => {
    expect(formatPlayedCount(11, 2)).toBe("11 (2 saldadas)");
  });

  it('con settled=1 usa el singular: "5 (1 saldada)"', () => {
    expect(formatPlayedCount(5, 1)).toBe("5 (1 saldada)");
  });

  it("con settled=0 no muestra paréntesis vacío ni «(0 saldadas)»", () => {
    const text = formatPlayedCount(11, 0);
    expect(text).toBe("11");
    expect(text).not.toContain("(");
  });
});

// ---------------------------------------------------------------------------
// AC-28: computeStandings procesa WALKOVER/UNPLAYED_DRAW sin ninguna rama
// especial (Hito 7, SPEC §4.6/§8). Puntos, VP y desempates idénticos a un
// PLAYED con los mismos números.
// ---------------------------------------------------------------------------

describe("AC-28: computeStandings sin ramas especiales por resolution", () => {
  /**
   * Builds a full two-match standings scenario where p1's own match uses
   * `resolution`, and a second, unrelated match (p3 vs p4) provides an
   * identical shape so both scenarios below are self-consistent and directly
   * comparable player-by-player — including `rank`, not just the raw stats.
   */
  function buildScenario(resolution: string) {
    const matches = [
      makeMatch("p1", "p2", "HOME_WIN", 80, 0, {
        status: "REPORTED",
        resolution,
      }),
      makeMatch("p3", "p4", "HOME_WIN", 50, 45, {
        status: "REPORTED",
        resolution: "PLAYED",
      }),
    ];
    return computeStandings(matches, makeConfig(), ["p1", "p2", "p3", "p4"]);
  }

  it("un 80-0 WALKOVER da los mismos puntos, VP, diferencia y posición que un 80-0 PLAYED", () => {
    const played = buildScenario("PLAYED");
    const walkover = buildScenario("WALKOVER");
    const p1played = played.find((r) => r.playerId === "p1")!;
    const p1walkover = walkover.find((r) => r.playerId === "p1")!;

    expect(p1walkover.points).toBe(p1played.points);
    expect(p1walkover.wins).toBe(p1played.wins);
    expect(p1walkover.vpFor).toBe(p1played.vpFor);
    expect(p1walkover.vpAgainst).toBe(p1played.vpAgainst);
    expect(p1walkover.vpDiff).toBe(p1played.vpDiff);
    expect(p1walkover.rank).toBe(p1played.rank);
  });

  it("un 0-0 UNPLAYED_DRAW da los mismos puntos, VP, diferencia y posición que un 0-0 PLAYED", () => {
    function buildDrawScenario(resolution: string) {
      const matches = [
        makeMatch("p1", "p2", "DRAW", 0, 0, { status: "REPORTED", resolution }),
        makeMatch("p3", "p4", "HOME_WIN", 50, 45, {
          status: "REPORTED",
          resolution: "PLAYED",
        }),
      ];
      return computeStandings(matches, makeConfig(), ["p1", "p2", "p3", "p4"]);
    }
    const played = buildDrawScenario("PLAYED");
    const unplayedDraw = buildDrawScenario("UNPLAYED_DRAW");
    const p1played = played.find((r) => r.playerId === "p1")!;
    const p1unplayed = unplayedDraw.find((r) => r.playerId === "p1")!;

    expect(p1unplayed.points).toBe(p1played.points);
    expect(p1unplayed.draws).toBe(p1played.draws);
    expect(p1unplayed.vpFor).toBe(p1played.vpFor);
    expect(p1unplayed.vpAgainst).toBe(p1played.vpAgainst);
    expect(p1unplayed.vpDiff).toBe(p1played.vpDiff);
    expect(p1unplayed.rank).toBe(p1played.rank);
  });

  it("un resolution desconocido no cambia la aritmética (regresión: ninguna rama debe leer resolution ahí)", () => {
    // A value that is not PLAYED/WALKOVER/UNPLAYED_DRAW at all. If the
    // scoring loop ever grew a branch keyed on `resolution` (e.g. an
    // exhaustive switch with special cases per value, or a stray `if
    // (resolution === "WALKOVER") bonus += X`), an unrecognized string would
    // be the first thing to expose it — either by falling into a default
    // branch that zeroes something out, or by an added special case simply
    // not covering it. Today `resolution` is read in exactly one place (the
    // settled tally), so this must score identically to PLAYED.
    const matches = [
      makeMatch("p1", "p2", "HOME_WIN", 45, 40, {
        status: "REPORTED",
        resolution: "PLAYED",
      }),
      makeMatch("p3", "p4", "HOME_WIN", 45, 40, {
        status: "REPORTED",
        resolution: "NOT_A_REAL_RESOLUTION_VALUE",
      }),
    ];
    const standings = computeStandings(matches, makeConfig());
    const p1 = standings.find((r) => r.playerId === "p1")!;
    const p3 = standings.find((r) => r.playerId === "p3")!;
    expect(p3.points).toBe(p1.points);
    expect(p3.wins).toBe(p1.wins);
    expect(p3.vpFor).toBe(p1.vpFor);
    expect(p3.vpAgainst).toBe(p1.vpAgainst);
    expect(p3.vpDiff).toBe(p1.vpDiff);
  });
});
