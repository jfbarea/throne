// Server actions a player runs on their *own* record, as opposed to the
// admin-only player management in src/server/league-actions.ts (every action
// there starts with `requireAdmin`).
//
// The boundary matters for authorization: these actions never take a playerId
// from the client. The target row is always `session.playerId`, read from the
// signed cookie (SPEC §5, §6), so a player cannot edit somebody else's profile
// by tampering with the request.

"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireAuth } from "@/lib/guards";
import { serialiseFactions } from "@/lib/factions";
import {
  updateOwnFactionsSchema,
  type UpdateOwnFactionsInput,
} from "@/lib/schemas";

export type ActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: string; fieldErrors?: Record<string, string[]> };

/**
 * Replace the logged-in player's declared factions.
 *
 * The input is the *list* of picked factions, not the joined string: the
 * server validates the count and each name (`factionListSchema`) and then
 * serialises it itself with `serialiseFactions`, so a hand-crafted request
 * cannot smuggle a 40-item list past the per-player cap by pre-joining it.
 *
 * An empty list clears the field to `null` — "no faction" keeps a single
 * representation in the DB.
 *
 * Authorization (SPEC §5): any authenticated session, acting only on itself.
 * An ADMIN session authenticated via ADMIN_PASSCODE has no `playerId` and
 * therefore no profile to edit; that is reported as an error, not a redirect,
 * since it is a legitimate session hitting a page it has no row for.
 */
export async function updateOwnFactions(
  input: UpdateOwnFactionsInput
): Promise<ActionResult> {
  const session = await requireAuth();

  if (!session.playerId) {
    return {
      ok: false,
      error:
        "Esta sesión de administrador no está ligada a ningún jugador, así que no tiene facciones que editar. Entra con tu nombre de jugador para cambiarlas.",
    };
  }

  const parsed = updateOwnFactionsSchema.safeParse(input);
  if (!parsed.success) {
    const flat = parsed.error.flatten();
    return {
      ok: false,
      error:
        Object.values(flat.fieldErrors).flat()[0] ??
        flat.formErrors[0] ??
        "Facciones inválidas",
      fieldErrors: flat.fieldErrors as Record<string, string[]>,
    };
  }

  await prisma.player.update({
    where: { id: session.playerId },
    data: { faction: serialiseFactions(parsed.data.factions) },
  });

  // Every surface that prints a player's faction.
  revalidatePath("/mi-perfil");
  revalidatePath("/clasificacion");
  revalidatePath("/bracket");
  revalidatePath("/admin/jugadores");
  revalidatePath("/admin/emparejamientos");
  revalidatePath("/admin/playoffs");

  return { ok: true, data: undefined };
}
