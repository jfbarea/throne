// Contract between `page.tsx`, `PartidasBrowser`, `VistaTabs` and the e2e
// suite (SPEC partidas-por-jornada §6): the shapes and the `data-testid`s /
// visible labels each side reads, so the three can be built in parallel
// (plan/partidas-por-jornada/PLAN.md, t01-t04) without a single one seeing
// another's implementation.

import type { Vista, StatusFilter } from "@/server/partidas-view";
import type { MatchCardMatch } from "./MatchCard";

/** One collapsible section of the list (§4.1, §4.1b). */
export interface BrowserBlock {
  /** Stable across revalidations: indexes the manual-collapse state (§4.3). */
  key: string;
  /** `ROUND` follows §4.1's current-round rule; `UNASSIGNED` and `LEGACY` always start collapsed (§4.1b). */
  kind: "ROUND" | "UNASSIGNED" | "LEGACY";
  /** e.g. "Ronda 3", "Sin ronda asignada", "Historial". */
  title: string;
  /** The block's subtitle without the match count (§4.5) — `PartidasBrowser` appends "N partidas" / "M de N partidas". */
  subtitle: string;
  matches: MatchCardMatch[];
}

export interface PartidasBrowserProps {
  blocks: BrowserBlock[];
  /** The `key` of §4.1's current round in this list, or `null` if none applies — everything starts collapsed then. */
  currentBlockKey: string | null;
  currentPlayerId: string;
  isAdmin: boolean;
  vista: Vista;
  /** Which empty-state wording §5 uses for the `PENDIENTES` banner: "no te queda…" vs. "…en la liga". */
  scope: "PLAYER" | "LEAGUE";
}

export interface VistaTabsProps {
  vista: Vista;
}

/** `data-testid`s for the blocks, the search row, the segmented filter, the tabs and the §5 banners. */
export const TEST_IDS = {
  searchInput: "search-input",
  searchClear: "search-clear",
  statusFilter: "status-filter",
  tabMias: "tab-mias",
  tabTodas: "tab-todas",
  noSearchResults: "empty-no-search-results",
  noSearchResultsClear: "empty-no-search-results-clear",
  noPending: "empty-no-pending",
  noPendingSeeJugadas: "empty-no-pending-see-jugadas",
  noJugadas: "empty-no-jugadas",
  noJugadasSeePendientes: "empty-no-jugadas-see-pendientes",
  adminNoOwnMatches: "empty-admin-no-own-matches",
  adminNoOwnMatchesSeeTodas: "empty-admin-no-own-matches-see-todas",
} as const;

/** `data-testid` of a block's `<details>`, e.g. `block-round-3`. */
export function blockTestId(key: string): string {
  return `block-${key}`;
}

/** `data-testid` of a block's `<summary>` — the whole header is the toggle (§4.5). */
export function blockToggleTestId(key: string): string {
  return `block-toggle-${key}`;
}

/** `data-testid` of one segmented-filter option, e.g. `status-filter-option-pendientes`. */
export function statusFilterOptionTestId(filter: StatusFilter): string {
  return `status-filter-option-${filter.toLowerCase()}`;
}

/** Visible copy the tests and the e2e assert on (§4.4, §4.5, §4.6, §5). */
export const LABELS = {
  tabMias: "Mis partidas",
  tabTodas: "Toda la liga",
  statusFilter: {
    PENDIENTES: { full: "Pendientes", short: "Pend." },
    JUGADAS: { full: "Jugadas", short: "Jug." },
    TODAS: { full: "Todas", short: "Todas" },
  } satisfies Record<StatusFilter, { full: string; short: string }>,
  searchClear: "Limpiar búsqueda",
  /** "Ninguna partida casa con «martin»" (§5). */
  noSearchResults: (query: string) => `Ninguna partida casa con «${query}»`,
  noPending: {
    PLAYER: "No te queda ninguna partida pendiente",
    LEAGUE: "No queda ninguna partida pendiente en la liga",
  } satisfies Record<"PLAYER" | "LEAGUE", string>,
  seeJugadas: "Ver jugadas",
  noJugadas: "Todavía no hay partidas jugadas",
  seePendientes: "Ver pendientes",
  adminNoOwnMatches: "No tienes partidas asignadas",
  seeTodas: "Ver todas las partidas →",
} as const;
