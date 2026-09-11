// Tests for Hito A2 (redirecciones-de-rutas-antiguas, lane A, multi-liga).
// plan/multi-liga/PLAN.md, hito A2's own acceptance criteria (spec criterios
// 5, 6, 7, 46):
//   1. Un jugador de A pidiendo /liga/<slug-B>/clasificacion acaba en la
//      suya, sin mensaje.
//   2. Un slug inexistente produce para ese jugador exactamente la misma
//      respuesta: no se distingue «no existe» de «no es tuya».
//   3. /clasificacion con sesión de jugador acaba en su equivalente con slug.
//   4. Con sesión previa al deploy, las cinco rutas antiguas llevan a la
//      misma página dentro de su liga, sin pasos intermedios.
//   5. La redirección hace una consulta, y ninguna si la sesión es de admin
//      o no hay sesión.
//
// Criterios 1-2 (the slugged route `/liga/<slug>/clasificacion` itself,
// reached with a foreign or nonexistent slug) exercise the same guard
// (`requireLeagueAccess`, src/lib/league-context.ts) already covered end to
// end by tests/league-context.test.ts and tests/route-scaffolding.test.ts
// (C1/C2, frozen) — this file adds the same check from lane A's own page
// (criterio 1/2's exact wording, "acaba en la suya, sin mensaje") instead of
// duplicating C1's suite, and focuses the rest on what's actually new in
// this hito: the five *legacy* (unslugged) routes.

import { describe, it, expect, vi } from "vitest";
import { prisma } from "@/lib/db";
import { requireLeagueAccess } from "@/lib/league-context";
import type { SessionPayload } from "@/lib/session";

function uid(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function createTestLeague(overrides: { archivedAt?: Date | null } = {}) {
  const id = uid("league");
  return prisma.league.create({
    data: {
      id,
      name: "Liga de test A2",
      season: "2026 Test",
      slug: `${id}-slug`,
      archivedAt: overrides.archivedAt ?? null,
    },
  });
}

async function createTestPlayer(leagueId: string) {
  return prisma.player.create({
    data: {
      id: uid("player"),
      leagueId,
      displayName: `Jugador ${uid("name")}`,
      role: "PLAYER",
      passcodeHash: "test-hash",
    },
  });
}

/** Extract the redirect target from a thrown next/navigation redirect error,
 * same helper as tests/league-context.test.ts and tests/route-scaffolding.test.ts. */
function redirectUrl(err: unknown): string {
  const digest = (err as { digest?: string }).digest;
  if (!digest || !digest.startsWith("NEXT_REDIRECT")) {
    throw new Error(`Not a redirect error: ${String(err)}`);
  }
  return digest.split(";")[2];
}

// ---------------------------------------------------------------------------
// Criterios 1-2 (spec 5, 6) — `/liga/<slug>/clasificacion` con slug ajeno o
// inexistente, desde la propia página (samePagePath), sin mensaje de error.
// ---------------------------------------------------------------------------

describe("A2 criterios 1-2 — /liga/<slug>/clasificacion con slug ajeno o inexistente", () => {
  it("un jugador de A pidiendo la clasificación de B acaba en la suya, sin mensaje", async () => {
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

  it("un slug inexistente produce la misma respuesta que uno ajeno — indistinguibles", async () => {
    const own = await createTestLeague();
    const player = await createTestPlayer(own.id);
    const session: SessionPayload = { playerId: player.id, role: "PLAYER" };

    try {
      await requireLeagueAccess(`nonexistent-${uid("slug")}`, session, "clasificacion");
      expect.unreachable("expected a redirect");
    } catch (err) {
      expect(redirectUrl(err)).toBe(`/liga/${own.slug}/clasificacion`);
    }
  });
});

// ---------------------------------------------------------------------------
// redirectToOwnLeaguePage — the five legacy routes' shared resolver
// (spec §4.3: cookie.playerId → Player.leagueId → League.slug)
// ---------------------------------------------------------------------------

describe("A2 criterio 3 — redirectToOwnLeaguePage (rutas antiguas)", () => {
  it("una sesión de jugador acaba en /liga/<su-slug>/<pagina>", async () => {
    const league = await createTestLeague();
    const player = await createTestPlayer(league.id);
    vi.resetModules();
    vi.doMock("@/lib/session", () => ({
      getSession: vi.fn(async (): Promise<SessionPayload> => ({
        playerId: player.id,
        role: "PLAYER",
      })),
    }));
    const { redirectToOwnLeaguePage: freshRedirect } = await import(
      "@/app/_lib/legacy-route-redirect"
    );

    try {
      await freshRedirect("clasificacion");
      expect.unreachable("expected a redirect");
    } catch (err) {
      expect(redirectUrl(err)).toBe(`/liga/${league.slug}/clasificacion`);
    }
    vi.doUnmock("@/lib/session");
  });

  it.each(["clasificacion", "calendario", "rondas", "bracket", "mis-partidas"])(
    "cada una de las cinco rutas antiguas lleva a /liga/<slug>/%s dentro de su liga",
    async (pagePath) => {
      const league = await createTestLeague();
      const player = await createTestPlayer(league.id);
      vi.resetModules();
      vi.doMock("@/lib/session", () => ({
        getSession: vi.fn(async (): Promise<SessionPayload> => ({
          playerId: player.id,
          role: "PLAYER",
        })),
      }));
      const { redirectToOwnLeaguePage: freshRedirect } = await import(
        "@/app/_lib/legacy-route-redirect"
      );

      try {
        await freshRedirect(pagePath);
        expect.unreachable("expected a redirect");
      } catch (err) {
        expect(redirectUrl(err)).toBe(`/liga/${league.slug}/${pagePath}`);
      }
      vi.doUnmock("@/lib/session");
    }
  );
});

describe("A2 criterio 5 — número de consultas en la redirección", () => {
  it("sesión de ADMIN: va a /admin sin consultar la base ni una vez", async () => {
    vi.resetModules();
    vi.doMock("@/lib/session", () => ({
      getSession: vi.fn(async (): Promise<SessionPayload> => ({
        playerId: null,
        role: "ADMIN",
      })),
    }));
    const { redirectToOwnLeaguePage: freshRedirect } = await import(
      "@/app/_lib/legacy-route-redirect"
    );
    const spy = vi.spyOn(prisma.player, "findUnique");

    try {
      await freshRedirect("clasificacion");
      expect.unreachable("expected a redirect");
    } catch (err) {
      expect(redirectUrl(err)).toBe("/admin");
    }
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
    vi.doUnmock("@/lib/session");
  });

  it("sin sesión: va a /login sin consultar la base ni una vez", async () => {
    vi.resetModules();
    vi.doMock("@/lib/session", () => ({
      getSession: vi.fn(async (): Promise<null> => null),
    }));
    const { redirectToOwnLeaguePage: freshRedirect } = await import(
      "@/app/_lib/legacy-route-redirect"
    );
    const spy = vi.spyOn(prisma.player, "findUnique");

    try {
      await freshRedirect("clasificacion");
      expect.unreachable("expected a redirect");
    } catch (err) {
      expect(redirectUrl(err)).toBe("/login");
    }
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
    vi.doUnmock("@/lib/session");
  });

  it("sesión de jugador: exactamente una consulta antes de redirigir", async () => {
    const league = await createTestLeague();
    const player = await createTestPlayer(league.id);
    vi.resetModules();
    vi.doMock("@/lib/session", () => ({
      getSession: vi.fn(async (): Promise<SessionPayload> => ({
        playerId: player.id,
        role: "PLAYER",
      })),
    }));
    const { redirectToOwnLeaguePage: freshRedirect } = await import(
      "@/app/_lib/legacy-route-redirect"
    );
    const spy = vi.spyOn(prisma.player, "findUnique");

    try {
      await freshRedirect("clasificacion");
    } catch {
      // redirect() throws — expected.
    }
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
    vi.doUnmock("@/lib/session");
  });
});

describe("A2 — casos límite de redirectToOwnLeaguePage", () => {
  it("Player fantasma (fila borrada): cierra sesión, va a /login", async () => {
    vi.resetModules();
    vi.doMock("@/lib/session", () => ({
      getSession: vi.fn(async (): Promise<SessionPayload> => ({
        playerId: `ghost-${uid("player")}`,
        role: "PLAYER",
      })),
    }));
    const { redirectToOwnLeaguePage: freshRedirect } = await import(
      "@/app/_lib/legacy-route-redirect"
    );

    try {
      await freshRedirect("clasificacion");
      expect.unreachable("expected a redirect");
    } catch (err) {
      expect(redirectUrl(err)).toBe("/login");
    }
    vi.doUnmock("@/lib/session");
  });

  it("liga archivada con sesión previa: cierra sesión, va a /login (spec §5.3)", async () => {
    const league = await createTestLeague({ archivedAt: new Date() });
    const player = await createTestPlayer(league.id);
    vi.resetModules();
    vi.doMock("@/lib/session", () => ({
      getSession: vi.fn(async (): Promise<SessionPayload> => ({
        playerId: player.id,
        role: "PLAYER",
      })),
    }));
    const { redirectToOwnLeaguePage: freshRedirect } = await import(
      "@/app/_lib/legacy-route-redirect"
    );

    try {
      await freshRedirect("clasificacion");
      expect.unreachable("expected a redirect");
    } catch (err) {
      expect(redirectUrl(err)).toBe("/login");
    }
    vi.doUnmock("@/lib/session");
  });
});
