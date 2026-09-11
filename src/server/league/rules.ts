// Server-side domain actions for the per-league bases prose.
// multi-liga spec §2.11, §4.11, §5.6. Lane E (bases-por-liga, E1).
//
// Scaffolded by C1 (contexto-de-liga-y-modulos) as an empty module so this
// lane had a file of its own, without touching src/server/league-actions.ts
// or any of its siblings.

"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/guards";
import {
  assertLeagueWritable,
  LeagueArchivedError,
} from "@/lib/league-context";
import type { ActionResult } from "./action-result";

// Generous but bounded — a textarea is free-form prose, not a title, but an
// unbounded string would let a single bad paste blow up the page and the
// DB column alike.
const updateLeagueRulesSchema = z.object({
  rulesMarkdown: z
    .string()
    .max(20000, "El texto de las bases no puede superar los 20.000 caracteres"),
});

/**
 * Save the free-form prose of a league's bases (`League.rulesMarkdown`).
 * Admin-only, blocked on an archived league (spec §5.6, criterio 39: the
 * bases of an archived league keep reading fine — `assertLeagueWritable`
 * only blocks this write, not `/liga/[slug]/bases` itself).
 */
export async function updateLeagueRules(
  leagueId: string,
  rulesMarkdown: string
): Promise<ActionResult> {
  await requireAdmin();

  const parsed = updateLeagueRulesSchema.safeParse({ rulesMarkdown });
  if (!parsed.success) {
    return {
      ok: false,
      error: "Texto de bases inválido",
      fieldErrors: parsed.error.flatten().fieldErrors as Record<
        string,
        string[]
      >,
    };
  }

  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: { archivedAt: true, slug: true },
  });
  if (!league) {
    return { ok: false, error: "La liga no existe" };
  }

  try {
    assertLeagueWritable(league);
  } catch (err) {
    if (err instanceof LeagueArchivedError) {
      return { ok: false, error: err.message };
    }
    throw err;
  }

  await prisma.league.update({
    where: { id: leagueId },
    data: { rulesMarkdown: parsed.data.rulesMarkdown },
  });

  revalidatePath(`/liga/${league.slug}/bases`);
  revalidatePath(`/admin/${league.slug}/bases`);
  revalidatePath("/bases");

  return { ok: true, data: undefined };
}
