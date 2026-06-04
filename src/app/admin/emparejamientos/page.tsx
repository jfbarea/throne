// Admin > Emparejamientos — generate league pairings.
// Server Component: loads league, players and current matches from DB.
// Protected by AdminLayout (requireAdmin called in layout).

import { prisma } from "@/lib/db";
import { Eyebrow } from "@/components/Eyebrow";
import { Card } from "@/components/Card";
import { Badge } from "@/components/Badge";
import { GenerateButton } from "./GenerateButton";
import { SyncButton } from "./SyncButton";
import { expectedPairingCount, missingPairings } from "@/server/pairings";
import Link from "next/link";
import { Users, CalendarBlank } from "@phosphor-icons/react/dist/ssr";

export default async function AdminEmparejamientosPage() {
  // MVP: single active league.
  const league = await prisma.league.findFirst({
    orderBy: { createdAt: "desc" },
    include: {
      _count: {
        select: { players: { where: { active: true } } },
      },
    },
  });

  if (!league) {
    return (
      <div className="space-y-6">
        <div>
          <Eyebrow>Administración · Emparejamientos</Eyebrow>
          <h1
            className="mt-2 text-[28px] font-semibold leading-tight"
            style={{ fontFamily: "var(--font-display)", color: "var(--fg)" }}
          >
            Emparejamientos de liga
          </h1>
        </div>
        <Card className="text-center py-10">
          <p
            className="text-[15px] font-semibold"
            style={{ color: "var(--fg-muted)", fontFamily: "var(--font-sans)" }}
          >
            No hay ninguna liga creada
          </p>
          <p
            className="mt-1 text-[13px]"
            style={{ color: "var(--fg-faint)", fontFamily: "var(--font-sans)" }}
          >
            Primero{" "}
            <Link href="/admin/liga" style={{ color: "var(--accent)" }}>
              crea una liga
            </Link>{" "}
            y{" "}
            <Link href="/admin/jugadores" style={{ color: "var(--accent)" }}>
              añade jugadores
            </Link>
            .
          </p>
        </Card>
      </div>
    );
  }

  const activePlayers = await prisma.player.findMany({
    where: { leagueId: league.id, active: true },
    select: { id: true, displayName: true, faction: true },
    orderBy: { displayName: "asc" },
  });

  // Select playerHomeId and playerAwayId (IDs) in addition to display names so
  // we can feed them to missingPairings without an extra DB query.
  const leagueMatches = await prisma.match.findMany({
    where: { leagueId: league.id, phase: "LEAGUE" },
    select: {
      id: true,
      status: true,
      scheduledAt: true,
      location: true,
      playerHomeId: true,
      playerAwayId: true,
      playerHome: { select: { displayName: true } },
      playerAway: { select: { displayName: true } },
    },
    orderBy: [{ scheduledAt: "asc" }, { createdAt: "asc" }],
  });

  // Hito 15: block regeneration if any match has a result (REPORTED or CONFIRMED legacy).
  const confirmedCount = leagueMatches.filter(
    (m) => m.status === "REPORTED" || m.status === "CONFIRMED"
  ).length;
  const hasConfirmedMatches = confirmedCount > 0;
  const activePlayerCount = activePlayers.length;
  const expectedCount = expectedPairingCount(activePlayerCount);

  // Compute missing pairings using the already-loaded data — no extra DB query.
  // activePlayers already has {id, displayName}, which matches PairingPlayer.
  // leagueMatches already carries playerHomeId / playerAwayId.
  // playerAwayId is nullable in the schema (playoff byes have no away player).
  // League matches always have an away player, but we guard with filter to be safe.
  const existingPairs = leagueMatches
    .filter((m): m is typeof m & { playerAwayId: string } => m.playerAwayId !== null)
    .map((m) => ({
      aId: m.playerHomeId,
      bId: m.playerAwayId,
    }));
  const missingCount = missingPairings(activePlayers, existingPairs).length;

  // Hito 15: REPORTED = "Jugada" (new flow). CONFIRMED/DISPUTED = legacy labels.
  const STATUS_LABEL: Record<
    string,
    {
      label: string;
      variant: "brass" | "moss" | "ash" | "ember" | "neutral";
    }
  > = {
    SCHEDULED: { label: "Pendiente", variant: "neutral" },
    REPORTED: { label: "Jugada", variant: "brass" },
    CONFIRMED: { label: "Confirmada", variant: "moss" },
    DISPUTED: { label: "Disputada", variant: "ember" },
  };

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <Eyebrow>Administración · Emparejamientos</Eyebrow>
        <h1
          className="mt-2 text-[28px] font-semibold leading-tight"
          style={{ fontFamily: "var(--font-display)", color: "var(--fg)" }}
        >
          Emparejamientos de liga
        </h1>
        <p
          className="mt-1 text-[13px]"
          style={{ color: "var(--fg-muted)", fontFamily: "var(--font-sans)" }}
        >
          {league.name} · {league.season}
        </p>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <Card className="text-center">
          <div className="flex items-center justify-center gap-1 mb-1">
            <Users size={14} style={{ color: "var(--fg-faint)" }} />
          </div>
          <p
            className="text-[28px] font-bold leading-none"
            style={{ fontFamily: "var(--font-display)", color: "var(--accent)" }}
          >
            {activePlayerCount}
          </p>
          <p
            className="mt-1 text-[11px] font-semibold uppercase tracking-[0.08em]"
            style={{ color: "var(--fg-faint)", fontFamily: "var(--font-sans)" }}
          >
            Jugadores activos
          </p>
        </Card>
        <Card className="text-center">
          <div className="flex items-center justify-center gap-1 mb-1">
            <CalendarBlank size={14} style={{ color: "var(--fg-faint)" }} />
          </div>
          <p
            className="text-[28px] font-bold leading-none"
            style={{ fontFamily: "var(--font-display)", color: "var(--accent)" }}
          >
            {leagueMatches.length}
          </p>
          <p
            className="mt-1 text-[11px] font-semibold uppercase tracking-[0.08em]"
            style={{ color: "var(--fg-faint)", fontFamily: "var(--font-sans)" }}
          >
            Partidas generadas
          </p>
        </Card>
        <Card className="text-center col-span-2 sm:col-span-1">
          <p
            className="text-[28px] font-bold leading-none"
            style={{ fontFamily: "var(--font-display)", color: "var(--fg-muted)" }}
          >
            {expectedCount}
          </p>
          <p
            className="mt-1 text-[11px] font-semibold uppercase tracking-[0.08em]"
            style={{ color: "var(--fg-faint)", fontFamily: "var(--font-sans)" }}
          >
            Partidas esperadas (C({activePlayerCount},2))
          </p>
        </Card>
      </div>

      {/* Generate action (regenerate — deletes everything) */}
      <Card featured>
        <p
          className="text-[15px] font-semibold mb-3"
          style={{ fontFamily: "var(--font-sans)", color: "var(--fg)" }}
        >
          Generar emparejamientos round-robin
        </p>
        <p
          className="text-[13px] mb-4"
          style={{ color: "var(--fg-muted)", fontFamily: "var(--font-sans)" }}
        >
          Se generarán todos los pares únicos entre los {activePlayerCount}{" "}
          jugadores activos: exactamente{" "}
          <strong style={{ color: "var(--fg)" }}>{expectedCount} partidas</strong>
          . Cada jugador se enfrenta a cada otro una vez. Las partidas nacen sin
          fecha (se acuerdan libremente después).
        </p>

        {activePlayerCount < 2 ? (
          <p
            className="text-[13px] rounded p-3"
            style={{
              background: "rgba(220,85,0,0.10)",
              border: "1px solid rgba(220,85,0,0.25)",
              color: "var(--danger)",
              fontFamily: "var(--font-sans)",
            }}
          >
            Se necesitan al menos 2 jugadores activos.{" "}
            <Link href="/admin/jugadores" style={{ color: "var(--accent)" }}>
              Añadir jugadores →
            </Link>
          </p>
        ) : (
          <GenerateButton
            leagueId={league.id}
            hasConfirmedMatches={hasConfirmedMatches}
            currentMatchCount={leagueMatches.length}
          />
        )}
      </Card>

      {/* Sync action (incremental — safe when league is in progress) */}
      <Card>
        <p
          className="text-[15px] font-semibold mb-3"
          style={{ fontFamily: "var(--font-sans)", color: "var(--fg)" }}
        >
          Añadir los que faltan
        </p>
        <p
          className="text-[13px] mb-1"
          style={{ color: "var(--fg-muted)", fontFamily: "var(--font-sans)" }}
        >
          Opción segura cuando la liga ya está en marcha. Añade{" "}
          <strong style={{ color: "var(--fg)" }}>
            {missingCount === 0
              ? "0 partidas"
              : `${missingCount} partida${missingCount !== 1 ? "s" : ""}`}
          </strong>{" "}
          que faltan entre los jugadores activos actuales.{" "}
          <strong style={{ color: "var(--fg)" }}>
            No borra nada
          </strong>
          : las fechas acordadas, resultados y partidas existentes se conservan
          intactos.
        </p>
        <p
          className="text-[12px] mb-4"
          style={{ color: "var(--fg-faint)", fontFamily: "var(--font-sans)" }}
        >
          Útil cuando se da de alta a un jugador nuevo a mitad de temporada.
          Funciona aunque ya haya partidas confirmadas.
        </p>

        {activePlayerCount < 2 ? (
          <p
            className="text-[13px] rounded p-3"
            style={{
              background: "rgba(220,85,0,0.10)",
              border: "1px solid rgba(220,85,0,0.25)",
              color: "var(--danger)",
              fontFamily: "var(--font-sans)",
            }}
          >
            Se necesitan al menos 2 jugadores activos.
          </p>
        ) : (
          <SyncButton leagueId={league.id} missingCount={missingCount} />
        )}
      </Card>

      {/* Player list for reference */}
      {activePlayers.length > 0 && (
        <div>
          <Eyebrow>Jugadores activos</Eyebrow>
          <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2">
            {activePlayers.map((p) => (
              <Card key={p.id} className="flex items-center gap-3 py-3">
                <div
                  className="w-8 h-8 flex-shrink-0 rounded-full flex items-center justify-center text-[12px] font-bold"
                  style={{
                    background: "rgba(201,166,107,0.15)",
                    color: "var(--accent)",
                    fontFamily: "var(--font-sans)",
                  }}
                >
                  {p.displayName.charAt(0).toUpperCase()}
                </div>
                <div className="min-w-0">
                  <p
                    className="text-[14px] font-semibold truncate"
                    style={{ fontFamily: "var(--font-sans)", color: "var(--fg)" }}
                  >
                    {p.displayName}
                  </p>
                  {p.faction && (
                    <p
                      className="text-[12px] truncate"
                      style={{
                        color: "var(--fg-faint)",
                        fontFamily: "var(--font-sans)",
                      }}
                    >
                      {p.faction}
                    </p>
                  )}
                </div>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* Current match list */}
      {leagueMatches.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <Eyebrow>Partidas de liga</Eyebrow>
            <Link
              href="/calendario"
              className="text-[12px] no-underline"
              style={{ color: "var(--accent)", fontFamily: "var(--font-sans)" }}
            >
              Ver calendario →
            </Link>
          </div>
          <div className="space-y-2">
            {leagueMatches.map((m) => {
              const st =
                STATUS_LABEL[m.status] ?? {
                  label: m.status,
                  variant: "neutral" as const,
                };
              return (
                <Card key={m.id} className="flex items-center justify-between gap-4 py-3">
                  <div className="min-w-0 flex-1">
                    <p
                      className="text-[14px] font-semibold"
                      style={{
                        fontFamily: "var(--font-sans)",
                        color: "var(--fg)",
                      }}
                    >
                      {m.playerHome.displayName}
                      <span
                        className="mx-2 font-normal"
                        style={{ color: "var(--fg-faint)" }}
                      >
                        vs
                      </span>
                      {m.playerAway?.displayName ?? "—"}
                    </p>
                    {m.scheduledAt ? (
                      <p
                        className="mt-0.5 text-[12px]"
                        style={{
                          color: "var(--fg-faint)",
                          fontFamily: "var(--font-sans)",
                        }}
                      >
                        {new Date(m.scheduledAt).toLocaleDateString("es-ES", {
                          day: "numeric",
                          month: "long",
                          year: "numeric",
                        })}
                        {m.location ? ` · ${m.location}` : ""}
                      </p>
                    ) : (
                      <p
                        className="mt-0.5 text-[12px]"
                        style={{
                          color: "var(--fg-faint)",
                          fontFamily: "var(--font-sans)",
                        }}
                      >
                        Sin fecha
                      </p>
                    )}
                  </div>
                  <Badge variant={st.variant} className="flex-shrink-0">
                    {st.label}
                  </Badge>
                </Card>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
