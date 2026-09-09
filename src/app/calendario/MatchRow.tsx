"use client";

// Client component: a single match row in the calendar.
// Shows match details and provides an edit-schedule inline form for authorized users.

import { useState } from "react";
import { Badge } from "@/components";
import { ScheduleForm } from "./ScheduleForm";
import { CalendarBlank, MapPin, Pencil } from "@phosphor-icons/react";
import { resolveMatchStatusLabel } from "@/server/round-ui";

interface MatchRowProps {
  match: {
    id: string;
    playerHomeName: string;
    playerAwayName: string | null;
    scheduledAt: string | null; // ISO string or null
    location: string | null;
    status: string;
    // Ronda a la que pertenece la partida (etiqueta, SPEC §4.6). null para
    // partidas de liga sin ronda asignada todavía (PLAN.md H6).
    roundIndex: number | null;
    // Cómo se resolvió el Result (SPEC §4.9). null si todavía no hay Result.
    resolution: string | null;
  };
  // Whether the current user can edit the schedule for this match.
  canEdit: boolean;
}

export function MatchRow({ match, canEdit }: MatchRowProps) {
  const [editing, setEditing] = useState(false);
  // Hito 6 (ui-cupo-y-rondas): the badge honors resolution — WALKOVER and
  // UNPLAYED_DRAW no longer show up looking like an ordinary "Jugada".
  const st = resolveMatchStatusLabel(
    match.status as "SCHEDULED" | "REPORTED" | "CONFIRMED" | "DISPUTED",
    match.resolution as "PLAYED" | "WALKOVER" | "UNPLAYED_DRAW" | null,
    "Jugada"
  );

  const formattedDate = match.scheduledAt
    ? new Date(match.scheduledAt).toLocaleDateString("es-ES", {
        weekday: "short",
        day: "numeric",
        month: "short",
        year: "numeric",
      })
    : null;

  const formattedTime = match.scheduledAt
    ? new Date(match.scheduledAt).toLocaleTimeString("es-ES", {
        hour: "2-digit",
        minute: "2-digit",
      })
    : null;

  return (
    <div
      className="rounded border p-4"
      style={{
        background: "var(--surface)",
        borderColor: "var(--border)",
      }}
    >
      {/* Match header */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p
            className="text-[15px] font-semibold"
            style={{ fontFamily: "var(--font-sans)", color: "var(--fg)" }}
          >
            {match.playerHomeName}
            <span
              className="mx-2 font-normal text-[13px]"
              style={{ color: "var(--fg-faint)" }}
            >
              vs
            </span>
            {match.playerAwayName ?? "—"}
          </p>

          {/* Date and location */}
          <div
            className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px]"
            style={{ color: "var(--fg-faint)", fontFamily: "var(--font-sans)" }}
          >
            {formattedDate ? (
              <>
                <span className="flex items-center gap-1">
                  <CalendarBlank size={12} />
                  {formattedDate}
                  {formattedTime && formattedTime !== "00:00" && (
                    <span className="ml-1">{formattedTime}</span>
                  )}
                </span>
                {match.location && (
                  <span className="flex items-center gap-1">
                    <MapPin size={12} />
                    {match.location}
                  </span>
                )}
              </>
            ) : (
              <span
                className="italic"
                style={{ color: "var(--fg-faint)" }}
              >
                Sin fecha acordada
              </span>
            )}
            {/* Ronda como etiqueta (SPEC §4.6, §6.4: "la ronda aparece como
                agrupador o etiqueta"; la vista sigue siendo la lista por
                scheduledAt). null = todavía sin ronda asignada (PLAN.md H6). */}
            <span>{match.roundIndex !== null ? `Ronda ${match.roundIndex}` : "Sin ronda"}</span>
          </div>
        </div>

        {/* Status badge + edit button */}
        <div className="flex items-center gap-2 flex-shrink-0">
          <Badge variant={st.variant}>{st.label}</Badge>
          {canEdit && !editing && (
            <button
              onClick={() => setEditing(true)}
              className="flex items-center gap-1 px-2 py-1 rounded text-[12px] font-semibold transition-colors duration-[120ms] cursor-pointer"
              style={{
                background: "transparent",
                border: "1px solid var(--border-strong)",
                color: "var(--fg-muted)",
                fontFamily: "var(--font-sans)",
              }}
              title="Fijar / editar fecha"
            >
              <Pencil size={12} />
              <span className="hidden sm:inline">Fecha</span>
            </button>
          )}
        </div>
      </div>

      {/* Inline schedule form */}
      {editing && (
        <ScheduleForm
          matchId={match.id}
          currentScheduledAt={match.scheduledAt}
          currentLocation={match.location}
          onDone={() => setEditing(false)}
        />
      )}
    </div>
  );
}
