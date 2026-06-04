// Admin dashboard — overview page.
// Server Component: reads DB to show league and player counts.
// Protected by AdminLayout (requireAdmin already called).

import { prisma } from "@/lib/db";
import { Card } from "@/components/Card";
import { Badge } from "@/components/Badge";
import { Eyebrow } from "@/components/Eyebrow";
import Link from "next/link";
import { Gear, Users, Crown, Sword } from "@phosphor-icons/react/dist/ssr";

const STATUS_LABEL: Record<string, { label: string; variant: "brass" | "moss" | "ash" | "ember" | "neutral" }> = {
  SETUP:    { label: "Configuración", variant: "brass" },
  LEAGUE:   { label: "Fase de liga",  variant: "moss"  },
  PLAYOFFS: { label: "Playoffs",      variant: "ember" },
  FINISHED: { label: "Finalizada",    variant: "neutral" },
};

export default async function AdminPage() {
  const leagues = await prisma.league.findMany({
    orderBy: { createdAt: "desc" },
    take: 5,
    include: {
      _count: { select: { players: true } },
    },
  });

  const activePlayers = await prisma.player.count({ where: { active: true } });

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <Eyebrow>Panel de administración</Eyebrow>
        <h1
          className="mt-2 text-[32px] font-semibold leading-tight"
          style={{ fontFamily: "var(--font-display)", color: "var(--fg)" }}
        >
          throne
        </h1>
        <p
          className="mt-1 text-[14px]"
          style={{ color: "var(--fg-muted)", fontFamily: "var(--font-sans)" }}
        >
          Gestiona la liga de Warhammer 40.000
        </p>
      </div>

      {/* Quick stats */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <Card className="text-center">
          <p
            className="text-[32px] font-bold leading-none"
            style={{ fontFamily: "var(--font-display)", color: "var(--accent)" }}
          >
            {leagues.length}
          </p>
          <p
            className="mt-1 text-[12px] font-semibold uppercase tracking-[0.08em]"
            style={{ color: "var(--fg-faint)", fontFamily: "var(--font-sans)" }}
          >
            Liga{leagues.length !== 1 ? "s" : ""}
          </p>
        </Card>
        <Card className="text-center">
          <p
            className="text-[32px] font-bold leading-none"
            style={{ fontFamily: "var(--font-display)", color: "var(--accent)" }}
          >
            {activePlayers}
          </p>
          <p
            className="mt-1 text-[12px] font-semibold uppercase tracking-[0.08em]"
            style={{ color: "var(--fg-faint)", fontFamily: "var(--font-sans)" }}
          >
            Jugadores activos
          </p>
        </Card>
      </div>

      {/* Quick actions */}
      <div>
        <Eyebrow>Acciones rápidas</Eyebrow>
        <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Link href="/admin/liga" className="no-underline">
            <Card featured className="flex items-center gap-4 cursor-pointer hover:opacity-80 transition-opacity">
              <span
                className="flex-shrink-0 w-10 h-10 flex items-center justify-center rounded"
                style={{ background: "rgba(201,166,107,0.12)", color: "var(--accent)" }}
              >
                <Gear size={20} />
              </span>
              <div>
                <p
                  className="text-[15px] font-semibold"
                  style={{ fontFamily: "var(--font-sans)", color: "var(--fg)" }}
                >
                  Configurar liga
                </p>
                <p
                  className="text-[12px]"
                  style={{ color: "var(--fg-muted)", fontFamily: "var(--font-sans)" }}
                >
                  Nombre, temporada, puntuación, playoffs
                </p>
              </div>
            </Card>
          </Link>

          <Link href="/admin/jugadores" className="no-underline">
            <Card className="flex items-center gap-4 cursor-pointer hover:opacity-80 transition-opacity">
              <span
                className="flex-shrink-0 w-10 h-10 flex items-center justify-center rounded"
                style={{ background: "rgba(201,166,107,0.12)", color: "var(--accent)" }}
              >
                <Users size={20} />
              </span>
              <div>
                <p
                  className="text-[15px] font-semibold"
                  style={{ fontFamily: "var(--font-sans)", color: "var(--fg)" }}
                >
                  Gestionar jugadores
                </p>
                <p
                  className="text-[12px]"
                  style={{ color: "var(--fg-muted)", fontFamily: "var(--font-sans)" }}
                >
                  Alta, baja, edición, passcodes
                </p>
              </div>
            </Card>
          </Link>

          <Link href="/admin/emparejamientos" className="no-underline">
            <Card className="flex items-center gap-4 cursor-pointer hover:opacity-80 transition-opacity">
              <span
                className="flex-shrink-0 w-10 h-10 flex items-center justify-center rounded"
                style={{ background: "rgba(201,166,107,0.12)", color: "var(--accent)" }}
              >
                <Sword size={20} />
              </span>
              <div>
                <p
                  className="text-[15px] font-semibold"
                  style={{ fontFamily: "var(--font-sans)", color: "var(--fg)" }}
                >
                  Emparejamientos
                </p>
                <p
                  className="text-[12px]"
                  style={{ color: "var(--fg-muted)", fontFamily: "var(--font-sans)" }}
                >
                  Generar partidas round-robin
                </p>
              </div>
            </Card>
          </Link>
        </div>
      </div>

      {/* Recent leagues */}
      {leagues.length > 0 && (
        <div>
          <Eyebrow>Ligas recientes</Eyebrow>
          <div className="mt-3 space-y-2">
            {leagues.map((league) => {
              const st = STATUS_LABEL[league.status] ?? { label: league.status, variant: "neutral" as const };
              return (
                <Card key={league.id} className="flex items-center justify-between gap-4 py-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <Crown size={14} style={{ color: "var(--accent)", flexShrink: 0 }} />
                      <p
                        className="text-[14px] font-semibold truncate"
                        style={{ fontFamily: "var(--font-sans)", color: "var(--fg)" }}
                      >
                        {league.name}
                      </p>
                    </div>
                    <p
                      className="mt-0.5 text-[12px] truncate"
                      style={{ color: "var(--fg-faint)", fontFamily: "var(--font-sans)" }}
                    >
                      {league.season} · {league._count.players} jugadores
                    </p>
                  </div>
                  <Badge variant={st.variant} className="flex-shrink-0">
                    {st.label}
                  </Badge>
                </Card>
              );
            })}
          </div>
        </div>
      )}

      {leagues.length === 0 && (
        <Card className="text-center py-10">
          <p
            className="text-[15px] font-semibold"
            style={{ color: "var(--fg-muted)", fontFamily: "var(--font-sans)" }}
          >
            No hay ligas creadas todavía
          </p>
          <p
            className="mt-1 text-[13px]"
            style={{ color: "var(--fg-faint)", fontFamily: "var(--font-sans)" }}
          >
            Ve a{" "}
            <Link href="/admin/liga" style={{ color: "var(--accent)" }}>
              Configurar liga
            </Link>{" "}
            para crear la primera.
          </p>
        </Card>
      )}
    </div>
  );
}
