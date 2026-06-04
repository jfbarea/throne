"use client";

// DisputaCard — single match card for the admin disputes view.
// Shows match details and provides admin resolve form.

import { useState } from "react";
import { Badge } from "@/components";
import { AdminResolveForm } from "./AdminResolveForm";
import { Gavel } from "@phosphor-icons/react";

type MatchStatus = "SCHEDULED" | "REPORTED" | "CONFIRMED" | "DISPUTED";

interface DisputaCardProps {
  match: {
    id: string;
    playerHomeName: string;
    playerAwayName: string | null;
    scheduledAt: string | null;
    status: MatchStatus;
    result: {
      homeVP: number;
      awayVP: number;
      outcome: string;
      reporterName: string;
    } | null;
  };
}

const STATUS_LABEL: Record<
  MatchStatus,
  { label: string; variant: "brass" | "moss" | "ash" | "ember" | "neutral" }
> = {
  SCHEDULED: { label: "Pendiente", variant: "neutral" },
  REPORTED: { label: "Reportada", variant: "brass" },
  CONFIRMED: { label: "Confirmada", variant: "moss" },
  DISPUTED: { label: "Disputada", variant: "ember" },
};

const OUTCOME_LABEL: Record<string, string> = {
  HOME_WIN: "Victoria Local",
  AWAY_WIN: "Victoria Visitante",
  DRAW: "Empate",
};

export function DisputaCard({ match }: DisputaCardProps) {
  const [showResolve, setShowResolve] = useState(false);
  const st = STATUS_LABEL[match.status] ?? {
    label: match.status,
    variant: "neutral" as const,
  };

  return (
    <div
      className="rounded border p-4"
      style={{
        background: "var(--surface)",
        borderColor:
          match.status === "DISPUTED" ? "rgba(220,85,0,0.4)" : "var(--border)",
      }}
    >
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

          {match.result && (
            <div
              className="mt-1 text-[13px]"
              style={{
                color: "var(--fg-muted)",
                fontFamily: "var(--font-sans)",
              }}
            >
              Reportado por{" "}
              <strong style={{ color: "var(--fg)" }}>
                {match.result.reporterName}
              </strong>
              {" · "}
              {match.result.homeVP} – {match.result.awayVP} VP ·{" "}
              {OUTCOME_LABEL[match.result.outcome] ?? match.result.outcome}
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          <Badge variant={st.variant}>{st.label}</Badge>
        </div>
      </div>

      {/* Admin resolve action — hidden for already-confirmed matches */}
      {!showResolve && match.status !== "CONFIRMED" && (
        <div className="mt-3">
          <button
            onClick={() => setShowResolve(true)}
            className="flex items-center gap-1.5 px-3 py-[7px] rounded text-[13px] font-semibold border transition-colors duration-[120ms] cursor-pointer"
            style={{
              background: "transparent",
              borderColor: "rgba(220,85,0,0.4)",
              color: "var(--danger)",
              fontFamily: "var(--font-sans)",
            }}
          >
            <Gavel size={13} />
            Resolver / Confirmar
          </button>
        </div>
      )}

      {showResolve && (
        <AdminResolveForm
          matchId={match.id}
          playerHomeName={match.playerHomeName}
          playerAwayName={match.playerAwayName ?? "Visitante"}
          currentHomeVP={match.result?.homeVP}
          currentAwayVP={match.result?.awayVP}
          currentOutcome={match.result?.outcome}
          onDone={() => setShowResolve(false)}
        />
      )}
    </div>
  );
}
