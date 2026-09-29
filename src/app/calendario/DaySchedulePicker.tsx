"use client";

// The day picker of §4.5 (calendario-de-verdad, track T3).
//
// What it is: the matches the session may bring onto this day, each one showing
// its current date so that choosing it reads as "move it here" (criterio 14).
// On choosing, it asks for the hour and calls `setMatchSchedule`.
//
// **Shape** (§9.2 left it open, T3 closes it): an *inline disclosure* under the
// day — a full-width trigger that expands a vertical list of candidates, and a
// second step for the hour. Not a modal and not a bottom sheet: both would need
// a portal, a focus trap and a scroll lock to behave, and §7's only requirement
// is that it be tappable and legible at 390px. An inline list is already
// mounted where it belongs (at the foot of `DayDetail`, or on its own for an
// empty day, criterio 15), it grows the document instead of overlaying it — so
// the document scrolls, never the picker (§7) — and it needs no width of its
// own, which is what keeps 390px honest (criterio 38).
//
// Two invariants this file does **not** own:
//
//  - **Eligibility.** "Adelantar sí, retrasar no" (§4.5), the closed-round rule
//    (§4.14) and the admin branch (§4.6) are `eligibleForDay`
//    (src/server/result-logic.ts). `candidates` arrives already filtered; this
//    component never re-decides who may go where. Empty list ⇒ no picker at all
//    (criterio 16).
//  - **Authorization and the valid range.** `setMatchSchedule` is the authority
//    (§4.6, §4.7, §4.14); a rejection comes back as a message and is shown.
//
// And one it does own: the chosen hour becomes an instant through
// `instantOnDay(dayKey, time)`, never `new Date("2026-10-17T20:00")`, which
// would read the browser's zone and contradict §4.12.
//
// **Navigating the list** (t07, from the review feedback): the list is long —
// a player gets one candidate per round of the league (12 with 13 players) and
// an admin gets *every* match, because `eligibleForDay` skips the round rule
// for admins (criterio 17). So the candidates are grouped under a per-round
// heading and, past `SEARCH_THRESHOLD`, a text field filters them by player
// name. Neither touches eligibility or its order: grouping is a partition of
// what arrived, and the filter only hides. The list stays a single inline `ul`
// — no modal, no portal, no scroll of its own — for the reasons above.

import { Fragment, useId, useMemo, useState, useTransition } from "react";
import { CalendarPlus, Clock, MagnifyingGlass } from "@phosphor-icons/react";
import { Button } from "@/components/Button";
import { setMatchSchedule } from "@/server/match-actions";
import {
  dayKeyOf,
  dayLabel as formatDayLabel,
  instantOnDay,
  timeLabel,
  type SchedulableMatch,
} from "@/server/calendar";
import { matchesPlayerQuery } from "@/server/match-search";

/** Evening kick-off, the hour this league actually plays at. */
const DEFAULT_TIME = "20:00";

/**
 * Above this many candidates the search field is worth its room. Below it the
 * grouped list fits in one look and a text input is just noise. Chosen here,
 * not by the spec (§9.2 left the shape open): revisable.
 */
const SEARCH_THRESHOLD = 6;

export interface DaySchedulePickerProps {
  /** "2026-10-17" — the target day, in `Europe/Madrid` (§4.12). */
  dayKey: string;
  /** "Sábado 17 de octubre", from `dayLabel`. */
  dayLabel: string;
  /**
   * What the session may bring to this day, already filtered by
   * `eligibleForDay`. Empty means the day does not open a picker (§4.5,
   * criterio 16).
   */
  candidates: SchedulableMatch[];
  /** Called after `setMatchSchedule` succeeds, so the day can refresh. */
  onScheduled?: () => void;
}

/** "Sábado 14 de noviembre · 20:00", read in `Europe/Madrid` (§4.12). */
function currentDateLabel(iso: string): string {
  const instant = new Date(iso);
  return `${formatDayLabel(dayKeyOf(instant))} · ${timeLabel(instant)}`;
}

function matchTitle(match: SchedulableMatch): string {
  return `${match.playerHomeName} vs ${match.playerAwayName ?? "—"}`;
}

interface CandidateGroup {
  /** `round-2` / `sin-ronda` — React key and test hook. */
  key: string;
  /** "Ronda 2" / "Sin ronda", the visible heading. */
  label: string;
  matches: SchedulableMatch[];
}

/**
 * Partitions the candidates by round, rounds ascending, and the ones with no
 * round (playoff, or a league match with `roundId = null`, §5.2) in their own
 * group at the end. **Inside a group the arrival order is kept**: which
 * matches are eligible and in what order is `eligibleForDay`'s call, not this
 * component's.
 */
function groupByRound(matches: SchedulableMatch[]): CandidateGroup[] {
  const byRound = new Map<number, SchedulableMatch[]>();
  const withoutRound: SchedulableMatch[] = [];

  for (const match of matches) {
    if (match.roundIndex === null) {
      withoutRound.push(match);
      continue;
    }
    const bucket = byRound.get(match.roundIndex);
    if (bucket === undefined) byRound.set(match.roundIndex, [match]);
    else bucket.push(match);
  }

  const groups: CandidateGroup[] = [...byRound.entries()]
    .sort(([a], [b]) => a - b)
    .map(([roundIndex, roundMatches]) => ({
      key: `round-${roundIndex}`,
      label: `Ronda ${roundIndex}`,
      matches: roundMatches,
    }));

  if (withoutRound.length > 0) {
    groups.push({
      key: "sin-ronda",
      label: "Sin ronda",
      matches: withoutRound,
    });
  }

  return groups;
}

export function DaySchedulePicker({
  dayKey,
  dayLabel,
  candidates,
  onScheduled,
}: DaySchedulePickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [chosenId, setChosenId] = useState<string | null>(null);
  const [time, setTime] = useState(DEFAULT_TIME);
  const [error, setError] = useState<string | null>(null);
  // Local state on purpose: the search text is not in the URL and is not
  // persisted (t07).
  const [query, setQuery] = useState("");
  const [isPending, startTransition] = useTransition();
  const timeInputId = useId();
  const searchInputId = useId();

  const groups = useMemo(() => {
    const filtered = groupByRound(candidates).map((group) => ({
      ...group,
      matches: group.matches.filter((m) => matchesPlayerQuery(m, query)),
    }));
    // A group left empty by the filter is not painted.
    return filtered.filter((group) => group.matches.length > 0);
  }, [candidates, query]);

  // Criterio 16: a day the session has nothing to bring to does not open a
  // picker. Nothing is rendered — not even the trigger.
  if (candidates.length === 0) return null;

  const showSearch = candidates.length > SEARCH_THRESHOLD;
  const hasResults = groups.length > 0;

  const chosen = candidates.find((c) => c.id === chosenId) ?? null;

  function reset() {
    setIsOpen(false);
    setChosenId(null);
    setTime(DEFAULT_TIME);
    setError(null);
    setQuery("");
  }

  function handleChoose(id: string) {
    setError(null);
    setChosenId(id);
  }

  function handleConfirm() {
    if (chosen === null) return;
    setError(null);
    const target = chosen.id;
    // §4.12: the hour is Spanish wall-clock time, resolved on this very day.
    const instant = instantOnDay(dayKey, time);
    startTransition(async () => {
      const result = await setMatchSchedule(target, {
        // `location` is deliberately not sent: moving a match must not wipe
        // where it was going to be played (§5.6 — the action only touches the
        // fields it receives).
        scheduledAt: instant.toISOString(),
      });
      if (result.ok) {
        reset();
        onScheduled?.();
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <section
      data-testid="day-schedule-picker"
      aria-label={`Agendar una partida el ${dayLabel}`}
      className="mt-3 w-full min-w-0"
    >
      {!isOpen && (
        <Button
          variant="secondary"
          size="sm"
          fullWidth
          icon={<CalendarPlus size={14} />}
          onClick={() => setIsOpen(true)}
          className="min-h-[44px]"
        >
          Agendar aquí · {candidates.length} partida
          {candidates.length !== 1 ? "s" : ""}
        </Button>
      )}

      {isOpen && chosen === null && (
        <div
          className="w-full min-w-0 space-y-2 rounded p-3"
          style={{
            background: "var(--bg)",
            border: "1px solid var(--border)",
          }}
        >
          <p
            className="text-[12px]"
            style={{
              color: "var(--fg-muted)",
              fontFamily: "var(--font-sans)",
            }}
          >
            Elige la partida que llevas al {dayLabel}
          </p>

          {/* Past SEARCH_THRESHOLD candidates the list stops fitting in one
              look — an admin gets the whole league (criterio 17). */}
          {showSearch && (
            <div className="flex w-full min-w-0 flex-col gap-[6px]">
              <label
                htmlFor={searchInputId}
                className="text-[11px] font-semibold tracking-[0.04em] uppercase"
                style={{
                  color: "var(--fg-faint)",
                  fontFamily: "var(--font-sans)",
                }}
              >
                Buscar jugador
              </label>
              <div
                className="flex w-full min-w-0 items-center gap-2 rounded px-3 py-[10px]"
                style={{
                  background: "var(--bg-raised)",
                  border: "1px solid var(--border)",
                }}
              >
                <span style={{ color: "var(--fg-faint)" }}>
                  <MagnifyingGlass size={15} />
                </span>
                <input
                  id={searchInputId}
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Nombre de cualquiera de los dos"
                  className="min-h-[24px] w-full min-w-0 flex-1 border-0 bg-transparent text-[14px] outline-none"
                  style={{ color: "var(--fg)", fontFamily: "var(--font-sans)" }}
                />
              </div>
            </div>
          )}

          {hasResults ? (
            /* One single `ul` on purpose: the groups are headings inside it,
               not nested lists, so the picker keeps exposing exactly one list
               to the outside. */
            <ul className="flex w-full min-w-0 flex-col gap-2">
              {groups.map((group, index) => (
                <Fragment key={group.key}>
                  {/* The heading is not one of the items: `presentation` keeps
                      the list's items being the candidates and nothing else. */}
                  <li
                    role="presentation"
                    data-testid="candidate-group"
                    className="w-full min-w-0 pt-1 text-[11px] font-semibold tracking-[0.06em] break-words uppercase"
                    style={{
                      color: "var(--fg-faint)",
                      fontFamily: "var(--font-sans)",
                      // A rule between groups, not above the first one.
                      borderTop:
                        index === 0 ? undefined : "1px solid var(--border)",
                    }}
                  >
                    {group.label}
                  </li>
                  {group.matches.map((candidate) => (
                    <li key={candidate.id} className="w-full min-w-0">
                      <button
                        type="button"
                        onClick={() => handleChoose(candidate.id)}
                        className="flex min-h-[44px] w-full min-w-0 cursor-pointer flex-col items-start gap-[2px] rounded px-3 py-2 text-left transition-colors duration-[120ms]"
                        style={{
                          background: "var(--surface)",
                          border: "1px solid var(--border)",
                          fontFamily: "var(--font-sans)",
                        }}
                      >
                        <span
                          className="w-full text-[14px] font-semibold break-words"
                          style={{ color: "var(--fg)" }}
                        >
                          {matchTitle(candidate)}
                        </span>
                        <span
                          className="w-full text-[11px] break-words"
                          style={{ color: "var(--fg-faint)" }}
                        >
                          {/* §4.5, criterio 14: an already dated match shows
                              its current date, so picking it reads as a move.
                              The round is not repeated here: the group heading
                              right above already says it. */}
                          {candidate.scheduledAt !== null
                            ? `Ahora: ${currentDateLabel(candidate.scheduledAt)} — se mueve aquí`
                            : "Sin fecha"}
                        </span>
                      </button>
                    </li>
                  ))}
                </Fragment>
              ))}
            </ul>
          ) : (
            <p
              role="status"
              data-testid="candidates-empty"
              className="w-full rounded px-3 py-3 text-[12px] break-words"
              style={{
                background: "var(--surface)",
                border: "1px solid var(--border)",
                color: "var(--fg-muted)",
                fontFamily: "var(--font-sans)",
              }}
            >
              Ninguna partida coincide con «{query.trim()}».
            </p>
          )}

          <Button variant="ghost" size="sm" onClick={reset}>
            Cancelar
          </Button>
        </div>
      )}

      {isOpen && chosen !== null && (
        <div
          className="w-full min-w-0 space-y-3 rounded p-3"
          style={{
            background: "var(--bg)",
            border: "1px solid var(--border)",
          }}
        >
          <p
            className="w-full text-[14px] font-semibold break-words"
            style={{ color: "var(--fg)", fontFamily: "var(--font-sans)" }}
          >
            {matchTitle(chosen)}
          </p>
          <p
            className="w-full text-[12px] break-words"
            style={{
              color: "var(--fg-muted)",
              fontFamily: "var(--font-sans)",
            }}
          >
            {dayLabel}
          </p>

          <div className="flex flex-col gap-[6px]">
            <label
              htmlFor={timeInputId}
              className="text-[11px] font-semibold tracking-[0.04em] uppercase"
              style={{
                color: "var(--fg-faint)",
                fontFamily: "var(--font-sans)",
              }}
            >
              Hora
            </label>
            <div
              className="flex w-full min-w-0 items-center gap-2 rounded px-3 py-[10px]"
              style={{
                background: "var(--bg-raised)",
                border: "1px solid var(--border)",
              }}
            >
              <span style={{ color: "var(--fg-faint)" }}>
                <Clock size={15} />
              </span>
              <input
                id={timeInputId}
                type="time"
                value={time}
                onChange={(e) => setTime(e.target.value)}
                className="min-h-[24px] w-full min-w-0 flex-1 border-0 bg-transparent text-[14px] outline-none"
                style={{ color: "var(--fg)", fontFamily: "var(--font-sans)" }}
              />
            </div>
          </div>

          {error !== null && (
            <p
              role="alert"
              className="w-full rounded p-2 text-[12px] break-words"
              style={{
                background: "rgba(220,85,0,0.10)",
                border: "1px solid rgba(220,85,0,0.25)",
                color: "var(--danger)",
                fontFamily: "var(--font-sans)",
              }}
            >
              {error}
            </p>
          )}

          <div className="flex flex-wrap gap-2">
            <Button
              variant="primary"
              size="sm"
              onClick={handleConfirm}
              disabled={isPending}
              className="min-h-[44px]"
            >
              {isPending ? "Guardando…" : "Agendar aquí"}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setChosenId(null)}
              disabled={isPending}
              className="min-h-[44px]"
            >
              Volver
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
