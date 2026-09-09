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
  formatOpenRoundsMessage,
  NO_ROUNDS_MESSAGE,
  seedsFromStandings,
  resolvePlayoffWinner,
  type OpenRoundInfo,
} from "@/server/bracket";

// ---------------------------------------------------------------------------
// ActionResult type (consistent with other action modules)
// ---------------------------------------------------------------------------

export type ActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: string };

// ---------------------------------------------------------------------------
// startPlayoffs "puerta a los playoffs" guard sentinel (H9, plan/rondas-con-fecha/PLAN.md)
// ---------------------------------------------------------------------------

/**
 * Internal sentinel thrown inside `startPlayoffs`'s transaction to abort it
 * when the authoritative re-read of the league's rounds (with `tx`) finds
 * one still open. Caught right outside `prisma.$transaction` and turned
 * into the same Spanish rejection the fast-path check below returns —
 * `formatOpenRoundsMessage` builds both — scoped with `instanceof` so a real
 * DB failure inside the transaction is never mistaken for "faltan rondas
 * por cerrar" (same pattern as D5 and the H5b sweep).
 */
class PlayoffsRoundsOpenError extends Error {
  constructor(public readonly openRounds: OpenRoundInfo[]) {
    super();
  }
}

/**
 * Internal sentinel thrown inside `startPlayoffs`'s transaction to abort it
 * when the authoritative re-read finds **zero** `Round` rows at all — a
 * distinct diagnosis from `PlayoffsRoundsOpenError` (see
 * `NO_ROUNDS_MESSAGE`'s doc, src/server/bracket.ts, for why and how this is
 * reachable). Caught right outside `prisma.$transaction` and turned into
 * `NO_ROUNDS_MESSAGE`; scoped with `instanceof` for the same reason as its
 * sibling above.
 */
class PlayoffsNoRoundsError extends Error {}

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

  // "Puerta a los playoffs" (SPEC §4.11, criterio 36): every round must be
  // closed before the bracket can be built — closing a round settles
  // everything left unplayed to 0-0 (§4.7), so this is what guarantees the
  // playoffs start with the full C(n,2) resolved and the seeds final. That
  // guarantee doesn't hold — not even vacuously — if the league has **zero**
  // `Round` rows at all, reachable only through the documented non-atomic
  // gap in `addMissingLeagueMatches`'s first call (`NO_ROUNDS_MESSAGE`'s doc,
  // src/server/bracket.ts): matches can exist with `roundId: null` and
  // nothing resolved, so this is checked explicitly, with its own diagnosis,
  // rather than silently passing because "no round is open" is vacuously
  // true of an empty set.
  //
  // This is a fast-path shortcut only (fast rejection, no transaction open
  // yet, same convention as `closeRound` — src/server/round-actions.ts): a
  // round could be reopened, or a brand-new one appended by a concurrent
  // `redistributePending` (an alta mid-liga landing in this exact window,
  // src/server/round-actions.ts), between this read and the transaction
  // below. The authoritative check is the re-read with `tx`, further down,
  // as the very first thing the transaction does — that one decides; this
  // one only gives a fast, friendly rejection for the common case.
  const roundsPreCheck = await prisma.round.findMany({
    where: { leagueId },
    select: { index: true, closedAt: true, deadline: true },
  });
  if (roundsPreCheck.length === 0) {
    return { ok: false, error: NO_ROUNDS_MESSAGE };
  }
  const openRoundsPreCheck = roundsPreCheck.filter((r) => r.closedAt === null);
  if (openRoundsPreCheck.length > 0) {
    return { ok: false, error: formatOpenRoundsMessage(openRoundsPreCheck) };
  }

  // Standings snapshot (leagueMatches + activePlayers, read below) stays a
  // plain read outside the transaction, same as before this hito. Considered
  // whether it needs the same "re-read authoritative with `tx`" hardening as
  // the rounds-closed guard above — decided not to, for two reasons that
  // both hold at once:
  //   1. Reach: once every round is closed, participants lose write access
  //      entirely (§4.7) — the only way this snapshot can go stale before
  //      the transaction commits is a second, concurrent ADMIN action:
  //      either editing a Result on an already-closed round via the admin
  //      override (§7.5), or an alta/baja/`matchesPerRound` change that
  //      reopens or appends a round via `redistributePending`. That second
  //      case is exactly what the guard above (and its authoritative re-read
  //      below) exists to catch — it always touches `Round.closedAt`.
  //   2. Scope: criterio 37 requires the bracket, seeding and byes to come
  //      out identical to today for the case this hito actually changes
  //      behavior for (all rounds already closed). Moving the standings
  //      computation itself inside the transaction would be a rewrite of
  //      pre-existing, already-approved bracket-building code that criterios
  //      36-37 don't touch, not a hardening of the new guard.
  // What's left over — an admin overriding a Result on a closed round in the
  // very same instant another admin action starts playoffs — is a narrow
  // admin-vs-admin race that predates this hito (it existed identically
  // before rondas-con-fecha) and applies equally to every other read below
  // this point (`activePlayers`, `league.playoffSize` itself). Flagged here,
  // not fixed, the same way `redistributePending` documents its own
  // unfixed double-redistribution race (src/server/round-actions.ts).
  //
  // This leftover is NOT hypothetical: it was reproduced during the H9 review
  // (plan/rondas-con-fecha/reviews/puerta-a-playoffs.md). The observable
  // consequence is a persisted playoff `Match` whose seeding comes from the
  // pre-edit version of that Result — i.e. a bracket built on a standings
  // snapshot that was already superseded when it committed. It does NOT
  // corrupt the league phase: the edited Result stays edited, and reverting
  // the bracket is an admin action (reset). Recording it precisely so nobody
  // re-derives the wrong conclusion that `Round.closedAt` covers every path
  // by which the standings can go stale — it does not.

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
  let bracketId: string;
  try {
    bracketId = await prisma.$transaction(async (tx) => {
      // Authoritative re-read (SPEC §4.11 hardening, H9 — same pattern D5 and
      // the H5b sweep already validated): the fast-path check above can be
      // stale by the time this transaction actually runs — a round could have
      // been reopened, or a new one appended by a concurrent
      // `redistributePending`, in the window between that read and this one.
      // Re-verify against `tx`, the transaction's own client, as the very
      // first thing it does — this is what decides, not the shortcut above.
      const currentRounds = await tx.round.findMany({
        where: { leagueId },
        select: { index: true, closedAt: true, deadline: true },
      });
      if (currentRounds.length === 0) {
        throw new PlayoffsNoRoundsError();
      }
      const stillOpen = currentRounds.filter((r) => r.closedAt === null);
      if (stillOpen.length > 0) {
        throw new PlayoffsRoundsOpenError(stillOpen);
      }

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
  } catch (err) {
    if (err instanceof PlayoffsNoRoundsError) {
      return { ok: false, error: NO_ROUNDS_MESSAGE };
    }
    if (err instanceof PlayoffsRoundsOpenError) {
      return { ok: false, error: formatOpenRoundsMessage(err.openRounds) };
    }
    throw err;
  }

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
    select: {
      id: true,
      feedsIntoSlotId: true,
      roundIndex: true,
      position: true,
    },
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
    f.id === currentSlot.id
      ? (updatedCurrentSlot?.playerId ?? null)
      : f.playerId
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
              playerHome: {
                select: { id: true, displayName: true, faction: true },
              },
              playerAway: {
                select: { id: true, displayName: true, faction: true },
              },
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
