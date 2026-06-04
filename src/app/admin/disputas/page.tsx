// Admin disputes and all-matches view.
// Shows DISPUTED matches prominently; all non-confirmed matches below.
// Admin can resolve any match here.
// SPEC §7.5 step 3, §5: admin override with AuditLog trace.

import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/guards";
import { Eyebrow } from "@/components/Eyebrow";
import { Card } from "@/components/Card";
import { DisputaCard } from "./DisputaCard";

export default async function DisputasPage() {
  await requireAdmin();

  const league = await prisma.league.findFirst({
    orderBy: { createdAt: "desc" },
  });

  if (!league) {
    return (
      <div className="space-y-6">
        <Eyebrow>Disputas y resolución</Eyebrow>
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
      </div>
    );
  }

  const rawMatches = await prisma.match.findMany({
    where: { leagueId: league.id, phase: "LEAGUE" },
    orderBy: [{ status: "asc" }, { updatedAt: "desc" }],
    select: {
      id: true,
      status: true,
      scheduledAt: true,
      playerHome: { select: { displayName: true } },
      playerAway: { select: { displayName: true } },
      result: {
        select: {
          homeVictoryPoints: true,
          awayVictoryPoints: true,
          outcome: true,
          reporter: { select: { displayName: true } },
        },
      },
    },
  });

  const disputed = rawMatches.filter((m) => m.status === "DISPUTED");
  const reported = rawMatches.filter((m) => m.status === "REPORTED");
  const pending = rawMatches.filter((m) => m.status === "SCHEDULED");
  const confirmed = rawMatches.filter((m) => m.status === "CONFIRMED");

  function toCardProps(m: (typeof rawMatches)[number]) {
    return {
      match: {
        id: m.id,
        playerHomeName: m.playerHome.displayName,
        playerAwayName: m.playerAway?.displayName ?? null,
        scheduledAt: m.scheduledAt ? m.scheduledAt.toISOString() : null,
        status: m.status as "SCHEDULED" | "REPORTED" | "CONFIRMED" | "DISPUTED",
        result: m.result
          ? {
              homeVP: m.result.homeVictoryPoints,
              awayVP: m.result.awayVictoryPoints,
              outcome: m.result.outcome,
              reporterName: m.result.reporter.displayName,
            }
          : null,
      },
    };
  }

  return (
    <div className="space-y-8">
      <div>
        <Eyebrow>Admin · {league.name}</Eyebrow>
        <h1
          className="mt-2 text-[28px] font-semibold leading-tight"
          style={{ fontFamily: "var(--font-display)", color: "var(--fg)" }}
        >
          Disputas y resolución
        </h1>
        <p
          className="mt-1 text-[13px]"
          style={{ color: "var(--fg-muted)", fontFamily: "var(--font-sans)" }}
        >
          {disputed.length} disputada{disputed.length !== 1 ? "s" : ""} ·{" "}
          {reported.length} por confirmar · {pending.length} pendiente
          {pending.length !== 1 ? "s" : ""} · {confirmed.length} confirmada
          {confirmed.length !== 1 ? "s" : ""}
        </p>
      </div>

      {/* Disputed — highest priority */}
      {disputed.length > 0 && (
        <section>
          <Eyebrow>Disputadas — requieren resolución ({disputed.length})</Eyebrow>
          <div className="mt-3 space-y-3">
            {disputed.map((m) => {
              const props = toCardProps(m);
              return <DisputaCard key={m.id} match={props.match} />;
            })}
          </div>
        </section>
      )}

      {disputed.length === 0 && (
        <Card className="text-center py-6">
          <p
            className="text-[14px]"
            style={{ color: "var(--fg-muted)", fontFamily: "var(--font-sans)" }}
          >
            No hay disputas activas
          </p>
        </Card>
      )}

      {/* Reported — awaiting rival confirmation */}
      {reported.length > 0 && (
        <section>
          <Eyebrow>Reportadas — esperando confirmación del rival ({reported.length})</Eyebrow>
          <div className="mt-3 space-y-3">
            {reported.map((m) => {
              const props = toCardProps(m);
              return <DisputaCard key={m.id} match={props.match} />;
            })}
          </div>
        </section>
      )}

      {/* Pending (no result yet) */}
      {pending.length > 0 && (
        <section>
          <Eyebrow>Sin resultado ({pending.length})</Eyebrow>
          <div className="mt-3 space-y-3">
            {pending.map((m) => {
              const props = toCardProps(m);
              return <DisputaCard key={m.id} match={props.match} />;
            })}
          </div>
        </section>
      )}

      {/* Confirmed */}
      {confirmed.length > 0 && (
        <section>
          <Eyebrow>Confirmadas ({confirmed.length})</Eyebrow>
          <div className="mt-3 space-y-3">
            {confirmed.map((m) => {
              const props = toCardProps(m);
              return <DisputaCard key={m.id} match={props.match} />;
            })}
          </div>
        </section>
      )}
    </div>
  );
}
