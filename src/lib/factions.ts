// Faction catalogue and the multi-value encoding of `Player.faction`.
//
// A player can field more than one army, so `faction` holds a *list*. There is
// no schema change behind this: SQLite has no array type and Prisma scalar
// lists are Postgres-only (same constraint documented for `League.tiebreakers`
// in prisma/schema.prisma), so the list is stored in the existing `String?`
// column joined by FACTION_SEPARATOR.
//
// The separator is a human-readable middle dot rather than JSON on purpose:
// every read-only surface that already prints `player.faction` verbatim
// (clasificacion, bracket, admin/emparejamientos, admin/playoffs) keeps
// rendering something a person wants to read ("Orks · Death Guard") instead of
// `["Orks","Death Guard"]`, and legacy free-text values written before this
// existed parse back as a single-item list untouched.
//
// The one constraint this puts on the catalogue: no faction name may contain a
// middle dot. None of the names below do, and `serialiseFactions` strips any
// that a caller sneaks in.

export interface FactionGroup {
  /** Group heading shown in the dropdown. */
  label: string;
  factions: string[];
}

/** Separator written between factions when persisting the field. */
export const FACTION_SEPARATOR = " · ";

/** Maximum number of factions a single player may declare. */
export const MAX_FACTIONS_PER_PLAYER = 6;

/** Maximum length of the serialised `Player.faction` column value. */
export const MAX_FACTION_FIELD_LENGTH = 240;

/** Maximum length of one individual faction name. */
export const MAX_FACTION_NAME_LENGTH = 80;

/**
 * The Warhammer 40.000 factions offered in the dropdown, grouped the way the
 * game groups them, in Spanish.
 *
 * Names follow the Spanish edition, which leaves a handful untranslated
 * because the Spanish edition itself does: the Latin ones the setting uses as
 * proper nouns ("Astra Militarum", "Adeptus Mechanicus", "Adepta Sororitas",
 * "Adeptus Custodes") and the xenos endonyms ("Aeldari", "Drukhari",
 * "Votann"). Everything with a Spanish form uses it.
 *
 * The catalogue is not a closed set: `Player.faction` may hold a value that is
 * not listed here (free text written before this catalogue existed, an English
 * name from before this list was translated, or a homebrew army), and the
 * selector surfaces those as removable extras rather than dropping them
 * silently.
 */
export const FACTION_GROUPS: FactionGroup[] = [
  {
    label: "Imperium",
    factions: [
      "Marines Espaciales",
      "Ángeles Sangrientos",
      "Ángeles Oscuros",
      "Lobos Espaciales",
      "Templarios Negros",
      "Vigilantes de la Muerte",
      "Caballeros Grises",
      "Adepta Sororitas",
      "Adeptus Custodes",
      "Adeptus Mechanicus",
      "Astra Militarum",
      "Caballeros Imperiales",
      "Agentes del Imperio",
    ],
  },
  {
    label: "Caos",
    factions: [
      "Marines Espaciales del Caos",
      "Guardia de la Muerte",
      "Mil Hijos",
      "Devoradores de Mundos",
      "Hijos del Emperador",
      "Demonios del Caos",
      "Caballeros del Caos",
    ],
  },
  {
    label: "Xenos",
    factions: [
      "Aeldari",
      "Drukhari",
      "Necrones",
      "Orkos",
      "Imperio T'au",
      "Tiránidos",
      "Cultos Genestealer",
      "Ligas de Votann",
    ],
  },
];

/** Flat list of every catalogued faction, in group order. */
export const ALL_FACTIONS: string[] = FACTION_GROUPS.flatMap((g) => g.factions);

const FACTION_NAME_SET = new Set(ALL_FACTIONS);

/** Whether a name belongs to the catalogue above. */
export function isKnownFaction(name: string): boolean {
  return FACTION_NAME_SET.has(name.trim());
}

/**
 * Parse the stored `Player.faction` value into the list of factions.
 *
 * Tolerant on input: splits on a middle dot with or without the surrounding
 * spaces, trims, drops empties and de-duplicates while preserving order. A
 * legacy single free-text value comes back as a one-item list; `null` and the
 * empty string come back as an empty list.
 */
export function parseFactions(raw: string | null | undefined): string[] {
  if (!raw) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const piece of raw.split(/\s*·\s*/)) {
    const name = piece.trim();
    if (name.length === 0 || seen.has(name)) continue;
    seen.add(name);
    out.push(name);
  }
  return out;
}

/**
 * Serialise a list of factions into the value stored in `Player.faction`.
 *
 * Returns `null` for an empty selection so "no faction" stays a single
 * representation in the DB (`null`, never `""`). Middle dots inside a name are
 * stripped: they would otherwise re-parse as extra factions.
 */
export function serialiseFactions(list: readonly string[]): string | null {
  const seen = new Set<string>();
  const clean: string[] = [];
  for (const item of list) {
    const name = item.replace(/·/g, "").trim();
    if (name.length === 0 || seen.has(name)) continue;
    seen.add(name);
    clean.push(name);
  }
  return clean.length > 0 ? clean.join(FACTION_SEPARATOR) : null;
}

/** Human-readable rendering of a stored value. Empty selection → `null`. */
export function formatFactions(raw: string | null | undefined): string | null {
  return serialiseFactions(parseFactions(raw));
}
