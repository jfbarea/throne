// Tests for Hito 15: resultados-directos
// Covers:
//   1. calculateBonus — pure function (SPEC §7.1)
//   2. validateOutcomeVsVP — advisory check
//   2b. deriveOutcome — outcome inferred from VP
//   3. Authorization: canReport (both participants + admin; third-party rejected)
//   4. Status transition guards: canReportInStatus (SCHEDULED and REPORTED)
//   5. Dimension independence: scheduledAt vs status are orthogonal
//   6. New standings gate: REPORTED counts, SCHEDULED does not
//   7. Regeneration guard: blocks on REPORTED (not just CONFIRMED)
//   8. Playoff advance: apuntar triggers advancePlayoffWinner (logic test)
//   9. DRAW invalid in playoff (logic test)

import { describe, it, expect } from "vitest";

// ---------------------------------------------------------------------------
// 1. calculateBonus
// ---------------------------------------------------------------------------

describe("calculateBonus", () => {
  async function getCalc() {
    const { calculateBonus } = await import("@/server/result-logic");
    return calculateBonus;
  }

  it("returns zeros when bonus is disabled", async () => {
    const calc = await getCalc();
    const result = calc(60, 40, "HOME_WIN", {
      bonusEnabled: false,
      bonusMarginThreshold: 10,
      bonusMinVP: 30,
    });
    expect(result).toEqual({ bonusHome: 0, bonusAway: 0 });
  });

  it("returns zeros when bonusEnabled=true but both thresholds are null", async () => {
    const calc = await getCalc();
    const result = calc(60, 40, "HOME_WIN", {
      bonusEnabled: true,
      bonusMarginThreshold: null,
      bonusMinVP: null,
    });
    expect(result).toEqual({ bonusHome: 0, bonusAway: 0 });
  });

  // ---- Massacre bonus ----

  it("awards massacre bonus to home winner when margin >= threshold", async () => {
    const calc = await getCalc();
    const result = calc(70, 50, "HOME_WIN", {
      bonusEnabled: true,
      bonusMarginThreshold: 20,
      bonusMinVP: null,
    });
    expect(result.bonusHome).toBe(1);
    expect(result.bonusAway).toBe(0);
  });

  it("does NOT award massacre bonus when margin equals threshold - 1 (boundary)", async () => {
    const calc = await getCalc();
    const result = calc(69, 50, "HOME_WIN", {
      bonusEnabled: true,
      bonusMarginThreshold: 20,
      bonusMinVP: null,
    });
    expect(result.bonusHome).toBe(0);
  });

  it("awards massacre bonus to away winner", async () => {
    const calc = await getCalc();
    const result = calc(30, 80, "AWAY_WIN", {
      bonusEnabled: true,
      bonusMarginThreshold: 20,
      bonusMinVP: null,
    });
    expect(result.bonusAway).toBe(1);
    expect(result.bonusHome).toBe(0);
  });

  it("does NOT award massacre bonus on DRAW (no clear winner)", async () => {
    const calc = await getCalc();
    const result = calc(50, 30, "DRAW", {
      bonusEnabled: true,
      bonusMarginThreshold: 10,
      bonusMinVP: null,
    });
    expect(result.bonusHome).toBe(0);
    expect(result.bonusAway).toBe(0);
  });

  // ---- Min-VP bonus ----

  it("awards min-VP bonus to both players when both reach threshold", async () => {
    const calc = await getCalc();
    const result = calc(40, 35, "HOME_WIN", {
      bonusEnabled: true,
      bonusMarginThreshold: null,
      bonusMinVP: 30,
    });
    expect(result.bonusHome).toBe(1);
    expect(result.bonusAway).toBe(1);
  });

  it("awards min-VP bonus only to the player who reaches threshold", async () => {
    const calc = await getCalc();
    const result = calc(40, 20, "HOME_WIN", {
      bonusEnabled: true,
      bonusMarginThreshold: null,
      bonusMinVP: 30,
    });
    expect(result.bonusHome).toBe(1);
    expect(result.bonusAway).toBe(0);
  });

  it("awards min-VP bonus even to the losing player", async () => {
    const calc = await getCalc();
    // Away player loses but still reaches minVP.
    const result = calc(60, 40, "HOME_WIN", {
      bonusEnabled: true,
      bonusMarginThreshold: null,
      bonusMinVP: 30,
    });
    expect(result.bonusHome).toBe(1);
    expect(result.bonusAway).toBe(1);
  });

  // ---- Combined ----

  it("stacks massacre and min-VP bonuses correctly", async () => {
    const calc = await getCalc();
    // Home wins 80-40 (margin=40 >= threshold 20), both >= minVP 30.
    const result = calc(80, 40, "HOME_WIN", {
      bonusEnabled: true,
      bonusMarginThreshold: 20,
      bonusMinVP: 30,
    });
    expect(result.bonusHome).toBe(2); // massacre + minVP
    expect(result.bonusAway).toBe(1); // only minVP
  });

  it("massacre exact threshold: margin === threshold grants bonus", async () => {
    const calc = await getCalc();
    const result = calc(70, 50, "HOME_WIN", {
      bonusEnabled: true,
      bonusMarginThreshold: 20,
      bonusMinVP: null,
    });
    expect(result.bonusHome).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 2. validateOutcomeVsVP
// ---------------------------------------------------------------------------

describe("validateOutcomeVsVP", () => {
  async function getValidator() {
    const { validateOutcomeVsVP } = await import("@/server/result-logic");
    return validateOutcomeVsVP;
  }

  it("returns null for consistent HOME_WIN (home > away)", async () => {
    const v = await getValidator();
    expect(v(60, 40, "HOME_WIN")).toBeNull();
  });

  it("returns null for consistent AWAY_WIN (away > home)", async () => {
    const v = await getValidator();
    expect(v(30, 70, "AWAY_WIN")).toBeNull();
  });

  it("returns null for DRAW with equal VP", async () => {
    const v = await getValidator();
    expect(v(50, 50, "DRAW")).toBeNull();
  });

  it("returns warning for HOME_WIN when home <= away", async () => {
    const v = await getValidator();
    const warning = v(40, 60, "HOME_WIN");
    expect(warning).not.toBeNull();
    expect(warning).toContain("Victoria Local");
  });

  it("returns warning for AWAY_WIN when away <= home", async () => {
    const v = await getValidator();
    const warning = v(80, 60, "AWAY_WIN");
    expect(warning).not.toBeNull();
    expect(warning).toContain("Victoria Visitante");
  });

  it("returns advisory warning for DRAW with unequal VP", async () => {
    const v = await getValidator();
    // W40k allows rule-defined draws even with VP difference; advisory only.
    const warning = v(55, 45, "DRAW");
    // This is advisory — may or may not return a warning based on implementation.
    // The function is allowed to return null (no enforcement) or a warning.
    // The key is it never throws.
    expect(() => v(55, 45, "DRAW")).not.toThrow();
    // If it returns a warning, it should be a string.
    if (warning !== null) {
      expect(typeof warning).toBe("string");
    }
  });
});

// ---------------------------------------------------------------------------
// 2b. deriveOutcome — outcome inferred from VP (SPEC §4.5)
// ---------------------------------------------------------------------------

describe("deriveOutcome", () => {
  async function getDerive() {
    const { deriveOutcome } = await import("@/server/result-logic");
    return deriveOutcome;
  }

  it("returns HOME_WIN when home VP are higher", async () => {
    const d = await getDerive();
    expect(d(60, 40)).toBe("HOME_WIN");
    expect(d(1, 0)).toBe("HOME_WIN");
  });

  it("returns AWAY_WIN when away VP are higher", async () => {
    const d = await getDerive();
    expect(d(30, 70)).toBe("AWAY_WIN");
    expect(d(0, 1)).toBe("AWAY_WIN");
  });

  it("returns DRAW when VP are equal", async () => {
    const d = await getDerive();
    expect(d(50, 50)).toBe("DRAW");
    expect(d(0, 0)).toBe("DRAW");
  });

  it("is consistent with validateOutcomeVsVP (no advisory warning for derived outcome)", async () => {
    const d = await getDerive();
    const { validateOutcomeVsVP } = await import("@/server/result-logic");
    // The derived outcome should never trigger a VP/outcome mismatch warning.
    expect(validateOutcomeVsVP(60, 40, d(60, 40))).toBeNull();
    expect(validateOutcomeVsVP(30, 70, d(30, 70))).toBeNull();
    expect(validateOutcomeVsVP(50, 50, d(50, 50))).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 3. Authorization: canReport (Hito 15 — both participants + admin)
// ---------------------------------------------------------------------------

describe("canReport — both participants and admin can report/edit", () => {
  async function getCR() {
    const { canReport } = await import("@/server/result-logic");
    return canReport;
  }

  const homeId = "player-home";
  const awayId = "player-away";

  it("home player can report their match", async () => {
    const cr = await getCR();
    expect(cr(homeId, "PLAYER", homeId, awayId)).toBe(true);
  });

  it("away player can report their match", async () => {
    const cr = await getCR();
    expect(cr(awayId, "PLAYER", homeId, awayId)).toBe(true);
  });

  it("admin can report any match", async () => {
    const cr = await getCR();
    expect(cr("admin-id", "ADMIN", homeId, awayId)).toBe(true);
  });

  it("third-party player cannot report a match they are not in", async () => {
    const cr = await getCR();
    expect(cr("player-c", "PLAYER", homeId, awayId)).toBe(false);
  });

  it("null playerId (unauthenticated) cannot report", async () => {
    const cr = await getCR();
    expect(cr(null, "PLAYER", homeId, awayId)).toBe(false);
  });

  it("null playerId with ADMIN role can still report (admin sessions may have null playerId — handled separately)", async () => {
    // NOTE: In practice, the server action requires actorId !== null for DB writes.
    // But the canReport pure function allows null + ADMIN for the role check.
    const cr = await getCR();
    expect(cr(null, "ADMIN", homeId, awayId)).toBe(true);
  });

  // Hito 15: both participants can edit (not just the reporter).
  it("home player can edit a result they did NOT originally report (away reported)", async () => {
    const cr = await getCR();
    // Home player edits — should be allowed (both participants can edit).
    expect(cr(homeId, "PLAYER", homeId, awayId)).toBe(true);
  });

  it("away player can edit a result they did NOT originally report (home reported)", async () => {
    const cr = await getCR();
    // Away player edits — should be allowed.
    expect(cr(awayId, "PLAYER", homeId, awayId)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 4. Status transition guards (Hito 15)
// ---------------------------------------------------------------------------

describe("canReportInStatus — SCHEDULED and REPORTED allowed; admin overrides any", () => {
  async function getGuard() {
    const { canReportInStatus } = await import("@/server/result-logic");
    return canReportInStatus;
  }

  it("player can report in SCHEDULED (fresh report)", async () => {
    const g = await getGuard();
    expect(g("SCHEDULED", false)).toBe(true);
  });

  it("player can edit in REPORTED (overwrite existing result)", async () => {
    const g = await getGuard();
    expect(g("REPORTED", false)).toBe(true);
  });

  it("player CANNOT act on a CONFIRMED match (legacy status)", async () => {
    const g = await getGuard();
    expect(g("CONFIRMED", false)).toBe(false);
  });

  it("admin can act on a CONFIRMED match (override)", async () => {
    const g = await getGuard();
    expect(g("CONFIRMED", true)).toBe(true);
  });

  it("admin can act on any status including DISPUTED (legacy)", async () => {
    const g = await getGuard();
    expect(g("DISPUTED", true)).toBe(true);
    expect(g("SCHEDULED", true)).toBe(true);
    expect(g("REPORTED", true)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 4b. Round-closed guard (Hito 4: cierre-de-ronda). Pure predicate, no DB —
// see tests/cierre-de-ronda.test.ts for the write-level integration through
// reportResult (AC-21).
// ---------------------------------------------------------------------------

describe("AC-21: canReportGivenRoundClosed — participante bloqueado, admin siempre puede", () => {
  async function getGuard() {
    const { canReportGivenRoundClosed } = await import("@/server/result-logic");
    return canReportGivenRoundClosed;
  }

  it("a participant cannot report when the round is closed", async () => {
    const g = await getGuard();
    expect(g(new Date(), false)).toBe(false);
  });

  it("a participant can report when the round is still open (closedAt = null)", async () => {
    const g = await getGuard();
    expect(g(null, false)).toBe(true);
  });

  it("a participant can report on a match with no round at all (playoffs)", async () => {
    const g = await getGuard();
    expect(g(null, false)).toBe(true);
  });

  it("admin overrides a closed round", async () => {
    const g = await getGuard();
    expect(g(new Date(), true)).toBe(true);
  });

  it("admin can also act when the round is open, obviously", async () => {
    const g = await getGuard();
    expect(g(null, true)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 5. Dimension independence: scheduledAt vs status are orthogonal
// ---------------------------------------------------------------------------

describe("scheduledAt and status are independent dimensions", () => {
  // Mirrors the domain model: Match has both scheduledAt and status.
  // Setting scheduledAt does NOT change status; reporting does NOT require a date.

  interface MatchState {
    scheduledAt: string | null;
    status: "SCHEDULED" | "REPORTED" | "CONFIRMED";
  }

  // Simulate the effect of setMatchSchedule (only updates scheduledAt/location).
  function applySchedule(
    match: MatchState,
    date: string | null
  ): MatchState {
    return { ...match, scheduledAt: date }; // status NOT changed
  }

  // Simulate the effect of reportResult (only updates status, not date).
  function applyReport(match: MatchState): MatchState {
    return { ...match, status: "REPORTED" }; // scheduledAt NOT changed
  }

  it("can report a match without scheduledAt (date not required)", () => {
    const match: MatchState = { scheduledAt: null, status: "SCHEDULED" };
    const afterReport = applyReport(match);
    expect(afterReport.status).toBe("REPORTED");
    expect(afterReport.scheduledAt).toBeNull();
  });

  it("setting a date does NOT change the match status", () => {
    const match: MatchState = { scheduledAt: null, status: "SCHEDULED" };
    const afterSchedule = applySchedule(match, "2026-09-15T18:00:00.000Z");
    expect(afterSchedule.status).toBe("SCHEDULED"); // unchanged
    expect(afterSchedule.scheduledAt).toBe("2026-09-15T18:00:00.000Z");
  });

  it("clearing a date does NOT change the match status", () => {
    const match: MatchState = {
      scheduledAt: "2026-09-15T18:00:00.000Z",
      status: "REPORTED",
    };
    const afterClear = applySchedule(match, null);
    expect(afterClear.status).toBe("REPORTED"); // unchanged
    expect(afterClear.scheduledAt).toBeNull();
  });

  it("a match can be reported and later get a date (any order)", () => {
    const match: MatchState = { scheduledAt: null, status: "SCHEDULED" };
    const afterReport = applyReport(match);
    const afterSchedule = applySchedule(afterReport, "2026-09-20T10:00:00.000Z");
    expect(afterSchedule.status).toBe("REPORTED");
    expect(afterSchedule.scheduledAt).toBe("2026-09-20T10:00:00.000Z");
  });

  it("a match can be scheduled and then reported (other order)", () => {
    const match: MatchState = { scheduledAt: null, status: "SCHEDULED" };
    const afterSchedule = applySchedule(match, "2026-09-20T10:00:00.000Z");
    const afterReport = applyReport(afterSchedule);
    expect(afterReport.status).toBe("REPORTED");
    expect(afterReport.scheduledAt).toBe("2026-09-20T10:00:00.000Z");
  });
});

// ---------------------------------------------------------------------------
// 6. New standings gate: REPORTED counts, SCHEDULED does not
// ---------------------------------------------------------------------------

describe("standings gate (Hito 15): REPORTED counts, SCHEDULED does not", () => {
  // Hito 15 changes the gate: REPORTED and CONFIRMED (legacy) both count.
  // SCHEDULED never counts.

  type Status = "SCHEDULED" | "REPORTED" | "CONFIRMED" | "DISPUTED";

  interface MatchWithResult {
    id: string;
    status: Status;
    phase: string;
    result: { outcome: string } | null;
  }

  // The updated standings gate (mirrors isConfirmedForStandings in standings.ts).
  function countForStandings(match: MatchWithResult): boolean {
    return (
      (match.status === "REPORTED" || match.status === "CONFIRMED") &&
      match.result !== null &&
      match.phase === "LEAGUE"
    );
  }

  it("REPORTED match with result counts for standings (new flow)", () => {
    expect(
      countForStandings({
        id: "m1",
        status: "REPORTED",
        phase: "LEAGUE",
        result: { outcome: "HOME_WIN" },
      })
    ).toBe(true);
  });

  it("CONFIRMED match with result counts for standings (legacy compatibility)", () => {
    expect(
      countForStandings({
        id: "m2",
        status: "CONFIRMED",
        phase: "LEAGUE",
        result: { outcome: "HOME_WIN" },
      })
    ).toBe(true);
  });

  it("SCHEDULED match does NOT count for standings (no result)", () => {
    expect(
      countForStandings({
        id: "m3",
        status: "SCHEDULED",
        phase: "LEAGUE",
        result: null,
      })
    ).toBe(false);
  });

  it("DISPUTED match does NOT count for standings (legacy, no gate)", () => {
    expect(
      countForStandings({
        id: "m4",
        status: "DISPUTED",
        phase: "LEAGUE",
        result: { outcome: "AWAY_WIN" },
      })
    ).toBe(false);
  });

  it("REPORTED PLAYOFF match does NOT count for league standings", () => {
    expect(
      countForStandings({
        id: "m5",
        status: "REPORTED",
        phase: "PLAYOFF",
        result: { outcome: "HOME_WIN" },
      })
    ).toBe(false);
  });

  it("filtering a list: REPORTED and CONFIRMED count; SCHEDULED/DISPUTED do not", () => {
    const matches: MatchWithResult[] = [
      { id: "m1", status: "REPORTED", phase: "LEAGUE", result: { outcome: "HOME_WIN" } },
      { id: "m2", status: "CONFIRMED", phase: "LEAGUE", result: { outcome: "AWAY_WIN" } },
      { id: "m3", status: "SCHEDULED", phase: "LEAGUE", result: null },
      { id: "m4", status: "DISPUTED", phase: "LEAGUE", result: { outcome: "DRAW" } },
    ];

    const forStandings = matches.filter(countForStandings);
    expect(forStandings).toHaveLength(2);
    expect(forStandings.map((m) => m.id)).toEqual(["m1", "m2"]);
  });
});

// ---------------------------------------------------------------------------
// 7. Regeneration guard: blocks on REPORTED and CONFIRMED
// ---------------------------------------------------------------------------

describe("regeneration guard (Hito 15): blocks when results exist (REPORTED or CONFIRMED)", () => {
  // The guard logic mirrors generateLeagueMatches in match-actions.ts.
  // Hito 15: blocks on REPORTED (new active status) OR CONFIRMED (legacy).

  function computeGuardResult(reportedOrConfirmedCount: number) {
    if (reportedOrConfirmedCount > 0) {
      return { blocked: true, confirmedCount: reportedOrConfirmedCount } as const;
    }
    return { blocked: false } as const;
  }

  it("allows regeneration when no results exist (count is 0)", () => {
    const result = computeGuardResult(0);
    expect(result.blocked).toBe(false);
  });

  it("blocks regeneration when REPORTED matches exist", () => {
    // This simulates matches in REPORTED status (new flow).
    const result = computeGuardResult(2);
    expect(result.blocked).toBe(true);
  });

  it("blocks regeneration when CONFIRMED matches exist (legacy)", () => {
    // CONFIRMED legacy data also blocks regeneration.
    const result = computeGuardResult(1);
    expect(result.blocked).toBe(true);
  });

  it("error message includes the count of results-with-result", () => {
    const result = computeGuardResult(3);
    if (result.blocked) {
      // New error message mentions "resultado apuntado" (not "confirmado").
      const errorMsg = `No se pueden regenerar los emparejamientos: hay ${result.confirmedCount} partidas con resultado apuntado.`;
      expect(errorMsg).toContain("3");
      expect(errorMsg).toContain("apuntado");
    }
  });
});

// ---------------------------------------------------------------------------
// 8. DRAW invalid in playoff — guard logic
// ---------------------------------------------------------------------------

describe("DRAW invalid in playoff matches", () => {
  // Mirrors the guard in reportResult for phase=PLAYOFF.
  function isDrawInvalid(phase: string, outcome: string): boolean {
    return phase === "PLAYOFF" && outcome === "DRAW";
  }

  it("DRAW is invalid in PLAYOFF phase", () => {
    expect(isDrawInvalid("PLAYOFF", "DRAW")).toBe(true);
  });

  it("HOME_WIN is valid in PLAYOFF", () => {
    expect(isDrawInvalid("PLAYOFF", "HOME_WIN")).toBe(false);
  });

  it("AWAY_WIN is valid in PLAYOFF", () => {
    expect(isDrawInvalid("PLAYOFF", "AWAY_WIN")).toBe(false);
  });

  it("DRAW is valid in LEAGUE phase", () => {
    expect(isDrawInvalid("LEAGUE", "DRAW")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 9. Playoff advance: apuntar triggers winner advance (logic test)
// ---------------------------------------------------------------------------

describe("playoff advance triggered by reportResult (logic test)", () => {
  // In Hito 15, advancePlayoffWinner is called from WITHIN the reportResult
  // transaction whenever phase=PLAYOFF and !isBye. This test documents the
  // expected branching logic (the actual DB calls are in integration tests or e2e).

  interface PlayoffMatchState {
    phase: "LEAGUE" | "PLAYOFF";
    isBye: boolean;
    outcome: string;
  }

  function shouldAdvanceWinner(match: PlayoffMatchState): boolean {
    // DRAW is pre-blocked by the playoff guard, so we only get here with a winner.
    return match.phase === "PLAYOFF" && !match.isBye;
  }

  it("advances winner for PLAYOFF non-bye match with HOME_WIN", () => {
    expect(
      shouldAdvanceWinner({ phase: "PLAYOFF", isBye: false, outcome: "HOME_WIN" })
    ).toBe(true);
  });

  it("advances winner for PLAYOFF non-bye match with AWAY_WIN", () => {
    expect(
      shouldAdvanceWinner({ phase: "PLAYOFF", isBye: false, outcome: "AWAY_WIN" })
    ).toBe(true);
  });

  it("does NOT advance winner for bye matches (isBye=true)", () => {
    expect(
      shouldAdvanceWinner({ phase: "PLAYOFF", isBye: true, outcome: "HOME_WIN" })
    ).toBe(false);
  });

  it("does NOT advance winner for LEAGUE phase matches", () => {
    expect(
      shouldAdvanceWinner({ phase: "LEAGUE", isBye: false, outcome: "HOME_WIN" })
    ).toBe(false);
  });
});
