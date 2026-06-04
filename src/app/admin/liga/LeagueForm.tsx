"use client";

// LeagueForm — client component for creating/editing league configuration.
// Hito 5: admin-liga-jugadores. SPEC §4.1, §7.1, §7.3.

import { useState, useTransition } from "react";
import { Button } from "@/components/Button";
import { Input } from "@/components/Input";
import { Card, CardEyebrow, CardTitle } from "@/components/Card";
import { Divider } from "@/components/Divider";
import {
  TIEBREAKER_VALUES,
  TIEBREAKER_LABELS,
  type Tiebreaker,
  type LeagueConfigInput,
} from "@/lib/schemas";
import { createLeague, updateLeague } from "@/server/league-actions";
import { ArrowUp, ArrowDown, Plus, FloppyDisk } from "@phosphor-icons/react";
import type { League } from "@/generated/prisma/client";

interface LeagueFormProps {
  /** If provided, we are editing an existing league; otherwise creating. */
  league?: League;
  /** Called after successful save so the page can show feedback. */
  onSaved?: (id: string) => void;
}

function parseTiebreakersSafe(raw: string): Tiebreaker[] {
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed as Tiebreaker[];
  } catch {
    // fallback
  }
  return [...TIEBREAKER_VALUES];
}

export function LeagueForm({ league, onSaved }: LeagueFormProps) {
  const isEditing = !!league;
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [saved, setSaved] = useState(false);

  // Form state
  const [name, setName] = useState(league?.name ?? "");
  const [season, setSeason] = useState(league?.season ?? "");
  const [pointsWin, setPointsWin] = useState(String(league?.pointsWin ?? 3));
  const [pointsDraw, setPointsDraw] = useState(String(league?.pointsDraw ?? 1));
  const [pointsLoss, setPointsLoss] = useState(String(league?.pointsLoss ?? 0));
  const [bonusEnabled, setBonusEnabled] = useState(league?.bonusEnabled ?? false);
  const [bonusMarginThreshold, setBonusMarginThreshold] = useState(
    String(league?.bonusMarginThreshold ?? "")
  );
  const [bonusMinVP, setBonusMinVP] = useState(
    String(league?.bonusMinVP ?? "")
  );
  const [playoffSize, setPlayoffSize] = useState(
    String(league?.playoffSize ?? 4)
  );
  const [tiebreakers, setTiebreakers] = useState<Tiebreaker[]>(
    league ? parseTiebreakersSafe(league.tiebreakers) : [...TIEBREAKER_VALUES]
  );

  // Tiebreaker reordering helpers
  function moveTiebreaker(index: number, direction: "up" | "down") {
    setTiebreakers((prev) => {
      const next = [...prev];
      const swapIdx = direction === "up" ? index - 1 : index + 1;
      if (swapIdx < 0 || swapIdx >= next.length) return prev;
      [next[index], next[swapIdx]] = [next[swapIdx], next[index]];
      return next;
    });
  }

  function buildInput(): LeagueConfigInput {
    return {
      name,
      season,
      pointsWin: parseInt(pointsWin, 10) || 0,
      pointsDraw: parseInt(pointsDraw, 10) || 0,
      pointsLoss: parseInt(pointsLoss, 10) || 0,
      bonusEnabled,
      bonusMarginThreshold:
        bonusEnabled && bonusMarginThreshold
          ? parseInt(bonusMarginThreshold, 10) || null
          : null,
      bonusMinVP:
        bonusEnabled && bonusMinVP
          ? parseInt(bonusMinVP, 10) || null
          : null,
      playoffSize: parseInt(playoffSize, 10) || 4,
      tiebreakers,
    };
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setFieldErrors({});
    setSaved(false);

    const input = buildInput();

    startTransition(async () => {
      const result = isEditing
        ? await updateLeague(league.id, input)
        : await createLeague(input);

      if (!result.ok) {
        setError(result.error);
        setFieldErrors(result.fieldErrors ?? {});
        return;
      }

      setSaved(true);
      if (!isEditing && result.ok && result.data) {
        onSaved?.(result.data.id);
      } else {
        onSaved?.(league!.id);
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-6">
      {/* Identidad */}
      <Card featured>
        <CardEyebrow>Identidad de la liga</CardEyebrow>
        <CardTitle>Nombre y temporada</CardTitle>
        <div className="space-y-4 mt-2">
          <Input
            label="Nombre de la liga"
            placeholder="Ej: Liga Capítulo Hierro"
            value={name}
            onChange={(e) => setName(e.target.value)}
            error={fieldErrors.name?.[0]}
            required
          />
          <Input
            label="Temporada"
            placeholder="Ej: 2026 Primavera"
            value={season}
            onChange={(e) => setSeason(e.target.value)}
            error={fieldErrors.season?.[0]}
            required
          />
        </div>
      </Card>

      {/* Puntuación */}
      <Card>
        <CardEyebrow>Sistema de puntuación</CardEyebrow>
        <CardTitle>Puntos por resultado</CardTitle>
        <div className="grid grid-cols-3 gap-4 mt-2">
          <Input
            label="Victoria"
            type="number"
            min={0}
            value={pointsWin}
            onChange={(e) => setPointsWin(e.target.value)}
            error={fieldErrors.pointsWin?.[0]}
          />
          <Input
            label="Empate"
            type="number"
            min={0}
            value={pointsDraw}
            onChange={(e) => setPointsDraw(e.target.value)}
            error={fieldErrors.pointsDraw?.[0]}
          />
          <Input
            label="Derrota"
            type="number"
            min={0}
            value={pointsLoss}
            onChange={(e) => setPointsLoss(e.target.value)}
            error={fieldErrors.pointsLoss?.[0]}
          />
        </div>
      </Card>

      {/* Bonus */}
      <Card>
        <CardEyebrow>Bonus opcionales</CardEyebrow>
        <CardTitle>Puntos extra (W40k)</CardTitle>
        <div className="mt-2 space-y-4">
          {/* Toggle */}
          <label
            className="flex items-center gap-3 cursor-pointer select-none"
            style={{ fontFamily: "var(--font-sans)" }}
          >
            <input
              type="checkbox"
              checked={bonusEnabled}
              onChange={(e) => setBonusEnabled(e.target.checked)}
              className="w-4 h-4 accent-[var(--accent)]"
            />
            <span
              className="text-[14px] font-semibold"
              style={{ color: "var(--fg)" }}
            >
              Activar bonus de liga
            </span>
          </label>
          {fieldErrors.bonusEnabled?.[0] && (
            <p
              className="text-[11px]"
              style={{ color: "var(--danger)", fontFamily: "var(--font-sans)" }}
            >
              {fieldErrors.bonusEnabled[0]}
            </p>
          )}

          {bonusEnabled && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Input
                label="Umbral de masacre (VP de diferencia)"
                placeholder="Ej: 20"
                type="number"
                min={1}
                value={bonusMarginThreshold}
                onChange={(e) => setBonusMarginThreshold(e.target.value)}
                helper="Punto extra si el ganador supera al rival por este margen de VP"
                error={fieldErrors.bonusMarginThreshold?.[0]}
              />
              <Input
                label="VP mínimos para bonus"
                placeholder="Ej: 40"
                type="number"
                min={1}
                value={bonusMinVP}
                onChange={(e) => setBonusMinVP(e.target.value)}
                helper="Punto extra si el jugador alcanza este mínimo de VP (aunque pierda)"
                error={fieldErrors.bonusMinVP?.[0]}
              />
            </div>
          )}
        </div>
      </Card>

      {/* Playoffs */}
      <Card>
        <CardEyebrow>Playoffs</CardEyebrow>
        <CardTitle>Clasificados</CardTitle>
        <div className="mt-2">
          <Input
            label="Jugadores que clasifican a playoffs"
            type="number"
            min={2}
            value={playoffSize}
            onChange={(e) => setPlayoffSize(e.target.value)}
            error={fieldErrors.playoffSize?.[0]}
            helper="Debe ser menor o igual al número de jugadores activos"
          />
        </div>
      </Card>

      {/* Tiebreakers */}
      <Card>
        <CardEyebrow>Desempates</CardEyebrow>
        <CardTitle>Criterios de clasificación</CardTitle>
        <p
          className="mt-1 mb-3 text-[13px]"
          style={{ color: "var(--fg-muted)", fontFamily: "var(--font-sans)" }}
        >
          Ordena los criterios de desempate de mayor a menor prioridad (arrastra
          con las flechas). El primero se aplica primero.
        </p>
        {fieldErrors.tiebreakers?.[0] && (
          <p
            className="mb-2 text-[11px]"
            style={{ color: "var(--danger)", fontFamily: "var(--font-sans)" }}
          >
            {fieldErrors.tiebreakers[0]}
          </p>
        )}
        <ol className="space-y-1">
          {tiebreakers.map((tb, i) => (
            <li
              key={tb}
              className="flex items-center gap-3 px-3 py-2 rounded"
              style={{
                background: "var(--surface-hover)",
                border: "1px solid var(--border)",
              }}
            >
              <span
                className="text-[11px] font-bold w-5 text-right flex-shrink-0"
                style={{ color: "var(--fg-faint)", fontFamily: "var(--font-mono)" }}
              >
                {i + 1}.
              </span>
              <span
                className="flex-1 text-[13px] font-semibold"
                style={{ color: "var(--fg)", fontFamily: "var(--font-sans)" }}
              >
                {TIEBREAKER_LABELS[tb]}
              </span>
              <div className="flex gap-1">
                <button
                  type="button"
                  disabled={i === 0}
                  onClick={() => moveTiebreaker(i, "up")}
                  className="p-1 rounded disabled:opacity-30 transition-opacity"
                  style={{ color: "var(--fg-faint)" }}
                  aria-label={`Subir ${TIEBREAKER_LABELS[tb]}`}
                >
                  <ArrowUp size={14} />
                </button>
                <button
                  type="button"
                  disabled={i === tiebreakers.length - 1}
                  onClick={() => moveTiebreaker(i, "down")}
                  className="p-1 rounded disabled:opacity-30 transition-opacity"
                  style={{ color: "var(--fg-faint)" }}
                  aria-label={`Bajar ${TIEBREAKER_LABELS[tb]}`}
                >
                  <ArrowDown size={14} />
                </button>
              </div>
            </li>
          ))}
        </ol>
      </Card>

      {/* Error / success banners */}
      {error && (
        <div
          className="px-4 py-3 rounded border text-[13px] font-semibold"
          style={{
            background: "var(--ember-100)",
            borderColor: "rgba(184,92,60,0.4)",
            color: "var(--danger)",
            fontFamily: "var(--font-sans)",
          }}
        >
          {error}
        </div>
      )}
      {saved && !error && (
        <div
          className="px-4 py-3 rounded border text-[13px] font-semibold"
          style={{
            background: "var(--moss-100)",
            borderColor: "rgba(107,122,78,0.4)",
            color: "var(--success)",
            fontFamily: "var(--font-sans)",
          }}
        >
          {isEditing ? "Configuración guardada correctamente." : "Liga creada correctamente."}
        </div>
      )}

      <Divider />

      <Button
        type="submit"
        variant="primary"
        fullWidth
        disabled={isPending}
        icon={isEditing ? <FloppyDisk size={16} /> : <Plus size={16} />}
      >
        {isPending
          ? "Guardando…"
          : isEditing
          ? "Guardar cambios"
          : "Crear liga"}
      </Button>
    </form>
  );
}
