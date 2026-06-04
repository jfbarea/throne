// Server actions for playoff phase management.
// Hito 9: playoffs-bracket.
// SPEC §7.4, §4.6, §5.

"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/guards";
import { computeStandings } from "@/server/standings";
import {
  buildBracket,
  seedsFromStandings,
  resolvePlayoffWinner,
} from "@/server/bracket";

// ---------------------------------------------------------------------------
// ActionResult type (consistent with other action modules)
// ---------------------------------------------------------------------------

export type ActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: string };

// ---------------------------------------------------------------------------
// startPlayoffs — admin action to close league and initialize playoff bracket
// ---------------------------------------------------------------------------

/**
 * Close the league phase and initialise the playoff bracket.
 *
 * Steps (all inside a transaction):
 *  1. Load the league + all confirmed LEAGUE matches + all active players.
 *  2. Compute current standings.
 *  3. Build in-memory bracket from top `playoffSize` seeds.
 *  4. Persist: Bracket, BracketSlots, Matches (phase=PLAYOFF).
 *     - Bye slots get isBye=true match with only playerHome (the advancing seed).
 *     - Real matches get phase=PLAYOFF, status=SCHEDULED, isBye=false.
 *  5. Transition league.status → PLAYOFFS.
 *
 * SPEC §7.4: admin-only. Empates no válidos en playoffs (enforced at confirm).
 */
export async function startPlayoffs(
  leagueId: string
): Promise<ActionResult<{ bracketId: string }>> {
  await requireAdmin();

  // Load league.
  const league = await prisma.league.findUnique({
    where: { id: leagueId },
  });

  if (!league) {
    return { ok: false, error: "Liga no encontrada" };
  }

  if (league.status !== "LEAGUE") {
    return {
      ok: false,
      error: `No se pueden iniciar los playoffs: la liga está en estado "${league.status}". Debe estar en estado LEAGUE.`,
    };
  }

  if (league.playoffSize < 2) {
    return {
      ok: false,
      error: "El tamaño de playoffs debe ser al menos 2.",
    };
  }

  // Load all confirmed LEAGUE matches for standings computation.
  const leagueMatches = await prisma.match.findMany({
    where: { leagueId, phase: "LEAGUE" },
    include: { result: true },
  });

  // Load active players (to pass to computeStandings for 0-match players).
  const activePlayers = await prisma.player.findMany({
    where: { leagueId, active: true },
    select: { id: true },
  });

  if (activePlayers.length < league.playoffSize) {
    return {
      ok: false,
      error: `No hay suficientes jugadores activos (${activePlayers.length}) para un playoff de tamaño ${league.playoffSize}.`,
    };
  }

  // Compute standings (pure function).
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

  // Extract seeds.
  const seeds = seedsFromStandings(standings, league.playoffSize);

  // Build bracket spec (pure).
  const spec = buildBracket(seeds);

  // Persist inside a transaction.
  const bracketId = await prisma.$transaction(async (tx) => {
    // Check no existing bracket.
    const existing = await tx.bracket.findUnique({ where: { leagueId } });
    if (existing) {
      throw new Error("Ya existe un bracket para esta liga.");
    }

    // Create Bracket.
    const bracket = await tx.bracket.create({
      data: {
        leagueId,
        size: spec.size,
      },
    });

    // Create BracketSlots — two passes:
    //   Pass 1: create all slots without feedsIntoSlotId (need ids first).
    //   Pass 2: wire feedsIntoSlotId.

    const createdSlots: Array<{ id: string; specIndex: number }> = [];

    for (let i = 0; i < spec.slots.length; i++) {
      const slotSpec = spec.slots[i];
      const slot = await tx.bracketSlot.create({
        data: {
          bracketId: bracket.id,
          roundIndex: slotSpec.roundIndex,
          position: slotSpec.position,
          playerId: slotSpec.playerId,
          feedsIntoSlotId: null, // wired in pass 2
        },
      });
      createdSlots.push({ id: slot.id, specIndex: i });
    }

    // Pass 2: wire feedsIntoSlotId.
    for (const { id, specIndex } of createdSlots) {
      const feedsIntoIndex = spec.slots[specIndex].feedsIntoIndex;
      if (feedsIntoIndex !== null) {
        const parentSlotId = createdSlots[feedsIntoIndex].id;
        await tx.bracketSlot.update({
          where: { id },
          data: { feedsIntoSlotId: parentSlotId },
        });
      }
    }

    // Create Matches for each slot.
    for (let i = 0; i < spec.slots.length; i++) {
      const slotSpec = spec.slots[i];
      const slotId = createdSlots[i].id;

      if (slotSpec.isBye) {
        // Bye match: home = advancing seed, no away player, auto-CONFIRMED.
        // The seed's playerId is already in slotSpec.playerId.
        const homePlayerId = slotSpec.playerId!;

        // For a bye, we create the match as CONFIRMED with status indicator.
        // isBye=true, no away player, no result (bye doesn't have a real score).
        await tx.match.create({
          data: {
            leagueId,
            phase: "PLAYOFF",
            status: "CONFIRMED",
            playerHomeId: homePlayerId,
            playerAwayId: null,
            isBye: true,
            bracketSlotId: slotId,
          },
        });
      } else if (slotSpec.roundIndex === 1) {
        // Round-1 real match: both players are known from seeds.
        // position p: top seed = p, bottom seed = size + 1 - p.
        const topSeedNum = slotSpec.position;
        const bottomSeedNum = spec.size + 1 - slotSpec.position;
        const homePlayer = seeds.find((s) => s.seed === topSeedNum);
        const awayPlayer = seeds.find((s) => s.seed === bottomSeedNum);

        if (!homePlayer || !awayPlayer) {
          // This shouldn't happen for round-1 non-bye slots
          throw new Error(
            `Missing seed for round-1 slot position ${slotSpec.position}`
          );
        }

        await tx.match.create({
          data: {
            leagueId,
            phase: "PLAYOFF",
            status: "SCHEDULED",
            playerHomeId: homePlayer.playerId,
            playerAwayId: awayPlayer.playerId,
            isBye: false,
            bracketSlotId: slotId,
          },
        });
      }
      // Later-round slots (roundIndex > 1, not bye) have no match yet.
      // Matches for those slots are created when both predecessors resolve.
    }

    // Transition league to PLAYOFFS.
    await tx.league.update({
      where: { id: leagueId },
      data: { status: "PLAYOFFS" },
    });

    return bracket.id;
  });

  revalidatePath("/bracket");
  revalidatePath("/admin");
  revalidatePath("/admin/emparejamientos");
  revalidatePath("/clasificacion");

  return { ok: true, data: { bracketId } };
}

// ---------------------------------------------------------------------------
// advancePlayoffWinner — called inside reportResult transaction for PLAYOFF matches
// ---------------------------------------------------------------------------

/**
 * After a playoff match result is reported, advance the winner to the next bracket slot.
 * If both slots feeding into the next slot are resolved, create the next match.
 * If the match is the final, mark the league as FINISHED.
 *
 * Hito 15: called from reportResult (no longer requires a separate confirm step).
 *
 * This function MUST be called inside a Prisma transaction (receives `tx`).
 * It is not a Server Action itself — it's called from reportResult.
 *
 * @param tx         Prisma transaction client.
 * @param matchId    The just-reported playoff match id.
 * @param outcome    The reported outcome.
 * @param leagueId   The league id.
 */
export async function advancePlayoffWinner(
  tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
  matchId: string,
  outcome: string,
  leagueId: string,
  playerHomeId: string,
  playerAwayId: string | null
): Promise<void> {
  // Determine winner.
  const winnerId = resolvePlayoffWinner(outcome, playerHomeId, playerAwayId);

  // Find the bracket slot for this match.
  const currentMatch = await tx.match.findUnique({
    where: { id: matchId },
    select: { bracketSlotId: true },
  });

  if (!currentMatch?.bracketSlotId) {
    // Not a bracket match (should not happen, but guard defensively).
    return;
  }

  const currentSlot = await tx.bracketSlot.findUnique({
    where: { id: currentMatch.bracketSlotId },
    select: { id: true, feedsIntoSlotId: true, roundIndex: true, position: true },
  });

  if (!currentSlot) return;

  // Record the winner in the current slot.
  await tx.bracketSlot.update({
    where: { id: currentSlot.id },
    data: { playerId: winnerId },
  });

  if (!currentSlot.feedsIntoSlotId) {
    // This was the final — crown champion, mark league FINISHED.
    await tx.league.update({
      where: { id: leagueId },
      data: { status: "FINISHED" },
    });
    return;
  }

  // Advance to the next slot.
  const nextSlot = await tx.bracketSlot.findUnique({
    where: { id: currentSlot.feedsIntoSlotId },
    select: {
      id: true,
      playerId: true,
      feedsIntoSlotId: true,
      roundIndex: true,
      position: true,
      fedBySlots: {
        select: { id: true, playerId: true },
      },
    },
  });

  if (!nextSlot) return;

  // Check if both feeders for the next slot are now resolved.
  const allFeeders = nextSlot.fedBySlots;
  // Re-fetch after we just updated the current slot's playerId.
  const updatedCurrentSlot = await tx.bracketSlot.findUnique({
    where: { id: currentSlot.id },
    select: { playerId: true },
  });
  // Build the resolved player list from all feeders.
  const resolvedPlayers = allFeeders.map((f) =>
    f.id === currentSlot.id ? updatedCurrentSlot?.playerId ?? null : f.playerId
  );
  const allResolved = resolvedPlayers.every((p) => p !== null);

  if (allResolved && resolvedPlayers.length === 2) {
    // Both players are known for the next slot — create the next match.
    const [homeId, awayId] = resolvedPlayers as [string, string];
    await tx.match.create({
      data: {
        leagueId,
        phase: "PLAYOFF",
        status: "SCHEDULED",
        playerHomeId: homeId,
        playerAwayId: awayId,
        isBye: false,
        bracketSlotId: nextSlot.id,
      },
    });
  }
}

// ---------------------------------------------------------------------------
// Bracket query helpers for the UI
// ---------------------------------------------------------------------------

/**
 * Load the full bracket for a league, including all slots, matches, and players.
 * Returns null if no bracket exists.
 */
export async function getBracket(leagueId: string) {
  const bracket = await prisma.bracket.findUnique({
    where: { leagueId },
    include: {
      slots: {
        orderBy: [{ roundIndex: "asc" }, { position: "asc" }],
        include: {
          match: {
            select: {
              id: true,
              isBye: true,
              status: true,
              phase: true,
              playerHomeId: true,
              playerAwayId: true,
              playerHome: { select: { id: true, displayName: true, faction: true } },
              playerAway: { select: { id: true, displayName: true, faction: true } },
              result: {
                select: {
                  id: true,
                  homeVictoryPoints: true,
                  awayVictoryPoints: true,
                  outcome: true,
                  bonusHome: true,
                  bonusAway: true,
                },
              },
            },
          },
        },
      },
    },
  });

  return bracket;
}
