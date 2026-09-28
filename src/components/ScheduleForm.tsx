"use client";

// Client component: form to set/edit/clear scheduledAt and location for a match.
// Used inline wherever a participant (or the admin) can agree on a date:
// the calendar row (src/app/calendario/MatchRow.tsx) and the match card in
// "Mis partidas" (src/app/mis-partidas/MatchCard.tsx). It lives in
// src/components/ rather than next to either page precisely because both need
// it — the authorization is the server's job either way (`setMatchSchedule`).

import { useState, useTransition } from "react";
import { Button } from "./Button";
import { Input } from "./Input";
import { setMatchSchedule } from "@/server/match-actions";
import { scheduleBounds } from "@/server/calendar";
import { CalendarBlank, MapPin, X, Check } from "@phosphor-icons/react";

interface ScheduleFormProps {
  matchId: string;
  currentScheduledAt: string | null; // ISO string or null
  currentLocation: string | null;
  /**
   * `League.startMonth` as an ISO string — the floor of §4.7. Optional so the
   * existing call sites keep compiling; without it the input carries no `min`
   * and the server stays the only gate (§5.5: the attributes are the net, not
   * the path).
   */
  leagueStartMonth?: string | null;
  /**
   * `Round.deadline` of this match's round, as an ISO string — the ceiling of
   * §4.6. null/absent for a playoff match or one with no round yet (§4.11,
   * §5.2): those have no ceiling.
   */
  roundDeadline?: string | null;
  /**
   * `Result.resolution` of this match, or null with no result. With `PLAYED`
   * the "Limpiar fecha" button is not rendered (§4.9, criterio 29) — for any
   * role, admin included.
   */
  resolution?: string | null;
  onDone?: () => void;
}

// Format an instant as a datetime-local input value (YYYY-MM-DDTHH:mm).
//
// **Browser-local on purpose.** `datetime-local` — its `value`, its `min` and
// its `max` — has no timezone: the browser reads all three as its own local
// wall clock. `scheduleBounds` returns `Date`s (instants) precisely so nobody
// formats them in `Europe/Madrid` here and hands the input a wall clock it will
// then reinterpret as local, which is how you end up one or two hours off
// (§4.12 governs which *day* a match belongs to, not how this input spells an
// instant). Same arithmetic as the existing value, kept in one place.
const toInputValue = (value: string | Date | null): string => {
  if (!value) return "";
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

export function ScheduleForm({
  matchId,
  currentScheduledAt,
  currentLocation,
  leagueStartMonth,
  roundDeadline,
  resolution,
  onDone,
}: ScheduleFormProps) {
  const [dateValue, setDateValue] = useState(toInputValue(currentScheduledAt));
  const [locationValue, setLocationValue] = useState(currentLocation ?? "");
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // Criterio 22 — the two ends of §4.7, straight from `scheduleBounds`:
  // 00:00 of the 1st of `League.startMonth`, and 23:59 of the round's deadline
  // day in `Europe/Madrid` (§9.5). Either may be null (no league start yet, no
  // round), in which case that end of the input is simply unbounded.
  const bounds = scheduleBounds(
    leagueStartMonth ? new Date(leagueStartMonth) : null,
    roundDeadline ? new Date(roundDeadline) : null
  );
  const minValue = toInputValue(bounds.min);
  const maxValue = toInputValue(bounds.max);

  // §4.9, criterio 29: the date of a PLAYED match may be corrected but not
  // erased, so the button that erases it is not offered. No admin escape —
  // same reason as §4.8.
  const canClear = Boolean(currentScheduledAt) && resolution !== "PLAYED";

  function handleSave() {
    setError(null);
    startTransition(async () => {
      const scheduledAt = dateValue ? new Date(dateValue).toISOString() : null;
      const result = await setMatchSchedule(matchId, {
        scheduledAt,
        location: locationValue.trim() || null,
      });
      if (result.ok) {
        onDone?.();
      } else {
        setError(result.error);
      }
    });
  }

  function handleClear() {
    setError(null);
    startTransition(async () => {
      const result = await setMatchSchedule(matchId, {
        scheduledAt: null,
        location: null,
      });
      if (result.ok) {
        setDateValue("");
        setLocationValue("");
        onDone?.();
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <div
      className="mt-3 space-y-3 rounded p-3"
      style={{
        background: "var(--bg)",
        border: "1px solid var(--border)",
      }}
    >
      <div className="space-y-2">
        <Input
          label="Fecha y hora"
          type="datetime-local"
          value={dateValue}
          onChange={(e) => setDateValue(e.target.value)}
          min={minValue || undefined}
          max={maxValue || undefined}
          leadingIcon={<CalendarBlank size={15} />}
        />
        <Input
          label="Lugar (opcional)"
          type="text"
          value={locationValue}
          onChange={(e) => setLocationValue(e.target.value)}
          placeholder="Ej: Warlotus, GTS Granada…"
          leadingIcon={<MapPin size={15} />}
        />
      </div>

      {error && (
        <p
          className="rounded p-2 text-[12px]"
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
          icon={<Check size={14} />}
          onClick={handleSave}
          disabled={isPending}
        >
          {isPending ? "Guardando…" : "Guardar fecha"}
        </Button>

        {canClear && (
          <Button
            variant="danger"
            size="sm"
            icon={<X size={14} />}
            onClick={handleClear}
            disabled={isPending}
          >
            Limpiar fecha
          </Button>
        )}

        {onDone && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onDone}
            disabled={isPending}
          >
            Cancelar
          </Button>
        )}
      </div>
    </div>
  );
}
