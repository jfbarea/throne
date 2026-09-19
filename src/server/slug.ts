// Pure slug helpers — no DB access, no imports beyond the standard library.
// multi-liga spec §2.6, §4.6: League.slug is a kebab-case ASCII identifier
// derived from `name` + `season`, unique across all leagues, with a numeric
// suffix on collision. No history is kept: recomputing the slug on rename is
// this module's caller's job (updateLeague, lane B), not this module's.

// Unicode range of combining diacritical marks (U+0300-U+036F). NFD
// normalization splits an accented letter into base letter + one of these
// marks (e.g. "í" -> "i" + U+0301), so stripping this range after NFD
// removes the accent while keeping the base ASCII letter.
const COMBINING_MARKS_RE = /[\u0300-\u036f]/g;

/**
 * Turn a league's `name` and `season` into a kebab-case ASCII slug:
 * lowercase, no diacritics, non-alphanumeric runs collapsed to a single "-",
 * no leading/trailing "-".
 *
 * `slugify("Liga de los Martes", "Primavera 2026")` ->
 * `"liga-de-los-martes-primavera-2026"` (spec criterio 19).
 */
export function slugify(name: string, season: string): string {
  const combined = `${name} ${season}`;
  return combined
    .normalize("NFD")
    .replace(COMBINING_MARKS_RE, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Given a candidate base slug and the set of slugs already in use, return a
 * slug guaranteed not to collide: the base itself if free, otherwise
 * `${base}-2`, `${base}-3`, ... -- the first suffix not already taken (spec
 * criterio 20, §4.6, §5.5).
 *
 * `taken` accepts anything iterable of strings (array, Set, ...) so callers
 * don't need to build a Set just to call this.
 */
export function uniqueSlug(base: string, taken: Iterable<string>): string {
  const takenSet = taken instanceof Set ? taken : new Set(taken);

  if (!takenSet.has(base)) {
    return base;
  }

  let suffix = 2;
  while (takenSet.has(`${base}-${suffix}`)) {
    suffix += 1;
  }
  return `${base}-${suffix}`;
}
