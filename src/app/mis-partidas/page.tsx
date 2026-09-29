import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireAuth } from "@/lib/guards";
import { pickCurrentRoundId } from "@/server/round-ui";
import { resolveVista, type Vista } from "@/server/partidas-view";
import { buildBrowserBlocks, type BrowserMatchInput } from "@/server/partidas-blocks";
import { Eyebrow } from "@/components/Eyebrow";
import { Card } from "@/components/Card";
import { AppHeader } from "@/components/AppHeader";
import { PartidasBrowser } from "./PartidasBrowser";
import { VistaTabs } from "./VistaTabs";
import { LABELS, TEST_IDS } from "./browser-contract";

interface MisPartidasPageProps {
  searchParams?: Promise<{ vista?: string | string[] }>;
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="min-h-screen flex flex-col"
      style={{ background: "var(--bg)", color: "var(--fg)" }}
    >
      <AppHeader active="mis-partidas" />
      <main className="flex-1 px-4 py-6 max-w-2xl mx-auto w-full space-y-6">
        {children}
      </main>
    </div>
  );
}

function EmptyCard({ children }: { children: React.ReactNode }) {
  return (
    <Card className="text-center py-10">
      <p
        className="text-[15px] font-semibold"
        style={{ color: "var(--fg-muted)", fontFamily: "var(--font-sans)" }}
      >
        {children}
      </p>
    </Card>
  );
}

export default async function MisPartidasPage({
  searchParams,
}: MisPartidasPageProps = {}) {
  const session = await requireAuth();
  const isAdmin = session.role === "ADMIN";
  const currentPlayerId = session.playerId ?? "";
  const { vista: vistaParam } = searchParams ? await searchParams : {};
  const vista: Vista = resolveVista(session.role, vistaParam);

  const league = await prisma.league.findFirst({ orderBy: { createdAt: "desc" } });

  if (!league) {
    return (
      <Shell>
        <EmptyCard>No hay ninguna liga configurada todavía</EmptyCard>
      </Shell>
    );
  }

  const [leagueMatchCount, rounds] = await Promise.all([
    prisma.match.count({ where: { leagueId: league.id, phase: "LEAGUE" } }),
    prisma.round.findMany({
      where: { leagueId: league.id },
      select: { id: true, index: true, deadline: true, closedAt: true },
    }),
  ]);
  const currentRoundId = pickCurrentRoundId(rounds, new Date());

  const where =
    vista === "MIAS"
      ? {
          leagueId: league.id,
          phase: "LEAGUE" as const,
          OR: [
            { playerHomeId: currentPlayerId },
            { playerAwayId: currentPlayerId },
          ],
        }
      : { leagueId: league.id, phase: "LEAGUE" as const };

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

  const matches: BrowserMatchInput[] = rawMatches.map((m) => ({
    id: m.id,
    status: m.status as BrowserMatchInput["status"],
    scheduledAt: m.scheduledAt,
    location: m.location,
    playerHomeId: m.playerHomeId,
    playerAwayId: m.playerAwayId,
    playerHomeName: m.playerHome.displayName,
    playerAwayName: m.playerAway?.displayName ?? null,
    roundId: m.roundId,
    round: m.round,
    result: m.result,
  }));

  const { blocks, currentBlockKey, counts } = buildBrowserBlocks({
    matches,
    vista,
    currentPlayerId,
    currentRoundId,
    leagueStartMonth: league.startMonth,
  });

  const scope: "PLAYER" | "LEAGUE" = vista === "MIAS" ? "PLAYER" : "LEAGUE";
  const eyebrowLabel = vista === "MIAS" ? "Mis partidas" : "Todas las partidas";
  const title = vista === "MIAS" ? "Mis partidas" : "Gestión de partidas";

  return (
    <Shell>
      <div>
        <Eyebrow>
          {eyebrowLabel} · {league.name}
        </Eyebrow>
        <h1
          className="mt-2 text-[28px] font-semibold leading-tight"
          style={{ fontFamily: "var(--font-display)", color: "var(--fg)" }}
        >
          {title}
        </h1>
        <p
          className="mt-1 text-[13px]"
          style={{ color: "var(--fg-muted)", fontFamily: "var(--font-sans)" }}
        >
          {counts.total} partida{counts.total !== 1 ? "s" : ""} · Pendientes:{" "}
          {counts.pending} · Apuntadas: {counts.played} · Incomparecencias:{" "}
          {counts.walkover} · Saldadas: {counts.unplayedDraw}
          {counts.legacy > 0 && <> · Legado: {counts.legacy}</>}
        </p>
      </div>

      {isAdmin && <VistaTabs vista={vista} />}

      {leagueMatchCount === 0 ? (
        <EmptyCard>
          {isAdmin ? (
            <>
              No hay partidas generadas todavía
              <span className="block mt-1">
                <Link href="/admin/emparejamientos" style={{ color: "var(--accent)" }}>
                  Generar emparejamientos →
                </Link>
              </span>
            </>
          ) : (
            "No tienes partidas asignadas"
          )}
        </EmptyCard>
      ) : vista === "MIAS" && counts.total === 0 ? (
        <Card className="text-center py-10" data-testid={TEST_IDS.adminNoOwnMatches}>
          <p
            className="text-[15px] font-semibold"
            style={{ color: "var(--fg-muted)", fontFamily: "var(--font-sans)" }}
          >
            {LABELS.adminNoOwnMatches}
          </p>
          {isAdmin && (
            <p className="mt-2 text-[13px]">
              <Link
                href="/mis-partidas?vista=todas"
                data-testid={TEST_IDS.adminNoOwnMatchesSeeTodas}
                style={{ color: "var(--accent)" }}
              >
                {LABELS.seeTodas}
              </Link>
            </p>
          )}
        </Card>
      ) : (
        <PartidasBrowser
          blocks={blocks}
          currentBlockKey={currentBlockKey}
          currentPlayerId={currentPlayerId}
          isAdmin={isAdmin}
          vista={vista}
          scope={scope}
        />
      )}
    </Shell>
  );
}
