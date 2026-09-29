// Search-by-player-name matching (SPEC partidas-por-jornada §4.2, §6),
// extracted from `DaySchedulePicker.tsx:95-109` (`fold` + `matchesQuery`) so
// the calendar and this app's other consumers share one copy (§6, t03).

/**
 * NFD splits a letter into base + combining mark; the explicit range below
 * drops the marks instead of `\p{Diacritic}` because the build targets
 * ES2017 (same reason as `DaySchedulePicker.tsx:93`).
 */
export function foldText(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

export function matchesPlayerQuery(
  match: { playerHomeName: string; playerAwayName: string | null },
  query: string
): boolean {
  const needle = foldText(query.trim());
  if (needle === "") return true;
  return (
    foldText(match.playerHomeName).includes(needle) ||
    foldText(match.playerAwayName ?? "").includes(needle)
  );
}
