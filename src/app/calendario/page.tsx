// Calendario — calendar view: list of matches ordered by date.
// SPEC §8: unscheduled matches first, then scheduled in chronological order.
// Accessible to all authenticated users (PLAYER or ADMIN).
// Admin can edit any match; players can only edit their own matches.

import { prisma } from "@/lib/db";
import { requireAuth } from "@/lib/guards";
import { Eyebrow } from "@/components/Eyebrow";
import { Card } from "@/components/Card";
import { MatchRow } from "./MatchRow";
import { AppHeader } from "@/components/AppHeader";
import Link from "next/link";

export default async function CalendarioPage() {
  const session = await requireAuth();
  const isAdmin = session.role === "ADMIN";

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
        <AppHeader active="calendario" />
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

  // Load all league matches (LEAGUE phase) with player names.
  // roundId/round.index (etiqueta, SPEC §4.6) and result.resolution (label,
  // SPEC §4.9) added in Hito 6 (ui-cupo-y-rondas).
  const rawMatches = await prisma.match.findMany({
    where: { leagueId: league.id, phase: "LEAGUE" },
    select: {
      id: true,
      status: true,
      scheduledAt: true,
      location: true,
      playerHomeId: true,
      playerAwayId: true,
      playerHome: { select: { displayName: true } },
      playerAway: { select: { displayName: true } },
      round: { select: { index: true } },
      result: { select: { resolution: true } },
    },
  });

  // Separate unscheduled and scheduled matches.
  const unscheduled = rawMatches.filter((m) => m.scheduledAt === null);
  const scheduled = rawMatches
    .filter((m) => m.scheduledAt !== null)
    .sort(
      (a, b) =>
        new Date(a.scheduledAt!).getTime() - new Date(b.scheduledAt!).getTime()
    );

  // Map to MatchRow props; determine canEdit per match.
  function toRowProps(m: (typeof rawMatches)[number]) {
    const canEdit =
      isAdmin ||
      (session.playerId !== null &&
        (m.playerHomeId === session.playerId ||
          m.playerAwayId === session.playerId));

    return {
      match: {
        id: m.id,
        playerHomeName: m.playerHome.displayName,
        playerAwayName: m.playerAway?.displayName ?? null,
        scheduledAt: m.scheduledAt ? m.scheduledAt.toISOString() : null,
        location: m.location,
        status: m.status,
        roundIndex: m.round?.index ?? null,
        resolution: m.result?.resolution ?? null,
      },
      canEdit,
    };
  }

  // For filter context display.
  // Hito 15: "jugadas" = REPORTED (new flow) or CONFIRMED (legacy).
  const now = new Date();
  const upcoming = scheduled.filter(
    (m) => m.scheduledAt !== null && new Date(m.scheduledAt) >= now
  );
  const played = scheduled.filter(
    (m) =>
      m.scheduledAt !== null &&
      new Date(m.scheduledAt) < now &&
      (m.status === "REPORTED" || m.status === "CONFIRMED")
  );

  return (
    <div
      className="min-h-screen flex flex-col"
      style={{ background: "var(--bg)", color: "var(--fg)" }}
    >
      <AppHeader active="calendario" />

      <main className="flex-1 px-4 py-6 max-w-2xl mx-auto w-full space-y-8">
        {/* League info */}
        <div>
          <Eyebrow>Calendario · {league.name}</Eyebrow>
          <h1
            className="mt-2 text-[28px] font-semibold leading-tight"
            style={{ fontFamily: "var(--font-display)", color: "var(--fg)" }}
          >
            {league.season}
          </h1>
          <p
            className="mt-1 text-[13px]"
            style={{ color: "var(--fg-muted)", fontFamily: "var(--font-sans)" }}
          >
            {rawMatches.length} partida{rawMatches.length !== 1 ? "s" : ""} ·{" "}
            {unscheduled.length} sin fecha · {upcoming.length} próxima
            {upcoming.length !== 1 ? "s" : ""} · {played.length} jugada
            {played.length !== 1 ? "s" : ""}
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
              No hay partidas generadas todavía
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

        {/* Unscheduled matches */}
        {unscheduled.length > 0 && (
          <section>
            <Eyebrow>Sin fecha ({unscheduled.length})</Eyebrow>
            <div className="mt-3 space-y-2">
              {unscheduled.map((m) => {
                const props = toRowProps(m);
                return (
                  <MatchRow
                    key={m.id}
                    match={props.match}
                    canEdit={props.canEdit}
                  />
                );
              })}
            </div>
          </section>
        )}

        {/* Scheduled matches */}
        {scheduled.length > 0 && (
          <section>
            <Eyebrow>Agendadas ({scheduled.length})</Eyebrow>
            <div className="mt-3 space-y-2">
              {scheduled.map((m) => {
                const props = toRowProps(m);
                return (
                  <MatchRow
                    key={m.id}
                    match={props.match}
                    canEdit={props.canEdit}
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
