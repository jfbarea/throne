"use client";

// MatchCard — a single match card for the "Mis partidas" view.
// Hito 15: simplified flow — any participant (or admin) can report/edit the result.
// No confirmation by rival, no disputes, no admin resolution.
// SPEC §8: mobile-first, optimized for thumb-on-table use.

import { useState } from "react";
import { Badge } from "@/components";
import { ScheduleForm } from "@/components/ScheduleForm";
import { ReportForm } from "./ReportForm";
import { WalkoverForm } from "./WalkoverForm";
import { CalendarBlank, MapPin, Pencil, Flag } from "@phosphor-icons/react";
import { resolveMatchStatusLabel } from "@/server/round-ui";

// REPORTED and CONFIRMED are both "has result" statuses.
// CONFIRMED only appears in legacy data (old confirmation flow); new matches use REPORTED.
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
      // Rondas-con-fecha (Hito 5, SPEC §4.9): how this Result came to be.
      // Consumed by resolveMatchStatusLabel (Hito 6, src/server/round-ui.ts)
      // to label the badge above (Apuntada / Incomparecencia / Saldada sin
      // jugar) instead of collapsing every REPORTED match into "Apuntada".
      resolution: string;
    } | null;
  };
  // The logged-in player's ID.
  currentPlayerId: string;
  // Whether the current user is admin.
  isAdmin: boolean;
}

function outcomeLabel(
  outcome: string,
  homeName: string,
  awayName: string | null
): string {
  if (outcome === "HOME_WIN") return `Victoria de ${homeName}`;
  if (outcome === "AWAY_WIN") return `Victoria de ${awayName ?? "Visitante"}`;
  if (outcome === "DRAW") return "Empate";
  return outcome;
}

export function MatchCard({ match, currentPlayerId, isAdmin }: MatchCardProps) {
  const [showReport, setShowReport] = useState(false);
  const [showWalkover, setShowWalkover] = useState(false);
  const [showSchedule, setShowSchedule] = useState(false);

  // Hito 6 (ui-cupo-y-rondas): the badge honors resolution — WALKOVER and
  // UNPLAYED_DRAW no longer show up looking like an ordinary "Apuntada".
  const st = resolveMatchStatusLabel(
    match.status,
    (match.result?.resolution as "PLAYED" | "WALKOVER" | "UNPLAYED_DRAW" | undefined) ??
      null,
    "Apuntada"
  );

  const isHome = match.playerHomeId === currentPlayerId;
  const isAway = match.playerAwayId === currentPlayerId;
  const isParticipant = isHome || isAway;

  // Hito 15: both participants AND admin can report/edit.
  // Allowed when status is SCHEDULED (fresh) or REPORTED (edit).
  // Admin can always act (canReportInStatus handles admin override server-side).
  const canReportOrEdit =
    isAdmin ||
    (isParticipant &&
      (match.status === "SCHEDULED" || match.status === "REPORTED"));

  // Button label depends on whether a result already exists.
  const reportButtonLabel = match.result ? "Editar resultado" : "Apuntar resultado";

  // Agreeing on a date is a different permission from reporting a result:
  // `setMatchSchedule` (src/server/match-actions.ts) authorizes any
  // participant or the admin and does NOT gate on match status, so the date
  // can still be fixed or corrected on a match whose result is already in.
  // This mirrors the calendar, where the same form has always been available.
  const canSchedule = isAdmin || isParticipant;

  const scheduleButtonLabel = match.scheduledAt ? "Cambiar fecha" : "Poner fecha";

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
        borderColor: "var(--border)",
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

          {/* Result summary (if a result has been recorded) */}
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
                {outcomeLabel(
                  match.result.outcome,
                  match.playerHomeName,
                  match.playerAwayName
                )}
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

      {/* Action buttons: poner/cambiar fecha, apuntar/editar resultado y
          declarar incomparecencia (collapsed by default for cleanliness).
          Incomparecencia needs a real rival — it never applies to a bye. */}
      {!showReport && !showWalkover && !showSchedule &&
        (canSchedule || canReportOrEdit) && (
        <div className="mt-3 flex flex-wrap gap-2">
          {canSchedule && (
            <button
              onClick={() => setShowSchedule(true)}
              className="flex items-center gap-1 px-3 py-[7px] rounded text-[13px] font-semibold border transition-colors duration-[120ms] cursor-pointer"
              style={{
                background: "transparent",
                borderColor: "var(--border-strong)",
                color: "var(--fg-muted)",
                fontFamily: "var(--font-sans)",
              }}
            >
              <CalendarBlank size={13} />
              {scheduleButtonLabel}
            </button>
          )}
          {canReportOrEdit && (
            <button
              onClick={() => setShowReport(true)}
              className="flex items-center gap-1 px-3 py-[7px] rounded text-[13px] font-semibold border transition-colors duration-[120ms] cursor-pointer"
              style={{
                background: "transparent",
                borderColor: "var(--border-strong)",
                color: "var(--fg-muted)",
                fontFamily: "var(--font-sans)",
              }}
            >
              {match.result ? <Pencil size={13} /> : <Flag size={13} />}
              {reportButtonLabel}
            </button>
          )}
          {canReportOrEdit && match.playerAwayId && (
            <button
              onClick={() => setShowWalkover(true)}
              className="flex items-center gap-1 px-3 py-[7px] rounded text-[13px] font-semibold border transition-colors duration-[120ms] cursor-pointer"
              style={{
                background: "transparent",
                borderColor: "var(--border-strong)",
                color: "var(--fg-muted)",
                fontFamily: "var(--font-sans)",
              }}
            >
              <Flag size={13} />
              Incomparecencia
            </button>
          )}
        </div>
      )}

      {/* Schedule form — same component the calendar uses. */}
      {showSchedule && (
        <ScheduleForm
          matchId={match.id}
          currentScheduledAt={match.scheduledAt}
          currentLocation={match.location}
          onDone={() => setShowSchedule(false)}
        />
      )}

      {/* Report / edit form */}
      {showReport && (
        <ReportForm
          matchId={match.id}
          playerHomeName={match.playerHomeName}
          playerAwayName={match.playerAwayName ?? "Visitante"}
          onDone={() => setShowReport(false)}
        />
      )}

      {/* Walkover (incomparecencia) form */}
      {showWalkover && match.playerAwayId && (
        <WalkoverForm
          matchId={match.id}
          playerHomeId={match.playerHomeId}
          playerAwayId={match.playerAwayId}
          playerHomeName={match.playerHomeName}
          playerAwayName={match.playerAwayName ?? "Visitante"}
          onDone={() => setShowWalkover(false)}
        />
      )}
    </div>
  );
}
