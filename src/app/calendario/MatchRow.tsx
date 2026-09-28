"use client";

// One match, as a row. Used twice by the calendar (spec
// plan/specs/calendario-de-verdad.md §6.2): inside the expanded day (§4.3) and
// inside the "Sin fecha" block of the visible month (§4.4).
//
// Two marks this row gained with the grid:
//  - **playoff** (§4.11): the grid no longer filters by `phase = LEAGUE`, so a
//    playoff match has to be visibly different from a league one.
//  - **"jugada, falta la fecha"** (§5.9): a `PLAYED` result with no
//    `scheduledAt`, the legacy shape this spec stopped creating but did not
//    migrate. It has no cell to be painted in, so the only place it can be seen
//    is here, in the "Sin fecha" block, saying why it is odd.
//
// Date and time are formatted in `Europe/Madrid` via `dayLabel`/`timeLabel`
// (§4.12), never with a bare `toLocaleDateString`: the row has to agree with
// the cell the match is painted in, and the browser's zone does not.

import { useState } from "react";
import { Badge } from "@/components";
import { ScheduleForm } from "@/components/ScheduleForm";
import { CalendarBlank, MapPin, Pencil, Trophy } from "@phosphor-icons/react";
import { resolveMatchStatusLabel } from "@/server/round-ui";
import {
  dayKeyOf,
  dayLabel,
  timeLabel,
  type CalendarMatch,
} from "@/server/calendar";

export interface MatchRowProps {
  match: CalendarMatch;
  /** Defaults to the match's own `canEdit`, resolved on the server. */
  canEdit?: boolean;
}

export function MatchRow({ match, canEdit = match.canEdit }: MatchRowProps) {
  const [editing, setEditing] = useState(false);

  // Hito 6 (ui-cupo-y-rondas): the badge honors resolution — WALKOVER and
  // UNPLAYED_DRAW no longer show up looking like an ordinary "Jugada".
  const st = resolveMatchStatusLabel(
    match.status as "SCHEDULED" | "REPORTED" | "CONFIRMED" | "DISPUTED",
    match.resolution as "PLAYED" | "WALKOVER" | "UNPLAYED_DRAW" | null,
    "Jugada"
  );

  const instant =
    match.scheduledAt === null ? null : new Date(match.scheduledAt);
  const formattedDate = instant === null ? null : dayLabel(dayKeyOf(instant));
  const formattedTime = instant === null ? null : timeLabel(instant);

  const isPlayoff = match.phase === "PLAYOFF";
  // §5.9: a result that predates this spec — played, but with no day to sit on.
  const missingDate =
    match.resolution === "PLAYED" && match.scheduledAt === null;

  return (
    <div
      className="rounded border p-3 sm:p-4"
      data-testid="match-row"
      data-match-id={match.id}
      data-phase={match.phase}
      data-mine={match.isMine ? "true" : "false"}
      style={{
        background: "var(--surface)",
        borderColor: isPlayoff ? "var(--accent-deep)" : "var(--border)",
      }}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p
            className="text-[15px] font-semibold break-words"
            style={{ fontFamily: "var(--font-sans)", color: "var(--fg)" }}
          >
            {match.playerHomeName}
            <span
              className="mx-2 text-[13px] font-normal"
              style={{ color: "var(--fg-faint)" }}
            >
              vs
            </span>
            {match.playerAwayName ?? "—"}
          </p>

          <div
            className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px]"
            style={{ color: "var(--fg-faint)", fontFamily: "var(--font-sans)" }}
          >
            {formattedDate !== null ? (
              <span className="flex items-center gap-1">
                <CalendarBlank size={12} />
                {formattedDate}
                {formattedTime !== null && formattedTime !== "00:00" && (
                  <span className="ml-1">{formattedTime}</span>
                )}
              </span>
            ) : (
              <span className="italic" style={{ color: "var(--fg-faint)" }}>
                Sin fecha acordada
              </span>
            )}

            {match.location !== null && match.location !== "" && (
              <span className="flex items-center gap-1">
                <MapPin size={12} />
                {match.location}
              </span>
            )}

            {/* Round as a label (SPEC §4.6). null = playoff (§4.11) or a league
                match with no round assigned yet (§5.2, criterio 36). */}
            <span>
              {isPlayoff
                ? "Playoffs"
                : match.roundIndex !== null
                  ? `Ronda ${match.roundIndex}`
                  : "Sin ronda"}
            </span>
          </div>

          {missingDate && (
            <p
              className="mt-2 text-[12px] font-semibold"
              data-testid="missing-date"
              style={{
                color: "var(--ember-500)",
                fontFamily: "var(--font-sans)",
              }}
            >
              jugada, falta la fecha
            </p>
          )}
        </div>

        <div className="flex shrink-0 flex-col items-end gap-1">
          <div className="flex items-center gap-1">
            {isPlayoff && (
              <span data-testid="playoff-mark">
                <Badge variant="ash">
                  <Trophy size={12} /> Playoff
                </Badge>
              </span>
            )}
            <Badge variant={st.variant}>{st.label}</Badge>
          </div>
          {canEdit && !editing && (
            <button
              onClick={() => setEditing(true)}
              className="flex cursor-pointer items-center gap-1 rounded px-2 py-1 text-[12px] font-semibold transition-colors duration-[120ms]"
              style={{
                background: "transparent",
                border: "1px solid var(--border-strong)",
                color: "var(--fg-muted)",
                fontFamily: "var(--font-sans)",
              }}
              title="Fijar / editar fecha"
            >
              <Pencil size={12} />
              <span>Fecha</span>
            </button>
          )}
        </div>
      </div>

      {editing && (
        <ScheduleForm
          matchId={match.id}
          currentScheduledAt={match.scheduledAt}
          currentLocation={match.location}
          // §4.7, criterio 22: the two ends of the valid range become the
          // `min`/`max` of the `datetime-local`. They are this match's own —
          // `roundDeadline` is null for a playoff match (§4.11) and for one
          // with no round yet (§5.2), which is exactly "no ceiling".
          leagueStartMonth={match.leagueStartMonth}
          roundDeadline={match.roundDeadline}
          // §4.9/criterio 29: without the resolution the form cannot know it
          // must hide "Limpiar fecha".
          resolution={match.resolution}
          onDone={() => setEditing(false)}
        />
      )}
    </div>
  );
}
