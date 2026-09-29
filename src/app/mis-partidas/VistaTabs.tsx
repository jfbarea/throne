"use client";

import Link from "next/link";
import { LABELS, TEST_IDS, type VistaTabsProps } from "./browser-contract";

function tabClassName(active: boolean): string {
  return `px-3 py-1.5 rounded text-[13px] font-semibold transition-colors duration-[120ms] no-underline ${
    active ? "" : "border"
  }`;
}

// Deliberately not sticky (SPEC §4.5): only the search-and-filter row below
// pins under `AppHeader`, so this scrolls away with the rest of the page.
export function VistaTabs({ vista }: VistaTabsProps) {
  const miasActive = vista === "MIAS";
  const todasActive = vista === "TODAS";

  return (
    <nav className="flex gap-2" aria-label="Vista de partidas">
      <Link
        href="/mis-partidas"
        data-testid={TEST_IDS.tabMias}
        aria-current={miasActive ? "page" : undefined}
        className={tabClassName(miasActive)}
        style={{
          fontFamily: "var(--font-sans)",
          background: miasActive ? "var(--accent)" : "transparent",
          borderColor: "var(--border-strong)",
          color: miasActive ? "var(--bg)" : "var(--fg-muted)",
        }}
      >
        {LABELS.tabMias}
      </Link>
      <Link
        href="/mis-partidas?vista=todas"
        data-testid={TEST_IDS.tabTodas}
        aria-current={todasActive ? "page" : undefined}
        className={tabClassName(todasActive)}
        style={{
          fontFamily: "var(--font-sans)",
          background: todasActive ? "var(--accent)" : "transparent",
          borderColor: "var(--border-strong)",
          color: todasActive ? "var(--bg)" : "var(--fg-muted)",
        }}
      >
        {LABELS.tabTodas}
      </Link>
    </nav>
  );
}
