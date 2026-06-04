"use client";

// PlayersPageClient — thin wrapper that triggers router.refresh() after mutations
// so the Server Component fetches fresh data from DB.

import { useRouter } from "next/navigation";
import { PlayerCreateForm } from "./PlayerCreateForm";
import { PlayerList } from "./PlayerList";

interface PlayerRow {
  id: string;
  displayName: string;
  faction: string | null;
  role: "ADMIN" | "PLAYER";
  active: boolean;
}

interface PlayersPageClientProps {
  leagueId: string;
  players: PlayerRow[];
}

export function PlayersPageClient({ leagueId, players }: PlayersPageClientProps) {
  const router = useRouter();

  function handleCreated() {
    router.refresh();
  }

  return (
    <div className="space-y-8">
      <PlayerCreateForm leagueId={leagueId} onCreated={handleCreated} />
      <PlayerList players={players} />
    </div>
  );
}
