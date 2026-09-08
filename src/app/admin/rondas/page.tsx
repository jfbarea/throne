// Admin > Rondas — list of league rounds with their deadline and status.
// Server Component: loads league and its rounds from DB.
// Protected by AdminLayout (requireAdmin called there).
//
// Rondas-con-fecha spec §4.4, §4.7. Hito 3: generar-con-rondas.
// Hito 4 (cierre-de-ronda) adds the "Cerrar ronda N" button per round.

import { prisma } from "@/lib/db";
import { Eyebrow } from "@/components/Eyebrow";
import { Card } from "@/components/Card";
import { Badge } from "@/components/Badge";
import { EditDeadlineForm } from "./EditDeadlineForm";
import { CloseRoundButton } from "./CloseRoundButton";
import Link from "next/link";

export default async function AdminRondasPage() {
  // MVP: single active league.
  const league = await prisma.league.findFirst({
    orderBy: { createdAt: "desc" },
  });

  if (!league) {
    return (
      <div className="space-y-6">
        <div>
          <Eyebrow>Administración · Rondas</Eyebrow>
          <h1
            className="mt-2 text-[28px] font-semibold leading-tight"
            style={{ fontFamily: "var(--font-display)", color: "var(--fg)" }}
          >
            Rondas de la liga
          </h1>
        </div>
        <Card className="text-center py-10">
          <p
            className="text-[15px] font-semibold"
            style={{ color: "var(--fg-muted)", fontFamily: "var(--font-sans)" }}
          >
            No hay ninguna liga creada
          </p>
          <p
            className="mt-1 text-[13px]"
            style={{ color: "var(--fg-faint)", fontFamily: "var(--font-sans)" }}
          >
            Primero{" "}
            <Link href="/admin/liga" style={{ color: "var(--accent)" }}>
              crea una liga
            </Link>
            .
          </p>
        </Card>
      </div>
    );
  }

  const rounds = await prisma.round.findMany({
    where: { leagueId: league.id },
    orderBy: { index: "asc" },
    include: { _count: { select: { matches: true } } },
  });

  // How many matches per round still have no Result — shown next to "Cerrar
  // ronda N" so the admin knows how many are about to be settled as 0-0
  // before pulling the trigger (PLAN.md H4). One query, aggregated in memory
  // (round count is small, no N+1 concern here).
  const unresolvedMatches = await prisma.match.findMany({
    where: { leagueId: league.id, roundId: { not: null }, result: null },
    select: { roundId: true },
  });
  const pendingByRound = new Map<string, number>();
  for (const m of unresolvedMatches) {
    if (m.roundId) {
      pendingByRound.set(m.roundId, (pendingByRound.get(m.roundId) ?? 0) + 1);
    }
  }

  const now = new Date().getTime();

  return (
    <div className="space-y-6">
      <div>
        <Eyebrow>Administración · Rondas</Eyebrow>
        <h1
          className="mt-2 text-[28px] font-semibold leading-tight"
          style={{ fontFamily: "var(--font-display)", color: "var(--fg)" }}
        >
          Rondas de la liga
        </h1>
        <p
          className="mt-1 text-[13px]"
          style={{ color: "var(--fg-muted)", fontFamily: "var(--font-sans)" }}
        >
          {league.name} · {league.season}
        </p>
      </div>

      {rounds.length === 0 ? (
        <Card className="text-center py-10">
          <p
            className="text-[15px] font-semibold"
            style={{ color: "var(--fg-muted)", fontFamily: "var(--font-sans)" }}
          >
            Todavía no hay rondas generadas
          </p>
          <p
            className="mt-1 text-[13px]"
            style={{ color: "var(--fg-faint)", fontFamily: "var(--font-sans)" }}
          >
            Se crean al{" "}
            <Link href="/admin/emparejamientos" style={{ color: "var(--accent)" }}>
              generar los emparejamientos
            </Link>
            . Hace falta un mes de arranque configurado en{" "}
            <Link href="/admin/liga" style={{ color: "var(--accent)" }}>
              la liga
            </Link>
            .
          </p>
        </Card>
      ) : (
        <div className="space-y-3">
          {rounds.map((round) => (
            <Card key={round.id} className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p
                    className="text-[15px] font-semibold"
                    style={{ fontFamily: "var(--font-sans)", color: "var(--fg)" }}
                  >
                    Ronda {round.index}
                  </p>
                  <p
                    className="mt-0.5 text-[12px]"
                    style={{ color: "var(--fg-faint)", fontFamily: "var(--font-sans)" }}
                  >
                    {round._count.matches} partida
                    {round._count.matches !== 1 ? "s" : ""}
                  </p>
                </div>
                <Badge variant={round.closedAt ? "moss" : "brass"}>
                  {round.closedAt ? "Cerrada" : "Abierta"}
                </Badge>
              </div>

              <EditDeadlineForm
                roundId={round.id}
                initialDeadline={round.deadline.toISOString().slice(0, 10)}
              />

              {round.closedAt ? (
                <p
                  className="text-[12px]"
                  style={{ color: "var(--fg-faint)", fontFamily: "var(--font-sans)" }}
                >
                  Cerrada el {round.closedAt.toLocaleDateString("es-ES")}.
                </p>
              ) : (
                <CloseRoundButton
                  roundId={round.id}
                  roundIndex={round.index}
                  isPastDeadline={round.deadline.getTime() <= now}
                  deadlineLabel={round.deadline.toLocaleDateString("es-ES")}
                  pendingCount={pendingByRound.get(round.id) ?? 0}
                />
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
