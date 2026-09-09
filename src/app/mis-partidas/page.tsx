// "Mis partidas" — matches for the logged-in player (home or away).
// SPEC §8: mobile-first, optimized for thumb-on-table use.
// Admin sees all matches across the league.
//
// Hito 6 (ui-cupo-y-rondas, plan/rondas-con-fecha/PLAN.md, SPEC §4.6,
// criterio 9): reorganized by round instead of by status. Each round is a
// block with its deadline and cupo counter, closest deadline first, closed
// rounds at the end (`sortRoundBlocks`, `roundQuota`/`quotaLabel` — the
// ordering and the cupo calculation are pure functions in src/server/, per
// spec §7.3).

import { prisma } from "@/lib/db";
import { requireAuth } from "@/lib/guards";
import { roundQuota, quotaLabel, type RoundMatchInput } from "@/server/rounds";
import { sortRoundBlocks } from "@/server/round-ui";
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
      roundId: true,
      round: { select: { index: true, deadline: true, closedAt: true } },
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

  type RawMatch = (typeof rawMatches)[number];

  // Stats legend (SPEC §4.9 resolution-aware split, replacing the old
  // status-only Apuntadas/Pendientes/Historial grouping below the fold).
  // Hito 15: REPORTED = has a Result and counts for standings immediately.
  // CONFIRMED/DISPUTED are legacy statuses, kept only for old data.
  const pendingCount = rawMatches.filter((m) => m.status === "SCHEDULED").length;
  const playedCount = rawMatches.filter(
    (m) => m.status === "REPORTED" && (m.result?.resolution ?? "PLAYED") === "PLAYED"
  ).length;
  const walkoverCount = rawMatches.filter(
    (m) => m.result?.resolution === "WALKOVER"
  ).length;
  const unplayedDrawCount = rawMatches.filter(
    (m) => m.result?.resolution === "UNPLAYED_DRAW"
  ).length;
  const legacyMatches = rawMatches.filter(
    (m) => m.status === "CONFIRMED" || m.status === "DISPUTED"
  );

  // Matches that belong to a round, grouped by round (SPEC §4.6, criterio
  // 9). Matches with `roundId = null` — the ones `addMissingLeagueMatches`
  // creates until Hito 8 redistributes them, per PLAN.md H6 — are neither
  // dropped nor guessed into a round: they get their own trailing block
  // below so nothing silently disappears from view.
  const roundedMatches = rawMatches.filter(
    (m) => m.status !== "CONFIRMED" && m.status !== "DISPUTED" && m.roundId !== null
  );
  const unassignedMatches = rawMatches.filter(
    (m) => m.status !== "CONFIRMED" && m.status !== "DISPUTED" && m.roundId === null
  );

  interface RoundBlock {
    roundId: string;
    index: number;
    deadline: Date;
    closedAt: Date | null;
    matches: RawMatch[];
  }

  const blocksByIndex = new Map<number, RoundBlock>();
  for (const m of roundedMatches) {
    if (!m.round || m.roundId === null) continue;
    const existing = blocksByIndex.get(m.round.index);
    if (existing) {
      existing.matches.push(m);
    } else {
      blocksByIndex.set(m.round.index, {
        roundId: m.roundId,
        index: m.round.index,
        deadline: m.round.deadline,
        closedAt: m.round.closedAt,
        matches: [m],
      });
    }
  }
  const roundBlocks = sortRoundBlocks([...blocksByIndex.values()]);

  // Player's own cupo per round (roundQuota/quotaLabel, Hito 2). Only
  // meaningful for a single player — admin's "Todas las partidas" spans
  // every player at once, so it shows an aggregate resolved/total instead
  // (there is no single "cupo" to report across a mixed list of players).
  const matchInputsByPlayer: RoundMatchInput[] = !isAdmin
    ? roundedMatches
        .filter((m) => m.playerAwayId !== null)
        .map((m) => ({
          roundIndex: m.round!.index,
          playerHomeId: m.playerHomeId,
          playerAwayId: m.playerAwayId!,
          hasResult: m.result !== null,
        }))
    : [];

  function roundBlockSubtitle(block: RoundBlock): string {
    const deadlineLabel = block.closedAt
      ? `cerrada el ${block.closedAt.toLocaleDateString("es-ES")}`
      : `cierra ${block.deadline.toLocaleDateString("es-ES", {
          day: "numeric",
          month: "short",
          year: "numeric",
        })}`;

    if (isAdmin) {
      const resolved = block.matches.filter((m) => m.result !== null).length;
      return `${deadlineLabel} · ${resolved} de ${block.matches.length} jugada${
        block.matches.length !== 1 ? "s" : ""
      }`;
    }

    const { required, resolved } = roundQuota(
      currentPlayerId,
      block.index,
      matchInputsByPlayer
    );
    return `${deadlineLabel} · ${quotaLabel(resolved, required)}`;
  }

  function toCardProps(m: RawMatch) {
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

  function renderMatches(matches: RawMatch[]) {
    return (
      <div className="mt-3 space-y-3">
        {matches.map((m) => {
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
    );
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
            {rawMatches.length} partida{rawMatches.length !== 1 ? "s" : ""} ·
            {" "}Pendientes: {pendingCount} · Apuntadas: {playedCount} ·{" "}
            Incomparecencias: {walkoverCount} · Saldadas: {unplayedDrawCount}
            {legacyMatches.length > 0 && <> · Legado: {legacyMatches.length}</>}
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

        {/* Round blocks — SPEC §4.6, criterio 9: closest deadline first,
            closed rounds at the end (sortRoundBlocks). */}
        {roundBlocks.map((block) => (
          <section key={block.roundId}>
            <Eyebrow>
              Ronda {block.index} · {roundBlockSubtitle(block)}
            </Eyebrow>
            {renderMatches(block.matches)}
          </section>
        ))}

        {/* Matches without a round yet (roundId = null) — PLAN.md H6: shown
            explicitly rather than silently dropped or guessed into a round;
            only appears before Hito 8 redistributes a mid-league alta. */}
        {unassignedMatches.length > 0 && (
          <section>
            <Eyebrow>Sin ronda asignada ({unassignedMatches.length})</Eyebrow>
            {renderMatches(unassignedMatches)}
          </section>
        )}

        {/* Legacy (CONFIRMED / DISPUTED from old flow — backward compatibility) */}
        {legacyMatches.length > 0 && (
          <section>
            <Eyebrow>Historial ({legacyMatches.length})</Eyebrow>
            {renderMatches(legacyMatches)}
          </section>
        )}
      </main>
    </div>
  );
}
