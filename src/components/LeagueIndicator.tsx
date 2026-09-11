// LeagueIndicator — small banner showing which league the current request is
// scoped to. multi-liga spec §4.10: "la cabecera muestra en qué liga estás" —
// informative for a player, and what keeps the admin from acting on the
// wrong league when jumping between them (§2.3).
//
// Deliberately its OWN component, not folded into AppHeader (owned by lane
// B, which will make AppHeader's own links slug-aware): this only needs to
// render underneath it, in the two new `[slug]` layouts (multi-liga C2,
// andamiaje-de-rutas). Lane B/D may later decide it belongs inside
// AppHeader instead — that's a UI call for whoever builds the real pages,
// not a cimientos decision.

import { Badge } from "@/components/Badge";

interface LeagueIndicatorProps {
  name: string;
  season: string;
  archivedAt: Date | null;
}

export function LeagueIndicator({
  name,
  season,
  archivedAt,
}: LeagueIndicatorProps) {
  return (
    <div
      className="flex items-center justify-between gap-3 px-4 py-2 border-b text-[13px]"
      style={{
        background: "var(--bg-raised)",
        borderColor: "var(--border)",
        color: "var(--fg-muted)",
        fontFamily: "var(--font-sans)",
      }}
    >
      <span className="truncate">
        <span style={{ color: "var(--fg-faint)" }}>Liga:</span>{" "}
        <span style={{ color: "var(--fg)", fontWeight: 600 }}>{name}</span>
        {" · "}
        {season}
      </span>
      {archivedAt !== null && <Badge variant="ash">Archivada</Badge>}
    </div>
  );
}
