"use client";

// MatchCard — a single match card for the "Mis partidas" view.
// Shows match details and provides contextual actions based on the current user's role.
// SPEC §8: mobile-first, optimized for thumb-on-table use.

import { useState } from "react";
import { Badge } from "@/components";
import { ReportForm } from "./ReportForm";
import { ConfirmActions } from "./ConfirmActions";
import { CalendarBlank, MapPin, Pencil, Flag } from "@phosphor-icons/react";

type MatchStatus = "SCHEDULED" | "REPORTED" | "CONFIRMED" | "DISPUTED";

interface MatchCardProps {
  match: {
    id: string;
    playerHomeId: string;
    playerAwayId: string | null;
    playerHomeName: string;
    playerAwayName: string | null;
    scheduledAt: string | null;
    location: string | null;
    status: MatchStatus;
    result: {
      homeVP: number;
      awayVP: number;
      outcome: string;
      reportedById: string;
      bonusHome: number;
      bonusAway: number;
    } | null;
  };
  // The logged-in player's ID.
  currentPlayerId: string;
  // Whether the current user is admin.
  isAdmin: boolean;
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

export function MatchCard({ match, currentPlayerId, isAdmin }: MatchCardProps) {
  const [showReport, setShowReport] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  const st = STATUS_LABEL[match.status] ?? {
    label: match.status,
    variant: "neutral" as const,
  };

  const isHome = match.playerHomeId === currentPlayerId;
  const isAway = match.playerAwayId === currentPlayerId;
  const isParticipant = isHome || isAway;

  // Determines if this player can report.
  const canReport =
    isAdmin ||
    (isParticipant &&
      (match.status === "SCHEDULED" ||
        match.status === "REPORTED" ||
        match.status === "DISPUTED"));

  // Determines if this player can confirm/dispute.
  // Only the RIVAL (not the reporter) can confirm/dispute; admin uses the admin view.
  const isReporter =
    match.result !== null && match.result.reportedById === currentPlayerId;
  const canConfirmOrDispute =
    !isAdmin &&
    isParticipant &&
    !isReporter &&
    match.status === "REPORTED";

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
        borderColor:
          match.status === "DISPUTED" ? "var(--danger)" : "var(--border)",
        borderWidth: match.status === "DISPUTED" ? "1px" : "1px",
      }}
    >
      {/* Header: players */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          {/* Home vs Away — highlight current player */}
          <p
            className="text-[15px] font-semibold leading-tight"
            style={{ fontFamily: "var(--font-sans)", color: "var(--fg)" }}
          >
            <span
              style={{
                color: isHome ? "var(--accent)" : "var(--fg)",
                fontWeight: isHome ? 700 : 600,
              }}
            >
              {match.playerHomeName}
            </span>
            <span
              className="mx-2 font-normal text-[13px]"
              style={{ color: "var(--fg-faint)" }}
            >
              vs
            </span>
            <span
              style={{
                color: isAway ? "var(--accent)" : "var(--fg)",
                fontWeight: isAway ? 700 : 600,
              }}
            >
              {match.playerAwayName ?? "—"}
            </span>
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
              <span className="italic" style={{ color: "var(--fg-faint)" }}>
                Sin fecha acordada
              </span>
            )}
          </div>

          {/* Result summary (if reported or confirmed) */}
          {match.result && (
            <div
              className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px]"
              style={{
                color: "var(--fg-muted)",
                fontFamily: "var(--font-sans)",
              }}
            >
              <span>
                <strong style={{ color: "var(--fg)" }}>
                  {match.result.homeVP}
                </strong>{" "}
                – {" "}
                <strong style={{ color: "var(--fg)" }}>
                  {match.result.awayVP}
                </strong>{" "}
                VP ·{" "}
                {OUTCOME_LABEL[match.result.outcome] ?? match.result.outcome}
              </span>
              {(match.result.bonusHome > 0 || match.result.bonusAway > 0) && (
                <span style={{ color: "var(--accent)", fontSize: "12px" }}>
                  Bonus: +{match.result.bonusHome} / +{match.result.bonusAway}
                </span>
              )}
            </div>
          )}
        </div>

        {/* Status badge */}
        <div className="flex flex-col items-end gap-2 flex-shrink-0">
          <Badge variant={st.variant}>{st.label}</Badge>
        </div>
      </div>

      {/* Action buttons (collapsed by default for cleanliness) */}
      {!showReport && !showConfirm && (
        <div className="mt-3 flex flex-wrap gap-2">
          {canReport && (
            <button
              onClick={() => {
                setShowConfirm(false);
                setShowReport(true);
              }}
              className="flex items-center gap-1 px-3 py-[7px] rounded text-[13px] font-semibold border transition-colors duration-[120ms] cursor-pointer"
              style={{
                background: "transparent",
                borderColor: "var(--border-strong)",
                color: "var(--fg-muted)",
                fontFamily: "var(--font-sans)",
              }}
            >
              <Flag size={13} />
              {match.result ? "Actualizar resultado" : "Reportar resultado"}
            </button>
          )}
          {canConfirmOrDispute && (
            <button
              onClick={() => {
                setShowReport(false);
                setShowConfirm(true);
              }}
              className="flex items-center gap-1 px-3 py-[7px] rounded text-[13px] font-semibold border transition-colors duration-[120ms] cursor-pointer"
              style={{
                background: "rgba(201,166,107,0.08)",
                borderColor: "rgba(201,166,107,0.3)",
                color: "var(--accent)",
                fontFamily: "var(--font-sans)",
              }}
            >
              <Pencil size={13} />
              Confirmar / Disputar
            </button>
          )}
        </div>
      )}

      {/* Report form */}
      {showReport && (
        <ReportForm
          matchId={match.id}
          playerHomeName={match.playerHomeName}
          playerAwayName={match.playerAwayName ?? "Visitante"}
          onDone={() => setShowReport(false)}
        />
      )}

      {/* Confirm / dispute actions */}
      {showConfirm && (
        <ConfirmActions
          matchId={match.id}
          onDone={() => setShowConfirm(false)}
        />
      )}
    </div>
  );
}
