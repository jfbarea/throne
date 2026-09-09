// AppHeader — unified appbar. Non-admin sections are direct links; admin
// sections live in a dropdown (AdminMenu) shown only to admins. Resolves the
// session server-side to decide whether to render the admin dropdown.

import Link from "next/link";
import { getSession } from "@/lib/session";
import { AppHeaderUser } from "@/components/AppHeaderUser";
import { AdminMenu } from "@/components/AdminMenu";
import {
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
  | "admin";

const NAV_LINKS = [
  { href: "/mis-partidas", label: "Mis partidas", section: "mis-partidas", Icon: Sword },
  { href: "/calendario", label: "Calendario", section: "calendario", Icon: CalendarBlank },
  { href: "/rondas", label: "Rondas", section: "rondas", Icon: ListChecks },
  { href: "/clasificacion", label: "Clasificación", section: "clasificacion", Icon: ChartBar },
  { href: "/bracket", label: "Playoffs", section: "bracket", Icon: Trophy },
] as const;

export async function AppHeader({ active }: { active?: AppSection }) {
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

      {/* min-w-0 + overflow-x-auto: with 5 nav links plus the admin menu and
          the user avatar, icon-only mode on a narrow phone can outgrow the
          header's own width (PLAN.md H6, adding "Rondas" as the 5th link
          made this overflow real). If it ever doesn't fit, it scrolls
          inside the nav itself — never the page body. */}
      <nav className="flex items-center gap-1 overflow-x-auto min-w-0">
        {NAV_LINKS.map(({ href, label, section, Icon }) => (
          <Link
            key={href}
            href={href}
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
        {isAdmin && <AdminMenu active={active === "admin"} />}
        <AppHeaderUser />
      </nav>
    </header>
  );
}
