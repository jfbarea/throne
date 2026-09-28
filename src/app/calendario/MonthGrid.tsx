"use client";

// The month grid of §4.1/§4.2 (plan/specs/calendario-de-verdad.md): 7 columns
// starting on Monday, whole weeks, a dot per match, one expanded day at a time,
// and the "Sin fecha" block of the visible month (§4.4) underneath.
//
// It owns exactly one piece of state — which day is open — and nothing else:
// the month, its round, its matches and what the session may schedule all
// arrive resolved from the server component (`page.tsx`), which is what keeps
// the whole view linkable through `?mes` (§4.1).
//
// **§5.4 without an effect.** Navigating to another month must close the open
// day. `?mes` navigation re-renders this component in the same position, so
// React would happily keep the previous month's state; the state therefore
// carries the month it belongs to and is read as "closed" the moment the
// months differ. No `useEffect`, nothing to forget to clean up.
//
// Mobile-first (§7): the grid is the same at every width — 7 equal
// `minmax(0, 1fr)` columns, square cells, no fixed pixel width anywhere — so
// nothing here can scroll horizontally at 390px; the document scrolls.

import { useMemo, useState } from "react";
import Link from "next/link";
import { CaretLeft, CaretRight } from "@phosphor-icons/react";
import { Eyebrow } from "@/components/Eyebrow";
import {
  dayKeyOf,
  dayLabel as formatDayLabel,
  formatMonthKey,
  groupByDay,
  monthGridDays,
  type CalendarMatch,
  type MonthKey,
  type SchedulableMatch,
} from "@/server/calendar";
import { DayDetail } from "./DayDetail";
import { MatchRow } from "./MatchRow";

/** §4.2: four dots at most, the rest counted as `+N`. */
const MAX_DOTS = 4;

const WEEKDAY_INITIALS = ["L", "M", "X", "J", "V", "S", "D"];

export interface MonthGridProps {
  /** The visible month (§4.1). Comes from `?mes` or from `entryMonth`. */
  month: MonthKey;
  /** "Octubre 2026", from `monthLabel`. */
  monthLabel: string;
  /** Round of this month, or null in a playoff month (§4.11). */
  roundIndex: number | null;
  /** `Round.deadline` as ISO, or null in a playoff month (§4.11). */
  roundDeadline: string | null;
  /** Today's day key in `Europe/Madrid`, from `dayKeyOf(new Date())` (§4.2). */
  todayKey: string;
  /** Matches of the visible month, all of them with a date (§4.2). */
  matches: CalendarMatch[];
  /** Matches with no date of this month's round — the §4.4 block. */
  unscheduled: CalendarMatch[];
  /**
   * What the session may drag onto a day of this month, already filtered by
   * `eligibleForDay` (§4.5). Month-level on purpose: the eligibility rule is
   * per round/month, so every day of the month shares the same candidates.
   */
  schedulable: SchedulableMatch[];
  /** `/calendario?mes=…` of the previous month, or null to disable it (§4.1). */
  prevMonthHref: string | null;
  /** Idem for the next month. */
  nextMonthHref: string | null;
}

/** An arrow: a `<Link>` when there is somewhere to go, a dead chip when not. */
function MonthArrow({
  href,
  direction,
  label,
}: {
  href: string | null;
  direction: "prev" | "next";
  label: string;
}) {
  const icon =
    direction === "prev" ? <CaretLeft size={16} /> : <CaretRight size={16} />;
  const shared =
    "flex h-9 w-9 shrink-0 items-center justify-center rounded border";

  if (href === null) {
    // §4.1: no infinite navigation into empty months (criterio 10).
    return (
      <span
        data-testid={`${direction}-month`}
        aria-disabled="true"
        aria-label={label}
        className={shared}
        style={{
          borderColor: "var(--border)",
          color: "var(--fg-disabled)",
          opacity: 0.4,
        }}
      >
        {icon}
      </span>
    );
  }

  return (
    <Link
      href={href}
      data-testid={`${direction}-month`}
      aria-label={label}
      className={`${shared} cursor-pointer`}
      style={{ borderColor: "var(--border-strong)", color: "var(--fg-muted)" }}
    >
      {icon}
    </Link>
  );
}

export function MonthGrid({
  month,
  monthLabel,
  roundIndex,
  roundDeadline,
  todayKey,
  matches,
  unscheduled,
  schedulable,
  prevMonthHref,
  nextMonthHref,
}: MonthGridProps) {
  const monthId = formatMonthKey(month);
  const [open, setOpen] = useState<{ month: string; dayKey: string } | null>(
    null
  );
  // §5.4: a day opened in another month is not open here.
  const openDayKey =
    open !== null && open.month === monthId ? open.dayKey : null;

  const cells = useMemo(() => monthGridDays(month), [month]);

  // Matches per day, in `Europe/Madrid` (§4.12) — the grouping itself comes
  // from src/server/calendar.ts; this only adapts the ISO strings that crossed
  // the server → client boundary back into instants.
  const byDay = useMemo(() => {
    const grouped = groupByDay(
      matches.map((match) => ({
        match,
        scheduledAt:
          match.scheduledAt === null ? null : new Date(match.scheduledAt),
      }))
    );
    const result = new Map<string, CalendarMatch[]>();
    for (const [dayKey, items] of grouped) {
      result.set(
        dayKey,
        [...items]
          .sort(
            (a, b) =>
              (a.scheduledAt?.getTime() ?? 0) - (b.scheduledAt?.getTime() ?? 0)
          )
          .map((item) => item.match)
      );
    }
    return result;
  }, [matches]);

  const deadlineKey =
    roundDeadline === null ? null : dayKeyOf(new Date(roundDeadline));
  const deadlineDay =
    deadlineKey === null ? null : Number(deadlineKey.slice(8));

  // §4.1: "Octubre 2026 · Ronda 3 · cierra el 31" / §4.11: "Marzo 2027 · Playoffs".
  //
  // The empty-month-with-no-round case is the one the spec does not name: §5.1
  // paints the grid of today's month for a league still in SETUP, which has no
  // round either, and calling that month "Playoffs" would be a lie. A month
  // with no round is a playoff month only when it actually holds playoff
  // matches (§4.11); otherwise the header is just the month.
  const isPlayoffMonth =
    roundIndex === null && (matches.length > 0 || unscheduled.length > 0);
  const heading =
    roundIndex === null
      ? `${monthLabel}${isPlayoffMonth ? " · Playoffs" : ""}`
      : `${monthLabel} · Ronda ${roundIndex}${deadlineDay === null ? "" : ` · cierra el ${deadlineDay}`}`;

  const openMatches = openDayKey === null ? [] : (byDay.get(openDayKey) ?? []);

  function toggleDay(dayKey: string) {
    setOpen((current) =>
      current !== null && current.month === monthId && current.dayKey === dayKey
        ? null
        : { month: monthId, dayKey }
    );
  }

  return (
    <section data-testid="month-grid" className="w-full min-w-0">
      <div className="flex items-center justify-between gap-2">
        <MonthArrow
          href={prevMonthHref}
          direction="prev"
          label="Mes anterior"
        />
        <h1
          data-testid="month-heading"
          className="min-w-0 flex-1 text-center text-[17px] leading-tight font-semibold break-words"
          style={{ fontFamily: "var(--font-display)", color: "var(--fg)" }}
        >
          {heading}
        </h1>
        <MonthArrow
          href={nextMonthHref}
          direction="next"
          label="Mes siguiente"
        />
      </div>

      {/* Weekday header — Monday first (§4.1). */}
      <div
        data-testid="weekday-header"
        className="mt-4 grid gap-1"
        style={{ gridTemplateColumns: "repeat(7, minmax(0, 1fr))" }}
      >
        {WEEKDAY_INITIALS.map((initial, i) => (
          <div
            key={i}
            className="min-w-0 text-center text-[11px] font-semibold uppercase"
            style={{ color: "var(--fg-faint)", fontFamily: "var(--font-sans)" }}
          >
            {initial}
          </div>
        ))}
      </div>

      <div
        data-testid="grid-cells"
        className="mt-1 grid gap-1"
        style={{ gridTemplateColumns: "repeat(7, minmax(0, 1fr))" }}
      >
        {cells.map((cell) => {
          const dayMatches = byDay.get(cell.dayKey) ?? [];
          const isToday = cell.dayKey === todayKey;
          const isDeadline =
            deadlineKey !== null && cell.dayKey === deadlineKey;
          const isOpen = openDayKey === cell.dayKey;
          // §4.1: filler days take no interaction. §4.5: neither does a day
          // with nothing to show and nothing the session could bring to it.
          const interactive =
            cell.inMonth && (dayMatches.length > 0 || schedulable.length > 0);
          const dots = dayMatches.slice(0, MAX_DOTS);
          const extra = dayMatches.length - dots.length;

          return (
            <button
              key={cell.dayKey}
              type="button"
              data-testid={`day-${cell.dayKey}`}
              data-in-month={cell.inMonth ? "true" : "false"}
              data-today={isToday ? "true" : "false"}
              data-deadline={isDeadline ? "true" : "false"}
              data-matches={dayMatches.length}
              disabled={!interactive}
              aria-expanded={isOpen}
              aria-label={`${formatDayLabel(cell.dayKey)}${
                dayMatches.length === 0
                  ? ""
                  : ` · ${dayMatches.length} partida${dayMatches.length !== 1 ? "s" : ""}`
              }`}
              onClick={interactive ? () => toggleDay(cell.dayKey) : undefined}
              className={`flex aspect-square w-full min-w-0 flex-col items-center justify-start gap-1 rounded border p-1 ${
                interactive ? "cursor-pointer" : "cursor-default"
              }`}
              style={{
                background: isOpen ? "var(--surface-hover)" : "var(--surface)",
                borderColor: isOpen
                  ? "var(--accent)"
                  : isDeadline
                    ? "var(--ember-500)"
                    : "var(--border)",
                // Today is marked without touching the border, which the
                // deadline day already uses (§4.2 asks for both at once).
                boxShadow: isToday ? "inset 0 0 0 2px var(--accent)" : "none",
                opacity: cell.inMonth ? 1 : 0.35,
                color: cell.inMonth ? "var(--fg)" : "var(--fg-disabled)",
              }}
            >
              <span
                className="text-[13px] leading-none font-semibold"
                style={{ fontFamily: "var(--font-sans)" }}
              >
                {cell.day}
              </span>

              <span className="flex flex-wrap items-center justify-center gap-[3px]">
                {dots.map((match) => (
                  <span
                    key={match.id}
                    data-testid="day-dot"
                    data-match-id={match.id}
                    data-result={
                      match.status === "REPORTED" ||
                      match.status === "CONFIRMED"
                        ? "true"
                        : "false"
                    }
                    data-mine={match.isMine ? "true" : "false"}
                    className="h-[6px] w-[6px] rounded-full"
                    style={{
                      // §4.2: with a result the dot is `--accent`; without one
                      // it stays muted.
                      background:
                        match.status === "REPORTED" ||
                        match.status === "CONFIRMED"
                          ? "var(--accent)"
                          : "var(--fg-disabled)",
                      // §4.2: the session's own matches get a ring.
                      boxShadow: match.isMine
                        ? "0 0 0 2px var(--accent-hover)"
                        : "none",
                    }}
                  />
                ))}
                {extra > 0 && (
                  <span
                    data-testid="day-more"
                    className="text-[10px] leading-none font-semibold"
                    style={{
                      color: "var(--fg-faint)",
                      fontFamily: "var(--font-sans)",
                    }}
                  >
                    +{extra}
                  </span>
                )}
              </span>
            </button>
          );
        })}
      </div>

      {openDayKey !== null && (
        <DayDetail
          dayKey={openDayKey}
          dayLabel={formatDayLabel(openDayKey)}
          matches={openMatches}
          schedulable={schedulable}
          onClose={() => setOpen(null)}
        />
      )}

      {unscheduled.length > 0 && (
        <section data-testid="unscheduled-block" className="mt-6">
          <Eyebrow as="div">
            {roundIndex === null
              ? `Sin fecha · Playoffs (${unscheduled.length})`
              : `Sin fecha · Ronda ${roundIndex} (${unscheduled.length})`}
          </Eyebrow>
          <div className="mt-3 space-y-2">
            {unscheduled.map((match) => (
              <MatchRow key={match.id} match={match} />
            ))}
          </div>
        </section>
      )}
    </section>
  );
}
