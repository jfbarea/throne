"use client";

// `page.tsx` must mount this component without a `vista`-keyed remount: the
// search text and the status filter rely on React preserving this
// component's identity across a tab switch (PLAN.md t01). Only the collapse
// map and the sticky-pending set are reset here when `vista` changes.

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { CaretRight, MagnifyingGlass, X } from "@phosphor-icons/react";
import { Button } from "@/components";
import { MatchCard } from "./MatchCard";
import { matchesPlayerQuery } from "@/server/match-search";
import {
  isPendingMatch,
  matchesStatusFilter,
  DEFAULT_STATUS_FILTER,
  type StatusFilter,
} from "@/server/partidas-view";
import {
  LABELS,
  TEST_IDS,
  blockTestId,
  blockToggleTestId,
  statusFilterOptionTestId,
  type BrowserBlock,
  type PartidasBrowserProps,
} from "./browser-contract";

type OpenMap = Record<string, boolean>;

function isOpenByDefault(block: BrowserBlock, currentBlockKey: string | null): boolean {
  return block.kind === "ROUND" && block.key === currentBlockKey;
}

function computeInitialOpenMap(
  blocks: BrowserBlock[],
  currentBlockKey: string | null
): OpenMap {
  const map: OpenMap = {};
  for (const block of blocks) {
    map[block.key] = isOpenByDefault(block, currentBlockKey);
  }
  return map;
}

function withDefaultsForNewBlocks(
  prevOpenMap: OpenMap,
  blocks: BrowserBlock[],
  currentBlockKey: string | null
): OpenMap {
  const next: OpenMap = {};
  for (const block of blocks) {
    next[block.key] =
      block.key in prevOpenMap
        ? prevOpenMap[block.key]
        : isOpenByDefault(block, currentBlockKey);
  }
  return next;
}

function capturePendingIds(blocks: BrowserBlock[]): Set<string> {
  const ids = new Set<string>();
  for (const block of blocks) {
    for (const match of block.matches) {
      if (isPendingMatch(match)) ids.add(match.id);
    }
  }
  return ids;
}

function countLabel(total: number, visible: number): string {
  const word = (n: number) => `${n} partida${n === 1 ? "" : "s"}`;
  return visible === total ? word(total) : `${visible} de ${word(total)}`;
}

// `subtitle` is `""` for UNASSIGNED/LEGACY (`src/server/partidas-blocks.ts`).
function blockHeaderText(
  block: Pick<BrowserBlock, "title" | "subtitle">,
  count: string
): string {
  return [block.title, block.subtitle, count].filter((part) => part !== "").join(" · ");
}

const STATUS_FILTER_ORDER: StatusFilter[] = ["PENDIENTES", "JUGADAS", "TODAS"];

export function PartidasBrowser({
  blocks,
  currentBlockKey,
  currentPlayerId,
  isAdmin,
  vista,
  scope,
}: PartidasBrowserProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>(
    DEFAULT_STATUS_FILTER
  );
  const [openMap, setOpenMap] = useState<OpenMap>(() =>
    computeInitialOpenMap(blocks, currentBlockKey)
  );
  const [stickyPendingIds, setStickyPendingIds] = useState<Set<string>>(() =>
    capturePendingIds(blocks)
  );
  const [savedOpenMap, setSavedOpenMap] = useState<OpenMap | null>(null);

  const prevVistaRef = useRef(vista);
  const didMountRef = useRef(false);

  useLayoutEffect(() => {
    if (!didMountRef.current) {
      didMountRef.current = true;
      return;
    }
    if (vista !== prevVistaRef.current) {
      prevVistaRef.current = vista;
      setOpenMap(computeInitialOpenMap(blocks, currentBlockKey));
      setStickyPendingIds(capturePendingIds(blocks));
      setSavedOpenMap(
        searchQuery.trim() === ""
          ? null
          : computeInitialOpenMap(blocks, currentBlockKey)
      );
    } else {
      setOpenMap((prev) => withDefaultsForNewBlocks(prev, blocks, currentBlockKey));
      setSavedOpenMap((prev) =>
        prev === null ? null : withDefaultsForNewBlocks(prev, blocks, currentBlockKey)
      );
    }
    // `currentBlockKey` and `searchQuery` read their value as of this render
    // on purpose but must not retrigger the effect by themselves — only a
    // `vista`/`blocks` change (a tab switch or a revalidation) should.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blocks, vista]);

  useHeaderHeightVar();

  const trimmedQuery = searchQuery.trim();
  const searchActive = trimmedQuery !== "";

  function handleSearchChange(value: string) {
    const wasActive = searchQuery.trim() !== "";
    const isActive = value.trim() !== "";
    if (!wasActive && isActive) {
      setSavedOpenMap(openMap);
    } else if (wasActive && !isActive) {
      if (savedOpenMap !== null) setOpenMap(savedOpenMap);
      setSavedOpenMap(null);
    }
    setSearchQuery(value);
  }

  function handleStatusFilterChange(next: StatusFilter) {
    if (next === statusFilter) return;
    if (next === "PENDIENTES") setStickyPendingIds(capturePendingIds(blocks));
    setStatusFilter(next);
  }

  function toggleBlock(key: string) {
    // No-op while searching, on purpose: every rendered block is forced
    // open then, and its `open` prop would just overwrite the toggle.
    if (searchActive) return;
    setOpenMap((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  const visibility = blocks.map((block) => {
    const statusFiltered = block.matches.filter((m) =>
      matchesStatusFilter(m, statusFilter, stickyPendingIds)
    );
    const visible = searchActive
      ? statusFiltered.filter((m) => matchesPlayerQuery(m, trimmedQuery))
      : statusFiltered;
    return { block, visible };
  });

  const renderedBlocks = visibility.filter((v) => v.visible.length > 0);
  const totalVisible = visibility.reduce((sum, v) => sum + v.visible.length, 0);

  let content: ReactNode;
  if (searchActive && totalVisible === 0) {
    content = (
      <EmptyBanner testId={TEST_IDS.noSearchResults}>
        <p>{LABELS.noSearchResults(trimmedQuery)}</p>
        <Button
          variant="ghost"
          size="sm"
          data-testid={TEST_IDS.noSearchResultsClear}
          onClick={() => handleSearchChange("")}
        >
          {LABELS.searchClear}
        </Button>
      </EmptyBanner>
    );
  } else if (!searchActive && statusFilter === "PENDIENTES" && totalVisible === 0) {
    content = (
      <EmptyBanner testId={TEST_IDS.noPending}>
        <p>{LABELS.noPending[scope]}</p>
        <Button
          variant="ghost"
          size="sm"
          data-testid={TEST_IDS.noPendingSeeJugadas}
          onClick={() => handleStatusFilterChange("JUGADAS")}
        >
          {LABELS.seeJugadas}
        </Button>
      </EmptyBanner>
    );
  } else if (!searchActive && statusFilter === "JUGADAS" && totalVisible === 0) {
    content = (
      <EmptyBanner testId={TEST_IDS.noJugadas}>
        <p>{LABELS.noJugadas}</p>
        <Button
          variant="ghost"
          size="sm"
          data-testid={TEST_IDS.noJugadasSeePendientes}
          onClick={() => handleStatusFilterChange("PENDIENTES")}
        >
          {LABELS.seePendientes}
        </Button>
      </EmptyBanner>
    );
  } else {
    content = (
      <div className="space-y-6">
        {renderedBlocks.map(({ block, visible }) => {
          const isOpen = searchActive ? true : (openMap[block.key] ?? false);
          return (
            <details
              key={block.key}
              open={isOpen}
              data-testid={blockTestId(block.key)}
              className="rounded"
              style={{ border: "1px solid var(--border)" }}
            >
              <summary
                data-testid={blockToggleTestId(block.key)}
                onClick={(e) => {
                  e.preventDefault();
                  toggleBlock(block.key);
                }}
                className="flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-3 select-none [&::-webkit-details-marker]:hidden"
                style={{ color: "var(--fg)", fontFamily: "var(--font-sans)" }}
              >
                <span className="min-w-0 flex-1 text-[13px] font-semibold break-words">
                  {blockHeaderText(
                    block,
                    countLabel(block.matches.length, visible.length)
                  )}
                </span>
                <span
                  className="flex-shrink-0 transition-transform duration-[120ms]"
                  style={{
                    color: "var(--fg-faint)",
                    transform: isOpen ? "rotate(90deg)" : "rotate(0deg)",
                  }}
                >
                  <CaretRight size={14} />
                </span>
              </summary>
              {isOpen && (
                <div className="space-y-3 px-3 pb-3">
                  {visible.map((match) => (
                    <MatchCard
                      key={match.id}
                      match={match}
                      currentPlayerId={currentPlayerId}
                      isAdmin={isAdmin}
                    />
                  ))}
                </div>
              )}
            </details>
          );
        })}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div
        data-testid="partidas-search-row"
        className="sticky z-[5] -mx-4 flex items-center gap-2 border-b px-4 py-2 sm:mx-0 sm:rounded sm:border"
        style={{
          top: "var(--app-header-height, 0px)",
          background: "var(--bg)",
          borderColor: "var(--border)",
        }}
      >
        <div
          className="flex min-w-0 flex-1 items-center gap-2 rounded px-3 py-[8px]"
          style={{ background: "var(--bg-raised)", border: "1px solid var(--border)" }}
        >
          <span style={{ color: "var(--fg-faint)" }}>
            <MagnifyingGlass size={15} />
          </span>
          <input
            type="search"
            value={searchQuery}
            onChange={(e) => handleSearchChange(e.target.value)}
            placeholder="Buscar por jugador"
            aria-label="Buscar partida por jugador"
            data-testid={TEST_IDS.searchInput}
            className="min-h-[24px] w-full min-w-0 flex-1 border-0 bg-transparent text-[14px] outline-none"
            style={{ color: "var(--fg)", fontFamily: "var(--font-sans)" }}
          />
          {searchQuery !== "" && (
            <button
              type="button"
              aria-label={LABELS.searchClear}
              data-testid={TEST_IDS.searchClear}
              onClick={() => handleSearchChange("")}
              className="flex flex-shrink-0 cursor-pointer items-center"
              style={{ color: "var(--fg-faint)", background: "transparent", border: "none" }}
            >
              <X size={14} />
            </button>
          )}
        </div>

        <div
          role="group"
          aria-label="Filtro de estado"
          data-testid={TEST_IDS.statusFilter}
          className="flex flex-shrink-0 gap-1"
        >
          {STATUS_FILTER_ORDER.map((filter) => {
            const active = statusFilter === filter;
            const labels = LABELS.statusFilter[filter];
            return (
              <button
                key={filter}
                type="button"
                aria-pressed={active}
                aria-label={labels.full}
                data-testid={statusFilterOptionTestId(filter)}
                onClick={() => handleStatusFilterChange(filter)}
                className="cursor-pointer rounded px-2 py-[7px] text-[12px] font-semibold whitespace-nowrap transition-colors duration-[120ms]"
                style={{
                  fontFamily: "var(--font-sans)",
                  background: active ? "var(--accent)" : "transparent",
                  color: active ? "var(--ink-900)" : "var(--fg-muted)",
                  border: `1px solid ${active ? "var(--accent)" : "var(--border-strong)"}`,
                }}
              >
                <span className="hidden min-[400px]:inline">{labels.full}</span>
                <span className="min-[400px]:hidden">{labels.short}</span>
              </button>
            );
          })}
        </div>
      </div>

      {content}
    </div>
  );
}

function EmptyBanner({
  testId,
  children,
}: {
  testId: string;
  children: ReactNode;
}) {
  return (
    <div
      data-testid={testId}
      className="space-y-3 rounded p-6 text-center"
      style={{ background: "var(--surface)", border: "1px solid var(--border)" }}
    >
      <div
        className="text-[14px] font-semibold"
        style={{ color: "var(--fg-muted)", fontFamily: "var(--font-sans)" }}
      >
        {children}
      </div>
    </div>
  );
}

// Assumes the document has exactly one `<header>` element — `AppHeader`
// (`src/components/AppHeader.tsx:42`), always `sticky top-0 z-10` and
// mounted once per page.
function useHeaderHeightVar() {
  useEffect(() => {
    const header = document.querySelector("header");
    if (!header) return;
    const root = document.documentElement;

    const applyHeight = () => {
      root.style.setProperty(
        "--app-header-height",
        `${header.getBoundingClientRect().height}px`
      );
    };
    applyHeight();

    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", applyHeight);
      return () => window.removeEventListener("resize", applyHeight);
    }
    const observer = new ResizeObserver(applyHeight);
    observer.observe(header);
    return () => observer.disconnect();
  }, []);
}
