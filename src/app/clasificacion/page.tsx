// Standings page — clasificación con desempates. SPEC §7.3, §8.
// Accessible to admin and all players. Mobile-first, dark mode, editorial feel.
// font-variant-numeric: tabular-nums for stat columns (Hito 3 reviewer suggestion).

import { prisma } from "@/lib/db";
import { requireAuth } from "@/lib/guards";
import { computeStandings } from "@/server/standings";
import { parseTiebreakers } from "@/lib/schemas";
import { Eyebrow } from "@/components/Eyebrow";
import { Card } from "@/components/Card";
import { AppHeader } from "@/components/AppHeader";
import {
  Trophy,
  Sword,
  ChartBar,
} from "@phosphor-icons/react/dist/ssr";

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default async function ClasificacionPage() {
  const session = await requireAuth();

  // MVP: single active league.
  const league = await prisma.league.findFirst({
    orderBy: { createdAt: "desc" },
  });

  if (!league) {
    return (
      <PageShell>
        <EmptyState message="No hay ninguna liga configurada todavía." />
      </PageShell>
    );
  }

  // Fetch all active players for this league (so players with 0 matches appear).
  const players = await prisma.player.findMany({
    where: { leagueId: league.id, active: true },
    select: { id: true, displayName: true, faction: true },
    orderBy: { createdAt: "asc" },
  });

  // Fetch all LEAGUE matches with their results.
  // Defensive orderBy: createdAt asc ensures a stable, reproducible query result
  // across DB implementations (SQLite, Postgres) regardless of internal row order.
  const rawMatches = await prisma.match.findMany({
    where: { leagueId: league.id, phase: "LEAGUE" },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      status: true,
      phase: true,
      playerHomeId: true,
      playerAwayId: true,
      result: {
        select: {
          homeVictoryPoints: true,
          awayVictoryPoints: true,
          outcome: true,
          bonusHome: true,
          bonusAway: true,
        },
      },
    },
  });

  // Map to StandingsMatch shape.
  const standingsMatches = rawMatches.map((m) => ({
    id: m.id,
    status: m.status as string,
    phase: m.phase as string,
    playerHomeId: m.playerHomeId,
    playerAwayId: m.playerAwayId,
    result: m.result
      ? {
          homeVictoryPoints: m.result.homeVictoryPoints,
          awayVictoryPoints: m.result.awayVictoryPoints,
          outcome: m.result.outcome as string,
          bonusHome: m.result.bonusHome,
          bonusAway: m.result.bonusAway,
        }
      : null,
  }));

  const playerIds = players.map((p) => p.id);

  const standingsConfig = {
    pointsWin: league.pointsWin,
    pointsDraw: league.pointsDraw,
    pointsLoss: league.pointsLoss,
    tiebreakers: league.tiebreakers,
    playoffSize: league.playoffSize,
  };

  const standings = computeStandings(
    standingsMatches,
    standingsConfig,
    playerIds
  );

  // Build a map for player display names and factions.
  const playerMap = new Map(
    players.map((p) => [p.id, { displayName: p.displayName, faction: p.faction }])
  );

  const tiebreakers = parseTiebreakers(league.tiebreakers);

  // Hito 15: count matches with result (REPORTED or CONFIRMED legacy).
  const confirmedCount = rawMatches.filter(
    (m) => m.status === "REPORTED" || m.status === "CONFIRMED"
  ).length;
  const totalMatches = rawMatches.length;

  return (
    <PageShell>
      {/* Header section */}
      <div className="mb-6">
        <Eyebrow>
          <ChartBar size={12} className="inline mr-1" />
          Clasificación · {league.name}
        </Eyebrow>
        <h1
          className="mt-2 text-[28px] font-semibold leading-tight"
          style={{ fontFamily: "var(--font-display)", color: "var(--fg)" }}
        >
          {league.name}
        </h1>
        <p
          className="mt-1 text-[13px]"
          style={{
            color: "var(--fg-muted)",
            fontFamily: "var(--font-sans)",
          }}
        >
          {league.season} · {confirmedCount} de {totalMatches} partidas jugadas
        </p>
      </div>

      {/* Playoff zone legend */}
      {league.playoffSize > 0 && standings.length > 0 && (
        <div
          className="mb-4 flex items-center gap-2 px-3 py-2 rounded text-[12px]"
          style={{
            background: "var(--moss-100)",
            border: "1px solid var(--moss-400)",
            color: "var(--moss-500)",
            fontFamily: "var(--font-sans)",
          }}
        >
          <Trophy size={13} />
          <span>
            Los {league.playoffSize} primeros clasificados avanzan a playoffs
          </span>
        </div>
      )}

      {standings.length === 0 ? (
        <EmptyState message="No hay partidas con resultado apuntado todavía. La clasificación aparecerá aquí en cuanto se apunte el primer resultado." />
      ) : (
        <>
          {/* Desktop table (md+) */}
          <div className="hidden md:block">
            <StandingsTable
              standings={standings}
              playerMap={playerMap}
              currentPlayerId={session.playerId ?? null}
            />
          </div>

          {/* Mobile cards (< md) */}
          <div className="md:hidden space-y-2">
            {standings.map((row) => {
              const player = playerMap.get(row.playerId);
              const isSelf = session.playerId === row.playerId;
              return (
                <StandingCard
                  key={row.playerId}
                  row={row}
                  displayName={player?.displayName ?? row.playerId}
                  faction={player?.faction ?? null}
                  isSelf={isSelf}
                />
              );
            })}
          </div>

          {/* Tiebreaker info */}
          <div className="mt-6">
            <TiebreakerInfo tiebreakers={tiebreakers} />
          </div>
        </>
      )}
    </PageShell>
  );
}

// ---------------------------------------------------------------------------
// Desktop table component
// ---------------------------------------------------------------------------

function StandingsTable({
  standings,
  playerMap,
  currentPlayerId,
}: {
  standings: Awaited<ReturnType<typeof computeStandings>>;
  playerMap: Map<string, { displayName: string; faction: string | null }>;
  currentPlayerId: string | null;
}) {
  return (
    <div
      className="rounded overflow-hidden"
      style={{ border: "1px solid var(--border)" }}
    >
      <table className="w-full border-collapse text-[13px]" style={{ fontFamily: "var(--font-sans)" }}>
        <thead>
          <tr
            style={{
              background: "var(--bg-raised)",
              borderBottom: "1px solid var(--border)",
            }}
          >
            <th
              className="px-3 py-2.5 text-left font-semibold text-[11px] uppercase tracking-[0.07em]"
              style={{ color: "var(--fg-faint)" }}
            >
              #
            </th>
            <th
              className="px-3 py-2.5 text-left font-semibold text-[11px] uppercase tracking-[0.07em]"
              style={{ color: "var(--fg-faint)" }}
            >
              Jugador
            </th>
            <th
              className="px-3 py-2.5 text-center font-semibold text-[11px] uppercase tracking-[0.07em]"
              style={{ color: "var(--fg-faint)" }}
              title="Partidas jugadas"
            >
              PJ
            </th>
            <th
              className="px-3 py-2.5 text-center font-semibold text-[11px] uppercase tracking-[0.07em]"
              style={{ color: "var(--fg-faint)" }}
              title="Victorias"
            >
              V
            </th>
            <th
              className="px-3 py-2.5 text-center font-semibold text-[11px] uppercase tracking-[0.07em]"
              style={{ color: "var(--fg-faint)" }}
              title="Empates"
            >
              E
            </th>
            <th
              className="px-3 py-2.5 text-center font-semibold text-[11px] uppercase tracking-[0.07em]"
              style={{ color: "var(--fg-faint)" }}
              title="Derrotas"
            >
              D
            </th>
            <th
              className="px-3 py-2.5 text-center font-semibold text-[11px] uppercase tracking-[0.07em]"
              style={{ color: "var(--accent)" }}
              title="Puntos de liga"
            >
              Pts
            </th>
            <th
              className="px-3 py-2.5 text-center font-semibold text-[11px] uppercase tracking-[0.07em]"
              style={{ color: "var(--fg-faint)" }}
              title="VP a favor"
            >
              VP+
            </th>
            <th
              className="px-3 py-2.5 text-center font-semibold text-[11px] uppercase tracking-[0.07em]"
              style={{ color: "var(--fg-faint)" }}
              title="VP en contra"
            >
              VP-
            </th>
            <th
              className="px-3 py-2.5 text-center font-semibold text-[11px] uppercase tracking-[0.07em]"
              style={{ color: "var(--fg-faint)" }}
              title="Diferencia de VP"
            >
              Dif
            </th>
          </tr>
        </thead>
        <tbody>
          {standings.map((row, idx) => {
            const player = playerMap.get(row.playerId);
            const displayName = player?.displayName ?? row.playerId;
            const faction = player?.faction ?? null;
            const isSelf = currentPlayerId === row.playerId;
            const isInZone = row.inPlayoffZone;
            const isLastInZone = isInZone && !standings[idx + 1]?.inPlayoffZone;

            return (
              <tr
                key={row.playerId}
                style={{
                  background: isSelf
                    ? "color-mix(in srgb, var(--accent) 8%, transparent)"
                    : idx % 2 === 0
                    ? "var(--bg)"
                    : "var(--bg-raised)",
                  borderBottom: isLastInZone
                    ? "2px solid var(--moss-400)"
                    : "1px solid var(--border)",
                }}
              >
                {/* Rank */}
                <td
                  className="px-3 py-2.5 text-center font-semibold"
                  style={{
                    fontVariantNumeric: "tabular-nums",
                    color: isInZone ? "var(--moss-500)" : "var(--fg-faint)",
                    minWidth: "2rem",
                  }}
                >
                  {isInZone ? (
                    <span className="flex items-center justify-center gap-1">
                      <Trophy size={11} />
                      {row.rank}
                    </span>
                  ) : (
                    row.rank
                  )}
                </td>

                {/* Player name */}
                <td className="px-3 py-2.5" style={{ minWidth: "8rem" }}>
                  <span
                    className="font-semibold"
                    style={{
                      color: isSelf ? "var(--accent)" : "var(--fg)",
                    }}
                  >
                    {displayName}
                    {isSelf && (
                      <span
                        className="ml-1.5 text-[10px] font-normal"
                        style={{ color: "var(--accent)" }}
                      >
                        (tú)
                      </span>
                    )}
                  </span>
                  {faction && (
                    <div
                      className="text-[11px] mt-0.5"
                      style={{ color: "var(--fg-faint)" }}
                    >
                      {faction}
                    </div>
                  )}
                </td>

                {/* Stats with tabular-nums */}
                <StatCell value={row.played} />
                <StatCell value={row.wins} />
                <StatCell value={row.draws} />
                <StatCell value={row.losses} />

                {/* Points — highlighted */}
                <td
                  className="px-3 py-2.5 text-center font-bold"
                  style={{
                    fontVariantNumeric: "tabular-nums",
                    color: "var(--accent)",
                  }}
                >
                  {row.points}
                </td>

                <StatCell value={row.vpFor} />
                <StatCell value={row.vpAgainst} />

                {/* VP diff — colored */}
                <td
                  className="px-3 py-2.5 text-center font-semibold"
                  style={{
                    fontVariantNumeric: "tabular-nums",
                    color:
                      row.vpDiff > 0
                        ? "var(--moss-500)"
                        : row.vpDiff < 0
                        ? "var(--ember-500)"
                        : "var(--fg-faint)",
                  }}
                >
                  {row.vpDiff > 0 ? "+" : ""}
                  {row.vpDiff}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function StatCell({ value }: { value: number }) {
  return (
    <td
      className="px-3 py-2.5 text-center"
      style={{
        fontVariantNumeric: "tabular-nums",
        color: "var(--fg-muted)",
      }}
    >
      {value}
    </td>
  );
}

// ---------------------------------------------------------------------------
// Mobile card component
// ---------------------------------------------------------------------------

function StandingCard({
  row,
  displayName,
  faction,
  isSelf,
}: {
  row: Awaited<ReturnType<typeof computeStandings>>[number];
  displayName: string;
  faction: string | null;
  isSelf: boolean;
}) {
  const isInZone = row.inPlayoffZone;

  return (
    <div
      className="rounded-[var(--radius-sm)] border p-4"
      style={{
        borderColor: "var(--border)",
        borderLeft: isInZone
          ? "3px solid var(--moss-500)"
          : "3px solid transparent",
        background: isSelf
          ? "color-mix(in srgb, var(--accent) 5%, var(--surface))"
          : "var(--surface)",
      }}
    >
      {/* Top row: rank + name + points */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2.5 min-w-0">
          {/* Rank badge */}
          <span
            className="flex-shrink-0 w-7 h-7 flex items-center justify-center rounded text-[13px] font-bold"
            style={{
              fontVariantNumeric: "tabular-nums",
              background: isInZone ? "var(--moss-100)" : "var(--bg-raised)",
              color: isInZone ? "var(--moss-500)" : "var(--fg-faint)",
              border: isInZone
                ? "1px solid var(--moss-400)"
                : "1px solid var(--border)",
            }}
          >
            {row.rank}
          </span>

          {/* Name + faction */}
          <div className="min-w-0">
            <div
              className="font-semibold text-[14px] leading-tight truncate"
              style={{ color: isSelf ? "var(--accent)" : "var(--fg)" }}
            >
              {displayName}
              {isSelf && (
                <span
                  className="ml-1 text-[10px] font-normal"
                  style={{ color: "var(--accent)" }}
                >
                  (tú)
                </span>
              )}
            </div>
            {faction && (
              <div
                className="text-[11px] truncate"
                style={{ color: "var(--fg-faint)" }}
              >
                {faction}
              </div>
            )}
          </div>
        </div>

        {/* Points — big and prominent */}
        <div className="flex-shrink-0 text-right">
          <div
            className="text-[22px] font-bold leading-none"
            style={{
              fontVariantNumeric: "tabular-nums",
              color: "var(--accent)",
              fontFamily: "var(--font-display)",
            }}
          >
            {row.points}
          </div>
          <div
            className="text-[10px] uppercase tracking-[0.07em]"
            style={{ color: "var(--fg-faint)", fontFamily: "var(--font-sans)" }}
          >
            pts
          </div>
        </div>
      </div>

      {/* Stats row */}
      <div
        className="mt-3 pt-3 grid grid-cols-7 gap-1 text-center text-[11px]"
        style={{
          borderTop: "1px solid var(--border)",
          fontFamily: "var(--font-sans)",
        }}
      >
        <MobileStat label="PJ" value={row.played} />
        <MobileStat label="V" value={row.wins} color="var(--moss-500)" />
        <MobileStat label="E" value={row.draws} />
        <MobileStat label="D" value={row.losses} color="var(--ember-500)" />
        <MobileStat label="VP+" value={row.vpFor} />
        <MobileStat label="VP-" value={row.vpAgainst} />
        <MobileStat
          label="Dif"
          value={row.vpDiff}
          showSign
          color={
            row.vpDiff > 0
              ? "var(--moss-500)"
              : row.vpDiff < 0
              ? "var(--ember-500)"
              : undefined
          }
        />
      </div>

      {/* Playoff zone tag */}
      {isInZone && (
        <div
          className="mt-2 flex items-center gap-1 text-[10px] font-semibold"
          style={{ color: "var(--moss-500)", fontFamily: "var(--font-sans)" }}
        >
          <Trophy size={10} />
          Clasificado para playoffs
        </div>
      )}
    </div>
  );
}

function MobileStat({
  label,
  value,
  showSign = false,
  color,
}: {
  label: string;
  value: number;
  showSign?: boolean;
  color?: string;
}) {
  const display = showSign && value > 0 ? `+${value}` : String(value);
  return (
    <div>
      <div
        className="font-bold text-[12px]"
        style={{
          fontVariantNumeric: "tabular-nums",
          color: color ?? "var(--fg-muted)",
        }}
      >
        {display}
      </div>
      <div style={{ color: "var(--fg-faint)", fontSize: "10px" }}>{label}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tiebreaker info panel
// ---------------------------------------------------------------------------

const TIEBREAKER_LABELS: Record<string, string> = {
  POINTS: "Puntos de liga",
  VP_DIFF: "Diferencia de VP",
  VP_FOR: "VP a favor",
  HEAD_TO_HEAD: "Enfrentamiento directo",
  LOSSES: "Menor nº de derrotas",
  ID_ORDER: "Orden de alta (desempate final)",
};

function TiebreakerInfo({ tiebreakers }: { tiebreakers: string[] }) {
  return (
    <details
      className="rounded text-[12px]"
      style={{
        border: "1px solid var(--border)",
        fontFamily: "var(--font-sans)",
      }}
    >
      <summary
        className="px-3 py-2 cursor-pointer select-none font-semibold"
        style={{ color: "var(--fg-faint)" }}
      >
        Criterios de desempate
      </summary>
      <ol
        className="px-4 pb-3 pt-1 space-y-1"
        style={{ color: "var(--fg-muted)" }}
      >
        {tiebreakers.map((tb, i) => (
          <li key={tb} className="flex items-center gap-2">
            <span
              className="flex-shrink-0 w-4 text-right"
              style={{ color: "var(--fg-faint)" }}
            >
              {i + 1}.
            </span>
            <span>{TIEBREAKER_LABELS[tb] ?? tb}</span>
          </li>
        ))}
      </ol>
    </details>
  );
}

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

function EmptyState({ message }: { message: string }) {
  return (
    <Card className="text-center py-10">
      <Sword size={28} style={{ color: "var(--fg-faint)", margin: "0 auto 8px" }} />
      <p
        className="text-[15px] font-semibold"
        style={{
          color: "var(--fg-muted)",
          fontFamily: "var(--font-sans)",
        }}
      >
        {message}
      </p>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Page shell with navigation
// ---------------------------------------------------------------------------

function PageShell({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="min-h-screen flex flex-col"
      style={{ background: "var(--bg)", color: "var(--fg)" }}
    >
      <AppHeader active="clasificacion" />

      <main className="flex-1 px-4 py-6 max-w-4xl mx-auto w-full">
        {children}
      </main>

      <footer
        className="px-4 py-3 text-center text-[11px] border-t"
        style={{
          color: "var(--fg-faint)",
          borderColor: "var(--border)",
          fontFamily: "var(--font-sans)",
        }}
      >
        throne · Clasificación de liga
      </footer>
    </div>
  );
}
