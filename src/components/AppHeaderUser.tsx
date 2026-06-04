// AppHeaderUser — server component for the appbar. Resolves the current session
// and the player's display name server-side, then renders the client UserMenu.
// Renders nothing when there is no active session.

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
