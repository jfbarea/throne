// Shared fixtures for the "calendario-de-verdad" feature
// (plan/calendario-de-verdad/TRACKS.md, T0 entrega 4).
//
// Written once, here, so the four parallel tracks (T1 guardas, T2 rejilla,
// T3 agendar, T4 periferia) do not invent four different seeds that collide on
// the first merge. Not a `*.test.ts` file on purpose: vitest's `include`
// (vitest.config.ts) only picks up test files, so this never runs as a suite of
// its own — same rule as tests/helpers/reparto.ts.
//
// Two halves, used by different tracks:
//   - `seedCalendarLeague` writes the real rows into file:./test.db (T1's
//     server actions need real Match/Round/Result rows).
//   - `makeCalendarMatch` / `makeSchedulableMatch` build the view models the UI
//     components take (T2, T3), with no DB involved.
//
// Every date here is expressed as an instant in `Europe/Madrid` via
// `instantOnDay` (src/server/calendar.ts), never as `new Date("…")`, so the
// fixture means the same thing under `TZ=UTC`, `TZ=Europe/Madrid` and
// `TZ=America/New_York` (spec §4.12).

import { prisma } from "@/lib/db";
import {
  instantOnDay,
  type CalendarMatch,
  type SchedulableMatch,
} from "@/server/calendar";

// ---------------------------------------------------------------------------
// The shape of the league every track shares
// ---------------------------------------------------------------------------

/**
 * October 2026 as `League.startMonth`: the first day of the month at midnight
 * UTC, exactly as `src/lib/schemas.ts` normalises the admin's input.
 */
export const FIXTURE_START_MONTH = new Date(Date.UTC(2026, 9, 1));

/**
 * The three round deadlines, as `deriveDeadlines` (src/server/rounds.ts)
 * computes them from `FIXTURE_START_MONTH`: the last day of each month at
 * 00:00 **UTC**. Written out literally instead of derived so a change in
 * `deriveDeadlines` shows up as a failing test rather than as a fixture that
 * silently follows along — §9.5 is precisely about this instant.
 */
export const FIXTURE_DEADLINES = {
  /** Round 1 — October 2026. Closed. */
  r1: new Date(Date.UTC(2026, 9, 31)),
  /** Round 2 — November 2026. Open. */
  r2: new Date(Date.UTC(2026, 10, 30)),
  /** Round 3 — December 2026. Open. */
  r3: new Date(Date.UTC(2026, 11, 31)),
} as const;

/** 17 Oct 2026, 19:00 Spanish time — a match played inside the closed round. */
export const FIXTURE_PLAYED_AT = instantOnDay("2026-10-17", "19:00");
/** 14 Nov 2026, 20:00 Spanish time — a scheduled, not yet played match. */
export const FIXTURE_SCHEDULED_AT = instantOnDay("2026-11-14", "20:00");
/**
 * 31 Dec 2026, 20:00 Spanish time — **the §9.5 case**: the closing day of
 * round 3 itself, nine hours after the stored deadline instant. It must be a
 * valid date for that round, or the day of the deadline falls outside its own
 * round.
 */
export const FIXTURE_ON_DEADLINE_DAY_AT = instantOnDay("2026-12-31", "20:00");
/** 10 Jan 2027, 20:00 Spanish time — a playoff match, past the last round. */
export const FIXTURE_PLAYOFF_AT = instantOnDay("2027-01-10", "20:00");

// ---------------------------------------------------------------------------
// DB fixture (T1, and anyone who needs real rows)
// ---------------------------------------------------------------------------

function uid(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * A `createdAt` strictly later than every league already in `test.db`.
 *
 * `/calendario`, `/rondas` and the rest of the single-league pages resolve
 * "the league" as `findFirst({ orderBy: { createdAt: "desc" } })`. So any test
 * that renders one of them is really asserting about *the newest league in the
 * database*, not about the league it seeded — and the two stop being the same
 * thing the moment another test file has seeded one.
 *
 * That is not hypothetical: it is the failure this helper was changed to fix.
 * `tests/rejilla.test.tsx` used to pin its leagues to a deterministic future
 * `createdAt` (1 Jan 2030) so they would not tie with another file's, and one
 * of its tests adds 24 extra matches. The result was that
 * `tests/periferia.test.tsx` rendered *rejilla's* league — round 2 showing "2
 * de 28 jugadas" instead of "2 de 4" — but only when rejilla happened to run
 * first. Each file was right on its own; the order was what decided.
 *
 * Reading the current maximum from the database keeps this correct whatever
 * the file order, and survives `vi.setSystemTime` (which a wall-clock default
 * would not). Test files run serially (`fileParallelism: false` in
 * vitest.config.ts), so there is no race between the read and the insert.
 *
 * Exported because `seedCalendarLeague` is not the only seed in play: a test
 * that writes a league of its own (a SETUP league with no `startMonth`, say)
 * needs the very same ordering, and a hand-copied version of this is a rule
 * that drifts in one place and not the other.
 */
export async function nextCreatedAt(): Promise<Date> {
  const newest = await prisma.league.findFirst({
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });
  const now = new Date();
  if (newest === null || newest.createdAt < now) return now;
  return new Date(newest.createdAt.getTime() + 1);
}

export interface SeededCalendar {
  leagueId: string;
  startMonth: Date;
  players: {
    /** Role ADMIN, and also a Player (so it can be a participant too). */
    admin: string;
    alice: string;
    bob: string;
    carol: string;
  };
  rounds: {
    /** October 2026, **closed** (§4.14, §5.9 live here). */
    r1: string;
    /** November 2026, open. */
    r2: string;
    /** December 2026, open — the last one. */
    r3: string;
  };
  matches: {
    /** R1 (closed) · alice vs bob · 17 Oct 19:00 · Result PLAYED. */
    playedInClosedRound: string;
    /** R1 (closed) · carol vs alice · sin fecha · Result UNPLAYED_DRAW. */
    settledInClosedRound: string;
    /** R2 · alice vs carol · sin fecha · sin Result. */
    openNoDate: string;
    /** R2 · bob vs carol · 14 Nov 20:00 · sin Result. */
    openScheduled: string;
    /** R2 · admin vs alice · sin fecha · Result WALKOVER (§4.8, criterio 26). */
    walkoverNoDate: string;
    /** R2 · carol vs bob · sin fecha · Result PLAYED — el dato legacy de §5.9. */
    legacyPlayedNoDate: string;
    /** R3 · alice vs bob · 31 Dic 20:00 — el caso de §9.5. */
    onDeadlineDay: string;
    /** LEAGUE con `roundId = null` (§5.2) · bob vs admin · sin fecha. */
    noRound: string;
    /** PLAYOFF (sin ronda, §4.11) · alice vs bob · 10 Ene 2027 20:00. */
    playoff: string;
  };
}

/**
 * Create a whole league in the test database: 4 players, 3 rounds (the first
 * one closed) and the 9 matches that cover every state the spec names — no
 * date, dated, PLAYED, WALKOVER, UNPLAYED_DRAW, in a closed round, on the
 * deadline day, with `roundId = null`, and playoff.
 *
 * Every id is unique per call, so tests can run against a shared `test.db`
 * without cleaning up after each other (the same pattern
 * tests/cierre-de-ronda.test.ts uses).
 *
 * The league is created with a `createdAt` strictly later than every league
 * already in the database — see `nextCreatedAt`. That is what makes "the
 * league this fixture just seeded is the one the page will render" true for
 * every caller, which several pages depend on.
 */
export async function seedCalendarLeague(): Promise<SeededCalendar> {
  const league = await prisma.league.create({
    data: {
      id: uid("league"),
      name: "Liga de test · calendario",
      season: "2026 Calendario",
      status: "LEAGUE",
      matchesPerRound: 2,
      startMonth: FIXTURE_START_MONTH,
      createdAt: await nextCreatedAt(),
    },
  });

  const makePlayer = async (name: string, role: "ADMIN" | "PLAYER") =>
    prisma.player.create({
      data: {
        id: uid(name.toLowerCase()),
        leagueId: league.id,
        displayName: name,
        role,
        passcodeHash: "test-hash",
      },
    });

  const admin = await makePlayer("Admin", "ADMIN");
  const alice = await makePlayer("Alice", "PLAYER");
  const bob = await makePlayer("Bob", "PLAYER");
  const carol = await makePlayer("Carol", "PLAYER");

  const makeRound = async (index: number, deadline: Date, closedAt: Date | null) =>
    prisma.round.create({
      data: { id: uid(`round${index}`), leagueId: league.id, index, deadline, closedAt },
    });

  // Round 1 closed the day after its deadline, as `closeRound` would leave it.
  const r1 = await makeRound(1, FIXTURE_DEADLINES.r1, new Date(Date.UTC(2026, 10, 1)));
  const r2 = await makeRound(2, FIXTURE_DEADLINES.r2, null);
  const r3 = await makeRound(3, FIXTURE_DEADLINES.r3, null);

  const makeMatch = async (spec: {
    key: string;
    roundId: string | null;
    homeId: string;
    awayId: string;
    scheduledAt: Date | null;
    status: "SCHEDULED" | "REPORTED" | "CONFIRMED";
    phase?: "LEAGUE" | "PLAYOFF";
  }) =>
    prisma.match.create({
      data: {
        id: uid(spec.key),
        leagueId: league.id,
        phase: spec.phase ?? "LEAGUE",
        status: spec.status,
        roundId: spec.roundId,
        playerHomeId: spec.homeId,
        playerAwayId: spec.awayId,
        scheduledAt: spec.scheduledAt,
      },
    });

  const makeResult = async (
    matchId: string,
    resolution: "PLAYED" | "WALKOVER" | "UNPLAYED_DRAW",
    homeVP: number,
    awayVP: number,
    outcome: "HOME_WIN" | "AWAY_WIN" | "DRAW"
  ) =>
    prisma.result.create({
      data: {
        matchId,
        homeVictoryPoints: homeVP,
        awayVictoryPoints: awayVP,
        outcome,
        resolution,
        reportedById: admin.id,
      },
    });

  const playedInClosedRound = await makeMatch({
    key: "m-played-closed",
    roundId: r1.id,
    homeId: alice.id,
    awayId: bob.id,
    scheduledAt: FIXTURE_PLAYED_AT,
    status: "REPORTED",
  });
  await makeResult(playedInClosedRound.id, "PLAYED", 80, 60, "HOME_WIN");

  const settledInClosedRound = await makeMatch({
    key: "m-settled-closed",
    roundId: r1.id,
    homeId: carol.id,
    awayId: alice.id,
    scheduledAt: null,
    status: "REPORTED",
  });
  await makeResult(settledInClosedRound.id, "UNPLAYED_DRAW", 0, 0, "DRAW");

  const openNoDate = await makeMatch({
    key: "m-open-nodate",
    roundId: r2.id,
    homeId: alice.id,
    awayId: carol.id,
    scheduledAt: null,
    status: "SCHEDULED",
  });

  const openScheduled = await makeMatch({
    key: "m-open-scheduled",
    roundId: r2.id,
    homeId: bob.id,
    awayId: carol.id,
    scheduledAt: FIXTURE_SCHEDULED_AT,
    status: "SCHEDULED",
  });

  const walkoverNoDate = await makeMatch({
    key: "m-walkover",
    roundId: r2.id,
    homeId: admin.id,
    awayId: alice.id,
    scheduledAt: null,
    status: "REPORTED",
  });
  await makeResult(walkoverNoDate.id, "WALKOVER", 80, 0, "HOME_WIN");

  // §5.9: a PLAYED result with no date, the kind that predates this spec. It
  // is not migrated and must keep counting for the standings.
  const legacyPlayedNoDate = await makeMatch({
    key: "m-legacy-played",
    roundId: r2.id,
    homeId: carol.id,
    awayId: bob.id,
    scheduledAt: null,
    status: "REPORTED",
  });
  await makeResult(legacyPlayedNoDate.id, "PLAYED", 55, 70, "AWAY_WIN");

  const onDeadlineDay = await makeMatch({
    key: "m-deadline-day",
    roundId: r3.id,
    homeId: alice.id,
    awayId: bob.id,
    scheduledAt: FIXTURE_ON_DEADLINE_DAY_AT,
    status: "SCHEDULED",
  });

  const noRound = await makeMatch({
    key: "m-no-round",
    roundId: null,
    homeId: bob.id,
    awayId: admin.id,
    scheduledAt: null,
    status: "SCHEDULED",
  });

  const playoff = await makeMatch({
    key: "m-playoff",
    roundId: null,
    homeId: alice.id,
    awayId: bob.id,
    scheduledAt: FIXTURE_PLAYOFF_AT,
    status: "SCHEDULED",
    phase: "PLAYOFF",
  });

  return {
    leagueId: league.id,
    startMonth: FIXTURE_START_MONTH,
    players: {
      admin: admin.id,
      alice: alice.id,
      bob: bob.id,
      carol: carol.id,
    },
    rounds: { r1: r1.id, r2: r2.id, r3: r3.id },
    matches: {
      playedInClosedRound: playedInClosedRound.id,
      settledInClosedRound: settledInClosedRound.id,
      openNoDate: openNoDate.id,
      openScheduled: openScheduled.id,
      walkoverNoDate: walkoverNoDate.id,
      legacyPlayedNoDate: legacyPlayedNoDate.id,
      onDeadlineDay: onDeadlineDay.id,
      noRound: noRound.id,
      playoff: playoff.id,
    },
  };
}

// ---------------------------------------------------------------------------
// View-model fixtures (T2, T3 — no DB)
// ---------------------------------------------------------------------------

/**
 * A `CalendarMatch` with sane defaults: a league match of round 2, dated on
 * 14 Nov 2026 at 20:00 Spanish time, no result, not mine, editable, with the
 * two ends of §4.7 (round 2's deadline as the ceiling, the league's start month
 * as the floor). Override only what the test is about.
 */
export function makeCalendarMatch(
  overrides: Partial<CalendarMatch> = {}
): CalendarMatch {
  return {
    id: "match-1",
    playerHomeName: "Alice",
    playerAwayName: "Bob",
    scheduledAt: FIXTURE_SCHEDULED_AT.toISOString(),
    location: "Warlotus",
    status: "SCHEDULED",
    phase: "LEAGUE",
    roundIndex: 2,
    roundDeadline: FIXTURE_DEADLINES.r2.toISOString(),
    leagueStartMonth: FIXTURE_START_MONTH.toISOString(),
    resolution: null,
    isMine: false,
    canEdit: true,
    ...overrides,
  };
}

/** A `SchedulableMatch` (day-picker candidate) with the same defaults. */
export function makeSchedulableMatch(
  overrides: Partial<SchedulableMatch> = {}
): SchedulableMatch {
  return {
    id: "match-1",
    playerHomeName: "Alice",
    playerAwayName: "Bob",
    roundIndex: 2,
    scheduledAt: null,
    ...overrides,
  };
}
