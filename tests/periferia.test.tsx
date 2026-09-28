// Tests for t04 (periferia) of the feature "calendario-de-verdad".
// Spec: plan/specs/calendario-de-verdad.md §4.8, §4.13 and §5.9.
//
// Covers:
//  - Criterio 37: `/rondas` no longer calls itself "Calendario de la liga"
//    **and its content is the same as today** (cupos, cierres, badge
//    abierta/cerrada). The second half is the one that matters: a test that
//    only read the new `h1` would pass just as happily with the rest of the
//    page broken, so the round cards are compared against a literal capture of
//    the markup this page rendered before the title changed.
//  - The on-screen half of criterio 25: `reportResult` rejects a match with no
//    `scheduledAt` (§4.8), so `MatchCard` says so before the user fills the
//    form, and offers the way out — putting the date.
//
// Rendering strategy: the page is an async Server Component, so it is awaited
// into an element tree and handed to `renderToStaticMarkup`. `AppHeader` is
// stubbed because it resolves the session through `cookies()`, which has no
// meaning outside a request; `requireAuth` for the same reason. Neither is part
// of what criterio 37 compares.

import { describe, it, expect, vi, beforeAll } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

// --- Stubs (declared before the imports they affect) -----------------------

const appHeaderSpy = vi.fn();

vi.mock("@/lib/guards", () => ({
  requireAuth: async () => ({ sub: "test-session", role: "ADMIN" }),
}));

vi.mock("@/components/AppHeader", () => ({
  AppHeader: (props: { active?: string }) => {
    appHeaderSpy(props);
    return null;
  },
}));

// MatchCard's three child forms are other tracks' files (ScheduleForm is t03's)
// and they reach for server actions. This test is about the buttons above them.
vi.mock("@/components/ScheduleForm", () => ({
  ScheduleForm: () => null,
}));
vi.mock("@/app/mis-partidas/ReportForm", () => ({
  ReportForm: () => null,
}));
vi.mock("@/app/mis-partidas/WalkoverForm", () => ({
  WalkoverForm: () => null,
}));

import { prisma } from "@/lib/db";
import RondasPage from "@/app/rondas/page";
import { MatchCard, scheduleFormPropsFor } from "@/app/mis-partidas/MatchCard";
import {
  FIXTURE_DEADLINES,
  FIXTURE_START_MONTH,
  seedCalendarLeague,
  type SeededCalendar,
} from "./helpers/calendario";
import { scheduleBounds } from "@/server/calendar";

// ---------------------------------------------------------------------------
// Criterio 37 — /rondas: sólo cambia el título
// ---------------------------------------------------------------------------

/**
 * The round list of `/rondas` exactly as it rendered **before** §4.13 touched
 * the title, for the fixture league of `seedCalendarLeague()`: three rounds
 * (the first closed), their deadlines, the resolved counters, the
 * abierta/cerrada badge and the four players' cupos with their colour and
 * their `title`.
 *
 * Two normalisations, both applied to the live render too (`normalise`):
 *  - Phosphor's inline `<svg>` collapses to `[icono:cumplido]` /
 *    `[icono:falta]`, which keeps the check-vs-warning distinction without
 *    7 KB of path data per icon.
 *  - The three formatted dates are placeholders, filled in at run time from
 *    the rounds the fixture actually wrote. `formatDeadline` in the page uses
 *    `toLocaleDateString` with no `timeZone`, so a machine set to
 *    `America/New_York` renders "31 oct 2026" where Madrid renders "1 nov
 *    2026"; the placeholder is what keeps this test honest under any `TZ`.
 *
 * Line breaks are cosmetic (one card per line) and are stripped before
 * comparing.
 */
const RONDAS_CONTENT_BEFORE = `<div class="space-y-4">
<div class="bg-[var(--surface)] border border-[var(--border)] rounded-[var(--radius-sm)] p-6   space-y-3"><div class="flex items-start justify-between gap-3"><div><p class="text-[15px] font-semibold" style="font-family:var(--font-sans);color:var(--fg)">Ronda 1</p><p class="mt-0.5 text-[12px]" style="color:var(--fg-faint);font-family:var(--font-sans)">Cerrada el {{R1_CLOSED_AT}} · 2 de 2 jugadas</p></div><span class="inline-flex items-center gap-[6px] px-[10px] py-1 rounded-[999px] border text-[12px] font-semibold leading-none tracking-[0.02em] bg-[var(--moss-100)] text-[var(--moss-500)] border-[rgba(107,122,78,0.4)]" style="font-family:var(--font-sans)">Cerrada</span></div><div class="grid gap-1.5" style="grid-template-columns:repeat(auto-fill, minmax(132px, 1fr))"><div class="flex items-center justify-between gap-2 rounded px-2 py-1.5 text-[12px] min-w-0" style="background:var(--bg-raised)"><span class="truncate" style="color:var(--fg-muted);font-family:var(--font-sans)">Admin</span><span class="flex items-center gap-1 flex-shrink-0 font-semibold" style="color:var(--moss-500);font-variant-numeric:tabular-nums" title="cumplido">0/0[icono:cumplido]</span></div><div class="flex items-center justify-between gap-2 rounded px-2 py-1.5 text-[12px] min-w-0" style="background:var(--bg-raised)"><span class="truncate" style="color:var(--fg-muted);font-family:var(--font-sans)">Alice</span><span class="flex items-center gap-1 flex-shrink-0 font-semibold" style="color:var(--moss-500);font-variant-numeric:tabular-nums" title="cumplido">2/2[icono:cumplido]</span></div><div class="flex items-center justify-between gap-2 rounded px-2 py-1.5 text-[12px] min-w-0" style="background:var(--bg-raised)"><span class="truncate" style="color:var(--fg-muted);font-family:var(--font-sans)">Bob</span><span class="flex items-center gap-1 flex-shrink-0 font-semibold" style="color:var(--moss-500);font-variant-numeric:tabular-nums" title="cumplido">1/1[icono:cumplido]</span></div><div class="flex items-center justify-between gap-2 rounded px-2 py-1.5 text-[12px] min-w-0" style="background:var(--bg-raised)"><span class="truncate" style="color:var(--fg-muted);font-family:var(--font-sans)">Carol</span><span class="flex items-center gap-1 flex-shrink-0 font-semibold" style="color:var(--moss-500);font-variant-numeric:tabular-nums" title="cumplido">1/1[icono:cumplido]</span></div></div></div>
<div class="bg-[var(--surface)] border border-[var(--border)] rounded-[var(--radius-sm)] p-6   space-y-3"><div class="flex items-start justify-between gap-3"><div><p class="text-[15px] font-semibold" style="font-family:var(--font-sans);color:var(--fg)">Ronda 2</p><p class="mt-0.5 text-[12px]" style="color:var(--fg-faint);font-family:var(--font-sans)">Cierra {{R2_DEADLINE}} · 2 de 4 jugadas</p></div><span class="inline-flex items-center gap-[6px] px-[10px] py-1 rounded-[999px] border text-[12px] font-semibold leading-none tracking-[0.02em] bg-[rgba(201,166,107,0.12)] text-[var(--accent)] border-[rgba(201,166,107,0.3)]" style="font-family:var(--font-sans)">Abierta</span></div><div class="grid gap-1.5" style="grid-template-columns:repeat(auto-fill, minmax(132px, 1fr))"><div class="flex items-center justify-between gap-2 rounded px-2 py-1.5 text-[12px] min-w-0" style="background:var(--bg-raised)"><span class="truncate" style="color:var(--fg-muted);font-family:var(--font-sans)">Admin</span><span class="flex items-center gap-1 flex-shrink-0 font-semibold" style="color:var(--moss-500);font-variant-numeric:tabular-nums" title="cumplido">1/1[icono:cumplido]</span></div><div class="flex items-center justify-between gap-2 rounded px-2 py-1.5 text-[12px] min-w-0" style="background:var(--bg-raised)"><span class="truncate" style="color:var(--fg-muted);font-family:var(--font-sans)">Alice</span><span class="flex items-center gap-1 flex-shrink-0 font-semibold" style="color:var(--ember-500);font-variant-numeric:tabular-nums" title="falta 1 de 2">1/2[icono:falta]</span></div><div class="flex items-center justify-between gap-2 rounded px-2 py-1.5 text-[12px] min-w-0" style="background:var(--bg-raised)"><span class="truncate" style="color:var(--fg-muted);font-family:var(--font-sans)">Bob</span><span class="flex items-center gap-1 flex-shrink-0 font-semibold" style="color:var(--ember-500);font-variant-numeric:tabular-nums" title="falta 1 de 2">1/2[icono:falta]</span></div><div class="flex items-center justify-between gap-2 rounded px-2 py-1.5 text-[12px] min-w-0" style="background:var(--bg-raised)"><span class="truncate" style="color:var(--fg-muted);font-family:var(--font-sans)">Carol</span><span class="flex items-center gap-1 flex-shrink-0 font-semibold" style="color:var(--ember-500);font-variant-numeric:tabular-nums" title="faltan 2 de 3">1/3[icono:falta]</span></div></div></div>
<div class="bg-[var(--surface)] border border-[var(--border)] rounded-[var(--radius-sm)] p-6   space-y-3"><div class="flex items-start justify-between gap-3"><div><p class="text-[15px] font-semibold" style="font-family:var(--font-sans);color:var(--fg)">Ronda 3</p><p class="mt-0.5 text-[12px]" style="color:var(--fg-faint);font-family:var(--font-sans)">Cierra {{R3_DEADLINE}} · 0 de 1 jugada</p></div><span class="inline-flex items-center gap-[6px] px-[10px] py-1 rounded-[999px] border text-[12px] font-semibold leading-none tracking-[0.02em] bg-[rgba(201,166,107,0.12)] text-[var(--accent)] border-[rgba(201,166,107,0.3)]" style="font-family:var(--font-sans)">Abierta</span></div><div class="grid gap-1.5" style="grid-template-columns:repeat(auto-fill, minmax(132px, 1fr))"><div class="flex items-center justify-between gap-2 rounded px-2 py-1.5 text-[12px] min-w-0" style="background:var(--bg-raised)"><span class="truncate" style="color:var(--fg-muted);font-family:var(--font-sans)">Admin</span><span class="flex items-center gap-1 flex-shrink-0 font-semibold" style="color:var(--moss-500);font-variant-numeric:tabular-nums" title="cumplido">0/0[icono:cumplido]</span></div><div class="flex items-center justify-between gap-2 rounded px-2 py-1.5 text-[12px] min-w-0" style="background:var(--bg-raised)"><span class="truncate" style="color:var(--fg-muted);font-family:var(--font-sans)">Alice</span><span class="flex items-center gap-1 flex-shrink-0 font-semibold" style="color:var(--ember-500);font-variant-numeric:tabular-nums" title="falta 1 de 1">0/1[icono:falta]</span></div><div class="flex items-center justify-between gap-2 rounded px-2 py-1.5 text-[12px] min-w-0" style="background:var(--bg-raised)"><span class="truncate" style="color:var(--fg-muted);font-family:var(--font-sans)">Bob</span><span class="flex items-center gap-1 flex-shrink-0 font-semibold" style="color:var(--ember-500);font-variant-numeric:tabular-nums" title="falta 1 de 1">0/1[icono:falta]</span></div><div class="flex items-center justify-between gap-2 rounded px-2 py-1.5 text-[12px] min-w-0" style="background:var(--bg-raised)"><span class="truncate" style="color:var(--fg-muted);font-family:var(--font-sans)">Carol</span><span class="flex items-center gap-1 flex-shrink-0 font-semibold" style="color:var(--moss-500);font-variant-numeric:tabular-nums" title="cumplido">0/0[icono:cumplido]</span></div></div></div></div>`;

const ROUNDS_LIST_OPEN = '<div class="space-y-4">';

function normalise(markup: string): string {
  return markup
    .replace(/<svg\b[^>]*>[\s\S]*?<\/svg>/g, (svg) =>
      // The check-circle path; anything else here is the warning-circle.
      svg.includes("M173.66") ? "[icono:cumplido]" : "[icono:falta]"
    )
    .replaceAll("\n", "");
}

/** The round cards: everything between the page header and the end of `<main>`. */
function roundsListOf(html: string): string {
  const start = html.indexOf(ROUNDS_LIST_OPEN);
  const end = html.indexOf("</main>");
  expect(start, "la lista de rondas no está en el render").toBeGreaterThan(-1);
  return normalise(html.slice(start, end));
}

function formatEsDate(date: Date): string {
  return date.toLocaleDateString("es-ES", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function textOf(markup: string): string {
  return markup.replace(/<[^>]+>/g, "").trim();
}

function tagContent(html: string, tag: string): string | null {
  const match = html.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`));
  return match ? textOf(match[1]) : null;
}

describe("AC-37: /rondas ya no se titula «Calendario de la liga» y su contenido es el de hoy", () => {
  let seeded: SeededCalendar;
  let html: string;

  beforeAll(async () => {
    // The shared fixture (tests/helpers/calendario.ts), not a seed of our own.
    seeded = await seedCalendarLeague();
    // /rondas shows the most recently created league; the fixture is it.
    html = renderToStaticMarkup(await RondasPage());
  });

  it("renderiza la liga de la fixture (si no, lo que se compara abajo no es lo que se cree)", () => {
    expect(tagContent(html, "span")).toBe("Rondas · Liga de test · calendario");
  });

  it("el h1 ya no dice «Calendario de la liga»", () => {
    expect(tagContent(html, "h1")).not.toBe("Calendario de la liga");
  });

  it("el h1 nombra lo que la página es: las rondas y los cupos", () => {
    expect(tagContent(html, "h1")).toBe("Rondas y cupos");
  });

  it("la bajada nombra las rondas, sus cierres y el cupo de cada jugador", () => {
    expect(tagContent(html, "p")).toBe(
      "Cada ronda, cuándo cierra y el cupo de cada jugador — a quién hay que perseguir."
    );
  });

  it("el contenido (cupos, cierres, badge abierta/cerrada) es idéntico al de antes del cambio", async () => {
    const rounds = await prisma.round.findMany({
      where: { leagueId: seeded.leagueId },
      orderBy: { index: "asc" },
    });
    const [r1, r2, r3] = rounds;

    const expected = RONDAS_CONTENT_BEFORE.replaceAll("\n", "")
      .replaceAll("{{R1_CLOSED_AT}}", formatEsDate(r1.closedAt as Date))
      .replaceAll("{{R2_DEADLINE}}", formatEsDate(r2.deadline))
      .replaceAll("{{R3_DEADLINE}}", formatEsDate(r3.deadline));

    expect(roundsListOf(html)).toBe(expected);
  });

  it("sigue siendo la misma entrada de menú: la cabecera se marca en «rondas»", () => {
    expect(appHeaderSpy).toHaveBeenCalledWith(
      expect.objectContaining({ active: "rondas" })
    );
  });
});

// ---------------------------------------------------------------------------
// Criterio 25, mitad de pantalla — MatchCard explica por qué no puede apuntar
// ---------------------------------------------------------------------------

type CardMatch = Parameters<typeof MatchCard>[0]["match"];

const PLAYER_HOME = "player-home";
const PLAYER_AWAY = "player-away";

function makeCardMatch(overrides: Partial<CardMatch> = {}): CardMatch {
  return {
    id: "match-1",
    playerHomeId: PLAYER_HOME,
    playerAwayId: PLAYER_AWAY,
    playerHomeName: "Alice",
    playerAwayName: "Bob",
    scheduledAt: null,
    location: null,
    status: "SCHEDULED",
    // §4.7's two ends, which src/app/mis-partidas/page.tsx now loads and hands
    // down (criterio 22). Round 2 of the shared fixture, October 2026 league.
    roundDeadline: FIXTURE_DEADLINES.r2.toISOString(),
    leagueStartMonth: FIXTURE_START_MONTH.toISOString(),
    result: null,
    ...overrides,
  };
}

function renderCard(
  match: CardMatch,
  opts: { currentPlayerId?: string; isAdmin?: boolean } = {}
): string {
  return renderToStaticMarkup(
    <MatchCard
      match={match}
      currentPlayerId={opts.currentPlayerId ?? PLAYER_HOME}
      isAdmin={opts.isAdmin ?? false}
    />
  );
}

/** The `<button>` whose visible text contains `label`, markup and all. */
function buttonWith(html: string, label: string): string {
  const buttons = html.match(/<button\b[^>]*>[\s\S]*?<\/button>/g) ?? [];
  const found = buttons.find((b) => textOf(b).includes(label));
  expect(found, `no hay ningún botón que diga «${label}»`).toBeDefined();
  return found as string;
}

function hasButton(html: string, label: string): boolean {
  const buttons = html.match(/<button\b[^>]*>[\s\S]*?<\/button>/g) ?? [];
  return buttons.some((b) => textOf(b).includes(label));
}

const BLOCKED_NOTE =
  "Sin fecha no hay resultado: la partida necesita día antes de tener marcador.";

describe("AC-25 (en pantalla): sin fecha, el botón de resultado dice por qué y ofrece ponerla", () => {
  it("una partida sin fecha deshabilita «Apuntar resultado»", () => {
    const html = renderCard(makeCardMatch({ scheduledAt: null }));

    expect(buttonWith(html, "Apuntar resultado")).toContain("disabled");
  });

  it("explica por qué está deshabilitado, en el propio botón y en el texto", () => {
    const html = renderCard(makeCardMatch({ scheduledAt: null }));

    expect(buttonWith(html, "Apuntar resultado")).toContain(
      'title="Esta partida no tiene fecha. Ponle fecha antes de apuntar el resultado."'
    );
    expect(textOf(html)).toContain(BLOCKED_NOTE);
  });

  it("ofrece el camino para arreglarlo: poner la fecha", () => {
    const html = renderCard(makeCardMatch({ scheduledAt: null }));

    expect(hasButton(html, "Poner fecha")).toBe(true);
  });

  it("con fecha, el botón sigue activo y la explicación no se pinta", () => {
    const html = renderCard(
      makeCardMatch({ scheduledAt: new Date(Date.UTC(2026, 10, 14, 19)).toISOString() })
    );

    expect(buttonWith(html, "Apuntar resultado")).not.toContain("disabled");
    expect(textOf(html)).not.toContain(BLOCKED_NOTE);
  });

  it("tampoco el admin apunta sin fecha: §4.8 no distingue rol", () => {
    const html = renderCard(makeCardMatch({ scheduledAt: null }), {
      currentPlayerId: "someone-else",
      isAdmin: true,
    });

    expect(buttonWith(html, "Apuntar resultado")).toContain("disabled");
    expect(textOf(html)).toContain(BLOCKED_NOTE);
  });

  it("§5.9: una partida PLAYED sin fecha bloquea «Editar resultado» y pide fecharla", () => {
    const html = renderCard(
      makeCardMatch({
        scheduledAt: null,
        status: "REPORTED",
        result: {
          homeVP: 55,
          awayVP: 70,
          outcome: "AWAY_WIN",
          reportedById: PLAYER_HOME,
          bonusHome: 0,
          bonusAway: 0,
          resolution: "PLAYED",
        },
      })
    );

    expect(buttonWith(html, "Editar resultado")).toContain("disabled");
    expect(textOf(html)).toContain(BLOCKED_NOTE);
    expect(hasButton(html, "Poner fecha")).toBe(true);
  });

  it("la incomparecencia sigue disponible sin fecha: §4.8 la exime", () => {
    const html = renderCard(makeCardMatch({ scheduledAt: null }));

    expect(buttonWith(html, "Incomparecencia")).not.toContain("disabled");
  });
});

// ---------------------------------------------------------------------------
// Criterio 29 en /mis-partidas — la costura entre MatchCard y ScheduleForm
// ---------------------------------------------------------------------------

// The form is only mounted after a click, and a server-rendered test cannot
// click, so the seam is checked where it lives: the props `MatchCard` builds
// (`scheduleFormPropsFor`) are fed to the **real** `ScheduleForm` — the one the
// mock above replaces everywhere else in this file — and the markup is read.
// `MatchRow` (the calendar) passed `resolution`; this side did not, and the
// form's `resolution !== "PLAYED"` then read `undefined` as "clearable".
async function realScheduleForm() {
  const mod = await vi.importActual<typeof import("@/components/ScheduleForm")>(
    "@/components/ScheduleForm"
  );
  return mod.ScheduleForm;
}

const SCHEDULED_ISO = new Date(Date.UTC(2026, 10, 14, 19)).toISOString();

describe("AC-29 en /mis-partidas: una partida PLAYED con fecha no ofrece «Limpiar fecha»", () => {
  it("con resolution = PLAYED, el formulario que monta MatchCard no pinta «Limpiar fecha»", async () => {
    const ScheduleForm = await realScheduleForm();
    const match = makeCardMatch({
      scheduledAt: SCHEDULED_ISO,
      status: "REPORTED",
      result: {
        homeVP: 80,
        awayVP: 60,
        outcome: "HOME_WIN",
        reportedById: PLAYER_HOME,
        bonusHome: 0,
        bonusAway: 0,
        resolution: "PLAYED",
      },
    });

    const html = renderToStaticMarkup(
      <ScheduleForm {...scheduleFormPropsFor(match)} />
    );

    expect(hasButton(html, "Limpiar fecha")).toBe(false);
    // The form is otherwise the same form: the date can still be corrected.
    expect(hasButton(html, "Guardar fecha")).toBe(true);
  });

  it("sin resultado, o con WALKOVER, «Limpiar fecha» sigue estando (§4.9)", async () => {
    const ScheduleForm = await realScheduleForm();

    for (const resolution of [null, "WALKOVER", "UNPLAYED_DRAW"]) {
      const match = makeCardMatch({
        scheduledAt: SCHEDULED_ISO,
        status: resolution ? "REPORTED" : "SCHEDULED",
        result: resolution
          ? {
              homeVP: 80,
              awayVP: 0,
              outcome: "HOME_WIN",
              reportedById: PLAYER_HOME,
              bonusHome: 0,
              bonusAway: 0,
              resolution,
            }
          : null,
      });

      const html = renderToStaticMarkup(
        <ScheduleForm {...scheduleFormPropsFor(match)} />
      );

      expect(hasButton(html, "Limpiar fecha"), `resolution=${resolution}`).toBe(
        true
      );
    }
  });

  it("MatchCard le pasa al formulario la resolution de la partida", () => {
    const played = makeCardMatch({
      scheduledAt: SCHEDULED_ISO,
      status: "REPORTED",
      result: {
        homeVP: 80,
        awayVP: 60,
        outcome: "HOME_WIN",
        reportedById: PLAYER_HOME,
        bonusHome: 0,
        bonusAway: 0,
        resolution: "PLAYED",
      },
    });

    expect(scheduleFormPropsFor(played)).toEqual({
      matchId: played.id,
      currentScheduledAt: SCHEDULED_ISO,
      currentLocation: null,
      leagueStartMonth: FIXTURE_START_MONTH.toISOString(),
      roundDeadline: FIXTURE_DEADLINES.r2.toISOString(),
      resolution: "PLAYED",
    });
    expect(scheduleFormPropsFor(makeCardMatch()).resolution).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Criterio 22 en /mis-partidas — la otra costura del mismo contrato
// ---------------------------------------------------------------------------

/**
 * Misma mecánica que el bloque de arriba, y por la misma razón: el formulario
 * sólo se monta tras un clic, así que la costura se comprueba donde vive, en
 * las props que `MatchCard` construye. Aquí eran `leagueStartMonth` y
 * `roundDeadline` las que faltaban — el `min`/`max` del `datetime-local` era
 * `undefined` en esta ruta igual que en el calendario (C1 de la review de la
 * ola 2). El montaje real de la página, con las cotas salidas de la base de
 * datos, está en tests/montaje.test.tsx.
 *
 * La aritmética del valor es del navegador (`datetime-local` no tiene zona),
 * así que se reproduce aquí tal cual la escribe `ScheduleForm`.
 */
function toLocalInputValue(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

describe("AC-22 en /mis-partidas: el datetime-local que monta MatchCard lleva min y max", () => {
  it("una partida de ronda llega al input con los dos extremos de §4.7", async () => {
    const ScheduleForm = await realScheduleForm();
    const html = renderToStaticMarkup(
      <ScheduleForm {...scheduleFormPropsFor(makeCardMatch())} />
    );

    const bounds = scheduleBounds(FIXTURE_START_MONTH, FIXTURE_DEADLINES.r2);
    expect(html).toContain(`min="${toLocalInputValue(bounds.min!)}"`);
    expect(html).toContain(`max="${toLocalInputValue(bounds.max!)}"`);
  });

  it("una partida sin ronda (§5.2) llega con suelo pero sin techo", async () => {
    const ScheduleForm = await realScheduleForm();
    const html = renderToStaticMarkup(
      <ScheduleForm
        {...scheduleFormPropsFor(makeCardMatch({ roundDeadline: null }))}
      />
    );

    const bounds = scheduleBounds(FIXTURE_START_MONTH, null);
    expect(html).toContain(`min="${toLocalInputValue(bounds.min!)}"`);
    expect(html).not.toContain("max=");
  });

  it("MatchCard le pasa al formulario las dos cotas de la partida", () => {
    expect(scheduleFormPropsFor(makeCardMatch())).toMatchObject({
      leagueStartMonth: FIXTURE_START_MONTH.toISOString(),
      roundDeadline: FIXTURE_DEADLINES.r2.toISOString(),
    });
    expect(
      scheduleFormPropsFor(
        makeCardMatch({ roundDeadline: null, leagueStartMonth: null })
      )
    ).toMatchObject({ leagueStartMonth: null, roundDeadline: null });
  });
});
