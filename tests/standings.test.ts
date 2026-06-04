// Tests for computeStandings — SPEC §7.3, Hito 8.
// Pure unit tests: no DB, no Next.js context.

import { describe, it, expect } from "vitest";
import {
  computeStandings,
  isConfirmedForStandings,
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
  } = {}
): StandingsMatch {
  return {
    id: `match-${++matchCounter}`,
    status: opts.status ?? "CONFIRMED",
    phase: opts.phase ?? "LEAGUE",
    playerHomeId: homeId,
    playerAwayId: awayId,
    result:
      opts.status === "SCHEDULED" || opts.status === "REPORTED" || opts.status === "DISPUTED"
        ? null
        : {
            homeVictoryPoints: homeVP,
            awayVictoryPoints: awayVP,
            outcome,
            bonusHome: opts.bonusHome ?? 0,
            bonusAway: opts.bonusAway ?? 0,
          },
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
// isConfirmedForStandings
// ---------------------------------------------------------------------------

describe("isConfirmedForStandings", () => {
  it("returns true for CONFIRMED LEAGUE match with result", () => {
    const m = hw("p1", "p2");
    expect(isConfirmedForStandings(m)).toBe(true);
  });

  it("returns false for REPORTED match", () => {
    const m = makeMatch("p1", "p2", "HOME_WIN", 10, 5, { status: "REPORTED" });
    expect(isConfirmedForStandings(m)).toBe(false);
  });

  it("returns false for DISPUTED match", () => {
    const m = makeMatch("p1", "p2", "HOME_WIN", 10, 5, { status: "DISPUTED" });
    expect(isConfirmedForStandings(m)).toBe(false);
  });

  it("returns false for SCHEDULED match (no result)", () => {
    const m = makeMatch("p1", "p2", "HOME_WIN", 10, 5, {
      status: "SCHEDULED",
    });
    expect(isConfirmedForStandings(m)).toBe(false);
  });

  it("returns false for PLAYOFF phase match", () => {
    const m = makeMatch("p1", "p2", "HOME_WIN", 10, 5, { phase: "PLAYOFF" });
    expect(isConfirmedForStandings(m)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Basic standings: only CONFIRMED results count
// ---------------------------------------------------------------------------

describe("computeStandings — only CONFIRMED results count", () => {
  it("empty match list returns empty standings", () => {
    expect(computeStandings([], makeConfig())).toEqual([]);
  });

  it("REPORTED matches do not affect the table", () => {
    const reported = makeMatch("p1", "p2", "HOME_WIN", 10, 5, {
      status: "REPORTED",
    });
    const standings = computeStandings([reported], makeConfig());
    expect(standings).toEqual([]);
  });

  it("DISPUTED matches do not affect the table", () => {
    const disputed = makeMatch("p1", "p2", "HOME_WIN", 10, 5, {
      status: "DISPUTED",
    });
    const standings = computeStandings([disputed], makeConfig());
    expect(standings).toEqual([]);
  });

  it("SCHEDULED matches do not affect the table", () => {
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

  it("a mix of statuses counts only CONFIRMED LEAGUE", () => {
    const confirmed = hw("p1", "p2", 10, 5);
    const reported = makeMatch("p1", "p3", "HOME_WIN", 10, 5, {
      status: "REPORTED",
    });
    const standings = computeStandings([confirmed, reported], makeConfig());
    // Only p1 and p2 appear.
    const ids = standings.map((r) => r.playerId).sort();
    expect(ids).toEqual(["p1", "p2"]);
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
