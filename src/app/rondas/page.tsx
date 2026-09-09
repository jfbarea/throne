// Rondas — league-wide calendar: every round, its deadline, how many of its
// matches are resolved and every active player's cupo (SPEC §4.6, criterios
// 12-13). Hito 6 (ui-cupo-y-rondas, plan/rondas-con-fecha/PLAN.md).
//
// Protected with requireAuth (like /clasificacion, /calendario and
// /bracket) — not public like /bases (criterio 13).
//
// Data fetching lives in src/server/round-overview.ts so the "no N+1" query
// shape (criterio 12) is testable in isolation, with an instrumented Prisma
// client, instead of only by inspecting this page.

import { prisma } from "@/lib/db";
import { requireAuth } from "@/lib/guards";
import { getRoundsOverview } from "@/server/round-overview";
import { Eyebrow } from "@/components/Eyebrow";
import { Card } from "@/components/Card";
import { Badge } from "@/components/Badge";
import { AppHeader } from "@/components/AppHeader";
import { CheckCircle, WarningCircle } from "@phosphor-icons/react/dist/ssr";

function formatDeadline(deadline: Date): string {
  return deadline.toLocaleDateString("es-ES", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export default async function RondasPage() {
  await requireAuth();

  // MVP: single active league.
  const league = await prisma.league.findFirst({
    orderBy: { createdAt: "desc" },
  });

  if (!league) {
    return (
      <PageShell>
        <EmptyState message="No hay ninguna liga configurada todavía." />
      </PageShell>
    );
  }

  const rounds = await getRoundsOverview(prisma, league.id);

  return (
    <PageShell league={league.name}>
      {rounds.length === 0 ? (
        <EmptyState message="Todavía no hay rondas generadas. Se crean al generar los emparejamientos de la liga." />
      ) : (
        <div className="space-y-4">
          {rounds.map((round) => (
            <Card key={round.roundId} className="space-y-3">
              <div className="flex items-start justify-between gap-3">
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
                    {round.closedAt
                      ? `Cerrada el ${formatDeadline(round.closedAt)}`
                      : `Cierra ${formatDeadline(round.deadline)}`}{" "}
                    · {round.resolvedMatches} de {round.totalMatches} jugada
                    {round.totalMatches !== 1 ? "s" : ""}
                  </p>
                </div>
                <Badge variant={round.closedAt ? "moss" : "brass"}>
                  {round.closedAt ? "Cerrada" : "Abierta"}
                </Badge>
              </div>

              {/* Per-player cupo. Wrapping grid, never a fixed-width table —
                  with 12-20 players this never needs horizontal scroll on a
                  phone screen (PLAN.md H6: "tiene que caber en móvil"; if it
                  ever did, it would scroll inside this box, never the body). */}
              <div
                className="grid gap-1.5"
                style={{ gridTemplateColumns: "repeat(auto-fill, minmax(132px, 1fr))" }}
              >
                {round.playerQuotas.map((q) => {
                  const met = q.resolved >= q.required;
                  return (
                    <div
                      key={q.playerId}
                      className="flex items-center justify-between gap-2 rounded px-2 py-1.5 text-[12px] min-w-0"
                      style={{ background: "var(--bg-raised)" }}
                    >
                      <span
                        className="truncate"
                        style={{ color: "var(--fg-muted)", fontFamily: "var(--font-sans)" }}
                      >
                        {q.displayName}
                      </span>
                      <span
                        className="flex items-center gap-1 flex-shrink-0 font-semibold"
                        style={{
                          color: met ? "var(--moss-500)" : "var(--ember-500)",
                          fontVariantNumeric: "tabular-nums",
                        }}
                        title={q.label}
                      >
                        {q.resolved}/{q.required}
                        {met ? <CheckCircle size={12} /> : <WarningCircle size={12} />}
                      </span>
                    </div>
                  );
                })}
              </div>
            </Card>
          ))}
        </div>
      )}
    </PageShell>
  );
}

// ---------------------------------------------------------------------------
// Page shell / empty state
// ---------------------------------------------------------------------------

function PageShell({
  league,
  children,
}: {
  league?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className="min-h-screen flex flex-col"
      style={{ background: "var(--bg)", color: "var(--fg)" }}
    >
      <AppHeader active="rondas" />

      <main className="flex-1 px-4 py-6 max-w-2xl mx-auto w-full space-y-6">
        <div>
          <Eyebrow>Rondas{league ? ` · ${league}` : ""}</Eyebrow>
          <h1
            className="mt-2 text-[28px] font-semibold leading-tight"
            style={{ fontFamily: "var(--font-display)", color: "var(--fg)" }}
          >
            Calendario de la liga
          </h1>
          <p
            className="mt-1 text-[13px]"
            style={{ color: "var(--fg-muted)", fontFamily: "var(--font-sans)" }}
          >
            El cupo de cada jugador por ronda — a quién hay que perseguir.
          </p>
        </div>

        {children}
      </main>
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <Card className="text-center py-10">
      <p
        className="text-[15px] font-semibold"
        style={{ color: "var(--fg-muted)", fontFamily: "var(--font-sans)" }}
      >
        {message}
      </p>
    </Card>
  );
}
