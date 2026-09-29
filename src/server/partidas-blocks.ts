import { roundQuota, quotaLabel, type RoundMatchInput } from "./rounds";
import { sortRoundBlocks } from "./round-ui";
import type { Vista } from "./partidas-view";
import type { BrowserBlock } from "@/app/mis-partidas/browser-contract";

/** Matches the Prisma `select` shape `page.tsx` queries with — Dates, not
 *  ISO strings, since this runs server-side before `toBrowserMatch`. */
export interface BrowserMatchInput {
  id: string;
  status: "SCHEDULED" | "REPORTED" | "CONFIRMED" | "DISPUTED";
  scheduledAt: Date | null;
  location: string | null;
  playerHomeId: string;
  playerAwayId: string | null;
  playerHomeName: string;
  playerAwayName: string | null;
  roundId: string | null;
  round: { index: number; deadline: Date; closedAt: Date | null } | null;
  result: {
    homeVictoryPoints: number;
    awayVictoryPoints: number;
    outcome: string;
    reportedById: string;
    bonusHome: number;
    bonusAway: number;
    resolution: string;
  } | null;
}

export interface BrowserCounts {
  total: number;
  pending: number;
  played: number;
  walkover: number;
  unplayedDraw: number;
  legacy: number;
}

export interface BuildBrowserBlocksInput {
  /** Pre-filtered by the caller's Prisma `where` to the active tab (MIAS/TODAS). */
  matches: BrowserMatchInput[];
  vista: Vista;
  currentPlayerId: string;
  /**
   * `pickCurrentRoundId`'s result. Must come from every round of the league,
   * not from `matches` — a round the active tab has no block for still
   * counts as "current", it just opens nothing here (§4.1).
   */
  currentRoundId: string | null;
  leagueStartMonth: Date | null;
}

export interface BuildBrowserBlocksResult {
  blocks: BrowserBlock[];
  currentBlockKey: string | null;
  counts: BrowserCounts;
}

type BrowserMatch = BrowserBlock["matches"][number];

function roundBlockKey(index: number): string {
  return `round-${index}`;
}

function deadlineLabel(round: { deadline: Date; closedAt: Date | null }): string {
  if (round.closedAt) {
    return `cerrada el ${round.closedAt.toLocaleDateString("es-ES")}`;
  }
  return `cierra ${round.deadline.toLocaleDateString("es-ES", {
    day: "numeric",
    month: "short",
    year: "numeric",
  })}`;
}

function toBrowserMatch(
  m: BrowserMatchInput,
  leagueStartMonthIso: string | null
): BrowserMatch {
  return {
    id: m.id,
    playerHomeId: m.playerHomeId,
    playerAwayId: m.playerAwayId,
    playerHomeName: m.playerHomeName,
    playerAwayName: m.playerAwayName,
    scheduledAt: m.scheduledAt ? m.scheduledAt.toISOString() : null,
    location: m.location,
    status: m.status,
    roundDeadline: m.round ? m.round.deadline.toISOString() : null,
    leagueStartMonth: leagueStartMonthIso,
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
  };
}

export function buildBrowserBlocks({
  matches,
  vista,
  currentPlayerId,
  currentRoundId,
  leagueStartMonth,
}: BuildBrowserBlocksInput): BuildBrowserBlocksResult {
  const leagueStartMonthIso = leagueStartMonth ? leagueStartMonth.toISOString() : null;

  const counts: BrowserCounts = {
    total: matches.length,
    pending: matches.filter((m) => m.status === "SCHEDULED").length,
    played: matches.filter(
      (m) => m.status === "REPORTED" && (m.result?.resolution ?? "PLAYED") === "PLAYED"
    ).length,
    walkover: matches.filter((m) => m.result?.resolution === "WALKOVER").length,
    unplayedDraw: matches.filter((m) => m.result?.resolution === "UNPLAYED_DRAW").length,
    legacy: matches.filter((m) => m.status === "CONFIRMED" || m.status === "DISPUTED")
      .length,
  };

  const roundedMatches = matches.filter(
    (m) => m.status !== "CONFIRMED" && m.status !== "DISPUTED" && m.roundId !== null
  );
  const unassignedMatches = matches.filter(
    (m) => m.status !== "CONFIRMED" && m.status !== "DISPUTED" && m.roundId === null
  );
  const legacyMatches = matches.filter(
    (m) => m.status === "CONFIRMED" || m.status === "DISPUTED"
  );

  interface RoundGroup {
    roundId: string;
    index: number;
    deadline: Date;
    closedAt: Date | null;
    matches: BrowserMatchInput[];
  }

  const groupsByRoundId = new Map<string, RoundGroup>();
  for (const m of roundedMatches) {
    if (!m.round || m.roundId === null) continue;
    const existing = groupsByRoundId.get(m.roundId);
    if (existing) {
      existing.matches.push(m);
    } else {
      groupsByRoundId.set(m.roundId, {
        roundId: m.roundId,
        index: m.round.index,
        deadline: m.round.deadline,
        closedAt: m.round.closedAt,
        matches: [m],
      });
    }
  }
  const roundGroups = sortRoundBlocks([...groupsByRoundId.values()]);

  // Bye matches (no away player) carry no cupo obligation for either side.
  const matchInputsByPlayer: RoundMatchInput[] =
    vista === "MIAS"
      ? roundedMatches
          .filter((m) => m.playerAwayId !== null)
          .map((m) => ({
            roundIndex: m.round!.index,
            playerHomeId: m.playerHomeId,
            playerAwayId: m.playerAwayId!,
            hasResult: m.result !== null,
          }))
      : [];

  function roundSubtitle(group: RoundGroup): string {
    const label = deadlineLabel(group);
    if (vista === "MIAS") {
      const { required, resolved } = roundQuota(
        currentPlayerId,
        group.index,
        matchInputsByPlayer
      );
      return `${label} · ${quotaLabel(resolved, required)}`;
    }
    const resolved = group.matches.filter((m) => m.result !== null).length;
    return `${label} · ${resolved} de ${group.matches.length} jugada${
      group.matches.length !== 1 ? "s" : ""
    }`;
  }

  const roundBlocks: BrowserBlock[] = roundGroups.map((group) => ({
    key: roundBlockKey(group.index),
    kind: "ROUND",
    title: `Ronda ${group.index}`,
    subtitle: roundSubtitle(group),
    matches: group.matches.map((m) => toBrowserMatch(m, leagueStartMonthIso)),
  }));

  const blocks: BrowserBlock[] = [...roundBlocks];

  if (unassignedMatches.length > 0) {
    blocks.push({
      key: "unassigned",
      kind: "UNASSIGNED",
      title: "Sin ronda asignada",
      subtitle: "",
      matches: unassignedMatches.map((m) => toBrowserMatch(m, leagueStartMonthIso)),
    });
  }

  if (legacyMatches.length > 0) {
    blocks.push({
      key: "legacy",
      kind: "LEGACY",
      title: "Historial",
      subtitle: "",
      matches: legacyMatches.map((m) => toBrowserMatch(m, leagueStartMonthIso)),
    });
  }

  const currentRoundGroup = currentRoundId
    ? roundGroups.find((g) => g.roundId === currentRoundId)
    : undefined;
  const currentBlockKey = currentRoundGroup ? roundBlockKey(currentRoundGroup.index) : null;

  return { blocks, currentBlockKey, counts };
}
