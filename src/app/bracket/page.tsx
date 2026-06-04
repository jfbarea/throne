// Bracket de playoffs — vista de árbol de eliminatoria.
// SPEC §8, §7.4. Visible a admin y jugadores (requireAuth).
// Mobile-first, dark mode, primitivos Hito 3.

import { requireAuth } from "@/lib/guards";
import { prisma } from "@/lib/db";
import { getBracket } from "@/server/playoff-actions";
import { Trophy, Sword } from "@phosphor-icons/react/dist/ssr";
import Link from "next/link";

export default async function BracketPage() {
  const session = await requireAuth();
  const isAdmin = session.role === "ADMIN";

  // Find the active/finished league.
  const league = await prisma.league.findFirst({
    where: { status: { in: ["PLAYOFFS", "FINISHED"] } },
    orderBy: { createdAt: "desc" },
  });

  if (!league) {
    return (
      <div
        className="min-h-screen flex flex-col items-center justify-center px-4"
        style={{ background: "var(--bg)", color: "var(--fg)" }}
      >
        <div
          className="text-center max-w-sm p-8 rounded-[var(--radius-sm)] border"
          style={{ borderColor: "var(--border)", background: "var(--bg-raised)" }}
        >
          <Sword size={40} style={{ color: "var(--fg-faint)" }} className="mx-auto mb-4" />
          <h1
            className="text-xl font-semibold mb-2"
            style={{ fontFamily: "var(--font-display)", color: "var(--fg)" }}
          >
            Playoffs no iniciados
          </h1>
          <p
            className="text-sm"
            style={{ color: "var(--fg-muted)", fontFamily: "var(--font-sans)" }}
          >
            La fase de playoffs aún no ha comenzado. Vuelve cuando el admin
            cierre la fase de liga.
          </p>
          {isAdmin && (
            <div className="mt-4">
              <Link
                href="/admin/playoffs"
                className="inline-block px-4 py-2 rounded-[var(--radius-sm)] text-sm font-semibold no-underline"
                style={{
                  background: "var(--accent)",
                  color: "var(--ink-900)",
                  fontFamily: "var(--font-sans)",
                }}
              >
                Ir al panel de admin
              </Link>
            </div>
          )}
        </div>
      </div>
    );
  }

  const bracket = await getBracket(league.id);

  if (!bracket) {
    return (
      <div
        className="min-h-screen flex items-center justify-center px-4"
        style={{ background: "var(--bg)", color: "var(--fg)" }}
      >
        <p style={{ color: "var(--fg-muted)", fontFamily: "var(--font-sans)" }}>
          Bracket no encontrado.
        </p>
      </div>
    );
  }

  // Group slots by round.
  const maxRound = Math.max(...bracket.slots.map((s) => s.roundIndex));
  const rounds: (typeof bracket.slots)[] = [];
  for (let r = 1; r <= maxRound; r++) {
    rounds.push(
      bracket.slots
        .filter((s) => s.roundIndex === r)
        .sort((a, b) => a.position - b.position)
    );
  }

  const champion =
    league.status === "FINISHED"
      ? bracket.slots.find((s) => s.feedsIntoSlotId === null)?.playerId
      : null;

  const championPlayer = champion
    ? await prisma.player.findUnique({
        where: { id: champion },
        select: { displayName: true, faction: true },
      })
    : null;

  const roundLabels: Record<number, string> = {};
  if (maxRound === 1) roundLabels[1] = "Final";
  else if (maxRound === 2) {
    roundLabels[1] = "Semifinales";
    roundLabels[2] = "Final";
  } else if (maxRound === 3) {
    roundLabels[1] = "Cuartos de final";
    roundLabels[2] = "Semifinales";
    roundLabels[3] = "Final";
  } else {
    for (let r = 1; r <= maxRound; r++) {
      if (r === maxRound) roundLabels[r] = "Final";
      else if (r === maxRound - 1) roundLabels[r] = "Semifinales";
      else roundLabels[r] = `Ronda ${r}`;
    }
  }

  return (
    <div
      className="min-h-screen"
      style={{ background: "var(--bg)", color: "var(--fg)" }}
    >
      {/* Header */}
      <header
        className="sticky top-0 z-10 flex items-center justify-between px-4 py-3 border-b"
        style={{
          background: "var(--bg-raised)",
          borderColor: "var(--border)",
        }}
      >
        <Link href="/" className="flex items-center gap-2 no-underline">
          <span style={{ color: "var(--accent)" }}>✦</span>
          <span
            className="text-[20px] font-semibold leading-none"
            style={{ fontFamily: "var(--font-display)", color: "var(--fg)" }}
          >
            throne
          </span>
        </Link>
        <nav className="flex items-center gap-2">
          <Link
            href="/clasificacion"
            className="text-[13px] font-semibold no-underline"
            style={{ color: "var(--fg-muted)", fontFamily: "var(--font-sans)" }}
          >
            Clasificación
          </Link>
          {isAdmin && (
            <Link
              href="/admin"
              className="text-[13px] font-semibold no-underline"
              style={{
                color: "var(--fg-muted)",
                fontFamily: "var(--font-sans)",
              }}
            >
              Admin
            </Link>
          )}
        </nav>
      </header>

      <main className="px-4 py-6 max-w-5xl mx-auto w-full">
        {/* Title */}
        <div className="mb-6">
          <p
            className="text-[11px] font-semibold uppercase tracking-[0.1em] mb-1"
            style={{ color: "var(--accent)", fontFamily: "var(--font-sans)" }}
          >
            {league.name} · {league.season}
          </p>
          <h1
            className="text-[28px] font-bold leading-tight"
            style={{ fontFamily: "var(--font-display)", color: "var(--fg)" }}
          >
            Bracket de playoffs
          </h1>
          {league.status === "FINISHED" && (
            <p
              className="text-sm mt-1"
              style={{ color: "var(--moss-500)", fontFamily: "var(--font-sans)" }}
            >
              Liga finalizada
            </p>
          )}
        </div>

        {/* Champion banner */}
        {championPlayer && (
          <div
            className="mb-8 p-4 rounded-[var(--radius-sm)] border flex items-center gap-3"
            style={{
              background: "var(--bg-raised)",
              borderColor: "var(--accent)",
            }}
          >
            <Trophy size={28} style={{ color: "var(--accent)" }} />
            <div>
              <p
                className="text-[11px] font-semibold uppercase tracking-[0.1em]"
                style={{
                  color: "var(--accent)",
                  fontFamily: "var(--font-sans)",
                }}
              >
                Campeón
              </p>
              <p
                className="text-xl font-bold"
                style={{
                  fontFamily: "var(--font-display)",
                  color: "var(--fg)",
                }}
              >
                {championPlayer.displayName}
              </p>
              {championPlayer.faction && (
                <p
                  className="text-sm"
                  style={{
                    color: "var(--fg-muted)",
                    fontFamily: "var(--font-sans)",
                  }}
                >
                  {championPlayer.faction}
                </p>
              )}
            </div>
          </div>
        )}

        {/* Bracket tree — horizontal scroll on mobile */}
        <div className="overflow-x-auto">
          <div
            className="flex gap-6 min-w-max items-start"
            style={{ minHeight: "200px" }}
          >
            {rounds.map((roundSlots, roundIdx) => {
              const roundNum = roundIdx + 1;
              return (
                <div key={roundNum} className="flex flex-col gap-0">
                  {/* Round label */}
                  <p
                    className="text-[11px] font-semibold uppercase tracking-[0.1em] mb-3 text-center"
                    style={{
                      color: "var(--fg-faint)",
                      fontFamily: "var(--font-sans)",
                    }}
                  >
                    {roundLabels[roundNum] ?? `Ronda ${roundNum}`}
                  </p>

                  {/* Slots in this round */}
                  <div
                    className="flex flex-col"
                    style={{
                      gap: `${Math.pow(2, roundIdx) * 8}px`,
                      paddingTop: `${(Math.pow(2, roundIdx) - 1) * 4}px`,
                    }}
                  >
                    {roundSlots.map((slot) => {
                      // Find the match for this slot (if any).
                      const slotMatch = slot.match[0] ?? null;
                      const isResolved = slot.playerId !== null;
                      const isChampionSlot =
                        slot.feedsIntoSlotId === null &&
                        league.status === "FINISHED";

                      return (
                        <div
                          key={slot.id}
                          className="w-48 rounded-[var(--radius-sm)] border overflow-hidden"
                          style={{
                            borderColor: isChampionSlot
                              ? "var(--accent)"
                              : isResolved
                                ? "var(--border-strong)"
                                : "var(--border)",
                            background: "var(--bg-raised)",
                          }}
                        >
                          {/* Slot header */}
                          <div
                            className="px-3 py-1 border-b flex items-center justify-between"
                            style={{
                              borderColor: "var(--border)",
                              background: isChampionSlot
                                ? "color-mix(in srgb, var(--accent) 10%, transparent)"
                                : "transparent",
                            }}
                          >
                            <span
                              className="text-[10px] font-semibold uppercase tracking-[0.08em]"
                              style={{
                                color: isChampionSlot
                                  ? "var(--accent)"
                                  : "var(--fg-faint)",
                                fontFamily: "var(--font-sans)",
                              }}
                            >
                              {slotMatch?.isBye
                                ? "Bye"
                                : `R${roundNum} · ${slot.position}`}
                            </span>
                            {slotMatch?.result && (
                              <span
                                className="text-[10px]"
                                style={{
                                  color: "var(--moss-500)",
                                  fontFamily: "var(--font-mono)",
                                }}
                              >
                                ✓
                              </span>
                            )}
                          </div>

                          {/* Players */}
                          {slotMatch ? (
                            <div>
                              <SlotPlayerRow
                                player={slotMatch.playerHome}
                                isWinner={
                                  slotMatch.result?.outcome === "HOME_WIN" ||
                                  !!slotMatch.isBye
                                }
                                vp={slotMatch.result?.homeVictoryPoints}
                                isBye={!!slotMatch.isBye}
                                seed={getSlotSeed(slot.position, 1, bracket.size)}
                              />
                              {!slotMatch.isBye && slotMatch.playerAway && (
                                <SlotPlayerRow
                                  player={slotMatch.playerAway}
                                  isWinner={
                                    slotMatch.result?.outcome === "AWAY_WIN"
                                  }
                                  vp={slotMatch.result?.awayVictoryPoints}
                                  isBye={false}
                                  seed={getSlotSeed(slot.position, 2, bracket.size)}
                                />
                              )}
                            </div>
                          ) : (
                            <div>
                              <TbdRow label={slot.playerId ? undefined : "TBD"} resolvedId={slot.playerId} />
                              <TbdRow />
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Legend */}
        <div className="mt-8 flex flex-wrap gap-4">
          <LegendItem color="var(--moss-500)" label="Ganador confirmado" />
          <LegendItem color="var(--accent)" label="Campeón / Final" />
          <LegendItem color="var(--fg-faint)" label="Bye (avance automático)" />
        </div>
      </main>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function getSlotSeed(position: number, row: 1 | 2, bracketSize: number): number {
  if (row === 1) return position;
  return bracketSize + 1 - position;
}

function SlotPlayerRow({
  player,
  isWinner,
  vp,
  isBye,
  seed,
}: {
  player: { id: string; displayName: string; faction?: string | null };
  isWinner?: boolean;
  vp?: number;
  isBye: boolean;
  seed?: number;
}) {
  return (
    <div
      className="px-3 py-1.5 flex items-center justify-between gap-2 border-b last:border-b-0"
      style={{
        borderColor: "var(--border)",
        background: isWinner
          ? "color-mix(in srgb, var(--moss-500) 8%, transparent)"
          : "transparent",
      }}
    >
      <div className="flex items-center gap-1.5 min-w-0">
        {seed !== undefined && (
          <span
            className="text-[10px] font-semibold shrink-0"
            style={{ color: "var(--fg-faint)", fontFamily: "var(--font-mono)" }}
          >
            #{seed}
          </span>
        )}
        <span
          className="text-[13px] font-semibold truncate"
          style={{
            color: isWinner ? "var(--moss-400)" : "var(--fg)",
            fontFamily: "var(--font-sans)",
          }}
        >
          {player.displayName}
        </span>
        {isBye && (
          <span
            className="text-[10px] ml-1 shrink-0"
            style={{ color: "var(--fg-faint)", fontFamily: "var(--font-sans)" }}
          >
            (bye)
          </span>
        )}
      </div>
      {vp !== undefined && (
        <span
          className="text-[12px] tabular-nums shrink-0"
          style={{
            color: isWinner ? "var(--moss-400)" : "var(--fg-muted)",
            fontFamily: "var(--font-mono)",
          }}
        >
          {vp}
        </span>
      )}
    </div>
  );
}

function TbdRow({ label = "TBD", resolvedId }: { label?: string; resolvedId?: string | null }) {
  return (
    <div
      className="px-3 py-1.5 border-b last:border-b-0"
      style={{ borderColor: "var(--border)" }}
    >
      <span
        className="text-[12px]"
        style={{ color: "var(--fg-faint)", fontFamily: "var(--font-sans)" }}
      >
        {resolvedId ? "— pendiente —" : label}
      </span>
    </div>
  );
}

function LegendItem({ color, label }: { color: string; label: string }) {
  return (
    <div className="flex items-center gap-2">
      <div
        className="w-3 h-3 rounded-full"
        style={{ background: color }}
      />
      <span
        className="text-[11px]"
        style={{ color: "var(--fg-muted)", fontFamily: "var(--font-sans)" }}
      >
        {label}
      </span>
    </div>
  );
}
