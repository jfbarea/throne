// Default `rulesMarkdown` template for a newly created League.
// multi-liga spec §2.11, §4.11 — "hybrid model": the page is composed of
// three kinds of content, only one of which lives in this string:
//
//  1. Fixed page chrome (masthead, "Formato" section) — same for every
//     league, hardcoded in src/app/liga/[slug]/bases/rules-content.tsx. Not
//     League config, not admin-editable prose: it's product behaviour, true
//     regardless of which league you're looking at.
//  2. Generated ("Puntuación" section's numbers) — scoring, bonus, the real
//     tiebreaker order and the playoff cutoff, read live from the League row
//     at render time (src/app/liga/[slug]/bases/rules-content.tsx). Never
//     duplicated here, so it can never drift from what computeStandings
//     actually does (spec §4.11).
//  3. Free-form prose (THIS constant) — Ejércitos, Incidencias, Convivencia.
//     The admin edits this per league via `/admin/[slug]/bases`
//     (`updateLeagueRules`, src/server/league/rules.ts).
//
// This three-way split is why this template only has three headings: the
// other two sections of the public page (Formato, Puntuación) never come
// from `rulesMarkdown` at all, by design — see the two comments above.
//
// C0 (modelo-liga-slug-archivado) created this file as an empty-ish
// placeholder — genuinely minimal, missing the walkover score, the
// bonus/incomparecencia interaction and most of the emphasis the original
// page had — so a league migrated or created before lane E landed never
// showed a blank bases page. E1 (bases-por-liga) replaces it here with the
// full extraction of the legacy /bases prose (src/app/bases/page.tsx, now
// gone), keeping every fact that isn't sourced from League config: the
// walkover score is a fixed constant (WALKOVER_VICTORY_POINTS,
// src/server/result-logic.ts), not a League field, so it stays prose here
// rather than moving to the generated block.
//
// Used by:
//  - the migration that already backfilled `rulesMarkdown` for the one
//    pre-existing league (prisma/migrations/*_add_league_slug_archived_rules)
//    — that migration is immutable and already applied, so it keeps C0's
//    shorter placeholder text verbatim; only leagues created from this point
//    on get this richer version;
//  - `createLeague`/`duplicateLeague` (lane D) for brand-new leagues that
//    don't copy prose from an origin.
export const DEFAULT_RULES_MARKDOWN = `## Ejércitos

El tamaño de las listas lo acordáis los dos jugadores antes de cada partida. No hay un valor fijo para toda la liga: lo pactáis al quedar, igual que la fecha y el sitio.

Si no os ponéis de acuerdo, no hay partida que jugar — y entonces aplica lo de siempre: pactáis un vencedor o la ronda la cierra el organizador con un 0-0 (ver «Incidencias»).

Listas legales de matched play de la edición vigente. Lista por escrito al rival antes de cada partida. Puedes cambiarla entre partidas, no durante.

Conversiones, impresiones 3D y *proxies* claros permitidos, avisando antes.

## Incidencias

Si os ponéis de acuerdo en quién gana sin llegar a jugar (alguien no puede presentarse, no responde, etc.): **incomparecencia**. Se apunta un **80-0** a favor de quien ganáis entre los dos — cualquiera de los dos lo puede declarar en la app, y el rival puede corregirlo si no está de acuerdo.

La incomparecencia **no lleva punto de bonus**, aunque la liga los tenga activados: con un margen de 80 puntos, un 80-0 real ya se llevaría los bonus configurables, así que sin ellos ganar jugando siempre renta igual o más que no presentarse.

Si no llegáis a un acuerdo antes de que cierre la ronda: **0-0**, un punto para cada uno. El cierre de cada ronda lo da el organizador, no es automático — así que hay margen para pactar un resultado con algo de retraso si hace falta.

Si alguien abandona la liga, el grupo decide qué hacer con sus resultados.

## Convivencia

Medir claro, declarar intenciones, dados a la vista, sin *slow play*.

Dudas de reglas: se consulta; si no se resuelve en 2-3 minutos, dado (4+ decide) y se sigue.

Lo no previsto y cualquier cambio a las bases lo decide la mayoría del grupo.

**Respeto siempre:** el buen ambiente es lo primero.
`;
