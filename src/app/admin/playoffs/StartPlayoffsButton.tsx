"use client";

// StartPlayoffsButton — client component that calls the startPlayoffs server action.
// Hito 9: playoffs-bracket.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { startPlayoffs } from "@/server/playoff-actions";
import { Button } from "@/components/Button";
import { Trophy } from "@phosphor-icons/react";

export function StartPlayoffsButton({ leagueId }: { leagueId: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);

  async function handleStart() {
    setLoading(true);
    setError(null);
    try {
      const result = await startPlayoffs(leagueId);
      if (result.ok) {
        router.push("/bracket");
        router.refresh();
      } else {
        setError(result.error);
      }
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Error inesperado al iniciar playoffs."
      );
    } finally {
      setLoading(false);
    }
  }

  if (!confirmed) {
    return (
      <Button
        variant="primary"
        icon={<Trophy size={16} />}
        onClick={() => setConfirmed(true)}
      >
        Iniciar playoffs
      </Button>
    );
  }

  return (
    <div className="space-y-3">
      <div
        className="p-3 rounded-[var(--radius-sm)] border text-sm"
        style={{
          borderColor: "var(--accent)",
          background: "color-mix(in srgb, var(--accent) 8%, transparent)",
          color: "var(--fg)",
          fontFamily: "var(--font-sans)",
        }}
      >
        ¿Confirmas que quieres cerrar la fase de liga e iniciar playoffs? Esta
        acción no se puede deshacer.
      </div>
      {error && (
        <p
          className="text-sm"
          style={{ color: "var(--danger)", fontFamily: "var(--font-sans)" }}
        >
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <Button
          variant="primary"
          icon={<Trophy size={16} />}
          disabled={loading}
          onClick={handleStart}
        >
          {loading ? "Iniciando…" : "Confirmar e iniciar"}
        </Button>
        <Button
          variant="ghost"
          disabled={loading}
          onClick={() => setConfirmed(false)}
        >
          Cancelar
        </Button>
      </div>
    </div>
  );
}
