"use client";

// FactionForm — the player's own faction picker on /mi-perfil.
//
// The initial selection comes from the server already parsed; the form keeps a
// local copy so the dropdown stays responsive, and only the *list* travels to
// `updateOwnFactions` (the server joins and validates it — see
// src/server/profile-actions.ts).

import { useState, useTransition } from "react";
import { Button } from "@/components/Button";
import { FactionSelect } from "@/components/FactionSelect";
import { updateOwnFactions } from "@/server/profile-actions";
import { MAX_FACTIONS_PER_PLAYER } from "@/lib/factions";
import { FloppyDisk, CheckCircle } from "@phosphor-icons/react";

interface FactionFormProps {
  /** The player's currently stored factions, already parsed into a list. */
  initialFactions: string[];
}

export function FactionForm({ initialFactions }: FactionFormProps) {
  const [factions, setFactions] = useState<string[]>(initialFactions);
  const [savedFactions, setSavedFactions] = useState<string[]>(initialFactions);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  // Compared as an ordered list: reordering is a real change the player can
  // save (the first faction is the one that reads as "their" army everywhere).
  const dirty =
    factions.length !== savedFactions.length ||
    factions.some((f, i) => f !== savedFactions[i]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaved(false);
    startTransition(async () => {
      const result = await updateOwnFactions({ factions });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setSavedFactions(factions);
      setSaved(true);
    });
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-4">
      <FactionSelect
        label="Mis facciones"
        value={factions}
        onChange={(next) => {
          setFactions(next);
          setSaved(false);
        }}
        disabled={isPending}
        helper={`Elige hasta ${MAX_FACTIONS_PER_PLAYER}. Se muestran en la clasificación y en los emparejamientos, en el orden en que las eliges.`}
      />

      {error && (
        <p
          className="rounded p-2 text-[12px]"
          style={{
            background: "rgba(184,92,60,0.08)",
            border: "1px solid rgba(184,92,60,0.4)",
            color: "var(--danger)",
            fontFamily: "var(--font-sans)",
          }}
        >
          {error}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="submit"
          variant="primary"
          size="sm"
          disabled={isPending || !dirty}
          icon={<FloppyDisk size={14} />}
        >
          {isPending ? "Guardando…" : "Guardar facciones"}
        </Button>

        {saved && !dirty && (
          <span
            className="flex items-center gap-1.5 text-[12px] font-semibold"
            style={{ color: "var(--accent)", fontFamily: "var(--font-sans)" }}
          >
            <CheckCircle size={14} />
            Guardado
          </span>
        )}
      </div>
    </form>
  );
}
