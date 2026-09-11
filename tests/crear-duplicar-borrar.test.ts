// Tests for multi-liga D2: crear-duplicar-borrar.
// Covers spec criterios 13, 26, 27, 28, 29, 30, 31, 32 and
// plan/multi-liga/PLAN.md's D2 acceptance criteria.
//
// Write tests against the real test database (file:./test.db), same
// conventions as tests/endurecer-guardas-transaccionales.test.ts: only
// next/cache and @/lib/guards are mocked, @/lib/db stays real. The
// mid-transaction-failure technique for the atomicity test is the same one
// validated there (spying on prisma.$transaction to throw before it ever
// runs the real inserts).

import { describe, it, expect, vi } from "vitest";
import bcrypt from "bcryptjs";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/guards", () => ({
  requireAdmin: vi.fn(async () => ({ role: "ADMIN", playerId: null })),
}));

import { prisma } from "@/lib/db";
import {
  createLeague,
  duplicateLeague,
  deleteLeague,
  suggestAdminDisplayName,
} from "@/server/league/lifecycle";
import { DEFAULT_RULES_MARKDOWN } from "@/server/league/default-rules";
import { TIEBREAKER_VALUES, type CreateLeagueInput } from "@/lib/schemas";

function uid(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function baseLeagueConfig(
  overrides: Partial<CreateLeagueInput> = {}
): CreateLeagueInput {
  return {
    name: `Liga D2 ${uid("name")}`,
    season: "2026 Test",
    pointsWin: 3,
    pointsDraw: 1,
    pointsLoss: 0,
    bonusEnabled: false,
    playoffSize: 2,
    tiebreakers: [...TIEBREAKER_VALUES],
    matchesPerRound: 2,
    startMonth: null,
    ...overrides,
  };
}

async function findAdminPlayer(leagueId: string) {
  return prisma.player.findFirst({ where: { leagueId, role: "ADMIN" } });
}

// ---------------------------------------------------------------------------
// createLeague — always born with exactly one ADMIN Player (criterio 13)
// ---------------------------------------------------------------------------

describe("createLeague", () => {
  it("creates the league with a real slug and the default bases template", async () => {
    const result = await createLeague(
      baseLeagueConfig({ name: "Liga de los Martes", season: "Primavera 2026" })
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.slug).toMatch(/^liga-de-los-martes-primavera-2026/);

    const league = await prisma.league.findUnique({ where: { id: result.data.id } });
    expect(league?.slug).toBe(result.data.slug);
    expect(league?.rulesMarkdown).toBe(DEFAULT_RULES_MARKDOWN);
  });

  it("disambiguates the slug on collision with a numeric suffix", async () => {
    const config = baseLeagueConfig({
      name: "Liga Repetida",
      season: "Otoño 2026",
    });
    const first = await createLeague(config);
    const second = await createLeague(config);
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) return;

    expect(first.data.slug).toBe("liga-repetida-otono-2026");
    expect(second.data.slug).toBe("liga-repetida-otono-2026-2");
  });

  it("creates exactly one ADMIN Player using the given adminDisplayName", async () => {
    const result = await createLeague({
      ...baseLeagueConfig(),
      adminDisplayName: "Capitán Admin",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const admins = await prisma.player.findMany({
      where: { leagueId: result.data.id, role: "ADMIN" },
    });
    expect(admins).toHaveLength(1);
    expect(admins[0].displayName).toBe("Capitán Admin");
    expect(admins[0].active).toBe(true);
  });

  it("falls back to a generic admin name for callers that omit adminDisplayName", async () => {
    const result = await createLeague(baseLeagueConfig());
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const admin = await findAdminPlayer(result.data.id);
    expect(admin).not.toBeNull();
    expect(admin?.displayName.length).toBeGreaterThan(0);
  });

  it("rejects an explicitly empty adminDisplayName with a field error", async () => {
    const result = await createLeague({
      ...baseLeagueConfig(),
      adminDisplayName: "   ",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.fieldErrors?.adminDisplayName).toBeDefined();
  });

  it("never leaves a league without its ADMIN Player, across several creations", async () => {
    for (let i = 0; i < 3; i++) {
      const result = await createLeague(baseLeagueConfig());
      expect(result.ok).toBe(true);
      if (!result.ok) continue;
      const admins = await prisma.player.count({
        where: { leagueId: result.data.id, role: "ADMIN" },
      });
      expect(admins).toBe(1);
    }
  });

  it("leaves an AuditLog trail whose actor is the league's own freshly created ADMIN Player", async () => {
    const result = await createLeague(baseLeagueConfig());
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const admin = await findAdminPlayer(result.data.id);
    const entry = await prisma.auditLog.findFirst({
      where: {
        entityType: "League",
        entityId: result.data.id,
        action: "CREATE_LEAGUE",
      },
    });
    expect(entry).not.toBeNull();
    expect(entry?.actorId).toBe(admin?.id);
  });
});

// ---------------------------------------------------------------------------
// suggestAdminDisplayName
// ---------------------------------------------------------------------------

describe("suggestAdminDisplayName", () => {
  it("suggests the ADMIN name of the most recently created league in circulation", async () => {
    const older = await createLeague(
      baseLeagueConfig({ adminDisplayName: "Admin Viejo" })
    );
    expect(older.ok).toBe(true);

    const newer = await createLeague(
      baseLeagueConfig({ adminDisplayName: "Admin Reciente" })
    );
    expect(newer.ok).toBe(true);

    const suggestion = await suggestAdminDisplayName();
    expect(suggestion).toBe("Admin Reciente");
  });

  it("skips an archived league even if it is the most recently created", async () => {
    const inCirculation = await createLeague(
      baseLeagueConfig({ adminDisplayName: "Admin En Circulación" })
    );
    expect(inCirculation.ok).toBe(true);
    if (!inCirculation.ok) return;

    const archivedNewer = await createLeague(
      baseLeagueConfig({ adminDisplayName: "Admin Recién Archivado" })
    );
    expect(archivedNewer.ok).toBe(true);
    if (!archivedNewer.ok) return;
    await prisma.league.update({
      where: { id: archivedNewer.data.id },
      data: { archivedAt: new Date() },
    });

    const suggestion = await suggestAdminDisplayName();
    expect(suggestion).toBe("Admin En Circulación");
  });
});

// ---------------------------------------------------------------------------
// duplicateLeague
// ---------------------------------------------------------------------------

describe("duplicateLeague — origin archived (criterios 26, 27, 28)", () => {
  // Every player name here is suffixed with a fresh uid: origin leagues are
  // archived (so they never collide with each other by themselves), but
  // once duplicated their DESTINATION league is born in circulation and
  // keeps the copied names indefinitely for the rest of the suite — reusing
  // literal names across `it` blocks would make a later test's origin
  // legitimately collide with an earlier test's surviving destination.
  async function createArchivedOriginWithRoster() {
    const tag = uid("o");
    const names = {
      admin: `Admin Origen ${tag}`,
      activeOne: `Jugador Activo Uno ${tag}`,
      activeTwo: `Jugador Activo Dos ${tag}`,
      inactive: `Jugador Inactivo ${tag}`,
    };

    const created = await createLeague(
      baseLeagueConfig({
        name: `Origen Archivado ${tag}`,
        pointsWin: 5,
        pointsDraw: 2,
        pointsLoss: 1,
        playoffSize: 2,
        bonusEnabled: true,
        bonusMarginThreshold: 20,
        bonusMinVP: 40,
        adminDisplayName: names.admin,
      })
    );
    if (!created.ok) throw new Error("fixture setup failed");

    await prisma.player.create({
      data: {
        id: uid("player"),
        leagueId: created.data.id,
        displayName: names.activeOne,
        faction: "Orkos",
        role: "PLAYER",
        passcodeHash: "origin-hash-1",
        active: true,
      },
    });
    await prisma.player.create({
      data: {
        id: uid("player"),
        leagueId: created.data.id,
        displayName: names.activeTwo,
        faction: null,
        role: "PLAYER",
        passcodeHash: "origin-hash-2",
        active: true,
      },
    });
    await prisma.player.create({
      data: {
        id: uid("player"),
        leagueId: created.data.id,
        displayName: names.inactive,
        role: "PLAYER",
        passcodeHash: "origin-hash-3",
        active: false,
      },
    });

    await prisma.league.update({
      where: { id: created.data.id },
      data: { archivedAt: new Date(), rulesMarkdown: "Prosa de origen" },
    });

    const league = await prisma.league.findUniqueOrThrow({
      where: { id: created.data.id },
    });
    return { league, names };
  }

  it("copies configuration and prose, and creates one Player per active origin player", async () => {
    const { league: origin, names } = await createArchivedOriginWithRoster();

    const result = await duplicateLeague(origin.id, {
      name: `Liga Duplicada ${uid("d")}`,
      season: "2027",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const destination = await prisma.league.findUnique({
      where: { id: result.data.id },
    });
    expect(destination?.status).toBe("SETUP");
    expect(destination?.pointsWin).toBe(5);
    expect(destination?.pointsDraw).toBe(2);
    expect(destination?.pointsLoss).toBe(1);
    expect(destination?.bonusEnabled).toBe(true);
    expect(destination?.bonusMarginThreshold).toBe(20);
    expect(destination?.bonusMinVP).toBe(40);
    expect(destination?.playoffSize).toBe(origin.playoffSize);
    expect(destination?.tiebreakers).toBe(origin.tiebreakers);
    expect(destination?.matchesPerRound).toBe(origin.matchesPerRound);
    expect(destination?.rulesMarkdown).toBe("Prosa de origen");
    expect(destination?.startMonth).toBeNull();
    expect(destination?.archivedAt).toBeNull();

    // criterio 26: one Player per ACTIVE origin player — the inactive one
    // is not copied.
    const destinationPlayers = await prisma.player.findMany({
      where: { leagueId: result.data.id },
    });
    const gotNames = destinationPlayers.map((p) => p.displayName).sort();
    expect(gotNames).toEqual(
      [names.admin, names.activeTwo, names.activeOne].sort()
    );

    const copiedRegular = destinationPlayers.find(
      (p) => p.displayName === names.activeOne
    );
    expect(copiedRegular?.faction).toBe("Orkos");
    expect(copiedRegular?.role).toBe("PLAYER");

    // criterio 13: exactly one ADMIN row.
    const admins = destinationPlayers.filter((p) => p.role === "ADMIN");
    expect(admins).toHaveLength(1);
    expect(admins[0].displayName).toBe(names.admin);
  });

  it("leaves an AuditLog trail whose actor is the destination's own ADMIN Player", async () => {
    const { league: origin } = await createArchivedOriginWithRoster();

    const result = await duplicateLeague(origin.id, {
      name: `Liga Duplicada Audit ${uid("a")}`,
      season: "2027",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const admin = await findAdminPlayer(result.data.id);
    const entry = await prisma.auditLog.findFirst({
      where: {
        entityType: "League",
        entityId: result.data.id,
        action: "DUPLICATE_LEAGUE",
      },
    });
    expect(entry).not.toBeNull();
    expect(entry?.actorId).toBe(admin?.id);
  });

  it("does not copy matches, results, rounds or bracket (criterio 27)", async () => {
    const { league: origin } = await createArchivedOriginWithRoster();

    const result = await duplicateLeague(origin.id, {
      name: "Liga Duplicada Sin Historia",
      season: "2027",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(await prisma.match.count({ where: { leagueId: result.data.id } })).toBe(0);
    expect(await prisma.round.count({ where: { leagueId: result.data.id } })).toBe(0);
    expect(await prisma.bracket.count({ where: { leagueId: result.data.id } })).toBe(0);
  });

  it("generates brand-new passcodes, distinct from the origin's, listed once (criterio 28)", async () => {
    const { league: origin } = await createArchivedOriginWithRoster();

    const result = await duplicateLeague(origin.id, {
      name: "Liga Duplicada Passcodes",
      season: "2027",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // 1 ADMIN + 2 active regular players copied.
    expect(result.data.generatedPasscodes).toHaveLength(3);

    const destinationPlayers = await prisma.player.findMany({
      where: { leagueId: result.data.id },
    });

    for (const entry of result.data.generatedPasscodes) {
      const row = destinationPlayers.find(
        (p) => p.displayName === entry.displayName
      );
      expect(row).toBeDefined();
      const matches = await bcrypt.compare(entry.plainPasscode, row!.passcodeHash);
      expect(matches).toBe(true);
      // Never equal to any of the origin's literal fixture hashes.
      expect(row!.passcodeHash).not.toBe("origin-hash-1");
      expect(row!.passcodeHash).not.toBe("origin-hash-2");
    }
  });

  it("fails before creating anything when a copied name collides with a league in circulation", async () => {
    const { league: origin, names } = await createArchivedOriginWithRoster();

    const otherCirculation = await createLeague(baseLeagueConfig());
    expect(otherCirculation.ok).toBe(true);
    if (!otherCirculation.ok) return;
    await prisma.player.create({
      data: {
        id: uid("player"),
        leagueId: otherCirculation.data.id,
        displayName: names.activeOne, // collides with origin's roster
        role: "PLAYER",
        passcodeHash: "test-hash",
        active: true,
      },
    });

    const leagueCountBefore = await prisma.league.count();
    const targetName = `Liga Que No Debe Existir ${uid("t")}`;

    const result = await duplicateLeague(origin.id, {
      name: targetName,
      season: "2027",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain(names.activeOne);

    const leagueCountAfter = await prisma.league.count();
    expect(leagueCountAfter).toBe(leagueCountBefore);
    const shouldNotExist = await prisma.league.findFirst({
      where: { name: targetName },
    });
    expect(shouldNotExist).toBeNull();
  });
});

describe("duplicateLeague — origin in circulation (criterio 29)", () => {
  it("copies configuration and creates no players beyond the ADMIN", async () => {
    const origin = await createLeague(
      baseLeagueConfig({
        name: `Origen En Circulación ${uid("o")}`,
        pointsWin: 7,
        adminDisplayName: "Admin Circulación",
      })
    );
    expect(origin.ok).toBe(true);
    if (!origin.ok) return;

    await prisma.player.create({
      data: {
        id: uid("player"),
        leagueId: origin.data.id,
        displayName: "No Debe Copiarse",
        role: "PLAYER",
        passcodeHash: "test-hash",
        active: true,
      },
    });

    const result = await duplicateLeague(origin.data.id, {
      name: "Duplicada De Liga Viva",
      season: "2027",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const destinationPlayers = await prisma.player.findMany({
      where: { leagueId: result.data.id },
    });
    expect(destinationPlayers).toHaveLength(1);
    expect(destinationPlayers[0].role).toBe("ADMIN");
    expect(destinationPlayers[0].displayName).toBe("Admin Circulación");

    const destination = await prisma.league.findUnique({
      where: { id: result.data.id },
    });
    expect(destination?.pointsWin).toBe(7);
  });
});

describe("duplicateLeague — atomicity (criterio 30)", () => {
  it("leaves no league and no player behind when the transaction fails partway", async () => {
    const origin = await createLeague(baseLeagueConfig());
    expect(origin.ok).toBe(true);
    if (!origin.ok) return;
    await prisma.league.update({
      where: { id: origin.data.id },
      data: { archivedAt: new Date() },
    });
    await prisma.player.create({
      data: {
        id: uid("player"),
        leagueId: origin.data.id,
        displayName: "Jugador Que No Debe Quedar Huérfano",
        role: "PLAYER",
        passcodeHash: "test-hash",
        active: true,
      },
    });

    const leagueCountBefore = await prisma.league.count();
    const playerCountBefore = await prisma.player.count();

    const spy = vi
      .spyOn(prisma, "$transaction")
      .mockImplementationOnce(async () => {
        throw new Error("simulated generic DB failure mid-duplication");
      });

    const targetName = `Liga Que Falla A Mitad ${uid("f")}`;
    await expect(
      duplicateLeague(origin.data.id, { name: targetName, season: "2027" })
    ).rejects.toThrow("simulated generic DB failure mid-duplication");

    spy.mockRestore();

    expect(await prisma.league.count()).toBe(leagueCountBefore);
    expect(await prisma.player.count()).toBe(playerCountBefore);
    expect(
      await prisma.league.findFirst({ where: { name: targetName } })
    ).toBeNull();
  });
});

describe("duplicateLeague — misc errors", () => {
  it("fails for a nonexistent origin league", async () => {
    const result = await duplicateLeague(`nonexistent-${uid("league")}`, {
      name: "No Importa",
      season: "2027",
    });
    expect(result.ok).toBe(false);
  });

  it("rejects an empty name with a field error", async () => {
    const origin = await createLeague(baseLeagueConfig());
    expect(origin.ok).toBe(true);
    if (!origin.ok) return;

    const result = await duplicateLeague(origin.data.id, {
      name: "",
      season: "2027",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.fieldErrors?.name).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// deleteLeague
// ---------------------------------------------------------------------------

describe("deleteLeague", () => {
  it("deletes a SETUP league with zero matches, along with its players (criterio 31)", async () => {
    const created = await createLeague(baseLeagueConfig());
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    await prisma.player.create({
      data: {
        id: uid("player"),
        leagueId: created.data.id,
        displayName: "Jugador A Borrar",
        role: "PLAYER",
        passcodeHash: "test-hash",
        active: true,
      },
    });

    const result = await deleteLeague(created.data.id);
    expect(result.ok).toBe(true);

    const league = await prisma.league.findUnique({ where: { id: created.data.id } });
    expect(league).toBeNull();
    const players = await prisma.player.count({ where: { leagueId: created.data.id } });
    expect(players).toBe(0);
  });

  it("refuses to delete a league that already has a match, and keeps everything intact (criterio 32)", async () => {
    const created = await createLeague(baseLeagueConfig());
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const p1 = await prisma.player.create({
      data: {
        id: uid("player"),
        leagueId: created.data.id,
        displayName: "P1",
        role: "PLAYER",
        passcodeHash: "test-hash",
      },
    });
    const p2 = await prisma.player.create({
      data: {
        id: uid("player"),
        leagueId: created.data.id,
        displayName: "P2",
        role: "PLAYER",
        passcodeHash: "test-hash",
      },
    });
    await prisma.match.create({
      data: {
        leagueId: created.data.id,
        phase: "LEAGUE",
        status: "SCHEDULED",
        playerHomeId: p1.id,
        playerAwayId: p2.id,
      },
    });

    const result = await deleteLeague(created.data.id);
    expect(result.ok).toBe(false);

    const league = await prisma.league.findUnique({ where: { id: created.data.id } });
    expect(league).not.toBeNull();
    const players = await prisma.player.count({ where: { leagueId: created.data.id } });
    expect(players).toBeGreaterThan(0);
  });

  it("refuses to delete a league that is no longer in SETUP", async () => {
    const created = await createLeague(baseLeagueConfig());
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    await prisma.league.update({
      where: { id: created.data.id },
      data: { status: "LEAGUE" },
    });

    const result = await deleteLeague(created.data.id);
    expect(result.ok).toBe(false);

    const league = await prisma.league.findUnique({ where: { id: created.data.id } });
    expect(league).not.toBeNull();
  });

  it("fails for a nonexistent league", async () => {
    const result = await deleteLeague(`nonexistent-${uid("league")}`);
    expect(result.ok).toBe(false);
  });
});
