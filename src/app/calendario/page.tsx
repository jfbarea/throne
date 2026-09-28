// /calendario — the month grid of the spec "calendario de verdad"
// (plan/specs/calendario-de-verdad.md §4.1-§4.4, §4.11, §4.12).
//
// Server Component. It resolves three things and hands them down already
// decided, so the client only paints:
//
//  1. **Which month is visible** — `?mes=AAAA-MM` when it is navigable, the
//     entry month otherwise (§4.1, criterios 8 and 9). A malformed or
//     out-of-range `?mes` falls back without erroring.
//  2. **The matches of that month**, resolved day by day in `Europe/Madrid`
//     (§4.12), **no longer filtered by `phase = LEAGUE`** (§4.11): the
//     playoffs are painted too.
//  3. **What the session may schedule onto a day of that month**, via
//     `eligibleForDay` — the "adelantar sí, retrasar no" rule is consumed
//     here, never restated.
//
// **Query budget (§7, "una consulta por vista, sin N+1").** Four client-level
// operations, constant regardless of how many players, rounds or matches the
// league has: `league.findFirst`, `round.findMany`, one `match.findMany` for
// the scheduled playoff months that bound the navigable range (§4.11), and one
// `match.findMany` that brings, in a single round-trip, the three sets the view
// needs — the matches of the visible month, every match with no date (the §4.4
// block and the picker's candidates), and the session's own matches wherever
// they are dated (so the picker can *move* one, §4.5). Everything below is
// in-memory aggregation over that one result set. Measured, not asserted by
// hand: tests/rejilla.test.tsx counts them with an instrumented client.

import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireAuth } from "@/lib/guards";
import { AppHeader } from "@/components/AppHeader";
import { Card } from "@/components/Card";
import { Eyebrow } from "@/components/Eyebrow";
import { eligibleForDay, type EligibilityInput } from "@/server/result-logic";
import {
  dayKeyOf,
  entryMonth,
  formatMonthKey,
  monthBounds,
  monthKeyEquals,
  monthKeyOf,
  monthLabel,
  navigableMonths,
  parseMonthKey,
  type CalendarMatch,
  type MonthKey,
  type RoundRef,
  type SchedulableMatch,
} from "@/server/calendar";
import { MonthGrid } from "./MonthGrid";

interface CalendarioPageProps {
  /** Next 16 hands search params as a promise. Optional so a test can omit it. */
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="flex min-h-screen flex-col"
      style={{ background: "var(--bg)", color: "var(--fg)" }}
    >
      <AppHeader active="calendario" />
      <main className="mx-auto w-full max-w-2xl flex-1 space-y-6 px-3 py-6 sm:px-4">
        {children}
      </main>
    </div>
  );
}

export default async function CalendarioPage({
  searchParams,
}: CalendarioPageProps = {}) {
  const session = await requireAuth();
  const isAdmin = session.role === "ADMIN";
  const playerId = session.playerId ?? null;

  const params = searchParams === undefined ? {} : await searchParams;
  const rawMes = params.mes;
  const requestedMonth = parseMonthKey(
    typeof rawMes === "string" ? rawMes : null
  );

  // MVP: single active league.
  const league = await prisma.league.findFirst({
    orderBy: { createdAt: "desc" },
  });

  if (!league) {
    // §5.1 — nothing to paint, not even a grid.
    return (
      <Shell>
        <Card className="py-10 text-center">
          <p
            className="text-[15px] font-semibold"
            style={{ color: "var(--fg-muted)", fontFamily: "var(--font-sans)" }}
          >
            No hay ninguna liga configurada todavía
          </p>
        </Card>
      </Shell>
    );
  }

  const [roundRows, playoffDayRows] = await Promise.all([
    prisma.round.findMany({
      where: { leagueId: league.id },
      orderBy: { index: "asc" },
      select: { id: true, index: true, deadline: true, closedAt: true },
    }),
    // §4.11: the navigable range covers the rounds *and* the months with
    // scheduled playoff matches. Only the instants are needed here.
    prisma.match.findMany({
      where: {
        leagueId: league.id,
        phase: "PLAYOFF",
        scheduledAt: { not: null },
      },
      select: { scheduledAt: true },
    }),
  ]);

  const rounds: RoundRef[] = roundRows.map((r) => ({
    index: r.index,
    deadline: r.deadline,
    closedAt: r.closedAt,
  }));
  const playoffDays = playoffDayRows
    .map((m) => m.scheduledAt)
    .filter((d): d is Date => d !== null);

  const now = new Date();
  const nav = navigableMonths(rounds, playoffDays);
  const entry = entryMonth(nav, rounds, now);
  // §4.1, criterio 8: an unparseable `?mes`, or one outside the navigable
  // range, falls back to the entry month — never an error page.
  const month: MonthKey =
    requestedMonth !== null &&
    nav.some((m) => monthKeyEquals(m, requestedMonth))
      ? requestedMonth
      : entry;

  const { start, end } = monthBounds(month);

  const matchRows = await prisma.match.findMany({
    where: {
      leagueId: league.id,
      OR: [
        // The cells of the visible month (§4.2). No `phase` filter (§4.11).
        { scheduledAt: { gte: start, lte: end } },
        // The "Sin fecha" block (§4.4, §5.2) and the picker's undated candidates.
        { scheduledAt: null },
        // The session's own matches wherever they are: choosing one in the
        // picker *moves* it to this day (§4.5, criterio 14).
        ...(playerId === null
          ? []
          : [{ playerHomeId: playerId }, { playerAwayId: playerId }]),
      ],
    },
    select: {
      id: true,
      status: true,
      phase: true,
      scheduledAt: true,
      location: true,
      roundId: true,
      playerHomeId: true,
      playerAwayId: true,
      playerHome: { select: { displayName: true } },
      playerAway: { select: { displayName: true } },
      // `deadline` is the ceiling of §4.7 for *this* match (criterio 22): the
      // one the row hands `ScheduleForm` as the input's `max`. It is read per
      // match on purpose — the visible month's round is the wrong answer for a
      // playoff match and for one with `roundId = null` (§4.11, §5.2).
      round: { select: { index: true, deadline: true, closedAt: true } },
      result: { select: { resolution: true } },
    },
    orderBy: [{ scheduledAt: "asc" }, { id: "asc" }],
  });

  type MatchRowData = (typeof matchRows)[number];

  const isMine = (m: MatchRowData): boolean =>
    playerId !== null &&
    (m.playerHomeId === playerId || m.playerAwayId === playerId);

  const toCalendarMatch = (m: MatchRowData): CalendarMatch => ({
    id: m.id,
    playerHomeName: m.playerHome.displayName,
    playerAwayName: m.playerAway?.displayName ?? null,
    scheduledAt: m.scheduledAt === null ? null : m.scheduledAt.toISOString(),
    location: m.location,
    status: m.status,
    phase: m.phase as "LEAGUE" | "PLAYOFF",
    roundIndex: m.round?.index ?? null,
    // §4.7's two ends, travelling with the match so `MatchRow` can put them on
    // the `datetime-local` (criterio 22). Both may be null: a playoff match has
    // no ceiling (§4.11), a league still in SETUP has no floor (§5.1).
    roundDeadline: m.round?.deadline.toISOString() ?? null,
    leagueStartMonth: league.startMonth?.toISOString() ?? null,
    resolution: m.result?.resolution ?? null,
    isMine: isMine(m),
    canEdit: isAdmin || isMine(m),
  });

  const toSchedulableMatch = (m: MatchRowData): SchedulableMatch => ({
    id: m.id,
    playerHomeName: m.playerHome.displayName,
    playerAwayName: m.playerAway?.displayName ?? null,
    roundIndex: m.round?.index ?? null,
    scheduledAt: m.scheduledAt === null ? null : m.scheduledAt.toISOString(),
  });

  // The round of the visible month, if it has one — "mes y ronda son la misma
  // cosa" (§4.1). A month without one is a playoff month (§4.11).
  const monthRound = roundRows.find((r) =>
    monthKeyEquals(monthKeyOf(r.deadline), month)
  );

  // §5.2: a league match with `roundId = null` is shown in the block of the
  // first open round, so it stays visible instead of falling off the calendar.
  const firstOpenRound =
    roundRows.find((r) => r.closedAt === null) ??
    roundRows[roundRows.length - 1];

  const monthMatches = matchRows
    .filter(
      (m) =>
        m.scheduledAt !== null &&
        monthKeyEquals(monthKeyOf(m.scheduledAt), month)
    )
    .map(toCalendarMatch);

  const belongsToUnscheduledBlock = (m: MatchRowData): boolean => {
    if (m.scheduledAt !== null) return false;
    // §4.11: a playoff month lists the undated playoff matches instead.
    if (monthRound === undefined) return m.phase === "PLAYOFF";
    if (m.phase === "PLAYOFF") return false;
    if (m.roundId !== null) return m.round?.index === monthRound.index;
    return firstOpenRound !== undefined && firstOpenRound.id === monthRound.id;
  };

  const unscheduled = matchRows
    .filter(belongsToUnscheduledBlock)
    .map(toCalendarMatch);

  // §4.5 — what this session may bring to a day of this month. The rule itself
  // lives in `eligibleForDay`; this only projects the rows onto its input.
  const eligibilityInput: EligibilityInput[] = matchRows.map((m) => ({
    id: m.id,
    playerHomeId: m.playerHomeId,
    playerAwayId: m.playerAwayId,
    roundIndex: m.round?.index ?? null,
    roundClosedAt: m.round?.closedAt ?? null,
  }));
  const eligibleIds = new Set(
    eligibleForDay(eligibilityInput, { month, rounds, playerId, isAdmin })
  );
  const schedulable = matchRows
    .filter((m) => eligibleIds.has(m.id))
    .map(toSchedulableMatch);

  const navIndex = nav.findIndex((m) => monthKeyEquals(m, month));
  const prevMonthHref =
    navIndex > 0
      ? `/calendario?mes=${formatMonthKey(nav[navIndex - 1])}`
      : null;
  const nextMonthHref =
    navIndex >= 0 && navIndex < nav.length - 1
      ? `/calendario?mes=${formatMonthKey(nav[navIndex + 1])}`
      : null;

  // §5.1: a league still in SETUP — no rounds, no matches. The grid is painted
  // anyway, on today's month, with the arrows dead and the reason spelled out.
  const nothingGenerated = roundRows.length === 0 && matchRows.length === 0;

  return (
    <Shell>
      <div>
        <Eyebrow>Calendario · {league.name}</Eyebrow>
        <p
          className="mt-1 text-[13px]"
          style={{ color: "var(--fg-muted)", fontFamily: "var(--font-sans)" }}
        >
          {league.season}
        </p>
      </div>

      {nothingGenerated && (
        <Card className="py-8 text-center">
          <p
            className="text-[15px] font-semibold"
            style={{ color: "var(--fg-muted)", fontFamily: "var(--font-sans)" }}
          >
            Todavía no hay partidas generadas
          </p>
          {isAdmin && (
            <p
              className="mt-1 text-[13px]"
              style={{
                color: "var(--fg-faint)",
                fontFamily: "var(--font-sans)",
              }}
            >
              <Link
                href="/admin/emparejamientos"
                style={{ color: "var(--accent)" }}
              >
                Generar emparejamientos →
              </Link>
            </p>
          )}
        </Card>
      )}

      <MonthGrid
        month={month}
        monthLabel={monthLabel(month)}
        roundIndex={monthRound?.index ?? null}
        roundDeadline={monthRound?.deadline.toISOString() ?? null}
        todayKey={dayKeyOf(now)}
        matches={monthMatches}
        unscheduled={unscheduled}
        schedulable={schedulable}
        prevMonthHref={prevMonthHref}
        nextMonthHref={nextMonthHref}
      />
    </Shell>
  );
}
