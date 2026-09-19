// Tests for `updateLeagueRules` (src/server/league/rules.ts, multi-liga
// spec §2.11, §4.11, §5.6, lane E hito E1). Real test database, only
// `next/cache` and `@/lib/guards` mocked — same convention as
// tests/endurecer-guardas-transaccionales.test.ts.
//
// Criterio covered: spec 39's second half ("intentar guardar sus bases
// falla") for an archived league; a normal save on a league in circulation
// succeeds and persists.

import { describe, it, expect, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/guards", () => ({
  requireAdmin: vi.fn(async () => ({ role: "ADMIN", playerId: null })),
}));

import { prisma } from "@/lib/db";
import { updateLeagueRules } from "@/server/league/rules";

function uid(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function createTestLeague(overrides: Record<string, unknown> = {}) {
  const id = uid("league");
  return prisma.league.create({
    data: {
      id,
      name: "Liga de test rules",
      season: "2026 Test",
      slug: `${id}-slug`,
      archivedAt: null,
      ...overrides,
    },
  });
}

describe("updateLeagueRules", () => {
  it("saves the new prose for a league in circulation", async () => {
    const league = await createTestLeague({
      rulesMarkdown: "## Antes\n\nViejo.",
    });

    const result = await updateLeagueRules(league.id, "## Después\n\nNuevo.");

    expect(result.ok).toBe(true);
    const updated = await prisma.league.findUnique({
      where: { id: league.id },
    });
    expect(updated?.rulesMarkdown).toBe("## Después\n\nNuevo.");
  });

  it("rejects saving on an archived league and leaves it unchanged (spec 39)", async () => {
    const league = await createTestLeague({
      archivedAt: new Date(),
      rulesMarkdown: "## Original\n\nNo debería cambiar.",
    });

    const result = await updateLeagueRules(
      league.id,
      "## Intento\n\nNo debería colar."
    );

    expect(result.ok).toBe(false);
    const untouched = await prisma.league.findUnique({
      where: { id: league.id },
    });
    expect(untouched?.rulesMarkdown).toBe("## Original\n\nNo debería cambiar.");
  });

  it("rejects a nonexistent league", async () => {
    const result = await updateLeagueRules(
      `nonexistent-${uid("league")}`,
      "texto"
    );
    expect(result.ok).toBe(false);
  });

  it("rejects prose over the length limit", async () => {
    const league = await createTestLeague();
    const tooLong = "a".repeat(20001);

    const result = await updateLeagueRules(league.id, tooLong);

    expect(result.ok).toBe(false);
    const untouched = await prisma.league.findUnique({
      where: { id: league.id },
    });
    expect(untouched?.rulesMarkdown).not.toBe(tooLong);
  });
});
