// AppHeaderUser — server component for the appbar. Resolves the current session
// and the player's display name server-side, then renders the client UserMenu.
// Renders nothing when there is no active session.
//
// Multi-liga spec §2.4, §4.4 (C3, sesion-de-admin-sin-playerid): every ADMIN
// session now has `playerId: null` (login-admin no longer resolves a global
// admin Player — it has a distinct one per league instead, with no single
// "the" admin Player to point at here). The `if (session.playerId)` guard
// below already handled a null playerId before this changed anything about
// login-admin — it now runs on every admin request instead of never — and
// falls back to the generic "Administrador" label via the `label` ternary.

import { getSession } from "@/lib/session";
import { prisma } from "@/lib/db";
import { UserMenu } from "./UserMenu";

export async function AppHeaderUser() {
  const session = await getSession();
  if (!session) return null;

  let displayName: string | null = null;
  if (session.playerId) {
    const player = await prisma.player.findUnique({
      where: { id: session.playerId },
      select: { displayName: true },
    });
    displayName = player?.displayName ?? null;
  }

  const label =
    displayName ?? (session.role === "ADMIN" ? "Administrador" : "Jugador");

  return <UserMenu label={label} role={session.role} />;
}
