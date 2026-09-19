"use client";

// DuplicateLeagueAction — admin-index action component (multi-liga D2,
// crear-duplicar-borrar). Built against the contract fixed in C2
// (./league-actions-contract.ts); lane B mounts this from /admin/page.tsx.
// spec §2.9, §4.8, criterios 13, 26-30.
//
// Whether the roster gets copied depends entirely on `league.archivedAt`
// (already on the contract's LeagueActionTarget) — this component picks the
// warning copy from it, it never asks the caller for a separate flag.

import { useState, useTransition } from "react";
import { Button } from "@/components/Button";
import { Input } from "@/components/Input";
import { Copy, Warning } from "@phosphor-icons/react";
import { duplicateLeague } from "@/server/league/lifecycle";
import type { DuplicateLeagueActionProps } from "./league-actions-contract";

export function DuplicateLeagueAction({
  league,
  onDuplicated,
}: DuplicateLeagueActionProps) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [name, setName] = useState(`${league.name} (copia)`);
  const [season, setSeason] = useState(league.season);

  const isOriginArchived = league.archivedAt !== null;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setFieldErrors({});

    startTransition(async () => {
      const result = await duplicateLeague(league.id, { name, season });
      if (!result.ok) {
        setError(result.error);
        setFieldErrors(result.fieldErrors ?? {});
        return;
      }
      setOpen(false);
      onDuplicated?.({
        newLeagueId: result.data.id,
        newLeagueSlug: result.data.slug,
        generatedPasscodes: result.data.generatedPasscodes,
      });
    });
  }

  if (!open) {
    return (
      <Button
        variant="ghost"
        size="sm"
        onClick={() => setOpen(true)}
        icon={<Copy size={14} />}
      >
        Duplicar
      </Button>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      noValidate
      className="space-y-3 rounded-[var(--radius-sm)] p-3"
      style={{ border: "1px solid var(--border)", background: "var(--bg-raised)" }}
    >
      <p
        className="text-[12px] font-semibold uppercase tracking-[0.08em]"
        style={{ color: "var(--fg-faint)", fontFamily: "var(--font-sans)" }}
      >
        Duplicar «{league.name}»
      </p>

      <div className="flex items-start gap-2">
        <Warning
          size={16}
          weight="fill"
          style={{ color: isOriginArchived ? "var(--accent)" : "var(--danger)" }}
          className="mt-[1px] shrink-0"
        />
        <p
          className="text-[12px] leading-[16px]"
          style={{ color: "var(--fg-muted)", fontFamily: "var(--font-sans)" }}
        >
          {isOriginArchived
            ? "Esta liga está archivada: se copiará su configuración y una fila por cada jugador activo, con passcodes nuevos."
            : "Esta liga está en circulación: solo se copiará su configuración. La liga nueva nacerá sin jugadores (salvo el admin)."}
        </p>
      </div>

      <Input
        label="Nombre de la nueva liga"
        value={name}
        onChange={(e) => setName(e.target.value)}
        error={fieldErrors.name?.[0]}
        required
      />
      <Input
        label="Temporada"
        value={season}
        onChange={(e) => setSeason(e.target.value)}
        error={fieldErrors.season?.[0]}
        required
      />

      {error && (
        <p
          className="text-[12px] leading-[16px]"
          style={{ color: "var(--danger)", fontFamily: "var(--font-sans)" }}
        >
          {error}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button variant="primary" size="sm" type="submit" disabled={isPending}>
          {isPending ? "Duplicando…" : "Confirmar duplicado"}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          type="button"
          onClick={() => setOpen(false)}
          disabled={isPending}
        >
          Cancelar
        </Button>
      </div>
    </form>
  );
}
