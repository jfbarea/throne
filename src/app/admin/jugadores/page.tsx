// Admin > Jugadores — player management page.
// Server Component: loads league and players from DB.
// Protected by AdminLayout.

import { prisma } from "@/lib/db";
import { Eyebrow } from "@/components/Eyebrow";
import { Card } from "@/components/Card";
import { PlayersPageClient } from "./PlayersPageClient";
import Link from "next/link";

export default async function AdminJugadoresPage() {
  // In MVP there is a single active league.
  const league = await prisma.league.findFirst({
    orderBy: { createdAt: "desc" },
    include: {
      players: {
        orderBy: [{ active: "desc" }, { createdAt: "asc" }],
        select: {
          id: true,
          displayName: true,
          faction: true,
          role: true,
          active: true,
        },
      },
    },
  });

  if (!league) {
    return (
      <div className="space-y-6">
        <div>
          <Eyebrow>Administración · Jugadores</Eyebrow>
          <h1
            className="mt-2 text-[28px] font-semibold leading-tight"
            style={{ fontFamily: "var(--font-display)", color: "var(--fg)" }}
          >
            Gestión de jugadores
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
            </Link>{" "}
            para poder añadir jugadores.
          </p>
        </Card>
      </div>
    );
  }

  const players = league.players.map((p) => ({
    ...p,
    role: p.role as "ADMIN" | "PLAYER",
  }));

  const activeCount = players.filter((p) => p.active).length;

  return (
    <div className="space-y-6">
      <div>
        <Eyebrow>Administración · Jugadores</Eyebrow>
        <h1
          className="mt-2 text-[28px] font-semibold leading-tight"
          style={{ fontFamily: "var(--font-display)", color: "var(--fg)" }}
        >
          Gestión de jugadores
        </h1>
        <p
          className="mt-1 text-[13px]"
          style={{ color: "var(--fg-muted)", fontFamily: "var(--font-sans)" }}
        >
          {league.name} · {league.season} ·{" "}
          <span style={{ color: "var(--accent)" }}>
            {activeCount} activo{activeCount !== 1 ? "s" : ""}
          </span>{" "}
          / {players.length} total
        </p>
      </div>

      <PlayersPageClient leagueId={league.id} players={players} />
    </div>
  );
}
