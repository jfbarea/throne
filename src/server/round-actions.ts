// Server actions for Round management.
// Hito 3 (generar-con-rondas): editing a round's deadline.
// Hito 4 (cierre-de-ronda): closing a round.
// Hito 8 (recalculo-alta-baja-y-cupo): redistributing pending matches.
// SPEC §4.4, §4.7, §5.1, §5.5, §5.6, §5.7, §5.8, §7.1.

"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/guards";
import {
  assignPairsToRounds,
  deriveDeadlines,
  type PreassignedPair,
} from "@/server/rounds";
import type { Pairing } from "@/server/pairings";
import { z } from "zod";

export type ActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: string };

// ---------------------------------------------------------------------------
// closeRound TOCTOU sentinel (H5b sweep, plan/rondas-con-fecha/PLAN.md)
// ---------------------------------------------------------------------------

/**
 * Internal sentinel thrown inside `closeRound`'s transaction to abort it
 * when the authoritative re-read of the round (with `tx`) finds it already
 * closed or its deadline no longer due — see the docstring on `closeRound`.
 * Caught right outside `prisma.$transaction` and turned into the same
 * user-facing rejection the corresponding fast-path check above returns;
 * scoped with `instanceof` so a real DB failure inside the transaction is
 * never mistaken for one of these two guards.
 */
class CloseRoundGuardFailedError extends Error {
  constructor(
    public readonly reason: "not_found" | "already_closed" | "not_due"
  ) {
    super();
  }
}

// ---------------------------------------------------------------------------
// Schema: edit a round's deadline
// ---------------------------------------------------------------------------

/**
 * Accepts a plain "YYYY-MM-DD" date (the shape a native <input type="date">
 * sends) and turns it into a UTC-midnight Date, same convention as
 * `deriveDeadlines` (src/server/rounds.ts) uses for the derived deadlines.
 */
const updateRoundDeadlineSchema = z.object({
  deadline: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha de cierre inválida")
    .transform((val) => {
      const [year, month, day] = val.split("-").map(Number);
      return new Date(Date.UTC(year, month - 1, day));
    }),
});

export type UpdateRoundDeadlineInput = z.input<
  typeof updateRoundDeadlineSchema
>;

// ---------------------------------------------------------------------------
// Admin action: updateRoundDeadline
// ---------------------------------------------------------------------------

/**
 * Edit the deadline of a single round (SPEC §4.4: "el admin puede editar la
 * fecha de cualquier ronda a mano").
 *
 * Deliberately does NOT:
 *   - Reassign any Match to a different round (SPEC §4.3, §8 criterio 14 —
 *     the round of a match is fixed by the pairing algorithm and nobody,
 *     admin included, can move it from here or anywhere else).
 *   - Touch any Match's `scheduledAt` (§8 criterio 8).
 *   - Require the new deadline to keep the rounds in chronological order
 *     (§4.4: "que las fechas queden ordenadas es responsabilidad del
 *     admin").
 *
 * Guard (SPEC §7.1): requires ADMIN session.
 */
export async function updateRoundDeadline(
  roundId: string,
  input: UpdateRoundDeadlineInput
): Promise<ActionResult> {
  const session = await requireAdmin();

  const parsed = updateRoundDeadlineSchema.safeParse(input);
  if (!parsed.success) {
    const message = parsed.error.issues[0]?.message ?? "Fecha inválida";
    return { ok: false, error: message };
  }

  const round = await prisma.round.findUnique({ where: { id: roundId } });
  if (!round) {
    return { ok: false, error: "Ronda no encontrada" };
  }

  const newDeadline = parsed.data.deadline;

  await prisma.$transaction(async (tx) => {
    await tx.round.update({
      where: { id: roundId },
      data: { deadline: newDeadline },
    });

    // Best-effort audit trail (requires an admin player in the session,
    // same convention as resetLeague — src/server/league-actions.ts).
    if (session.playerId) {
      await tx.auditLog.create({
        data: {
          actorId: session.playerId,
          action: "UPDATE_ROUND_DEADLINE",
          entityType: "Round",
          entityId: roundId,
          payload: JSON.stringify({
            leagueId: round.leagueId,
            roundIndex: round.index,
            previousDeadline: round.deadline.toISOString(),
            newDeadline: newDeadline.toISOString(),
          }),
        },
      });
    }
  });

  revalidatePath("/admin/rondas");

  return { ok: true, data: undefined };
}

// ---------------------------------------------------------------------------
// Admin action: closeRound
// ---------------------------------------------------------------------------

/**
 * Close a round: every match in it that still has no `Result` gets settled
 * as a 0-0 draw (SPEC §4.7, §4.8, §4.9, criterio 18):
 *   homeVictoryPoints = 0, awayVictoryPoints = 0, outcome = DRAW,
 *   resolution = UNPLAYED_DRAW, bonusHome = bonusAway = 0.
 *
 * Deliberately does NOT go through `calculateBonus` (§4.8: the 0-0 never
 * earns bonus, unlike a real 0-0 draw someone plays out and reports, which
 * would still be checked against the bonus config via `reportResult`).
 *
 * Matches that already have a `Result` are left untouched (criterio 19) —
 * the query below only selects matches with `result: null`.
 *
 * Guards (SPEC §5.7, §7.1):
 *   - `requireAdmin()` first.
 *   - Refuses if the round doesn't exist, is already closed, or its
 *     `deadline` hasn't arrived yet. There is no separate "force close"
 *     path (§5.7): moving the deadline (`updateRoundDeadline`) is the only
 *     way to close early.
 *
 * No ordering precondition (§5.8, criterio 22): closing round 4 while round
 * 3 is still open is allowed and doesn't touch round 3 at all.
 *
 * Everything — settling the pending matches, sealing `closedAt`, and the
 * `AuditLog` entry — happens in one `prisma.$transaction` (SPEC §7.1).
 *
 * TOCTOU hardening (H5b sweep, plan/rondas-con-fecha/PLAN.md): `closedAt`
 * and `deadline` are read once above for a fast, friendly rejection, then
 * re-read with `tx` as the very first thing inside the transaction. This
 * closes an admin-vs-admin race (only admin actions ever touch `Round`):
 * two overlapping `closeRound` calls on the same round would otherwise both
 * pass the outer checks and the second would silently "succeed" again
 * (`settledCount: 0`, `closedAt` overwritten with a later timestamp, a
 * redundant `CLOSE_ROUND` audit entry) instead of being rejected as
 * "ya está cerrada" — the exact double-close `updateRoundDeadline` and this
 * docstring both say can't happen. Per-match settlement (criterio 18) was
 * already race-safe: `unresolvedMatches` below is read with `tx`, not from a
 * stale snapshot, so a match a participant reports mid-race is correctly
 * excluded either way. Behavior in the non-racing path is unchanged — same
 * checks, same messages, same happy path.
 */
export async function closeRound(
  roundId: string
): Promise<ActionResult<{ settledCount: number }>> {
  const session = await requireAdmin();

  const round = await prisma.round.findUnique({ where: { id: roundId } });
  if (!round) {
    return { ok: false, error: "Ronda no encontrada" };
  }

  if (round.closedAt !== null) {
    return { ok: false, error: "La ronda ya está cerrada" };
  }

  if (round.deadline.getTime() > Date.now()) {
    return {
      ok: false,
      error:
        "No se puede cerrar la ronda antes de su fecha de cierre. Si quieres cerrarla antes, mueve primero la fecha.",
    };
  }

  // Admin sessions must have a playerId for DB writes (same convention as
  // reportResult — src/server/result-actions.ts).
  if (!session.playerId) {
    return {
      ok: false,
      error:
        "La sesión de administrador no tiene un jugador asociado. Usa un jugador con rol ADMIN.",
    };
  }
  const actorId = session.playerId;

  let settledCount: number;
  try {
    settledCount = await prisma.$transaction(async (tx) => {
      // Authoritative re-read (H5b, TOCTOU): the outer checks above are a
      // fast-path shortcut and can be stale by the time the transaction
      // actually runs — re-verify against `tx`, the transaction's own
      // client, as the very first thing it does.
      const currentRound = await tx.round.findUnique({
        where: { id: roundId },
        select: { closedAt: true, deadline: true },
      });
      if (!currentRound) {
        throw new CloseRoundGuardFailedError("not_found");
      }
      if (currentRound.closedAt !== null) {
        throw new CloseRoundGuardFailedError("already_closed");
      }
      if (currentRound.deadline.getTime() > Date.now()) {
        throw new CloseRoundGuardFailedError("not_due");
      }

      // Only matches of this round without a Result yet — matches that already
      // have one are never touched (criterio 19). Read with `tx`, not from a
      // stale snapshot, so a match a participant reported mid-race is
      // correctly excluded either way (already race-safe before H5b).
      const unresolvedMatches = await tx.match.findMany({
        where: { roundId, result: null },
        select: { id: true },
      });
      const ids = unresolvedMatches.map((m) => m.id);

      if (ids.length > 0) {
        await tx.result.createMany({
          data: ids.map((matchId) => ({
            matchId,
            homeVictoryPoints: 0,
            awayVictoryPoints: 0,
            outcome: "DRAW" as const,
            resolution: "UNPLAYED_DRAW" as const,
            reportedById: actorId,
            bonusHome: 0,
            bonusAway: 0,
          })),
        });

        // A Match with a Result counts for standings via isConfirmedForStandings
        // (src/server/standings.ts), which requires status REPORTED/CONFIRMED
        // AND a Result — so the settled matches must transition too.
        await tx.match.updateMany({
          where: { id: { in: ids } },
          data: { status: "REPORTED" },
        });
      }

      await tx.round.update({
        where: { id: roundId },
        data: { closedAt: new Date() },
      });

      await tx.auditLog.create({
        data: {
          actorId,
          action: "CLOSE_ROUND",
          entityType: "Round",
          entityId: roundId,
          payload: JSON.stringify({
            leagueId: round.leagueId,
            roundIndex: round.index,
            settledCount: ids.length,
          }),
        },
      });

      return ids.length;
    });
  } catch (err) {
    if (err instanceof CloseRoundGuardFailedError) {
      if (err.reason === "not_found") {
        return { ok: false, error: "Ronda no encontrada" };
      }
      if (err.reason === "already_closed") {
        return { ok: false, error: "La ronda ya está cerrada" };
      }
      return {
        ok: false,
        error:
          "No se puede cerrar la ronda antes de su fecha de cierre. Si quieres cerrarla antes, mueve primero la fecha.",
      };
    }
    throw err;
  }

  revalidatePath("/admin/rondas");
  revalidatePath("/mis-partidas");
  revalidatePath("/clasificacion");
  revalidatePath("/rondas");
  revalidatePath("/calendario");

  return { ok: true, data: { settledCount } };
}

// ---------------------------------------------------------------------------
// Admin action: redistributePending (Hito 8: recalculo-alta-baja-y-cupo)
// ---------------------------------------------------------------------------

/**
 * Internal sentinel thrown inside `redistributePending`'s transaction to
 * abort it when the re-read (with `tx`) of an existing OPEN round it intends
 * to write matches into finds it closed. Caught right outside
 * `prisma.$transaction` and turned into a Spanish rejection; scoped with
 * `instanceof` so a real DB failure is never mistaken for this race.
 */
class RedistributeRoundClosedDuringTransactionError extends Error {}

export interface RedistributeSummary {
  /** How many pending matches actually got a (possibly unchanged) roundId write. */
  reassignedCount: number;
  /** How many new Round rows were created to hold the overflow (SPEC §5.1). */
  roundsAdded: number;
  /** How many trailing, now-empty open rounds got deleted (SPEC §5.5). */
  roundsRemoved: number;
}

/** Order-independent key for a pair of player ids — same convention as the
 * private `pairKey` in src/server/rounds.ts, duplicated here (not exported
 * there) since it's a one-line normalisation, not domain logic. */
function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

interface PendingMatchInput {
  id: string;
  playerHomeId: string;
  playerAwayId: string;
}

/**
 * A match that already has a `Result` and sits in an OPEN round — never
 * moved, but its seat still counts against `matchesPerRound` there (Hito 8
 * review, plan/rondas-con-fecha/reviews/recalculo-alta-baja-y-cupo.md: the
 * bloqueante this type exists to close). `roundIndex` is the `Round.index`
 * it already occupies, not a DB id — `assignPairsToRounds` works purely in
 * terms of indexes, same as everything else it receives.
 */
interface ResolvedMatchInput {
  playerHomeId: string;
  playerAwayId: string;
  roundIndex: number;
}

interface RoundInput {
  id: string;
  index: number;
  closedAt: Date | null;
  deadline: Date;
}

interface RedistributionPlan {
  /** Every pending match that should end up in the given round index — always
   * includes matches that don't actually move, so the write step is a plain,
   * uniform "set roundId" for the whole set. */
  assignments: { matchId: string; roundIndex: number }[];
  /** Existing OPEN round ids the plan intends to write matches into —
   * re-verified for concurrent closure right before the write (H5b pattern,
   * plan/rondas-con-fecha/PLAN.md: "compite con closeRound"). */
  targetExistingRoundIds: string[];
  /** New Round rows to create, ascending index order, before applying the
   * assignments that reference them. */
  newRounds: { index: number; deadline: Date }[];
}

/**
 * Pure planning step — no Prisma calls, only decides where every pending
 * match should land. `assignPairsToRounds` (src/server/rounds.ts, Hito 2) is
 * the actual coloring algorithm; this only wires its result to concrete
 * Round rows (existing or new) and derives the extra rounds' deadlines
 * (SPEC §5.1 point 3, §4.4).
 *
 * `resolvedInOpenRounds` (Hito 8 review, plan/rondas-con-fecha/reviews/recalculo-alta-baja-y-cupo.md):
 * matches that already have a `Result` but sit in an OPEN round — passed to
 * `assignPairsToRounds` as `preassigned` so the coloring algorithm itself
 * knows how much of each player's `matchesPerRound` those already-settled
 * matches consume in that round, instead of coloring the pending subgraph
 * blind to seats that are actually taken. This is the fix for the
 * bloqueante that review found: without it, a player with a real, played
 * match in an open round could end up with a *second* match placed in that
 * exact round by the recalculation — the invariant SPEC §8 criterio 2
 * exists to prevent, and criterio 29 repeats explicitly for this hito.
 *
 * Never retries `assignPairsToRounds` on a "not enough open rounds" error:
 * instead it always offers a generous, provably-sufficient number of extra
 * *candidate* indexes up front — `participantIds.length` of them, one call is
 * enough. This bound holds **whether or not there is precoloring**: the
 * number of factors `assignPairsToRounds` has to place never exceeds
 * `participantIds.length` either way (Vizing's `Δ + 1` when there is none, a
 * strictly smaller quantity than the graph's own vertex count either way —
 * see rounds.ts's own doc), and in the worst case every factor needs a
 * brand-new, entirely unconsumed round of its own, which `participantIds.length`
 * fresh candidates always cover on top of whatever the existing open rounds
 * already offer. What precoloring gives up is *optimality*, not this safety
 * margin: with real precoloring in play the algorithm may need more of
 * those candidate rounds than the `Δ + 1` free-coloring case ever would
 * (see `assignPairsToRounds`'s own doc for why `Δ + 1` itself stops being a
 * guaranteed bound once matches are already fixed to a round) — this
 * function never assumes otherwise; it just offers enough room either way.
 */
function planRedistribution(params: {
  pendingMatches: PendingMatchInput[];
  resolvedInOpenRounds: ResolvedMatchInput[];
  matchesPerRound: number;
  rounds: RoundInput[];
  startMonth: Date | null;
}): { ok: true; plan: RedistributionPlan } | { ok: false; error: string } {
  const { pendingMatches, resolvedInOpenRounds, matchesPerRound, rounds, startMonth } =
    params;

  const openRounds = rounds.filter((r) => r.closedAt === null);
  const openIndexes = openRounds.map((r) => r.index);
  const openIndexSet = new Set(openIndexes);

  if (pendingMatches.length === 0) {
    return {
      ok: true,
      plan: { assignments: [], targetExistingRoundIds: [], newRounds: [] },
    };
  }

  const pairs: Pairing[] = pendingMatches.map((m) => ({
    homeId: m.playerHomeId,
    awayId: m.playerAwayId,
  }));
  const participantIds = [
    ...new Set(pairs.flatMap((p) => [p.homeId, p.awayId])),
  ];

  const preassigned: PreassignedPair[] = resolvedInOpenRounds.map((m) => ({
    homeId: m.playerHomeId,
    awayId: m.playerAwayId,
    roundIndex: m.roundIndex,
  }));

  const maxExistingIndex = rounds.reduce(
    (max, r) => Math.max(max, r.index),
    0
  );
  const candidateNewIndexes = Array.from(
    { length: participantIds.length },
    (_, i) => maxExistingIndex + 1 + i
  );

  const assignments = assignPairsToRounds(
    pairs,
    participantIds,
    matchesPerRound,
    [...openIndexes, ...candidateNewIndexes],
    preassigned
  );

  const usedNewIndexes = [
    ...new Set(
      assignments.map((a) => a.roundIndex).filter((idx) => idx > maxExistingIndex)
    ),
  ].sort((a, b) => a - b);

  let newRoundDeadlines: Date[] = [];
  if (usedNewIndexes.length > 0) {
    // Anchor month for the new deadlines: the month right after the last
    // existing round's deadline (SPEC §5.1: "fecha derivada del mes
    // siguiente al último cierre" — "cierre" here is the round's deadline,
    // the same vocabulary as SPEC §4.4's "Ronda 1 cierra 31 mar 2026", not
    // literally `closedAt`). If there is no round at all yet, fall back to
    // the league's own `startMonth` — same convention `generateLeagueMatches`
    // uses for round 1.
    const anchor =
      rounds.length > 0
        ? (() => {
            const last = rounds.reduce((a, b) => (a.index > b.index ? a : b));
            return new Date(
              Date.UTC(
                last.deadline.getUTCFullYear(),
                last.deadline.getUTCMonth() + 1,
                1
              )
            );
          })()
        : startMonth;

    if (anchor === null) {
      return {
        ok: false,
        error:
          "No se pueden añadir más rondas: la liga no tiene un mes de arranque configurado. Fíjalo en la configuración de la liga.",
      };
    }
    newRoundDeadlines = deriveDeadlines(anchor, usedNewIndexes.length);
  }

  const matchIdByPairKey = new Map<string, string>();
  for (const m of pendingMatches) {
    matchIdByPairKey.set(pairKey(m.playerHomeId, m.playerAwayId), m.id);
  }

  const planAssignments = assignments.map((a) => ({
    matchId: matchIdByPairKey.get(pairKey(a.homeId, a.awayId))!,
    roundIndex: a.roundIndex,
  }));

  const usedExistingIndexes = new Set(
    assignments.map((a) => a.roundIndex).filter((idx) => openIndexSet.has(idx))
  );
  const targetExistingRoundIds = openRounds
    .filter((r) => usedExistingIndexes.has(r.index))
    .map((r) => r.id);

  return {
    ok: true,
    plan: {
      assignments: planAssignments,
      targetExistingRoundIds,
      newRounds: usedNewIndexes.map((index, i) => ({
        index,
        deadline: newRoundDeadlines[i],
      })),
    },
  };
}

/**
 * Recompute the round each still-pending (no `Result`) league match belongs
 * to (SPEC §5.1, §5.5, §5.6 — Hito 8). The single entry point the three
 * triggers of this hito call after their own write:
 *   - `addMissingLeagueMatches` (src/server/match-actions.ts), after creating
 *     the new pairs for an alta a mitad de liga (criterios 29-31).
 *   - `setPlayerActive(false)` (src/server/league-actions.ts), after settling
 *     the deactivated player's own pending matches as walkovers (criterio 32
 *     point 3).
 *   - `updateLeague` (src/server/league-actions.ts), after persisting a
 *     changed `matchesPerRound` (criterios 34, 35).
 *
 * What it does, every time (SPEC §5.1 points 1-3):
 *   1. Closed rounds, and any match that already has a `Result` (in an open
 *      round or none), are never touched — only `phase = LEAGUE` matches
 *      with `result: null` in an open round (or no round yet at all) are
 *      candidates to move.
 *   2. All of those pending matches are redistributed together across the
 *      open rounds with `assignPairsToRounds` (src/server/rounds.ts, Hito 2)
 *      — the same `Δ + 1` guarantee than criterio 2 needs.
 *   3. If the open rounds don't have room, new rounds are appended at the
 *      end with deadlines derived from the months following the last
 *      existing round's deadline (criterio 30); trailing open rounds left
 *      completely empty afterwards (no match at all, pending or resolved)
 *      are deleted (criterio 35, SPEC §5.5).
 *
 * Deliberately never touches `Match.scheduledAt` (criterio 31) — only
 * `roundId` is written.
 *
 * TOCTOU hardening (H5b pattern, plan/rondas-con-fecha/PLAN.md): the plan
 * above is computed from a read taken *before* `prisma.$transaction` opens.
 * Two things could have changed by the time the transaction actually runs:
 *   - An existing OPEN round the plan targets could have been closed by a
 *     concurrent `closeRound` — re-checked with `tx`, as the very first
 *     thing inside the transaction; any hit aborts the whole redistribution
 *     (the caller can simply retry — a fresh plan will route around the
 *     now-closed round). Newly created rounds can't have this problem: they
 *     don't exist outside this transaction.
 *   - A pending match the plan wants to move could have received a real
 *     `Result` in the meantime (`reportResult` / `declareWalkover`) — this
 *     one self-heals instead of aborting: matches no longer `result: null`
 *     at write time are simply skipped, leaving them exactly where they
 *     already are, which is the correct outcome ("no reasigna ninguna
 *     partida que ya tenga Result").
 *
 * Everything — creating new rounds, writing `roundId`, deleting emptied
 * trailing rounds, and the `AuditLog` entry — happens in one
 * `prisma.$transaction` (SPEC §7.1).
 *
 * Guard: `requireAdmin()` first, even though every current caller is itself
 * an already-admin-gated action — this stays a standalone action in its own
 * right (same convention as the rest of this file).
 *
 * Known limitation — two concurrent `redistributePending` on the same league:
 * both can plan the same new round index and race to create it, so the loser
 * hits the `@@unique([leagueId, index])` constraint. It fails hard and atomic
 * (the whole transaction rolls back; no half-written rounds), so the league is
 * never left inconsistent by this alone, and re-running the action recovers.
 * Not guarded because it needs two admins acting at the same instant and the
 * failure is loud — unlike the silent double-close that H5b had to fix in
 * `closeRound`. Documented here, at the place it actually happens, as well as
 * in both callers: `addMissingLeagueMatches` is the one composite flow that is
 * NOT atomic end to end, so a failure there can leave the newly created
 * matches with `roundId: null`, and those do not self-heal on a plain retry of
 * that action — the recovery path is to run this redistribution again.
 */
export async function redistributePending(
  leagueId: string
): Promise<ActionResult<RedistributeSummary>> {
  const session = await requireAdmin();

  const league = await prisma.league.findUnique({ where: { id: leagueId } });
  if (!league) {
    return { ok: false, error: "Liga no encontrada" };
  }

  const rounds = await prisma.round.findMany({
    where: { leagueId },
    select: { id: true, index: true, closedAt: true, deadline: true },
    orderBy: { index: "asc" },
  });

  const pendingMatchesRaw = await prisma.match.findMany({
    where: {
      leagueId,
      phase: "LEAGUE",
      result: null,
      OR: [{ roundId: null }, { round: { closedAt: null } }],
    },
    select: { id: true, playerHomeId: true, playerAwayId: true },
  });
  // League matches always have an away player (only playoff byes don't) —
  // filtered defensively, same convention as match-actions.ts.
  const pendingMatches = pendingMatchesRaw.filter(
    (m): m is typeof m & { playerAwayId: string } => m.playerAwayId !== null
  );

  // Matches that already have a Result but still sit in an OPEN round — the
  // capacity they already consume there (Hito 8 review: the bloqueante this
  // closes, see planRedistribution's doc). `round: { closedAt: null }` on a
  // nullable relation only matches rows whose round actually exists and is
  // open, so every row here is guaranteed a non-null `round`.
  const resolvedInOpenRoundsRaw = await prisma.match.findMany({
    where: {
      leagueId,
      phase: "LEAGUE",
      result: { isNot: null },
      round: { closedAt: null },
    },
    select: {
      playerHomeId: true,
      playerAwayId: true,
      round: { select: { index: true } },
    },
  });
  const resolvedInOpenRounds = resolvedInOpenRoundsRaw
    .filter(
      (m): m is typeof m & { playerAwayId: string; round: { index: number } } =>
        m.playerAwayId !== null && m.round !== null
    )
    .map((m) => ({
      playerHomeId: m.playerHomeId,
      playerAwayId: m.playerAwayId,
      roundIndex: m.round.index,
    }));

  const planned = planRedistribution({
    pendingMatches,
    resolvedInOpenRounds,
    matchesPerRound: league.matchesPerRound,
    rounds,
    startMonth: league.startMonth,
  });

  if (!planned.ok) {
    return { ok: false, error: planned.error };
  }
  const { plan } = planned;

  // Admin sessions must have a playerId for DB writes (same convention as
  // closeRound).
  if (!session.playerId) {
    return {
      ok: false,
      error:
        "La sesión de administrador no tiene un jugador asociado. Usa un jugador con rol ADMIN.",
    };
  }
  const actorId = session.playerId;

  // Snapshot used only to map round index -> id for existing rounds, and to
  // drive the trailing-cleanup scan below. Ids are immutable, so this stays
  // valid even though `closedAt` itself is re-verified with `tx` below.
  const openRoundsSnapshot = rounds.filter((r) => r.closedAt === null);

  let summary: RedistributeSummary;
  try {
    summary = await prisma.$transaction(async (tx) => {
      // H5b hardening, part 1: re-verify none of the existing OPEN rounds
      // the plan targets got closed since the read above.
      if (plan.targetExistingRoundIds.length > 0) {
        const fresh = await tx.round.findMany({
          where: { id: { in: plan.targetExistingRoundIds } },
          select: { id: true, closedAt: true },
        });
        if (
          fresh.length !== plan.targetExistingRoundIds.length ||
          fresh.some((r) => r.closedAt !== null)
        ) {
          throw new RedistributeRoundClosedDuringTransactionError();
        }
      }

      // H5b hardening, part 2: self-heal instead of abort — a match the plan
      // wants to move could have received a real Result in the same window.
      // Re-check and simply exclude those from the write below.
      //
      // Known narrow residual, not fixed here (out of scope of the Hito 8
      // review's bloqueante, which needs no concurrency at all to reproduce):
      // the excluded match stays wherever it currently sits, but the plan
      // colored every *other* pending match assuming this one would move —
      // i.e. without counting the excluded match's true resting round as
      // `preassigned` capacity. If another of that match's players' pending
      // pairs was placed into that same round by this same plan, the two
      // could in principle collide there. This requires two things to land
      // in the exact same transaction window (a `reportResult` on this
      // specific match, *and* this specific redistribution), on top of the
      // already-narrow closeRound race right above — noted for whoever
      // widens this hardening next, not treated as a blocker now.
      const planMatchIds = plan.assignments.map((a) => a.matchId);
      const stillPending =
        planMatchIds.length > 0
          ? await tx.match.findMany({
              where: { id: { in: planMatchIds }, result: null },
              select: { id: true },
            })
          : [];
      const stillPendingIds = new Set(stillPending.map((m) => m.id));

      // Create the new Round rows first — the assignments below need their
      // real ids.
      const newRoundIdByIndex = new Map<number, string>();
      for (const nr of plan.newRounds) {
        const round = await tx.round.create({
          data: { leagueId, index: nr.index, deadline: nr.deadline },
        });
        newRoundIdByIndex.set(nr.index, round.id);
      }

      const existingRoundIdByIndex = new Map<number, string>();
      for (const r of openRoundsSnapshot) {
        existingRoundIdByIndex.set(r.index, r.id);
      }

      const matchIdsByRoundId = new Map<string, string[]>();
      for (const a of plan.assignments) {
        if (!stillPendingIds.has(a.matchId)) continue;
        const roundId =
          existingRoundIdByIndex.get(a.roundIndex) ??
          newRoundIdByIndex.get(a.roundIndex);
        if (!roundId) {
          // Unreachable given how `planRedistribution` builds `assignments`
          // (every `roundIndex` it emits is either an existing open round's
          // index or one of `plan.newRounds`' own indexes) — a named,
          // diagnosable failure instead of silently dropping a match is
          // preferable to a bug that only shows up as "why didn't this
          // match move", same reasoning as rounds.ts's own defensive throws.
          throw new Error(
            `redistributePending: no round id found for planned roundIndex ${a.roundIndex} (match ${a.matchId})`
          );
        }
        const list = matchIdsByRoundId.get(roundId) ?? [];
        list.push(a.matchId);
        matchIdsByRoundId.set(roundId, list);
      }

      // Only `roundId` is written — never `scheduledAt` (criterio 31).
      let reassignedCount = 0;
      for (const [roundId, matchIds] of matchIdsByRoundId) {
        await tx.match.updateMany({
          where: { id: { in: matchIds } },
          data: { roundId },
        });
        reassignedCount += matchIds.length;
      }

      // Trailing cleanup (SPEC §5.5): an open round left with zero matches
      // at all — not just zero *pending* ones, a round whose matches were
      // all already resolved is not "empty" — gets deleted, walking from the
      // highest index down and stopping at the first non-empty round, so
      // only a contiguous block at the very end is ever touched.
      let roundsRemoved = 0;
      const openDesc = [...openRoundsSnapshot].sort((a, b) => b.index - a.index);
      for (const r of openDesc) {
        const count = await tx.match.count({ where: { roundId: r.id } });
        if (count > 0) break;
        await tx.round.delete({ where: { id: r.id } });
        roundsRemoved++;
      }

      await tx.auditLog.create({
        data: {
          actorId,
          action: "REDISTRIBUTE_PENDING",
          entityType: "League",
          entityId: leagueId,
          payload: JSON.stringify({
            reassignedCount,
            roundsAdded: plan.newRounds.length,
            roundsRemoved,
          }),
        },
      });

      return {
        reassignedCount,
        roundsAdded: plan.newRounds.length,
        roundsRemoved,
      };
    });
  } catch (err) {
    if (err instanceof RedistributeRoundClosedDuringTransactionError) {
      return {
        ok: false,
        error:
          "Alguna ronda se cerró mientras se recalculaba el reparto. Vuelve a intentarlo.",
      };
    }
    throw err;
  }

  revalidatePath("/admin/rondas");
  revalidatePath("/admin/emparejamientos");
  revalidatePath("/mis-partidas");
  revalidatePath("/rondas");
  revalidatePath("/calendario");
  revalidatePath("/clasificacion");

  return { ok: true, data: summary };
}
