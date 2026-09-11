// AppHeader — unified appbar. Non-admin sections are direct links; admin
// sections live in a dropdown (AdminMenu) shown only to admins. Resolves the
// session server-side to decide whether to render the admin dropdown.

import Link from "next/link";
import { getSession } from "@/lib/session";
import { AppHeaderUser } from "@/components/AppHeaderUser";
import { AdminMenu } from "@/components/AdminMenu";
import {
  BookOpenText,
  CalendarBlank,
  ChartBar,
  ListChecks,
  Sword,
  Trophy,
} from "@phosphor-icons/react/dist/ssr";

export type AppSection =
  | "mis-partidas"
  | "calendario"
  | "rondas"
  | "clasificacion"
  | "bracket"
  | "guia"
  | "admin";

// Multi-liga B1 (indice-de-ligas-y-pantallas-con-slug, spec §4.10): these
// five sections live under `/liga/<slug>/...` now, so their href is built
// from the league of the current context rather than hardcoded.
const NAV_SECTIONS = [
  { section: "mis-partidas", label: "Mis partidas", Icon: Sword },
  { section: "calendario", label: "Calendario", Icon: CalendarBlank },
  { section: "rondas", label: "Rondas", Icon: ListChecks },
  { section: "clasificacion", label: "Clasificación", Icon: ChartBar },
  { section: "bracket", label: "Playoffs", Icon: Trophy },
] as const;

// `/guia` carries no league (spec §3: it documents the product, not a
// league's rules) and is never slug-prefixed — spec §4.10 keeps it in the
// header "tal cual".
const GUIA_LINK = { href: "/guia", label: "Guía", section: "guia", Icon: BookOpenText } as const;

/**
 * Build a player-facing nav link's href. With a known `leagueSlug` (the
 * caller already resolved one — e.g. a page under `/liga/[slug]` or
 * `/admin/[slug]`, spec §2.3, §4.10) it points straight into that league.
 * Without one (`/guia`, `/mi-perfil`, or an ADMIN session with no league in
 * context yet) it falls back to the old unslugged route, which resolves via
 * the session-based redirect every one of these routes keeps (spec §4.3,
 * §5.10, lane A) — a player lands on their own league, an admin on `/admin`,
 * so the link is always correct even without knowing the slug up front.
 */
export function buildNavHref(section: string, leagueSlug?: string): string {
  return leagueSlug ? `/liga/${leagueSlug}/${section}` : `/${section}`;
}

export async function AppHeader({
  active,
  leagueSlug,
}: {
  active?: AppSection;
  /** The league of the current page's context, if any (spec §2.3, §4.10) —
   * threaded through by whichever page/layout already resolved it (lane A's
   * `/liga/[slug]` pages, this lane's `/admin/[slug]` pages). Never derived
   * here: this component makes zero extra queries, same convention as
   * `resolveLeagueBySlug`'s callers. */
  leagueSlug?: string;
}) {
  const session = await getSession();
  const isAdmin = session?.role === "ADMIN";

  return (
    <header
      className="sticky top-0 z-10 flex items-center justify-between px-4 py-3 border-b"
      style={{ background: "var(--bg-raised)", borderColor: "var(--border)" }}
    >
      <Link href="/" className="flex items-center gap-2 no-underline flex-shrink-0">
        <span style={{ color: "var(--accent)" }}>✦</span>
        <span
          className="text-[20px] font-semibold leading-none"
          style={{ fontFamily: "var(--font-display)", color: "var(--fg)" }}
        >
          throne
        </span>
      </Link>

      {/* The scrollable region wraps ONLY the plain links.
          `overflow-x-auto` is needed because with 6 nav links plus the admin
          menu and the user avatar, icon-only mode on a narrow phone can
          outgrow the header's own width (PLAN.md H6, adding "Rondas" as the
          5th link made this overflow real; H12 added "Guía" as the 6th,
          verified against the same overflow test) — it scrolls inside
          itself, never the page body.
          But `AdminMenu` and `AppHeaderUser` MUST stay outside it: both open
          an `absolute`-positioned dropdown, and declaring `overflow-x` makes
          the vertical axis compute from `visible` to `auto` (CSS overflow
          spec), so an ancestor with `overflow-x-auto` clips the panel inside
          a ~40px-tall strip — the dropdowns opened but were invisible. */}
      <div className="flex items-center gap-1 min-w-0">
        <nav className="flex items-center gap-1 overflow-x-auto min-w-0">
          {NAV_SECTIONS.map(({ section, label, Icon }) => (
            <Link
              key={section}
              href={buildNavHref(section, leagueSlug)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded text-[13px] font-semibold transition-colors duration-[120ms] no-underline flex-shrink-0"
              style={{
                fontFamily: "var(--font-sans)",
                color: active === section ? "var(--accent)" : "var(--fg-muted)",
              }}
            >
              <Icon size={14} />
              <span className="hidden sm:inline">{label}</span>
            </Link>
          ))}
          <Link
            href={GUIA_LINK.href}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded text-[13px] font-semibold transition-colors duration-[120ms] no-underline flex-shrink-0"
            style={{
              fontFamily: "var(--font-sans)",
              color: active === GUIA_LINK.section ? "var(--accent)" : "var(--fg-muted)",
            }}
          >
            <GUIA_LINK.Icon size={14} />
            <span className="hidden sm:inline">{GUIA_LINK.label}</span>
          </Link>
        </nav>
        {isAdmin && (
          <AdminMenu active={active === "admin"} leagueSlug={leagueSlug} />
        )}
        <AppHeaderUser />
      </div>
    </header>
  );
}
