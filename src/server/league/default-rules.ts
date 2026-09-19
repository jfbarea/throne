// Default `rulesMarkdown` template for a newly created League.
// multi-liga spec §2.11, §4.11 — "hybrid model": the page is composed of
// two kinds of content:
//
//  1. Generated ("Configuración de esta liga") — scoring, bonus, the real
//     tiebreaker order and the playoff cutoff, read live from the League row
//     at render time (src/app/liga/[slug]/bases/rules-content.tsx). Never
//     duplicated here, so it can never drift from what computeStandings
//     actually does (spec §4.11).
//  2. Free-form prose (THIS constant) — Formato, Puntuación, Ejércitos,
//     Incidencias, Convivencia. The admin edits this per league via
//     `/admin/[slug]/bases` (`updateLeagueRules`, src/server/league/rules.ts)
//     — spec §2.11 grants the admin editing rights over every one of these
//     sections, not just some of them.
//
// E1 (bases-por-liga) originally kept "Formato" and part of "Puntuación" as
// fixed JSX instead of prose, on the premise that C0's migration
// (prisma/migrations/*_add_league_slug_archived_rules) was already applied
// and immutable, so the one pre-existing league could never get those
// sections retroactively. That premise was wrong (the migration isn't
// deployed anywhere yet — see the E3 builder's report), so E3
// (plantilla-completa-en-la-migracion) moved that prose into this constant,
// AND into the migration's own backfill (kept byte-for-byte identical —
// tests/default-rules-migration-parity.test.ts fails the suite if they ever
// diverge), so every league — the pre-existing one included, once this
// ships — gets the full, editable template.
//
// This is the full extraction of the legacy /bases prose
// (src/app/bases/page.tsx, now gone), keeping every fact that isn't sourced
// from League config: the walkover score is a fixed constant
// (WALKOVER_VICTORY_POINTS, src/server/result-logic.ts), not a League
// field, so it stays prose here rather than moving to the generated block.
//
// Used by:
//  - the migration that backfills `rulesMarkdown` for the one pre-existing
//    league (prisma/migrations/*_add_league_slug_archived_rules);
//  - `createLeague`/`duplicateLeague` (lane D) for brand-new leagues that
//    don't copy prose from an origin.
export const DEFAULT_RULES_MARKDOWN = `## Formato

Liguilla a una vuelta: todos contra todos, una partida por rival. Si sois 4 o menos, ida y vuelta.

Los emparejamientos se publican al inicio, repartidos en **rondas mensuales**: cada ronda dura un mes y te toca jugar el número de partidas por ronda que tenga configurado esta liga (lo ves arriba, en el bloque de configuración). Dentro del mes, tú decides con quién juegas primero y qué día quedáis.

Cada ronda tiene una **fecha límite** (el último día de su mes). No es un día de quedada obligatorio: es la fecha a partir de la cual el organizador puede dar la ronda por cerrada.

Puedes **adelantar** una partida de un mes futuro sin haber acabado el actual — pero eso no te libra de las partidas de tu ronda en curso: cuando llegue su cierre, cuentan igual (ver «Incidencias»).

## Puntuación

El ganador se decide por *Victory Points*; se anotan los VP de ambos jugadores. La puntuación exacta, el bonus, el orden de desempates y el cupo de playoffs de esta liga están arriba, en el bloque que se actualiza solo con la configuración.

## Ejércitos

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
