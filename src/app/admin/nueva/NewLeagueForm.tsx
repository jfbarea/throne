"use client";

// NewLeagueForm — client component for /admin/nueva: creates a brand-new
// league in blank, always alongside its own ADMIN Player row (multi-liga
// spec §2.9, §4.9). Not for editing — /admin/[slug]/liga (lane B) is
// edit-only once that route exists.

import { useState, useTransition } from "react";
import Link from "next/link";
import { Button } from "@/components/Button";
import { Input } from "@/components/Input";
import { Card, CardEyebrow, CardTitle } from "@/components/Card";
import { Divider } from "@/components/Divider";
import {
  TIEBREAKER_VALUES,
  TIEBREAKER_LABELS,
  type Tiebreaker,
} from "@/lib/schemas";
import { createLeague } from "@/server/league/lifecycle";
import { ArrowUp, ArrowDown, Plus } from "@phosphor-icons/react";

interface NewLeagueFormProps {
  /** Precargado con el nombre del admin en la liga en circulación más
   * reciente (spec §4.9); "" cuando esta es la primera liga. Editable. */
  defaultAdminDisplayName: string;
}

export function NewLeagueForm({ defaultAdminDisplayName }: NewLeagueFormProps) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [created, setCreated] = useState<{ id: string; slug: string } | null>(
    null
  );

  const [adminDisplayName, setAdminDisplayName] = useState(
    defaultAdminDisplayName
  );
  const [name, setName] = useState("");
  const [season, setSeason] = useState("");
  const [pointsWin, setPointsWin] = useState("3");
  const [pointsDraw, setPointsDraw] = useState("1");
  const [pointsLoss, setPointsLoss] = useState("0");
  const [bonusEnabled, setBonusEnabled] = useState(false);
  const [bonusMarginThreshold, setBonusMarginThreshold] = useState("");
  const [bonusMinVP, setBonusMinVP] = useState("");
  const [playoffSize, setPlayoffSize] = useState("4");
  const [tiebreakers, setTiebreakers] = useState<Tiebreaker[]>([
    ...TIEBREAKER_VALUES,
  ]);
  const [matchesPerRound, setMatchesPerRound] = useState("2");
  const [startMonth, setStartMonth] = useState("");

  function moveTiebreaker(index: number, direction: "up" | "down") {
    setTiebreakers((prev) => {
      const next = [...prev];
      const swapIdx = direction === "up" ? index - 1 : index + 1;
      if (swapIdx < 0 || swapIdx >= next.length) return prev;
      [next[index], next[swapIdx]] = [next[swapIdx], next[index]];
      return next;
    });
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setFieldErrors({});

    startTransition(async () => {
      const result = await createLeague({
        name,
        season,
        adminDisplayName,
        pointsWin: parseInt(pointsWin, 10) || 0,
        pointsDraw: parseInt(pointsDraw, 10) || 0,
        pointsLoss: parseInt(pointsLoss, 10) || 0,
        bonusEnabled,
        bonusMarginThreshold:
          bonusEnabled && bonusMarginThreshold
            ? parseInt(bonusMarginThreshold, 10) || null
            : null,
        bonusMinVP:
          bonusEnabled && bonusMinVP ? parseInt(bonusMinVP, 10) || null : null,
        playoffSize: parseInt(playoffSize, 10) || 4,
        tiebreakers,
        matchesPerRound: parseInt(matchesPerRound, 10) || 0,
        startMonth: startMonth ? `${startMonth}-01` : null,
      });

      if (!result.ok) {
        setError(result.error);
        setFieldErrors(result.fieldErrors ?? {});
        return;
      }

      setCreated(result.data);
    });
  }

  if (created) {
    return (
      <Card featured className="space-y-4">
        <div>
          <CardEyebrow>Liga creada</CardEyebrow>
          <CardTitle>{name}</CardTitle>
          <p
            className="text-[13px]"
            style={{ color: "var(--fg-muted)", fontFamily: "var(--font-sans)" }}
          >
            Ya puedes terminar de configurarla y dar de alta al resto de
            jugadores.
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <Link href={`/admin/${created.slug}/liga`} className="no-underline">
            <Button variant="primary">Ir a la configuración de la liga</Button>
          </Link>
          <Link href="/admin" className="no-underline">
            <Button variant="ghost">Volver al índice</Button>
          </Link>
        </div>
      </Card>
    );
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

      {/* El admin como jugador (spec §4.9) */}
      <Card>
        <CardEyebrow>Tú, como jugador de esta liga</CardEyebrow>
        <CardTitle>Nombre del admin</CardTitle>
        <p
          className="mt-1 mb-3 text-[13px]"
          style={{ color: "var(--fg-muted)", fontFamily: "var(--font-sans)" }}
        >
          Toda liga nace con una fila de jugador para el admin. Si en esta no
          vas a jugar, puedes darte de baja después desde jugadores.
        </p>
        <Input
          label="Nombre de jugador del admin"
          placeholder="Ej: Comisario Valdris"
          value={adminDisplayName}
          onChange={(e) => setAdminDisplayName(e.target.value)}
          error={fieldErrors.adminDisplayName?.[0]}
          required
        />
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

      {/* Rondas */}
      <Card>
        <CardEyebrow>Rondas mensuales</CardEyebrow>
        <CardTitle>Cupo y mes de arranque</CardTitle>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-2">
          <Input
            label="Partidas por ronda"
            type="number"
            min={1}
            value={matchesPerRound}
            onChange={(e) => setMatchesPerRound(e.target.value)}
            error={fieldErrors.matchesPerRound?.[0]}
            helper="Partidas que cada jugador debe jugar en cada ronda mensual"
          />
          <Input
            label="Mes de arranque"
            type="month"
            value={startMonth}
            onChange={(e) => setStartMonth(e.target.value)}
            error={fieldErrors.startMonth?.[0]}
            helper="Déjalo vacío si aún no lo has decidido — no se podrán generar emparejamientos hasta fijarlo."
          />
        </div>
      </Card>

      {/* Bonus */}
      <Card>
        <CardEyebrow>Bonus opcionales</CardEyebrow>
        <CardTitle>Puntos extra (W40k)</CardTitle>
        <div className="mt-2 space-y-4">
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
          Ordena los criterios de desempate de mayor a menor prioridad. El
          primero se aplica primero.
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

      <Divider />

      <Button
        type="submit"
        variant="primary"
        fullWidth
        disabled={isPending}
        icon={<Plus size={16} />}
      >
        {isPending ? "Creando…" : "Crear liga"}
      </Button>
    </form>
  );
}
