// Server actions for match management: pairing generation and schedule setting.
// Hito 6: emparejamientos-y-fechas.
// SPEC §7.2, §5, §4.4, ADR-007.

"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireAdmin, requireAuth } from "@/lib/guards";
import { missingPairings } from "@/server/pairings";
import { roundRobinRounds, deriveDeadlines } from "@/server/rounds";
import { redistributePending } from "@/server/round-actions";
import { LEAGUE_TZ } from "@/server/calendar";
import {
  canScheduleAt,
  type ScheduleContext,
  type ScheduleRejection,
} from "@/server/result-logic";
import { z } from "zod";

// Re-export the ActionResult type consistent with league-actions.
export type ActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: string };

// ---------------------------------------------------------------------------
// Schema: schedule a match (set/clear scheduledAt and optional location)
// ---------------------------------------------------------------------------

const scheduleMatchSchema = z.object({
  // ISO 8601 string or null to clear.
  scheduledAt: z
    .string()
    .datetime({ message: "Fecha inválida" })
    .nullable()
    .optional(),
  location: z
    .string()
    .trim()
    .max(200, "El lugar no puede superar los 200 caracteres")
    .nullable()
    .optional(),
});

export type ScheduleMatchInput = z.infer<typeof scheduleMatchSchema>;

// ---------------------------------------------------------------------------
// Admin action: generateLeagueMatches
// ---------------------------------------------------------------------------

/**
 * Generate (or regenerate) all round-robin league matches for the given league,
 * split into monthly rounds (rondas-con-fecha spec §4.2, §4.3, §4.4).
 *
 * Guard (SPEC §5): requires ADMIN session.
 *
 * Rounds guard (rondas-con-fecha spec §4.4, PLAN.md H3): refuses to generate
 * — creating neither a Round nor a Match — while `league.startMonth` is
 * `null`. Without a starting month there is nothing to derive round
 * deadlines from (D1, PLAN.md): a league in SETUP can legitimately have no
 * starting month yet, and that must stay an explicit blocker, not an
 * invented default.
 *
 * Regeneration guard (SPEC §7.2, §9):
 *   - Blocked if any existing league match has status CONFIRMED (games already played).
 *   - If no confirmed matches exist, previous SCHEDULED/REPORTED/DISPUTED league
 *     matches (and their Round rows) are deleted and replaced with fresh ones
 *     (dates discarded).
 *
 * Postcondition: all new matches have phase=LEAGUE, status=SCHEDULED,
 *   scheduledAt=null, isBye=false, roundId pointing at a freshly created Round.
 */
export async function generateLeagueMatches(
  leagueId: string
): Promise<ActionResult<{ count: number }>> {
  await requireAdmin();

  // Load league and its active players.
  const league = await prisma.league.findUnique({
    where: { id: leagueId },
  });

  if (!league) {
    return { ok: false, error: "Liga no encontrada" };
  }

  // Rounds guard: nothing to derive deadlines from without a starting month.
  // Checked before any other read/write so a league missing this config
  // never ends up with a partial, DB-inconsistent generation.
  if (league.startMonth === null) {
    return {
      ok: false,
      error:
        "La liga no tiene un mes de arranque configurado. Fíjalo en la configuración de la liga antes de generar los emparejamientos.",
    };
  }

  // Load active players for this league.
  const players = await prisma.player.findMany({
    where: { leagueId, active: true },
    select: { id: true, displayName: true },
  });

  if (players.length < 2) {
    return {
      ok: false,
      error:
        "Se necesitan al menos 2 jugadores activos para generar emparejamientos",
    };
  }

  // Generate the pure round-robin, already split into rounds (before the
  // transaction — pure computation, no DB). SPEC §4.3: the circle method
  // over the complete graph is the exact construction used here.
  const rounds = roundRobinRounds(
    players.map((p) => p.id),
    league.matchesPerRound
  );
  const deadlines = deriveDeadlines(league.startMonth, rounds.length);
  const totalMatchCount = rounds.reduce((sum, r) => sum + r.length, 0);

  // Transactionally: check regeneration guard, delete old rounds/matches,
  // create the new ones. TOCTOU fix: the confirmed-count check now lives
  // INSIDE the transaction so the read and the delete/create are atomic (no
  // race between two concurrent requests).
  const guardResult = await prisma.$transaction(async (tx) => {
    // Regeneration guard (Hito 15): block if any league match has a result
    // apuntado (status REPORTED or CONFIRMED). REPORTED is the new active status;
    // CONFIRMED is kept for legacy data compatibility.
    const confirmedCount = await tx.match.count({
      where: {
        leagueId,
        phase: "LEAGUE",
        status: { in: ["REPORTED", "CONFIRMED"] },
      },
    });

    if (confirmedCount > 0) {
      // Return the count so the caller can build the error message.
      return { blocked: true, confirmedCount } as const;
    }

    // Delete existing league matches for this league.
    // Results are tied to matches; we delete results first due to FK constraints.
    const existingMatchIds = await tx.match.findMany({
      where: { leagueId, phase: "LEAGUE" },
      select: { id: true },
    });

    if (existingMatchIds.length > 0) {
      const ids = existingMatchIds.map((m) => m.id);
      await tx.result.deleteMany({ where: { matchId: { in: ids } } });
      await tx.match.deleteMany({ where: { id: { in: ids } } });
    }

    // Delete existing Round rows for this league — matches referencing them
    // are already gone, and @@unique([leagueId, index]) would otherwise
    // collide with the fresh rounds created below.
    await tx.round.deleteMany({ where: { leagueId } });

    // Create the new Round rows one at a time (not createMany) so we get
    // each generated id back to assign as Match.roundId below.
    const roundIds: string[] = [];
    for (let i = 0; i < rounds.length; i++) {
      const round = await tx.round.create({
        data: { leagueId, index: i + 1, deadline: deadlines[i] },
      });
      roundIds.push(round.id);
    }

    // Create new matches, each tied to the round it was assigned to.
    await tx.match.createMany({
      data: rounds.flatMap((roundPairs, i) =>
        roundPairs.map((p) => ({
          leagueId,
          phase: "LEAGUE" as const,
          status: "SCHEDULED" as const,
          playerHomeId: p.homeId,
          playerAwayId: p.awayId,
          scheduledAt: null,
          location: null,
          isBye: false,
          roundId: roundIds[i],
        }))
      ),
    });

    // If the league is still in SETUP, transition it to LEAGUE phase.
    if (league.status === "SETUP") {
      await tx.league.update({
        where: { id: leagueId },
        data: { status: "LEAGUE" },
      });
    }

    return { blocked: false } as const;
  });

  if (guardResult.blocked) {
    const count = guardResult.confirmedCount;
    return {
      ok: false,
      error: `No se pueden regenerar los emparejamientos: hay ${count} partida${count !== 1 ? "s" : ""} con resultado apuntado. Usa "Añadir los que faltan" en su lugar para no perder resultados existentes.`,
    };
  }

  revalidatePath("/admin/emparejamientos");
  revalidatePath("/admin/rondas");
  revalidatePath("/calendario");
  revalidatePath("/admin");

  return { ok: true, data: { count: totalMatchCount } };
}

// ---------------------------------------------------------------------------
// Admin action: addMissingLeagueMatches
// ---------------------------------------------------------------------------

/**
 * Incrementally add only the league match pairs that are not yet present.
 *
 * Unlike `generateLeagueMatches`, this action:
 *   - NEVER deletes any existing matches, dates, or results.
 *   - Works even when confirmed matches exist (no regeneration guard).
 *   - Only creates pairs between currently ACTIVE players.
 *   - If the league is still in SETUP and at least one new match is created,
 *     transitions the league status to LEAGUE (same pattern as full generation).
 *
 * Guard (SPEC §5): requires ADMIN session.
 *
 * Rondas-con-fecha §5.1 (Hito 8, criterios 29-31): the new pairs are created
 * here with `roundId: null` — same as always — but as soon as they exist,
 * `redistributePending` (src/server/round-actions.ts) is invoked to place
 * *every* pending match (the freshly created ones and any other match still
 * without a `Result`) into the open rounds, adding rounds at the end if the
 * quota doesn't fit. There is no invalid `roundId: null` state left standing
 * once this returns successfully.
 *
 * **Not atomic end-to-end** (Hito 8 review, plan/rondas-con-fecha/reviews/recalculo-alta-baja-y-cupo.md):
 * the new matches are created and committed in their own transaction
 * *before* `redistributePending` opens its own, separate transaction. If
 * `redistributePending` fails afterwards — the documented `Round`-index
 * collision between two concurrent redistributions, or anything else — the
 * new matches stay committed with `roundId: null`. The UI already renders
 * that state ("Sin ronda asignada", Hito 6), so it isn't corrupt, but
 * **retrying this exact action does not repair it**: `missingPairings` would
 * see zero pairs left to create and never call `redistributePending` again.
 * The recovery path is any *other* trigger of this hito running afterwards
 * (an admin editing `matchesPerRound`, another alta, a baja) — or simply
 * calling `redistributePending(leagueId)` directly.
 *
 * @returns { count } — number of new matches created (0 if none were missing).
 */
export async function addMissingLeagueMatches(
  leagueId: string
): Promise<ActionResult<{ count: number }>> {
  await requireAdmin();

  // Load league.
  const league = await prisma.league.findUnique({
    where: { id: leagueId },
  });

  if (!league) {
    return { ok: false, error: "Liga no encontrada" };
  }

  // Load active players.
  const players = await prisma.player.findMany({
    where: { leagueId, active: true },
    select: { id: true, displayName: true },
  });

  if (players.length < 2) {
    return {
      ok: false,
      error:
        "Se necesitan al menos 2 jugadores activos para generar emparejamientos",
    };
  }

  // Read existing pairs, compute what's missing, and create the new matches all
  // INSIDE one transaction so the read and the create are atomic. Otherwise two
  // concurrent calls could both read "pair {A,B} missing" and each create it,
  // producing duplicates (negligible on SQLite, real on Postgres).
  const createdCount = await prisma.$transaction(async (tx) => {
    // Load existing LEAGUE pairs (home/away IDs only).
    const existingMatches = await tx.match.findMany({
      where: { leagueId, phase: "LEAGUE" },
      select: { playerHomeId: true, playerAwayId: true },
    });

    // Map to ExistingPair shape (aId = home, bId = away — order is irrelevant for
    // the unordered comparison inside missingPairings).
    // playerAwayId is nullable in the schema (playoff byes); league matches always
    // have an away player, but we guard with a filter to keep types clean.
    const existingPairs = existingMatches
      .filter(
        (m): m is typeof m & { playerAwayId: string } => m.playerAwayId !== null
      )
      .map((m) => ({
        aId: m.playerHomeId,
        bId: m.playerAwayId,
      }));

    // Compute the pairs that are not yet present.
    const newPairings = missingPairings(players, existingPairs);

    if (newPairings.length === 0) {
      // Nothing to create — leave league status untouched.
      return 0;
    }

    await tx.match.createMany({
      data: newPairings.map((p) => ({
        leagueId,
        phase: "LEAGUE" as const,
        status: "SCHEDULED" as const,
        playerHomeId: p.homeId,
        playerAwayId: p.awayId,
        scheduledAt: null,
        location: null,
        isBye: false,
      })),
    });

    // If the league is still in SETUP, transition it to LEAGUE.
    if (league.status === "SETUP") {
      await tx.league.update({
        where: { id: leagueId },
        data: { status: "LEAGUE" },
      });
    }

    return newPairings.length;
  });

  if (createdCount > 0) {
    const redistributeResult = await redistributePending(leagueId);
    if (!redistributeResult.ok) {
      return {
        ok: false,
        error: `Se añadieron ${createdCount} partida${createdCount !== 1 ? "s" : ""}, pero no se pudieron repartir en rondas: ${redistributeResult.error}`,
      };
    }

    revalidatePath("/admin/emparejamientos");
    revalidatePath("/calendario");
    revalidatePath("/admin");
    revalidatePath("/admin/rondas");
    revalidatePath("/mis-partidas");
    revalidatePath("/rondas");
  }

  return { ok: true, data: { count: createdCount } };
}

// ---------------------------------------------------------------------------
// Participant/admin action: setMatchSchedule
// ---------------------------------------------------------------------------

/**
 * Internal sentinel thrown inside the `setMatchSchedule` transaction to abort
 * it when the schedule guard (`canScheduleAt`) fails on the re-read done with
 * `tx` — see the docstring on the action. It carries the already-built Spanish
 * message so the catch block right outside `prisma.$transaction` returns
 * exactly the same rejection the fast-path check would have returned. Scoped
 * with `instanceof`, so a real DB failure inside the transaction is never
 * mistaken for a rejected date. Never leaks past `setMatchSchedule`.
 *
 * Same mechanics as `RoundClosedDuringTransactionError`
 * (src/server/result-actions.ts).
 */
class ScheduleRejectedDuringTransactionError extends Error {}

/** "31 de octubre", read in `Europe/Madrid` (calendario-de-verdad §4.12). */
function dayAndMonthEs(instant: Date): string {
  return new Intl.DateTimeFormat("es-ES", {
    timeZone: LEAGUE_TZ,
    day: "numeric",
    month: "long",
  }).format(instant);
}

/** "octubre de 2026", read in `Europe/Madrid`. */
function monthAndYearEs(instant: Date): string {
  return new Intl.DateTimeFormat("es-ES", {
    timeZone: LEAGUE_TZ,
    month: "long",
    year: "numeric",
  }).format(instant);
}

/** What `scheduleRejectionMessage` needs to name the offending bound. */
interface ScheduleMessageContext {
  /** `Round.index` of the match's round (1-based), null when it has none. */
  roundIndex: number | null;
  roundDeadline: Date | null;
  leagueStartMonth: Date | null;
}

/**
 * Turn a `ScheduleRejection` into the Spanish message of
 * calendario-de-verdad §5.5. The reason is the fact
 * (`canScheduleAt`, src/server/result-logic.ts), the wording is presentation:
 * every message names **which** of the bounds was violated, and with which
 * concrete date, so the user knows what to pick instead.
 *
 * `ROUND_CLOSED` (§4.14) and `CLEARING_PLAYED_MATCH` (§4.9) are not spelled
 * out in §5.5 — it only fixes the wording of the two range ends. They reuse
 * the phrasing of the round-closed rejection `reportResult` already returns
 * (src/server/result-actions.ts), which is the same rule.
 */
function scheduleRejectionMessage(
  reason: ScheduleRejection,
  ctx: ScheduleMessageContext
): string {
  switch (reason) {
    case "AFTER_ROUND_DEADLINE": {
      // canScheduleAt only returns this when the round has a deadline; the
      // fallbacks keep the message sane if that ever stops being true.
      const round =
        ctx.roundIndex === null ? "su ronda" : `la ronda ${ctx.roundIndex}`;
      if (ctx.roundDeadline === null) {
        return `Esta partida es de ${round}, que ya ha cerrado. Elige una fecha anterior.`;
      }
      return `Esta partida es de ${round}, que cierra el ${dayAndMonthEs(ctx.roundDeadline)}. Elige una fecha anterior.`;
    }
    case "BEFORE_LEAGUE_START":
      if (ctx.leagueStartMonth === null) {
        return "La liga todavía no tiene mes de arranque. No puedes fechar una partida antes de que empiece.";
      }
      return `La liga empieza en ${monthAndYearEs(ctx.leagueStartMonth)}. No puedes fechar una partida antes.`;
    case "ROUND_CLOSED":
      return "La ronda de esta partida ya está cerrada. Solo el admin puede cambiar la fecha.";
    case "CLEARING_PLAYED_MATCH":
      return "Esta partida ya tiene un resultado apuntado: no puedes dejarla sin fecha. Cámbiala si el día no era el correcto.";
  }
}

/**
 * Set, edit, or clear the scheduled date (and optional location) of a match.
 *
 * Authorization (SPEC §5, §7.2):
 *   - The logged-in player must be home or away of the match, OR admin.
 *   - The server reads identity exclusively from the signed session cookie —
 *     no playerId is accepted from the client.
 *
 * Either or both fields may be omitted; omitted fields are not changed.
 * Pass scheduledAt: null explicitly to clear the date.
 *
 * Schedule guard (calendario-de-verdad spec §4.6, §4.7, §4.9, §4.14, criteria
 * 18-21, 23, 24, 29-32): every write of `scheduledAt` goes through
 * `canScheduleAt` (src/server/result-logic.ts) — the range of §4.7 with the
 * admin escape on the ceiling, the closed-round freeze of §4.14, and the ban
 * on clearing the date of a `PLAYED` match of §4.9. The predicate is not
 * restated here; this action only turns its `reason` into the Spanish message
 * of §5.5.
 *
 * **Only when the date is actually written** (§5.6, criterio 24): a call that
 * carries just a `location` never revalidates the stored `scheduledAt`, which
 * may legitimately sit outside the range (data predating this spec, or a date
 * the admin set through the §4.6 escape). The validation is of a date write,
 * not of the row.
 *
 * Guarded TWICE against the same predicate, same TOCTOU pattern as
 * `reportResult` (src/server/result-actions.ts): once below, before opening
 * the transaction (fast-path rejection — no point opening a transaction just
 * to abort it), and once more INSIDE `prisma.$transaction`, re-reading the
 * `Round` and the `Result` with `tx` as the very first thing the transaction
 * does. The outer read goes stale in the window between it and the
 * transaction opening — a concurrent admin `closeRound` (criterio 32) or a
 * concurrent `reportResult` turning the match into a `PLAYED` one whose date
 * may no longer be cleared (§4.9) — and without the re-read that window lets
 * through exactly the write the two rules forbid.
 */
export async function setMatchSchedule(
  matchId: string,
  input: ScheduleMatchInput
): Promise<ActionResult> {
  const session = await requireAuth();

  // Load the match to authorize, plus everything the schedule guard needs:
  // its round (deadline/closedAt/index, null for a playoff match or one not
  // yet assigned, §4.11 and §5.2), its league's startMonth (the floor of
  // §4.7) and its Result's resolution (§4.9). One query, no N+1.
  const match = await prisma.match.findUnique({
    where: { id: matchId },
    select: {
      id: true,
      leagueId: true,
      playerHomeId: true,
      playerAwayId: true,
      phase: true,
      roundId: true,
      round: { select: { index: true, deadline: true, closedAt: true } },
      league: { select: { startMonth: true } },
      result: { select: { resolution: true } },
    },
  });

  if (!match) {
    return { ok: false, error: "Partida no encontrada" };
  }

  // Authorization: must be home, away, or admin.
  const isAdmin = session.role === "ADMIN";
  const isParticipant =
    session.playerId !== null &&
    (match.playerHomeId === session.playerId ||
      match.playerAwayId === session.playerId);

  if (!isAdmin && !isParticipant) {
    return {
      ok: false,
      error: "No tienes permiso para modificar la fecha de esta partida",
    };
  }

  // Validate input.
  const parsed = scheduleMatchSchema.safeParse(input);
  if (!parsed.success) {
    const flat = parsed.error.flatten();
    const firstFieldError = Object.values(flat.fieldErrors).flat()[0];
    const firstFormError = flat.formErrors[0];
    return {
      ok: false,
      error: firstFieldError ?? firstFormError ?? "Datos inválidos",
    };
  }

  const d = parsed.data;

  // Build update payload — only include fields that were provided.
  const updateData: {
    scheduledAt?: Date | null;
    location?: string | null;
  } = {};

  if ("scheduledAt" in d) {
    updateData.scheduledAt =
      d.scheduledAt != null ? new Date(d.scheduledAt) : null;
  }
  if ("location" in d) {
    updateData.location = d.location ?? null;
  }

  if (Object.keys(updateData).length === 0) {
    // Nothing to update — no-op success.
    return { ok: true, data: undefined };
  }

  // Is this call writing the date at all? (§5.6, criterio 24: a location-only
  // edit never revalidates the stored date.)
  const writesSchedule = "scheduledAt" in updateData;
  const nextScheduledAt = updateData.scheduledAt ?? null;

  const messageContext: ScheduleMessageContext = {
    roundIndex: match.round?.index ?? null,
    roundDeadline: match.round?.deadline ?? null,
    leagueStartMonth: match.league.startMonth,
  };

  if (writesSchedule) {
    // Fast-path rejection (§4.6, §4.7, §4.9, §4.14). Authoritative check is
    // the re-read inside the transaction below.
    const context: ScheduleContext = {
      roundDeadline: match.round?.deadline ?? null,
      roundClosedAt: match.round?.closedAt ?? null,
      leagueStartMonth: match.league.startMonth,
      hasPlayedResult: match.result?.resolution === "PLAYED",
    };

    const decision = canScheduleAt(nextScheduledAt, context, isAdmin);
    if (!decision.ok) {
      return {
        ok: false,
        error: scheduleRejectionMessage(decision.reason, messageContext),
      };
    }
  }

  try {
    await prisma.$transaction(async (tx) => {
      if (writesSchedule) {
        // Authoritative re-read (TOCTOU): `match.roundId` is immutable once
        // set (nothing in this codebase updates it), so only the Round's own
        // columns and the Result need refreshing — with `tx`, as the very
        // first thing the transaction does.
        const currentRound =
          match.roundId === null
            ? null
            : await tx.round.findUnique({
                where: { id: match.roundId },
                select: { index: true, deadline: true, closedAt: true },
              });
        const currentResult = await tx.result.findUnique({
          where: { matchId },
          select: { resolution: true },
        });

        const decision = canScheduleAt(
          nextScheduledAt,
          {
            roundDeadline: currentRound?.deadline ?? null,
            roundClosedAt: currentRound?.closedAt ?? null,
            leagueStartMonth: match.league.startMonth,
            hasPlayedResult: currentResult?.resolution === "PLAYED",
          },
          isAdmin
        );

        if (!decision.ok) {
          throw new ScheduleRejectedDuringTransactionError(
            scheduleRejectionMessage(decision.reason, {
              roundIndex: currentRound?.index ?? null,
              roundDeadline: currentRound?.deadline ?? null,
              leagueStartMonth: match.league.startMonth,
            })
          );
        }
      }

      await tx.match.update({
        where: { id: matchId },
        data: updateData,
      });
    });
  } catch (err) {
    if (err instanceof ScheduleRejectedDuringTransactionError) {
      return { ok: false, error: err.message };
    }
    throw err;
  }

  // Every view that prints a match date. "/mis-partidas" and "/rondas" were
  // added when the schedule form became reachable from the match card too:
  // without them the card kept showing the stale date until a hard reload.
  revalidatePath("/calendario");
  revalidatePath("/admin/emparejamientos");
  revalidatePath("/mis-partidas");
  revalidatePath("/rondas");

  return { ok: true, data: undefined };
}
