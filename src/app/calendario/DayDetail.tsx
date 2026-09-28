"use client";

// The expanded day of §4.3 (plan/specs/calendario-de-verdad.md), rendered
// below the grid — never on top of it and never in another page.
//
// Two rules of the spec live in the markup itself:
//  - **every match, uncut** (§5.3): the cell caps its dots at 4, the detail
//    does not cap anything, and it has no scroll of its own — "el que scrollea
//    es el documento".
//  - **the picker at the foot** (§4.5, criterio 15): `DaySchedulePicker` is
//    mounted unconditionally so the chain MonthGrid → DayDetail →
//    DaySchedulePicker cannot silently break; whether it shows anything is its
//    own call, and `candidates: []` means "this day opens no picker"
//    (criterio 16), as its props say.

import { Eyebrow } from "@/components/Eyebrow";
import { X } from "@phosphor-icons/react";
import type { CalendarMatch, SchedulableMatch } from "@/server/calendar";
import { DaySchedulePicker } from "./DaySchedulePicker";
import { MatchRow } from "./MatchRow";

export interface DayDetailProps {
  /** "2026-10-17" — the day, resolved in `Europe/Madrid` (§4.12). */
  dayKey: string;
  /** "Sábado 17 de octubre", from `dayLabel`. */
  dayLabel: string;
  /** Every match of the day, uncut (§5.3). */
  matches: CalendarMatch[];
  /** Candidates for this day's picker, already filtered by `eligibleForDay`. */
  schedulable: SchedulableMatch[];
  /** Collapse the day (§4.3: tapping it again closes it). */
  onClose?: () => void;
}

export function DayDetail({
  dayKey,
  dayLabel,
  matches,
  schedulable,
  onClose,
}: DayDetailProps) {
  return (
    <div
      data-testid="day-detail"
      data-day={dayKey}
      className="mt-3 rounded border p-3"
      style={{ background: "var(--bg-raised)", borderColor: "var(--border)" }}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <Eyebrow as="div">{dayLabel}</Eyebrow>
          <p
            className="mt-1 text-[12px]"
            style={{ color: "var(--fg-faint)", fontFamily: "var(--font-sans)" }}
          >
            {matches.length === 0
              ? "Ninguna partida todavía"
              : `${matches.length} partida${matches.length !== 1 ? "s" : ""}`}
          </p>
        </div>
        {onClose !== undefined && (
          <button
            type="button"
            onClick={onClose}
            data-testid="close-day"
            aria-label="Cerrar el día"
            className="flex shrink-0 cursor-pointer items-center gap-1 rounded px-2 py-1 text-[12px] font-semibold"
            style={{
              background: "transparent",
              border: "1px solid var(--border-strong)",
              color: "var(--fg-muted)",
              fontFamily: "var(--font-sans)",
            }}
          >
            <X size={12} />
            Cerrar
          </button>
        )}
      </div>

      {matches.length > 0 && (
        <div className="mt-3 space-y-2">
          {matches.map((match) => (
            <MatchRow key={match.id} match={match} />
          ))}
        </div>
      )}

      <div className="mt-3">
        <DaySchedulePicker
          dayKey={dayKey}
          dayLabel={dayLabel}
          candidates={schedulable}
        />
      </div>
    </div>
  );
}
