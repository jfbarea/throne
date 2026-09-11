// @vitest-environment jsdom
//
// Tests for the multi-liga hito de integración I1 — "montar las acciones de
// ciclo de vida en /admin". The four action components
// (src/components/admin/{Archive,Unarchive,Duplicate,Delete}LeagueAction.tsx,
// lane D) already existed and were already tested at the server-action
// level; what was untested — because it didn't exist — was the mount point
// itself (`AdminLeagueActions`, src/app/admin/AdminLeagueActions.tsx) and
// the one-time passcode screen the duplication flow ends on
// (`DuplicatePasscodesScreen`, src/app/admin/DuplicatePasscodesScreen.tsx).
//
// This is the one spec (`tests/**/*.test.tsx`, jsdom via
// vitest.config.ts's `environmentMatchGlobs`) in the whole suite that
// renders a client component and clicks its buttons — everything else
// tests server actions and Server Component page functions directly,
// which can't exercise "click Archivar, see it persist and see the index
// get told to refresh" at all. It hits the real test DB and the real
// server actions in src/server/league/lifecycle.ts, only mocking
// `@/lib/guards` (same convention as tests/admin-indice-de-ligas.test.ts)
// and `next/navigation`'s `useRouter` (there's no live Next.js router in a
// bare jsdom render).

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { prisma } from "@/lib/db";
import type { SessionPayload } from "@/lib/session";
import type { LeagueActionTarget } from "@/components/admin/league-actions-contract";

const ADMIN_SESSION: SessionPayload = { playerId: null, role: "ADMIN" };

vi.mock("@/lib/guards", () => ({
  requireAdmin: vi.fn(async (): Promise<SessionPayload> => ADMIN_SESSION),
}));

// Same convention as tests/archivado-de-ligas.test.ts and
// tests/crear-duplicar-borrar.test.ts: outside of an actual Next.js request
// (dev server, route handler, or Server Action invocation through the
// framework), `revalidatePath` throws — there is no "static generation
// store" for it to touch. It's a side effect this test doesn't need to
// observe.
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh }),
}));

// Imported after the mocks above so the module graph they touch
// (src/server/league/lifecycle.ts -> @/lib/guards) picks up the mock.
const { AdminLeagueActions } = await import("@/app/admin/AdminLeagueActions");

function uid(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

type LeagueStatus = "SETUP" | "LEAGUE" | "PLAYOFFS" | "FINISHED";

async function createTestLeague(
  overrides: { status?: LeagueStatus; archivedAt?: Date | null } = {}
) {
  const id = uid("league");
  return prisma.league.create({
    data: {
      id,
      name: `Liga ${id}`,
      season: "2026 Test",
      slug: `${id}-slug`,
      status: overrides.status ?? "SETUP",
      archivedAt: overrides.archivedAt ?? null,
    },
  });
}

async function createAdminPlayer(leagueId: string) {
  return prisma.player.create({
    data: {
      id: uid("admin-player"),
      leagueId,
      displayName: `Admin ${uid("name")}`,
      role: "ADMIN",
      active: true,
      passcodeHash: "test-hash",
    },
  });
}

function targetFrom(
  league: {
    id: string;
    slug: string;
    name: string;
    season: string;
    status: string;
    archivedAt: Date | null;
  },
  overrides: Partial<LeagueActionTarget> = {}
): LeagueActionTarget {
  return {
    id: league.id,
    slug: league.slug,
    name: league.name,
    season: league.season,
    status: league.status,
    archivedAt: league.archivedAt,
    activePlayerCount: 1,
    matchCount: 0,
    ...overrides,
  };
}

beforeEach(() => {
  refresh.mockClear();
});

describe("AdminLeagueActions — montaje de las acciones de ciclo de vida (I1)", () => {
  it("offers Archivar and Borrar for a SETUP league in circulation with zero matches, and hides Desarchivar", async () => {
    const league = await createTestLeague();
    await createAdminPlayer(league.id);

    render(<AdminLeagueActions league={targetFrom(league)} />);

    expect(screen.getByRole("button", { name: /^archivar$/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /^borrar$/i })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /desarchivar/i })).toBeNull();
  });

  it("archiving via the button persists archivedAt and tells the index to refresh (criterio 22)", async () => {
    const league = await createTestLeague();
    await createAdminPlayer(league.id);
    const user = userEvent.setup();

    render(<AdminLeagueActions league={targetFrom(league)} />);

    await user.click(screen.getByRole("button", { name: /^archivar$/i }));
    await user.click(await screen.findByRole("button", { name: /sí, archivar/i }));

    await waitFor(async () => {
      const reloaded = await prisma.league.findUniqueOrThrow({
        where: { id: league.id },
      });
      expect(reloaded.archivedAt).not.toBeNull();
    });
    expect(refresh).toHaveBeenCalled();
  });

  it("offers Desarchivar for an archived league, and hides Archivar (archivar/desarchivar are mutually exclusive, spec §2.8)", async () => {
    const league = await createTestLeague({ archivedAt: new Date() });
    await createAdminPlayer(league.id);

    render(<AdminLeagueActions league={targetFrom(league)} />);

    expect(screen.getByRole("button", { name: /desarchivar/i })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^archivar$/i })).toBeNull();
  });

  it("unarchiving via the button clears archivedAt and tells the index to refresh", async () => {
    const league = await createTestLeague({ archivedAt: new Date() });
    await createAdminPlayer(league.id);
    const user = userEvent.setup();

    render(<AdminLeagueActions league={targetFrom(league)} />);

    await user.click(screen.getByRole("button", { name: /desarchivar/i }));

    await waitFor(async () => {
      const reloaded = await prisma.league.findUniqueOrThrow({
        where: { id: league.id },
      });
      expect(reloaded.archivedAt).toBeNull();
    });
    expect(refresh).toHaveBeenCalled();
  });

  it("hides Borrar once the league is out of SETUP (criterio 32)", async () => {
    const league = await createTestLeague({ status: "LEAGUE" });
    await createAdminPlayer(league.id);

    render(
      <AdminLeagueActions
        league={targetFrom(league, { status: "LEAGUE" })}
      />
    );

    expect(screen.queryByRole("button", { name: /^borrar$/i })).toBeNull();
  });

  it("hides Borrar once the league has at least one match, even in SETUP (spec §2.10, §5.7)", async () => {
    const league = await createTestLeague();
    await createAdminPlayer(league.id);

    render(
      <AdminLeagueActions league={targetFrom(league, { matchCount: 1 })} />
    );

    expect(screen.queryByRole("button", { name: /^borrar$/i })).toBeNull();
  });

  it("deleting an eligible league via the button removes it and tells the index to refresh (criterio 31)", async () => {
    const league = await createTestLeague();
    await createAdminPlayer(league.id);
    const user = userEvent.setup();

    render(<AdminLeagueActions league={targetFrom(league)} />);

    await user.click(screen.getByRole("button", { name: /^borrar$/i }));
    await user.click(await screen.findByRole("button", { name: /sí, borrar/i }));

    await waitFor(async () => {
      const reloaded = await prisma.league.findUnique({
        where: { id: league.id },
      });
      expect(reloaded).toBeNull();
    });
    expect(refresh).toHaveBeenCalled();
  });

  it("duplicating opens the one-time passcode screen before refreshing the index (spec §2.9)", async () => {
    const origin = await createTestLeague({ archivedAt: new Date() });
    const adminPlayer = await createAdminPlayer(origin.id);
    const user = userEvent.setup();

    render(<AdminLeagueActions league={targetFrom(origin)} />);

    await user.click(screen.getByRole("button", { name: /duplicar/i }));
    await user.click(
      await screen.findByRole("button", { name: /confirmar duplicado/i })
    );

    // The screen shows up once, listing displayName + passcode of every
    // copied player (here, just the origin's ADMIN row, since the origin
    // has no PLAYER rows) — not a bare `router.refresh()` straight after
    // the server action resolves.
    expect(
      await screen.findByText(/códigos de acceso generados/i)
    ).toBeTruthy();
    expect(screen.getByText(adminPlayer.displayName)).toBeTruthy();
    expect(refresh).not.toHaveBeenCalled();

    // The listed passcode is a fresh one, never the origin's own hash in
    // the clear (there is no plaintext to compare against — this just
    // confirms a new Player row exists with a distinct hash, spec
    // criterio 28).
    const newLeague = await prisma.league.findFirstOrThrow({
      where: { id: { not: origin.id } },
      orderBy: { createdAt: "desc" },
    });
    const newAdmin = await prisma.player.findFirstOrThrow({
      where: { leagueId: newLeague.id, role: "ADMIN" },
    });
    expect(newAdmin.passcodeHash).not.toBe(adminPlayer.passcodeHash);

    await user.click(
      screen.getByRole("button", { name: /he anotado los códigos/i })
    );

    // Only once the admin dismisses the one-time screen does the index get
    // told to refresh — closing the modal is the trigger, not the
    // duplication itself.
    expect(refresh).toHaveBeenCalled();
  });
});
