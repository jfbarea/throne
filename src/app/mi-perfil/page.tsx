// "Mi perfil" — the only page a player edits about themselves. Today it holds
// the faction picker; the name, the role and the passcode stay admin-only
// (SPEC §4.2, §5), so they are shown here read-only.
//
// Reached from the user menu in the appbar, not from the main nav: it is a
// per-account setting, not a league section.

import { requireAuth } from "@/lib/guards";
import { prisma } from "@/lib/db";
import { parseFactions } from "@/lib/factions";
import { AppHeader } from "@/components/AppHeader";
import { Card, CardEyebrow, CardTitle, Eyebrow, Badge } from "@/components";
import { FactionForm } from "./FactionForm";

export default async function MiPerfilPage() {
  const session = await requireAuth();

  // An ADMIN session authenticated with ADMIN_PASSCODE has no Player row.
  const player = session.playerId
    ? await prisma.player.findUnique({
        where: { id: session.playerId },
        select: {
          displayName: true,
          faction: true,
          role: true,
          active: true,
          league: { select: { name: true, season: true } },
        },
      })
    : null;

  return (
    <div
      className="flex min-h-screen flex-col"
      style={{ background: "var(--bg)", color: "var(--fg)" }}
    >
      <AppHeader />

      <main className="mx-auto w-full max-w-2xl flex-1 space-y-6 px-4 py-6">
        <div>
          <Eyebrow as="p">Tu cuenta</Eyebrow>
          <h1
            className="mt-2 text-[28px] leading-tight font-semibold"
            style={{ fontFamily: "var(--font-display)", color: "var(--fg)" }}
          >
            Mi perfil
          </h1>
        </div>

        {!player ? (
          <Card className="py-10 text-center">
            <p
              className="text-[15px] font-semibold"
              style={{
                color: "var(--fg-muted)",
                fontFamily: "var(--font-sans)",
              }}
            >
              Esta sesión de administrador no está ligada a ningún jugador
            </p>
            <p
              className="mt-1 text-[13px]"
              style={{
                color: "var(--fg-faint)",
                fontFamily: "var(--font-sans)",
              }}
            >
              Entra con tu nombre de jugador y tu código para editar tus
              facciones.
            </p>
          </Card>
        ) : (
          <>
            {/* Identity — read-only: name, role and passcode are admin-only. */}
            <Card>
              <CardEyebrow>
                {player.league.name} · {player.league.season}
              </CardEyebrow>
              <CardTitle>{player.displayName}</CardTitle>
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={player.role === "ADMIN" ? "brass" : "neutral"}>
                  {player.role === "ADMIN" ? "Admin" : "Jugador"}
                </Badge>
                {!player.active && <Badge variant="ember">Inactivo</Badge>}
              </div>
              <p
                className="mt-3 text-[12px]"
                style={{
                  color: "var(--fg-faint)",
                  fontFamily: "var(--font-sans)",
                }}
              >
                El nombre, el rol y el código de acceso los cambia el admin.
              </p>
            </Card>

            {/* Factions — the editable part. */}
            <Card>
              <CardEyebrow>Ejércitos</CardEyebrow>
              <CardTitle>Facciones</CardTitle>
              <FactionForm initialFactions={parseFactions(player.faction)} />
            </Card>
          </>
        )}
      </main>
    </div>
  );
}
