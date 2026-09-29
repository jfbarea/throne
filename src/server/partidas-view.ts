// Vista and status-filter domain (SPEC partidas-por-jornada §4.4, §4.6).

export type Vista = "MIAS" | "TODAS";

export function resolveVista(
  role: "ADMIN" | "PLAYER",
  param: string | string[] | undefined
): Vista {
  if (role !== "ADMIN") return "MIAS";
  const value = Array.isArray(param) ? param[0] : param;
  return value === "todas" ? "TODAS" : "MIAS";
}

export type StatusFilter = "PENDIENTES" | "JUGADAS" | "TODAS";

export const DEFAULT_STATUS_FILTER: StatusFilter = "PENDIENTES";

export function isPendingMatch(m: { status: string; result: unknown | null }): boolean {
  return m.status === "SCHEDULED" && m.result === null;
}

/**
 * `stickyPendingIds` is the "recién resueltas" set of §4.6: ids captured at
 * the moment the `PENDIENTES` filter was entered, so a match resolved while
 * it was on screen stays under `PENDIENTES` instead of vanishing on
 * revalidation. It only widens the `PENDIENTES` branch; `JUGADAS` still
 * means "has a result", full stop.
 */
export function matchesStatusFilter(
  m: { id: string; status: string; result: unknown | null },
  filter: StatusFilter,
  stickyPendingIds?: ReadonlySet<string>
): boolean {
  if (filter === "TODAS") return true;
  if (filter === "PENDIENTES") {
    return isPendingMatch(m) || (stickyPendingIds?.has(m.id) ?? false);
  }
  return !isPendingMatch(m);
}
