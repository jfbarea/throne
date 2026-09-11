"use client";

// BasesRulesForm — textarea + live preview + explicit save for a league's
// bases prose (multi-liga spec §4.11: "un textarea de markdown con vista
// previa y guardado explícito").
//
// The preview reuses the exact same components the public page renders
// (`BasesBody`, `parseRulesSections`) from src/app/liga/[slug]/bases/ — same
// convention as LeagueForm.tsx reusing @/lib/schemas: importing across
// route folders this lane owns, so "vista previa" can never drift from what
// `/liga/[slug]/bases` actually shows.

import { useState, useTransition } from "react";
import { Button } from "@/components";
import { updateLeagueRules } from "@/server/league/rules";
import {
  BasesBody,
  parseRulesSections,
  type GeneratedRulesLeague,
} from "@/app/liga/[slug]/bases/rules-content";

interface Props {
  leagueId: string;
  initialRulesMarkdown: string;
  archived: boolean;
  league: GeneratedRulesLeague;
}

export function BasesRulesForm({
  leagueId,
  initialRulesMarkdown,
  archived,
  league,
}: Props) {
  const [value, setValue] = useState(initialRulesMarkdown);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [showPreview, setShowPreview] = useState(false);

  function handleSave() {
    setError(null);
    setSaved(false);
    startTransition(async () => {
      const result = await updateLeagueRules(leagueId, value);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setSaved(true);
    });
  }

  const disabled = archived || isPending;
  const sections = parseRulesSections(value);

  return (
    <div className="space-y-4">
      {archived && (
        <div
          className="rounded border px-4 py-3 text-[13px] font-semibold"
          style={{
            background: "var(--ash-100)",
            borderColor: "rgba(122,139,153,0.4)",
            color: "var(--fg-muted)",
            fontFamily: "var(--font-sans)",
          }}
        >
          Esta liga está archivada: las bases se pueden leer, pero no editar.
        </div>
      )}

      <div className="flex flex-col gap-[6px]">
        <label
          htmlFor="rules-markdown"
          className="text-[11px] font-semibold tracking-[0.04em] text-[var(--fg-faint)] uppercase"
          style={{ fontFamily: "var(--font-sans)" }}
        >
          Prosa de las bases (markdown)
        </label>
        <textarea
          id="rules-markdown"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          disabled={disabled}
          rows={20}
          spellCheck={false}
          className="w-full rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--bg-raised)] px-3 py-[10px] text-[13px] text-[var(--fg)] outline-none focus:border-[var(--accent)] disabled:opacity-60"
          style={{ fontFamily: "var(--font-mono)" }}
        />
        <span
          className="text-[11px] leading-[16px] text-[var(--fg-faint)]"
          style={{ fontFamily: "var(--font-sans)" }}
        >
          Cada `## Título` empieza una sección nueva; cada línea o párrafo
          dentro es una viñeta. `**negrita**` y `*cursiva*` se respetan. La
          puntuación, el bonus, los desempates y el formato no se editan aquí:
          salen de la configuración de la liga.
        </span>
      </div>

      <div className="flex gap-2">
        <Button
          type="button"
          variant="secondary"
          onClick={() => setShowPreview((v) => !v)}
        >
          {showPreview ? "Ocultar vista previa" : "Ver vista previa"}
        </Button>
        <Button type="button" onClick={handleSave} disabled={disabled}>
          {isPending ? "Guardando…" : "Guardar bases"}
        </Button>
      </div>

      {error && (
        <div
          className="rounded border px-4 py-3 text-[13px] font-semibold"
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
          className="rounded border px-4 py-3 text-[13px] font-semibold"
          style={{
            background: "var(--moss-100)",
            borderColor: "rgba(107,122,78,0.4)",
            color: "var(--success)",
            fontFamily: "var(--font-sans)",
          }}
        >
          Bases guardadas correctamente.
        </div>
      )}

      {showPreview && (
        <div className="pt-4">
          <BasesBody league={league} sections={sections} />
        </div>
      )}
    </div>
  );
}
