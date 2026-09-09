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
import { CalendarBlank, MapPin, X, Check } from "@phosphor-icons/react";

interface ScheduleFormProps {
  matchId: string;
  currentScheduledAt: string | null; // ISO string or null
  currentLocation: string | null;
  onDone?: () => void;
}

export function ScheduleForm({
  matchId,
  currentScheduledAt,
  currentLocation,
  onDone,
}: ScheduleFormProps) {
  // Format existing date to datetime-local input value (YYYY-MM-DDTHH:mm).
  const toInputValue = (iso: string | null): string => {
    if (!iso) return "";
    const d = new Date(iso);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };

  const [dateValue, setDateValue] = useState(toInputValue(currentScheduledAt));
  const [locationValue, setLocationValue] = useState(currentLocation ?? "");
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

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

        {currentScheduledAt && (
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
