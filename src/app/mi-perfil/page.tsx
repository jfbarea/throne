// "Mi perfil" — the only page a player edits about themselves. Today it holds
// the faction picker; the name, the role and the passcode stay admin-only
// (SPEC §4.2, §5), so they are shown here read-only.
//
// Reached from the user menu in the appbar, not from the main nav: it is a
// per-account setting, not a league section.

import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/guards";
import { prisma } from "@/lib/db";
import { parseFactions } from "@/lib/factions";
import { AppHeader } from "@/components/AppHeader";
import { Card, CardEyebrow, CardTitle, Eyebrow, Badge } from "@/components";
import { FactionForm } from "./FactionForm";

export default async function MiPerfilPage() {
  const session = await requireAuth();

  // The admin session carries no fixed playerId (multi-liga spec §2.4, §4.4):
  // it has a distinct Player row — and a distinct faction — per league, so
  // there's no single "mi perfil" to show. Send it to the league index
  // instead of rendering the "sin jugador asociado" placeholder this page
  // used to show for admins pre-multi-liga (spec §5.8): the admin edits its
  // faction per league from /admin/[slug]/jugadores now.
  if (session.role === "ADMIN") {
    redirect("/admin");
  }

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
          // The ADMIN branch redirects above; this now only covers a PLAYER
          // session whose Player row is gone (e.g. its league was deleted,
          // spec §5.2) — a dangling cookie, not the admin case.
          <Card className="py-10 text-center">
            <p
              className="text-[15px] font-semibold"
              style={{
                color: "var(--fg-muted)",
                fontFamily: "var(--font-sans)",
              }}
            >
              No se encontró tu perfil
            </p>
            <p
              className="mt-1 text-[13px]"
              style={{
                color: "var(--fg-faint)",
                fontFamily: "var(--font-sans)",
              }}
            >
              Vuelve a entrar con tu nombre de jugador y tu código.
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
