// Tests for multi-liga C4: nombres-unicos-y-login.
// Covers the hito's own acceptance criteria (plan/multi-liga/PLAN.md):
//   1. Alta en B de un nombre ya usado en A (en circulación): error en el
//      campo, sin crear fila.
//   2. Ese mismo alta funciona si la liga que tenía el nombre está archivada.
//   3. Con "Javi" en archivada y "Javi" en circulación, el login entra en la
//      de circulación.
//   4. Un jugador de liga archivada no inicia sesión, con el error genérico.
//   5. El admin, con fila homónima en cada liga, no rompe ninguna
//      comprobación.
//   6. deletePlayer sobre el Player ADMIN devuelve error y la fila sigue ahí.
//
// Write tests against the real test database (file:./test.db), same
// conventions as tests/admin-liga-jugadores.test.ts and
// tests/recalculo-alta-baja-y-cupo.test.ts: only next/cache and @/lib/guards
// are mocked, @/lib/db stays real.
//
// The displayName check this hito adds is GLOBAL (spec §2.7): unlike every
// other test suite in this repo, tests here cannot reuse a generic name like
// "Jugador A" across `it` blocks — the real, shared, never-truncated
// file:./test.db would make an earlier test's leftover row collide with a
// later one. Every name used below is uniqued with `uid()` for that reason,
// except where a deliberate same-name collision across two leagues is
// exactly what the test means to set up (in which case both sides are
// created within the same `it`, never left for a later one to bump into).

import { describe, it, expect, vi } from "vitest";
import bcrypt from "bcryptjs";

function uid(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function createTestLeague(overrides: { archivedAt?: Date | null } = {}) {
  const { prisma } = await import("@/lib/db");
  const id = uid("league");
  return prisma.league.create({
    data: {
      id,
      name: `Liga de test C4 ${id}`,
      season: "2026 Test",
      slug: `${id}-slug`,
      archivedAt: overrides.archivedAt ?? null,
    },
  });
}

async function createPlayerRow(
  leagueId: string,
  displayName: string,
  overrides: { role?: "ADMIN" | "PLAYER"; passcode?: string } = {}
) {
  const { prisma } = await import("@/lib/db");
  const passcodeHash = overrides.passcode
    ? await bcrypt.hash(overrides.passcode, 4)
    : "test-hash";
  return prisma.player.create({
    data: {
      id: uid("player"),
      leagueId,
      displayName,
      role: overrides.role ?? "PLAYER",
      passcodeHash,
    },
  });
}

// ---------------------------------------------------------------------------
// findDisplayNameConflict / assertDisplayNameAvailable — the single point
// ---------------------------------------------------------------------------

describe("findDisplayNameConflict / assertDisplayNameAvailable (the single point of the check)", () => {
  it("finds a conflict with a role=PLAYER row in another non-archived league", async () => {
    const { findDisplayNameConflict } = await import("@/server/league/players");
    const leagueA = await createTestLeague();
    const name = uid("Javi");
    await createPlayerRow(leagueA.id, name);

    const conflict = await findDisplayNameConflict(name);
    expect(conflict?.leagueName).toBe(leagueA.name);
  });

  it("finds no conflict when the only match is role=ADMIN (the deliberate exception, §2.7)", async () => {
    const { findDisplayNameConflict } = await import("@/server/league/players");
    const leagueA = await createTestLeague();
    const name = uid("Admin");
    await createPlayerRow(leagueA.id, name, { role: "ADMIN" });

    const conflict = await findDisplayNameConflict(name);
    expect(conflict).toBeNull();
  });

  it("finds no conflict when the only match is in an archived league", async () => {
    const { findDisplayNameConflict } = await import("@/server/league/players");
    const archived = await createTestLeague({ archivedAt: new Date() });
    const name = uid("Javi");
    await createPlayerRow(archived.id, name);

    const conflict = await findDisplayNameConflict(name);
    expect(conflict).toBeNull();
  });

  it("excludePlayerId lets a player's own row be ignored (rename check)", async () => {
    const { findDisplayNameConflict } = await import("@/server/league/players");
    const league = await createTestLeague();
    const name = uid("Javi");
    const player = await createPlayerRow(league.id, name);

    expect(await findDisplayNameConflict(name)).not.toBeNull();
    expect(
      await findDisplayNameConflict(name, { excludePlayerId: player.id })
    ).toBeNull();
  });

  it("assertDisplayNameAvailable throws for role=PLAYER, naming the conflicting league", async () => {
    // DisplayNameTakenError itself is deliberately not exported from
    // players.ts (it's a "use server" module — see the class's own
    // docstring), so this asserts on the rejection's message instead of
    // `instanceof`.
    const { assertDisplayNameAvailable } = await import(
      "@/server/league/players"
    );
    const league = await createTestLeague();
    const name = uid("Javi");
    await createPlayerRow(league.id, name);

    await expect(assertDisplayNameAvailable(name, "PLAYER")).rejects.toThrow(
      league.name
    );
  });

  it("assertDisplayNameAvailable is a no-op for role=ADMIN, even with an identical name taken", async () => {
    const { assertDisplayNameAvailable } = await import(
      "@/server/league/players"
    );
    const league = await createTestLeague();
    const name = uid("Javi");
    await createPlayerRow(league.id, name);

    await expect(
      assertDisplayNameAvailable(name, "ADMIN")
    ).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Criterios 1-2: createPlayer enforces the global check, respecting archived
// ---------------------------------------------------------------------------

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/guards", () => ({
  requireAdmin: vi.fn(async () => ({ role: "ADMIN", playerId: null })),
}));

describe("createPlayer — global displayName uniqueness (multi-liga spec §2.7)", () => {
  it("rejects a name already used in another league in circulation, with a field error, and creates no row", async () => {
    const { prisma } = await import("@/lib/db");
    const { createPlayer } = await import("@/server/league/players");

    const leagueA = await createTestLeague();
    const name = uid("Javi");
    await createPlayerRow(leagueA.id, name);
    const leagueB = await createTestLeague();

    const res = await createPlayer(leagueB.id, {
      displayName: name,
      faction: null,
      role: "PLAYER",
    });

    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.fieldErrors?.displayName).toBeDefined();

    const rows = await prisma.player.findMany({
      where: { leagueId: leagueB.id, displayName: name },
    });
    expect(rows).toHaveLength(0);
  });

  it("succeeds if the league holding the name is archived", async () => {
    const { createPlayer } = await import("@/server/league/players");

    const archived = await createTestLeague({ archivedAt: new Date() });
    const name = uid("Javi");
    await createPlayerRow(archived.id, name);
    const leagueB = await createTestLeague();

    const res = await createPlayer(leagueB.id, {
      displayName: name,
      faction: null,
      role: "PLAYER",
    });

    expect(res.ok).toBe(true);
  });

  it("still rejects two PLAYER rows with the same name inside the same league (unchanged behaviour)", async () => {
    const { createPlayer } = await import("@/server/league/players");
    const league = await createTestLeague();
    const name = uid("Javi");
    await createPlayerRow(league.id, name);

    const res = await createPlayer(league.id, {
      displayName: name,
      faction: null,
      role: "PLAYER",
    });
    expect(res.ok).toBe(false);
  });

  it("does not reject creating the admin's own role=ADMIN row under a name already used by a PLAYER elsewhere", async () => {
    const { createPlayer } = await import("@/server/league/players");
    const leagueA = await createTestLeague();
    const name = uid("Admin");
    await createPlayerRow(leagueA.id, name);
    const leagueB = await createTestLeague();

    const res = await createPlayer(leagueB.id, {
      displayName: name,
      faction: null,
      role: "ADMIN",
    });
    expect(res.ok).toBe(true);
  });
});

describe("updatePlayer — global displayName uniqueness applies to edits too (spec §5.4)", () => {
  it("rejects renaming into a name already used in another league in circulation", async () => {
    const { updatePlayer } = await import("@/server/league/players");
    const leagueA = await createTestLeague();
    const takenName = uid("Javi");
    await createPlayerRow(leagueA.id, takenName);
    const leagueB = await createTestLeague();
    const target = await createPlayerRow(leagueB.id, uid("Marc"));

    const res = await updatePlayer(target.id, {
      displayName: takenName,
      faction: null,
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.fieldErrors?.displayName).toBeDefined();

    const { prisma } = await import("@/lib/db");
    const unchanged = await prisma.player.findUnique({ where: { id: target.id } });
    expect(unchanged?.displayName).not.toBe(takenName);
  });

  it("allows keeping (re-saving) a player's own unchanged name", async () => {
    const { updatePlayer } = await import("@/server/league/players");
    const league = await createTestLeague();
    const name = uid("Javi");
    const player = await createPlayerRow(league.id, name);

    const res = await updatePlayer(player.id, {
      displayName: name,
      faction: "Necrons",
    });
    expect(res.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Criterio 6: deletePlayer refuses to delete the ADMIN Player of a league
// ---------------------------------------------------------------------------

describe("deletePlayer — protects the role=ADMIN Player of a league (spec §4.9, criterio 14)", () => {
  it("fails and leaves the row intact", async () => {
    const { prisma } = await import("@/lib/db");
    const { deletePlayer } = await import("@/server/league/players");

    const league = await createTestLeague();
    const admin = await createPlayerRow(league.id, uid("Admin"), {
      role: "ADMIN",
    });

    const res = await deletePlayer(admin.id);
    expect(res.ok).toBe(false);

    const stillThere = await prisma.player.findUnique({ where: { id: admin.id } });
    expect(stillThere).not.toBeNull();
  });

  it("still allows deleting a regular PLAYER with no match history", async () => {
    const { prisma } = await import("@/lib/db");
    const { deletePlayer } = await import("@/server/league/players");

    const league = await createTestLeague();
    const player = await createPlayerRow(league.id, uid("Marc"));

    const res = await deletePlayer(player.id);
    expect(res.ok).toBe(true);

    const gone = await prisma.player.findUnique({ where: { id: player.id } });
    expect(gone).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Criterios 3-5: verifyPlayerPasscode — role=PLAYER + non-archived league
// ---------------------------------------------------------------------------

describe("verifyPlayerPasscode — multi-liga spec §2.7, §2.8, §4.4", () => {
  it("logs into the non-archived league when the same name also exists, archived, elsewhere", async () => {
    const { verifyPlayerPasscode } = await import("@/lib/auth");

    const name = uid("Javi");
    const archived = await createTestLeague({ archivedAt: new Date() });
    await createPlayerRow(archived.id, name, { passcode: "old-code" });

    const current = await createTestLeague();
    const currentJavi = await createPlayerRow(current.id, name, {
      passcode: "new-code",
    });

    const result = await verifyPlayerPasscode(name, "new-code");
    expect(result?.id).toBe(currentJavi.id);
  });

  it("a player of an archived league cannot log in — generic failure, same as a wrong passcode", async () => {
    const { verifyPlayerPasscode } = await import("@/lib/auth");

    const name = uid("SoloArchivada");
    const archived = await createTestLeague({ archivedAt: new Date() });
    await createPlayerRow(archived.id, name, { passcode: "1234" });

    const result = await verifyPlayerPasscode(name, "1234");
    expect(result).toBeNull();
  });

  it("never authenticates through the admin's homonymous role=ADMIN row (§2.4 — admin never uses this login path)", async () => {
    const { verifyPlayerPasscode } = await import("@/lib/auth");

    const name = uid("Admin");
    const league = await createTestLeague();
    await createPlayerRow(league.id, name, {
      role: "ADMIN",
      passcode: "admin-code",
    });

    const result = await verifyPlayerPasscode(name, "admin-code");
    expect(result).toBeNull();
  });

  it("the admin's homonymous ADMIN row in another league never blocks a real PLAYER's login (criterio 5)", async () => {
    const { verifyPlayerPasscode } = await import("@/lib/auth");

    const name = uid("Javi");
    const leagueA = await createTestLeague();
    await createPlayerRow(leagueA.id, name, {
      role: "ADMIN",
      passcode: "admin-code",
    });

    const leagueB = await createTestLeague();
    const playerJavi = await createPlayerRow(leagueB.id, name, {
      role: "PLAYER",
      passcode: "player-code",
    });

    const result = await verifyPlayerPasscode(name, "player-code");
    expect(result?.id).toBe(playerJavi.id);
  });
});
