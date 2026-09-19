// Tests for Hito C1 (contexto-de-liga-y-modulos, multi-liga).
// Covers the four helpers with liga propia, ajena, archivada e inexistente,
// per the hito's own acceptance criterion 1 (plan/multi-liga/PLAN.md).
//
// Real test database (file:./test.db), same convention as
// tests/incomparecencia.test.ts. `next/navigation`'s `redirect()` is called
// for real (not mocked): it just throws a plain Error carrying a `digest`
// string (`NEXT_REDIRECT;<type>;<url>;<status>;`) — no request context
// needed to construct it — so tests catch it and parse the target URL out
// of that digest instead of mocking Next internals.

import { describe, it, expect } from "vitest";
import { prisma } from "@/lib/db";
import {
  resolveLeagueBySlug,
  requireLeagueAccess,
  assertLeagueWritable,
  resolveActingPlayerId,
  LeagueArchivedError,
  LeagueNotFoundForAdminError,
} from "@/lib/league-context";
import type { SessionPayload } from "@/lib/session";

function uid(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function createTestLeague(overrides: { archivedAt?: Date | null } = {}) {
  const id = uid("league");
  return prisma.league.create({
    data: {
      id,
      name: "Liga de test C1",
      season: "2026 Test",
      slug: `${id}-slug`,
      archivedAt: overrides.archivedAt ?? null,
    },
  });
}

async function createTestPlayer(
  leagueId: string,
  role: "ADMIN" | "PLAYER" = "PLAYER"
) {
  return prisma.player.create({
    data: {
      id: uid("player"),
      leagueId,
      displayName: `Jugador ${uid("name")}`,
      role,
      passcodeHash: "test-hash",
    },
  });
}

/** Extract the redirect target from a thrown next/navigation redirect error. */
function redirectUrl(err: unknown): string {
  const digest = (err as { digest?: string }).digest;
  if (!digest || !digest.startsWith("NEXT_REDIRECT")) {
    throw new Error(`Not a redirect error: ${String(err)}`);
  }
  return digest.split(";")[2];
}

describe("resolveLeagueBySlug", () => {
  it("returns the league matching the slug", async () => {
    const league = await createTestLeague();
    const found = await resolveLeagueBySlug(league.slug);
    expect(found?.id).toBe(league.id);
  });

  it("returns null for a slug that doesn't exist", async () => {
    const found = await resolveLeagueBySlug(`nonexistent-${uid("slug")}`);
    expect(found).toBeNull();
  });
});

describe("requireLeagueAccess — ADMIN", () => {
  it("grants access to any league in circulation (liga ajena included)", async () => {
    const league = await createTestLeague();
    const session: SessionPayload = { playerId: null, role: "ADMIN" };
    const result = await requireLeagueAccess(league.slug, session);
    expect(result.id).toBe(league.id);
  });

  it("grants access to an archived league (read-only enforced elsewhere)", async () => {
    const league = await createTestLeague({ archivedAt: new Date() });
    const session: SessionPayload = { playerId: null, role: "ADMIN" };
    const result = await requireLeagueAccess(league.slug, session);
    expect(result.id).toBe(league.id);
    expect(result.archivedAt).not.toBeNull();
  });

  it("throws LeagueNotFoundForAdminError for a nonexistent slug", async () => {
    const session: SessionPayload = { playerId: null, role: "ADMIN" };
    await expect(
      requireLeagueAccess(`nonexistent-${uid("slug")}`, session)
    ).rejects.toBeInstanceOf(LeagueNotFoundForAdminError);
  });
});

describe("requireLeagueAccess — PLAYER", () => {
  it("grants access to their own league", async () => {
    const league = await createTestLeague();
    const player = await createTestPlayer(league.id);
    const session: SessionPayload = { playerId: player.id, role: "PLAYER" };

    const result = await requireLeagueAccess(league.slug, session);
    expect(result.id).toBe(league.id);
  });

  it("redirects silently to their own league for a foreign league (liga ajena)", async () => {
    const own = await createTestLeague();
    const foreign = await createTestLeague();
    const player = await createTestPlayer(own.id);
    const session: SessionPayload = { playerId: player.id, role: "PLAYER" };

    try {
      await requireLeagueAccess(foreign.slug, session);
      expect.unreachable("expected a redirect");
    } catch (err) {
      expect(redirectUrl(err)).toBe(`/liga/${own.slug}`);
    }
  });

  it("preserves the requested page when samePagePath is given", async () => {
    const own = await createTestLeague();
    const foreign = await createTestLeague();
    const player = await createTestPlayer(own.id);
    const session: SessionPayload = { playerId: player.id, role: "PLAYER" };

    try {
      await requireLeagueAccess(foreign.slug, session, "clasificacion");
      expect.unreachable("expected a redirect");
    } catch (err) {
      expect(redirectUrl(err)).toBe(`/liga/${own.slug}/clasificacion`);
    }
  });

  it("redirects the same way for a nonexistent slug (indistinguishable from ajena)", async () => {
    const own = await createTestLeague();
    const player = await createTestPlayer(own.id);
    const session: SessionPayload = { playerId: player.id, role: "PLAYER" };

    try {
      await requireLeagueAccess(`nonexistent-${uid("slug")}`, session);
      expect.unreachable("expected a redirect");
    } catch (err) {
      expect(redirectUrl(err)).toBe(`/liga/${own.slug}`);
    }
  });

  it("signs out (redirects to /login) when their own league is archived", async () => {
    const own = await createTestLeague({ archivedAt: new Date() });
    const player = await createTestPlayer(own.id);
    const session: SessionPayload = { playerId: player.id, role: "PLAYER" };

    try {
      await requireLeagueAccess(own.slug, session);
      expect.unreachable("expected a redirect");
    } catch (err) {
      expect(redirectUrl(err)).toBe("/login");
    }
  });

  it("redirects to /login when the Player row no longer resolves (their league was deleted)", async () => {
    const session: SessionPayload = {
      playerId: `ghost-${uid("player")}`,
      role: "PLAYER",
    };
    const league = await createTestLeague();

    try {
      await requireLeagueAccess(league.slug, session);
      expect.unreachable("expected a redirect");
    } catch (err) {
      expect(redirectUrl(err)).toBe("/login");
    }
  });
});

describe("assertLeagueWritable", () => {
  it("does not throw for a league in circulation", () => {
    expect(() => assertLeagueWritable({ archivedAt: null })).not.toThrow();
  });

  it("throws LeagueArchivedError for an archived league", () => {
    expect(() => assertLeagueWritable({ archivedAt: new Date() })).toThrow(
      LeagueArchivedError
    );
  });
});

describe("resolveActingPlayerId", () => {
  it("returns the session's own playerId for a PLAYER session", async () => {
    const league = await createTestLeague();
    const player = await createTestPlayer(league.id);
    const session: SessionPayload = { playerId: player.id, role: "PLAYER" };

    const actorId = await resolveActingPlayerId(league.id, session);
    expect(actorId).toBe(player.id);
  });

  it("resolves the ADMIN Player of the given league for an ADMIN session", async () => {
    const league = await createTestLeague();
    const adminPlayer = await createTestPlayer(league.id, "ADMIN");
    const session: SessionPayload = { playerId: null, role: "ADMIN" };

    const actorId = await resolveActingPlayerId(league.id, session);
    expect(actorId).toBe(adminPlayer.id);
  });

  it("does not cross leagues: an ADMIN Player in another league is not returned", async () => {
    const league = await createTestLeague();
    const otherLeague = await createTestLeague();
    await createTestPlayer(otherLeague.id, "ADMIN");
    const session: SessionPayload = { playerId: null, role: "ADMIN" };

    const actorId = await resolveActingPlayerId(league.id, session);
    expect(actorId).toBeNull();
  });

  it("returns null for an ADMIN session when the league has no ADMIN Player yet", async () => {
    const league = await createTestLeague();
    await createTestPlayer(league.id, "PLAYER");
    const session: SessionPayload = { playerId: null, role: "ADMIN" };

    const actorId = await resolveActingPlayerId(league.id, session);
    expect(actorId).toBeNull();
  });
});
