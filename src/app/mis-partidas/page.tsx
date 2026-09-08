// "Mis partidas" — matches for the logged-in player (home or away).
// SPEC §8: mobile-first, optimized for thumb-on-table use.
// Admin sees all matches across the league.

import { prisma } from "@/lib/db";
import { requireAuth } from "@/lib/guards";
import { Eyebrow } from "@/components/Eyebrow";
import { Card } from "@/components/Card";
import { MatchCard } from "./MatchCard";
import { AppHeader } from "@/components/AppHeader";
import Link from "next/link";

export default async function MisPartidasPage() {
  const session = await requireAuth();
  const isAdmin = session.role === "ADMIN";
  const currentPlayerId = session.playerId ?? "";

  // MVP: single active league.
  const league = await prisma.league.findFirst({
    orderBy: { createdAt: "desc" },
  });

  if (!league) {
    return (
      <div
        className="min-h-screen flex flex-col"
        style={{ background: "var(--bg)", color: "var(--fg)" }}
      >
        <AppHeader active="mis-partidas" />
        <main className="flex-1 px-4 py-6 max-w-2xl mx-auto w-full">
          <Card className="text-center py-10">
            <p
              className="text-[15px] font-semibold"
              style={{
                color: "var(--fg-muted)",
                fontFamily: "var(--font-sans)",
              }}
            >
              No hay ninguna liga configurada todavía
            </p>
          </Card>
        </main>
      </div>
    );
  }

  // Build the where clause: admin sees all, player sees their own.
  const where = isAdmin
    ? { leagueId: league.id, phase: "LEAGUE" as const }
    : {
        leagueId: league.id,
        phase: "LEAGUE" as const,
        OR: [
          { playerHomeId: currentPlayerId },
          { playerAwayId: currentPlayerId },
        ],
      };

  const rawMatches = await prisma.match.findMany({
    where,
    orderBy: [{ status: "asc" }, { scheduledAt: "asc" }],
    select: {
      id: true,
      status: true,
      scheduledAt: true,
      location: true,
      playerHomeId: true,
      playerAwayId: true,
      playerHome: { select: { displayName: true } },
      playerAway: { select: { displayName: true } },
      result: {
        select: {
          homeVictoryPoints: true,
          awayVictoryPoints: true,
          outcome: true,
          reportedById: true,
          bonusHome: true,
          bonusAway: true,
          resolution: true,
        },
      },
    },
  });

  // Separate into groups for better UX.
  // Hito 15: REPORTED = apuntada (counts for standings immediately).
  // CONFIRMED only appears in legacy data. DISPUTED is legacy-only too.
  const pending = rawMatches.filter(
    (m) => m.status === "SCHEDULED"
  );
  const reported = rawMatches.filter((m) => m.status === "REPORTED");
  // Legacy statuses: CONFIRMED and DISPUTED are kept for backward compatibility.
  const legacy = rawMatches.filter(
    (m) => m.status === "CONFIRMED" || m.status === "DISPUTED"
  );

  function toCardProps(m: (typeof rawMatches)[number]) {
    return {
      match: {
        id: m.id,
        playerHomeId: m.playerHomeId,
        playerAwayId: m.playerAwayId,
        playerHomeName: m.playerHome.displayName,
        playerAwayName: m.playerAway?.displayName ?? null,
        scheduledAt: m.scheduledAt ? m.scheduledAt.toISOString() : null,
        location: m.location,
        status: m.status as "SCHEDULED" | "REPORTED" | "CONFIRMED" | "DISPUTED",
        result: m.result
          ? {
              homeVP: m.result.homeVictoryPoints,
              awayVP: m.result.awayVictoryPoints,
              outcome: m.result.outcome,
              reportedById: m.result.reportedById,
              bonusHome: m.result.bonusHome,
              bonusAway: m.result.bonusAway,
              resolution: m.result.resolution,
            }
          : null,
      },
      currentPlayerId,
      isAdmin,
    };
  }

  return (
    <div
      className="min-h-screen flex flex-col"
      style={{ background: "var(--bg)", color: "var(--fg)" }}
    >
      <AppHeader active="mis-partidas" />

      <main className="flex-1 px-4 py-6 max-w-2xl mx-auto w-full space-y-8">
        {/* Header */}
        <div>
          <Eyebrow>
            {isAdmin ? "Todas las partidas" : "Mis partidas"} · {league.name}
          </Eyebrow>
          <h1
            className="mt-2 text-[28px] font-semibold leading-tight"
            style={{ fontFamily: "var(--font-display)", color: "var(--fg)" }}
          >
            {isAdmin ? "Gestión de partidas" : "Mis partidas"}
          </h1>
          <p
            className="mt-1 text-[13px]"
            style={{
              color: "var(--fg-muted)",
              fontFamily: "var(--font-sans)",
            }}
          >
            {rawMatches.length} partida{rawMatches.length !== 1 ? "s" : ""} ·{" "}
            {pending.length} pendiente{pending.length !== 1 ? "s" : ""} ·{" "}
            {reported.length} apuntada{reported.length !== 1 ? "s" : ""} ·{" "}
            {legacy.length} legado{legacy.length !== 1 ? "s" : ""}
          </p>
        </div>

        {rawMatches.length === 0 && (
          <Card className="text-center py-10">
            <p
              className="text-[15px] font-semibold"
              style={{
                color: "var(--fg-muted)",
                fontFamily: "var(--font-sans)",
              }}
            >
              {isAdmin
                ? "No hay partidas generadas todavía"
                : "No tienes partidas asignadas"}
            </p>
            {isAdmin && (
              <p
                className="mt-1 text-[13px]"
                style={{
                  color: "var(--fg-faint)",
                  fontFamily: "var(--font-sans)",
                }}
              >
                <Link
                  href="/admin/emparejamientos"
                  style={{ color: "var(--accent)" }}
                >
                  Generar emparejamientos →
                </Link>
              </p>
            )}
          </Card>
        )}

        {/* Reported (apuntadas) — counts for standings immediately */}
        {reported.length > 0 && (
          <section>
            <Eyebrow>Apuntadas ({reported.length})</Eyebrow>
            <div className="mt-3 space-y-3">
              {reported.map((m) => {
                const props = toCardProps(m);
                return (
                  <MatchCard
                    key={m.id}
                    match={props.match}
                    currentPlayerId={props.currentPlayerId}
                    isAdmin={props.isAdmin}
                  />
                );
              })}
            </div>
          </section>
        )}

        {/* Pending (no result yet) */}
        {pending.length > 0 && (
          <section>
            <Eyebrow>Pendientes ({pending.length})</Eyebrow>
            <div className="mt-3 space-y-3">
              {pending.map((m) => {
                const props = toCardProps(m);
                return (
                  <MatchCard
                    key={m.id}
                    match={props.match}
                    currentPlayerId={props.currentPlayerId}
                    isAdmin={props.isAdmin}
                  />
                );
              })}
            </div>
          </section>
        )}

        {/* Legacy (CONFIRMED / DISPUTED from old flow — backward compatibility) */}
        {legacy.length > 0 && (
          <section>
            <Eyebrow>Historial ({legacy.length})</Eyebrow>
            <div className="mt-3 space-y-3">
              {legacy.map((m) => {
                const props = toCardProps(m);
                return (
                  <MatchCard
                    key={m.id}
                    match={props.match}
                    currentPlayerId={props.currentPlayerId}
                    isAdmin={props.isAdmin}
                  />
                );
              })}
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
