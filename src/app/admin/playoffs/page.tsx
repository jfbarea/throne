// Admin: iniciar playoffs — cerrar fase de liga y construir el bracket.
// SPEC §7.4, §5. Solo admin.

import { requireAdmin } from "@/lib/guards";
import { prisma } from "@/lib/db";
import { computeStandings } from "@/server/standings";
import Link from "next/link";
import { StartPlayoffsButton } from "./StartPlayoffsButton";

export default async function AdminPlayoffsPage() {
  await requireAdmin();

  // Load active league in LEAGUE or PLAYOFFS/FINISHED status.
  const league = await prisma.league.findFirst({
    where: { status: { in: ["LEAGUE", "PLAYOFFS", "FINISHED"] } },
    orderBy: { createdAt: "desc" },
  });

  if (!league) {
    return (
      <div
        className="rounded-[var(--radius-sm)] border p-6"
        style={{
          borderColor: "var(--border)",
          background: "var(--bg-raised)",
          fontFamily: "var(--font-sans)",
        }}
      >
        <p style={{ color: "var(--fg-muted)" }}>
          No hay ninguna liga activa en fase LEAGUE. Primero genera los
          emparejamientos y asegúrate de que la liga esté en marcha.
        </p>
      </div>
    );
  }

  // Load league matches and players to show standings preview.
  const leagueMatches = await prisma.match.findMany({
    where: { leagueId: league.id, phase: "LEAGUE" },
    include: { result: true },
  });

  const activePlayers = await prisma.player.findMany({
    where: { leagueId: league.id, active: true },
    select: { id: true, displayName: true, faction: true },
  });

  const standings = computeStandings(
    leagueMatches.map((m) => ({
      id: m.id,
      status: m.status,
      phase: m.phase,
      playerHomeId: m.playerHomeId,
      playerAwayId: m.playerAwayId,
      result: m.result
        ? {
            homeVictoryPoints: m.result.homeVictoryPoints,
            awayVictoryPoints: m.result.awayVictoryPoints,
            outcome: m.result.outcome,
            bonusHome: m.result.bonusHome,
            bonusAway: m.result.bonusAway,
          }
        : null,
    })),
    {
      pointsWin: league.pointsWin,
      pointsDraw: league.pointsDraw,
      pointsLoss: league.pointsLoss,
      tiebreakers: league.tiebreakers,
      playoffSize: league.playoffSize,
    },
    activePlayers.map((p) => p.id)
  );

  const playerMap = new Map(activePlayers.map((p) => [p.id, p]));

  // Hito 15: "jugadas" = REPORTED (new flow) or CONFIRMED (legacy data).
  const confirmedCount = leagueMatches.filter(
    (m) => m.status === "REPORTED" || m.status === "CONFIRMED"
  ).length;
  const pendingCount = leagueMatches.filter(
    (m) => m.status !== "REPORTED" && m.status !== "CONFIRMED"
  ).length;

  const canStart = league.status === "LEAGUE";
  const alreadyStarted =
    league.status === "PLAYOFFS" || league.status === "FINISHED";

  return (
    <div style={{ fontFamily: "var(--font-sans)" }}>
      {/* Page title */}
      <div className="mb-6">
        <p
          className="text-[11px] font-semibold uppercase tracking-[0.1em] mb-1"
          style={{ color: "var(--accent)" }}
        >
          {league.name} · {league.season}
        </p>
        <h1
          className="text-[26px] font-bold leading-tight"
          style={{ fontFamily: "var(--font-display)", color: "var(--fg)" }}
        >
          Iniciar playoffs
        </h1>
        <p className="text-sm mt-1" style={{ color: "var(--fg-muted)" }}>
          Cierra la fase de liga y construye el cuadro de eliminatoria.
        </p>
      </div>

      {/* Status banner */}
      {alreadyStarted && (
        <div
          className="mb-6 p-4 rounded-[var(--radius-sm)] border"
          style={{ borderColor: "var(--moss-600)", background: "color-mix(in srgb, var(--moss-500) 10%, transparent)" }}
        >
          <p className="text-sm font-semibold" style={{ color: "var(--moss-400)" }}>
            Los playoffs ya han sido iniciados (estado: {league.status}).
          </p>
          <Link
            href="/bracket"
            className="inline-block mt-2 text-sm font-semibold no-underline"
            style={{ color: "var(--accent)" }}
          >
            Ver bracket →
          </Link>
        </div>
      )}

      {/* Stats summary */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-6">
        <StatCard label="Partidas jugadas" value={confirmedCount} />
        <StatCard label="Partidas pendientes" value={pendingCount} color={pendingCount > 0 ? "var(--ember-400)" : undefined} />
        <StatCard label="Clasifican a playoffs" value={league.playoffSize} />
      </div>

      {/* Standings preview: top N seeds */}
      <div
        className="mb-6 rounded-[var(--radius-sm)] border"
        style={{ borderColor: "var(--border)", background: "var(--bg-raised)" }}
      >
        <div
          className="px-4 py-3 border-b"
          style={{ borderColor: "var(--border)" }}
        >
          <h2
            className="text-[14px] font-semibold"
            style={{ color: "var(--fg)" }}
          >
            Seeds actuales (top {league.playoffSize})
          </h2>
          <p className="text-[12px] mt-0.5" style={{ color: "var(--fg-muted)" }}>
            Solo partidas con resultado apuntado. El orden puede cambiar si hay pendientes.
          </p>
        </div>
        <div>
          {standings.slice(0, league.playoffSize).map((row, idx) => {
            const player = playerMap.get(row.playerId);
            const isInPlayoffs = row.inPlayoffZone;
            return (
              <div
                key={row.playerId}
                className="flex items-center gap-3 px-4 py-2.5 border-b last:border-b-0"
                style={{
                  borderColor: "var(--border)",
                  background:
                    idx === 0
                      ? "color-mix(in srgb, var(--accent) 5%, transparent)"
                      : "transparent",
                }}
              >
                <span
                  className="w-6 text-center text-[13px] font-bold tabular-nums shrink-0"
                  style={{
                    color: isInPlayoffs ? "var(--accent)" : "var(--fg-faint)",
                    fontFamily: "var(--font-mono)",
                  }}
                >
                  {row.rank}
                </span>
                <div className="flex-1 min-w-0">
                  <span
                    className="text-[13px] font-semibold truncate block"
                    style={{ color: "var(--fg)" }}
                  >
                    {player?.displayName ?? row.playerId}
                  </span>
                  {player?.faction && (
                    <span
                      className="text-[11px] truncate block"
                      style={{ color: "var(--fg-faint)" }}
                    >
                      {player.faction}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <span
                    className="text-[13px] font-semibold tabular-nums"
                    style={{ color: "var(--fg)", fontFamily: "var(--font-mono)" }}
                  >
                    {row.points} pts
                  </span>
                  <span
                    className="text-[11px] tabular-nums"
                    style={{
                      color: "var(--fg-muted)",
                      fontFamily: "var(--font-mono)",
                    }}
                  >
                    {row.vpDiff > 0 ? "+" : ""}
                    {row.vpDiff}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Action */}
      {canStart && (
        <div
          className="rounded-[var(--radius-sm)] border p-5"
          style={{ borderColor: "var(--border)", background: "var(--bg-raised)" }}
        >
          <h2
            className="text-[14px] font-semibold mb-2"
            style={{ color: "var(--fg)" }}
          >
            Cerrar fase de liga e iniciar playoffs
          </h2>
          {pendingCount > 0 && (
            <div
              className="mb-3 p-3 rounded-[var(--radius-sm)] text-sm"
              style={{
                background: "color-mix(in srgb, var(--ember-500) 10%, transparent)",
                color: "var(--ember-300)",
                border: "1px solid var(--ember-700)",
              }}
            >
              Atención: hay {pendingCount} partida{pendingCount !== 1 ? "s" : ""}{" "}
              sin confirmar. El bracket se construirá con los resultados confirmados
              actuales. Puedes continuar igualmente.
            </div>
          )}
          <p className="text-sm mb-4" style={{ color: "var(--fg-muted)" }}>
            Se tomarán los {league.playoffSize} mejores seeds según los standings
            actuales y se construirá el cuadro de eliminatoria. Esta acción no se
            puede deshacer.
          </p>
          <StartPlayoffsButton leagueId={league.id} />
        </div>
      )}
    </div>
  );
}

function StatCard({
  label,
  value,
  color,
}: {
  label: string;
  value: number;
  color?: string;
}) {
  return (
    <div
      className="rounded-[var(--radius-sm)] border p-3"
      style={{ borderColor: "var(--border)", background: "var(--bg-raised)" }}
    >
      <p
        className="text-[11px] font-semibold uppercase tracking-[0.08em] mb-1"
        style={{ color: "var(--fg-faint)", fontFamily: "var(--font-sans)" }}
      >
        {label}
      </p>
      <p
        className="text-[24px] font-bold tabular-nums"
        style={{
          color: color ?? "var(--fg)",
          fontFamily: "var(--font-mono)",
          lineHeight: 1,
        }}
      >
        {value}
      </p>
    </div>
  );
}
