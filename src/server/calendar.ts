// Pure calendar/date logic for the "calendario de verdad" feature.
// Spec: plan/specs/calendario-de-verdad.md §4.1, §4.7, §4.12, §9.4, §9.5.
//
// No Prisma, no SQL, no React: every function here is a pure function over
// plain values, testable on its own (same contract as src/server/rounds.ts).
//
// THE ONE RULE OF THIS MODULE (spec §4.12): a `Date` is an instant; the *day*
// (and therefore the *month*) it belongs to is always resolved in
// `Europe/Madrid`, never in the machine's timezone and never in UTC. The
// league is played in Spain: the day boundary that matters is the one the
// players live, not the one the server happens to run in. That is why nothing
// here uses `getFullYear`/`getMonth`/`getDate` (local) nor `toLocaleDateString`
// without an explicit `timeZone`.
//
// Spec §7 forbids new dependencies, so the zone arithmetic is done with
// `Intl.DateTimeFormat` alone (§9.4).

export const LEAGUE_TZ = "Europe/Madrid";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A calendar month. `month` is 1-12, **not** a JS 0-11 month index. */
export interface MonthKey {
  year: number;
  month: number;
}

/** One cell of the month grid (§4.1). */
export interface DayCell {
  /** "2026-10-17" — the identity of the cell across server and client. */
  dayKey: string;
  /** Day of its own month, 1-31. */
  day: number;
  /** The month this day actually belongs to (differs for filler days). */
  month: MonthKey;
  /** false for the leading/trailing filler days of the adjacent months. */
  inMonth: boolean;
  /** ISO weekday: 1 = Monday … 7 = Sunday. */
  weekday: number;
}

/**
 * The minimal `Round` shape this module needs. Deliberately not a Prisma type:
 * callers project their rows onto this.
 */
export interface RoundRef {
  /** 1-based, as `Round.index`. */
  index: number;
  deadline: Date;
  /** null while the round is open. */
  closedAt: Date | null;
}

/**
 * A match as the calendar UI consumes it (`MonthGrid`, `DayDetail`,
 * `MatchRow`). Dates travel as ISO strings because these cross the
 * server-component → client-component boundary, exactly like today's
 * `MatchRow` props.
 */
export interface CalendarMatch {
  id: string;
  playerHomeName: string;
  playerAwayName: string | null;
  /** ISO-8601 instant, or null when the match has no agreed date yet. */
  scheduledAt: string | null;
  location: string | null;
  /** `MatchStatus`: SCHEDULED | REPORTED | CONFIRMED | DISPUTED. */
  status: string;
  phase: "LEAGUE" | "PLAYOFF";
  /** null for playoff matches and for league matches not yet assigned (§5.2). */
  roundIndex: number | null;
  /**
   * `Round.deadline` of **this match's own round**, as an ISO instant — the
   * ceiling of §4.6/§4.7, and the `max` of the `datetime-local` (criterio 22).
   *
   * null means "no ceiling", which is the right answer for a playoff match
   * (§4.11) and for a league match with `roundId = null` (§5.2). It travels per
   * match, and not as one value for the visible month, precisely because those
   * two cases live inside a month that does have a round: reusing the month's
   * deadline would hand them a ceiling the server does not enforce.
   */
  roundDeadline: string | null;
  /**
   * `League.startMonth` as an ISO instant — the floor of §4.7, and the `min` of
   * the `datetime-local`. null while the league is still in SETUP (§5.1).
   *
   * League-level, so it is the same value on every match of a league. It rides
   * along here rather than as a prop threaded through
   * `MonthGrid → DayDetail → MatchRow` because the row is the only consumer and
   * the pair (floor, ceiling) is only meaningful together: keeping them in one
   * place is what stops one of them being wired and the other forgotten, which
   * is how criterio 22 came to be tested but not alive.
   */
  leagueStartMonth: string | null;
  /** `Resolution`: PLAYED | WALKOVER | UNPLAYED_DRAW, or null with no Result. */
  resolution: string | null;
  /** Whether the session's player takes part in it (§4.2, the ringed dot). */
  isMine: boolean;
  /** Whether the session may edit its schedule (participant or admin). */
  canEdit: boolean;
}

/** A candidate row of the day picker (§4.5). */
export interface SchedulableMatch {
  id: string;
  playerHomeName: string;
  playerAwayName: string | null;
  roundIndex: number | null;
  /** Current date, shown so choosing it reads as "move it here" (§4.5). */
  scheduledAt: string | null;
}

// ---------------------------------------------------------------------------
// Timezone primitives (§4.12, §9.4)
// ---------------------------------------------------------------------------

interface ZonedParts {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number; // 0-23
  minute: number;
  second: number;
}

const PARTS_FORMATTER = new Intl.DateTimeFormat("en-US", {
  timeZone: LEAGUE_TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

/** The wall-clock reading of `instant` in `LEAGUE_TZ`. */
function zonedParts(instant: Date): ZonedParts {
  const parts = PARTS_FORMATTER.formatToParts(instant);
  const read = (type: string): number =>
    Number(parts.find((p) => p.type === type)!.value);
  return {
    year: read("year"),
    month: read("month"),
    day: read("day"),
    hour: read("hour"),
    minute: read("minute"),
    second: read("second"),
  };
}

/** Offset of `LEAGUE_TZ` at that instant, in ms (+3600000 for CET). */
function tzOffsetMs(instant: Date): number {
  const p = zonedParts(instant);
  const asIfUTC = Date.UTC(
    p.year,
    p.month - 1,
    p.day,
    p.hour,
    p.minute,
    p.second,
    instant.getUTCMilliseconds()
  );
  return asIfUTC - instant.getTime();
}

/**
 * The instant at which `LEAGUE_TZ` reads exactly this wall clock.
 *
 * Two passes on purpose, and branchless on purpose: the first offset is the
 * one in force at the *guessed* instant, which is wrong precisely on the two
 * DST days (§5.10); re-reading the offset at the corrected instant fixes it.
 * Doing it unconditionally (instead of `if (off2 !== off1)`) keeps the DST and
 * the non-DST paths on the same line of code — same result, no branch that
 * only one day a year can cover.
 *
 * On the spring-forward day the 02:00-02:59 wall clock does not exist; this
 * maps it forward to 03:00. Nothing here ever builds such a time (§4.7's
 * bounds are 00:00 and 23:59:59.999, which always exist).
 */
function instantFromZoned(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  ms: number
): Date {
  const guess = Date.UTC(year, month - 1, day, hour, minute, second, ms);
  const firstOffset = tzOffsetMs(new Date(guess));
  const settledOffset = tzOffsetMs(new Date(guess - firstOffset));
  return new Date(guess - settledOffset);
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function pad4(n: number): string {
  return String(n).padStart(4, "0");
}

interface DayParts {
  year: number;
  month: number;
  day: number;
}

/** Splits "2026-10-17". Callers only ever pass keys built by this module. */
function splitDayKey(dayKey: string): DayParts {
  const [y, m, d] = dayKey.split("-");
  return { year: Number(y), month: Number(m), day: Number(d) };
}

// ---------------------------------------------------------------------------
// Month keys
// ---------------------------------------------------------------------------

/**
 * Parse the `?mes=AAAA-MM` query parameter (§4.1). Returns null for anything
 * that is not a well-formed month — the caller falls back to the entry month
 * without erroring (criterio 8).
 */
export function parseMonthKey(raw: string | null): MonthKey | null {
  if (raw === null) return null;
  const match = /^(\d{4})-(\d{2})$/.exec(raw);
  if (match === null) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (month < 1 || month > 12) return null;
  return { year, month };
}

/** "2026-10". The inverse of `parseMonthKey`, and the `?mes` value. */
export function formatMonthKey(m: MonthKey): string {
  return `${pad4(m.year)}-${pad2(m.month)}`;
}

/** Negative when `a` is earlier, 0 when equal, positive when later. */
export function compareMonthKeys(a: MonthKey, b: MonthKey): number {
  if (a.year !== b.year) return a.year - b.year;
  return a.month - b.month;
}

export function monthKeyEquals(a: MonthKey, b: MonthKey): boolean {
  return compareMonthKeys(a, b) === 0;
}

/** `delta` may be negative. Rolls the year over correctly in both directions. */
export function addMonths(m: MonthKey, delta: number): MonthKey {
  const total = m.year * 12 + (m.month - 1) + delta;
  const year = Math.floor(total / 12);
  const month = ((total % 12) + 12) % 12;
  return { year, month: month + 1 };
}

/** How many days that month has. Leap years included. */
export function daysInMonth(m: MonthKey): number {
  return new Date(Date.UTC(m.year, m.month, 0)).getUTCDate();
}

// ---------------------------------------------------------------------------
// Instant → day / month, in LEAGUE_TZ (§4.12)
// ---------------------------------------------------------------------------

/**
 * The day an instant belongs to, in `Europe/Madrid`: "2026-11-01".
 *
 * Criterio 3: 2026-11-01T00:30 Spanish time is 2026-10-31T23:30Z, and it
 * belongs to **1 November**, the day the players lived, not to 31 October.
 */
export function dayKeyOf(instant: Date): string {
  const p = zonedParts(instant);
  return `${pad4(p.year)}-${pad2(p.month)}-${pad2(p.day)}`;
}

/** The month an instant belongs to, in `Europe/Madrid`. */
export function monthKeyOf(instant: Date): MonthKey {
  const p = zonedParts(instant);
  return { year: p.year, month: p.month };
}

/** 00:00:00.000 of that day, in `Europe/Madrid`. */
export function startOfDay(dayKey: string): Date {
  const { year, month, day } = splitDayKey(dayKey);
  return instantFromZoned(year, month, day, 0, 0, 0, 0);
}

/** 23:59:59.999 of that day, in `Europe/Madrid`. The last valid instant. */
export function endOfDay(dayKey: string): Date {
  const { year, month, day } = splitDayKey(dayKey);
  return instantFromZoned(year, month, day, 23, 59, 59, 999);
}

/**
 * The instant of "that day at HH:mm, Spanish time" — what the day picker
 * builds once the player has chosen a match and an hour (§4.5).
 *
 * @param time - "HH:mm", 24h. Anything else yields an Invalid Date.
 */
export function instantOnDay(dayKey: string, time: string): Date {
  const { year, month, day } = splitDayKey(dayKey);
  const [hh, mm] = time.split(":");
  return instantFromZoned(year, month, day, Number(hh), Number(mm), 0, 0);
}

/** The whole month as an instant range, for the month's single query (§7). */
export function monthBounds(m: MonthKey): { start: Date; end: Date } {
  return {
    start: startOfDay(`${pad4(m.year)}-${pad2(m.month)}-01`),
    end: endOfDay(`${pad4(m.year)}-${pad2(m.month)}-${pad2(daysInMonth(m))}`),
  };
}

// ---------------------------------------------------------------------------
// The grid (§4.1)
// ---------------------------------------------------------------------------

/** ISO weekday of a UTC-built date: 1 = Monday … 7 = Sunday. */
function isoWeekday(utcDate: Date): number {
  const jsDay = utcDate.getUTCDay(); // 0 = Sunday
  if (jsDay === 0) return 7;
  return jsDay;
}

/**
 * The cells of the month grid: whole weeks starting on Monday, with the
 * leading/trailing days of the adjacent months marked `inMonth: false`
 * (criterio 1).
 *
 * Pure calendar arithmetic — which weekday the 1st falls on does not depend on
 * any timezone — so this is computed in UTC and is TZ-independent by
 * construction. 28-, 29-, 30- and 31-day months all fall out of
 * `Date.UTC(y, m, 0)` with no lookup table, the same trick `deriveDeadlines`
 * uses (src/server/rounds.ts).
 */
export function monthGridDays(m: MonthKey): DayCell[] {
  const firstOfMonth = new Date(Date.UTC(m.year, m.month - 1, 1));
  const leading = isoWeekday(firstOfMonth) - 1;
  const length = daysInMonth(m);
  const cellCount = Math.ceil((leading + length) / 7) * 7;

  const cells: DayCell[] = [];
  for (let i = 0; i < cellCount; i++) {
    const utc = new Date(Date.UTC(m.year, m.month - 1, 1 - leading + i));
    const year = utc.getUTCFullYear();
    const month = utc.getUTCMonth() + 1;
    const day = utc.getUTCDate();
    cells.push({
      dayKey: `${pad4(year)}-${pad2(month)}-${pad2(day)}`,
      day,
      month: { year, month },
      inMonth: i >= leading && i < leading + length,
      weekday: isoWeekday(utc),
    });
  }
  return cells;
}

// ---------------------------------------------------------------------------
// Rounds ↔ months (§4.1, §4.11)
// ---------------------------------------------------------------------------

/**
 * The month of round N (1-based), counted from `League.startMonth` — the same
 * correspondence `deriveDeadlines` establishes, read in `Europe/Madrid`
 * (§4.1: "mes y ronda son la misma cosa").
 */
export function monthOfRound(startMonth: Date, roundIndex: number): MonthKey {
  return addMonths(monthKeyOf(startMonth), roundIndex - 1);
}

/**
 * The contiguous range of months the arrows may reach: from the earliest to
 * the latest month that has either a round or a scheduled playoff match
 * (§4.1, §4.11). Contiguous on purpose — the arrows step month by month, so a
 * hole between the last round and a playoff month would strand the far side.
 *
 * Empty when the league has neither rounds nor scheduled playoffs (§5.1); the
 * caller then falls back to today's month.
 */
export function navigableMonths(
  rounds: RoundRef[],
  playoffDays: Date[]
): MonthKey[] {
  const keys: MonthKey[] = [];
  for (const round of rounds) keys.push(monthKeyOf(round.deadline));
  for (const day of playoffDays) keys.push(monthKeyOf(day));
  if (keys.length === 0) return [];

  let min = keys[0];
  let max = keys[0];
  for (const key of keys) {
    if (compareMonthKeys(key, min) < 0) min = key;
    if (compareMonthKeys(key, max) > 0) max = key;
  }

  const months: MonthKey[] = [];
  let cursor = min;
  while (compareMonthKeys(cursor, max) <= 0) {
    months.push(cursor);
    cursor = addMonths(cursor, 1);
  }
  return months;
}

/**
 * Which month `/calendario` opens on with no `?mes` (§4.1, criterio 9):
 *
 *  1. today's month, if it is navigable;
 *  2. otherwise the month of the first open round (lowest `index` with
 *     `closedAt === null`);
 *  3. otherwise the month of the last round;
 *  4. otherwise (no rounds at all — a navigable range made only of playoff
 *     months, or no range at all) the last navigable month, or today's when
 *     there is nothing to navigate (§5.1).
 */
export function entryMonth(
  nav: MonthKey[],
  rounds: RoundRef[],
  now: Date
): MonthKey {
  const currentMonth = monthKeyOf(now);
  if (nav.length === 0) return currentMonth;
  if (nav.some((m) => monthKeyEquals(m, currentMonth))) return currentMonth;

  const byIndex = [...rounds].sort((a, b) => a.index - b.index);
  const firstOpen = byIndex.find((r) => r.closedAt === null);
  if (firstOpen !== undefined) return monthKeyOf(firstOpen.deadline);

  const last = byIndex[byIndex.length - 1];
  if (last !== undefined) return monthKeyOf(last.deadline);

  return nav[nav.length - 1];
}

// ---------------------------------------------------------------------------
// The valid range of a scheduledAt (§4.7) — and §9.5, the one that bites
// ---------------------------------------------------------------------------

/**
 * The two ends of §4.7, already as comparable instants:
 *
 *   [ 00:00 of the 1st of League.startMonth , 23:59:59.999 of the round's
 *     deadline day ]                                     (Europe/Madrid, both)
 *
 * **§9.5 lives here.** `deriveDeadlines` (src/server/rounds.ts) stores the
 * deadline as `new Date(Date.UTC(y, m + 1, 0))`, i.e. the last day of the
 * month **at 00:00 UTC**. Returned as-is, that instant would reject every
 * match played on the closing day itself — 20:00 on 31 October is nine hours
 * *after* "31 October 00:00 UTC", so the day of the deadline would fall
 * outside its own round. The ceiling is therefore the **end of the deadline's
 * day in `Europe/Madrid`**, not the stored instant.
 *
 * @param startMonth - `League.startMonth`, or null for a league still in SETUP
 *   (no floor).
 * @param roundDeadline - `Round.deadline`, or null for a playoff match / a
 *   league match with no round yet (§5.2, §4.11: no ceiling).
 */
export function scheduleBounds(
  startMonth: Date | null,
  roundDeadline: Date | null
): { min: Date | null; max: Date | null } {
  let min: Date | null = null;
  if (startMonth !== null) {
    const m = monthKeyOf(startMonth);
    min = startOfDay(`${pad4(m.year)}-${pad2(m.month)}-01`);
  }

  let max: Date | null = null;
  if (roundDeadline !== null) {
    max = endOfDay(dayKeyOf(roundDeadline));
  }

  return { min, max };
}

// ---------------------------------------------------------------------------
// Laying matches out on the grid (§4.2)
// ---------------------------------------------------------------------------

/**
 * Group anything that carries a `scheduledAt` by the day it falls on, in
 * `Europe/Madrid`. Items with no date are skipped — they belong to the
 * "Sin fecha" block (§4.4), not to a cell.
 */
export function groupByDay<T extends { scheduledAt: Date | null }>(
  items: T[]
): Map<string, T[]> {
  const byDay = new Map<string, T[]>();
  for (const item of items) {
    if (item.scheduledAt === null) continue;
    const key = dayKeyOf(item.scheduledAt);
    const bucket = byDay.get(key);
    if (bucket === undefined) {
      byDay.set(key, [item]);
    } else {
      bucket.push(item);
    }
  }
  return byDay;
}

// ---------------------------------------------------------------------------
// Spanish labels (calculation, not presentation — same role as `quotaLabel`)
// ---------------------------------------------------------------------------

const MONTH_NAMES_ES = [
  "Enero",
  "Febrero",
  "Marzo",
  "Abril",
  "Mayo",
  "Junio",
  "Julio",
  "Agosto",
  "Septiembre",
  "Octubre",
  "Noviembre",
  "Diciembre",
];

const WEEKDAY_NAMES_ES = [
  "Lunes",
  "Martes",
  "Miércoles",
  "Jueves",
  "Viernes",
  "Sábado",
  "Domingo",
];

/** "Octubre 2026" — the month header of §4.1. */
export function monthLabel(m: MonthKey): string {
  return `${MONTH_NAMES_ES[m.month - 1]} ${m.year}`;
}

/** "Sábado 17 de octubre" — the header of the expanded day (§4.3). */
export function dayLabel(dayKey: string): string {
  const { year, month, day } = splitDayKey(dayKey);
  const weekday = isoWeekday(new Date(Date.UTC(year, month - 1, day)));
  return `${WEEKDAY_NAMES_ES[weekday - 1]} ${day} de ${MONTH_NAMES_ES[month - 1].toLowerCase()}`;
}

/**
 * "20:00" — the hour of a match, in `Europe/Madrid` (§4.3). Deliberately not
 * `toLocaleTimeString` without a zone, which is what makes today's `MatchRow`
 * disagree with the rest of the calendar (§4.12).
 */
export function timeLabel(instant: Date): string {
  const p = zonedParts(instant);
  return `${pad2(p.hour)}:${pad2(p.minute)}`;
}
