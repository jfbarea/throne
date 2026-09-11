// Default `rulesMarkdown` template for a newly created League.
// multi-liga spec §2.11, §4.11 — "hybrid model": scoring, bonus, tiebreaker
// order, matches-per-round and playoff size are GENERATED from the League's
// own config and never duplicated here. This template only covers what stays
// free-form prose: army lists, incidents and table conduct.
//
// C0 (modelo-liga-slug-archivado) creates this file and gives it real,
// minimal content so a league migrated or created before lane E lands never
// shows a blank bases page — it does NOT do the full extraction of the
// legacy /bases prose (src/app/bases/page.tsx). That extraction, replacing
// this template with the definitive text, is E1 (bases-por-liga)'s job.
//
// Used by the migration that backfills `rulesMarkdown` for pre-existing
// leagues (see prisma/migrations/*_add_league_slug_archived_rules), and,
// once lane D wires it in, by `createLeague`/`duplicateLeague` for brand-new
// leagues that don't copy prose from an origin.
export const DEFAULT_RULES_MARKDOWN = `## Ejércitos

El tamaño de las listas lo acordáis los dos jugadores antes de cada partida. No hay un valor fijo para toda la liga: lo pactáis al quedar, igual que la fecha y el sitio.

Listas legales de matched play de la edición vigente. Lista por escrito al rival antes de cada partida. Puedes cambiarla entre partidas, no durante.

Conversiones, impresiones 3D y proxies claros permitidos, avisando antes.

## Incidencias

Si os ponéis de acuerdo en quién gana sin llegar a jugar (alguien no puede presentarse, no responde, etc.): incomparecencia. Cualquiera de los dos la puede declarar en la app.

Si no llegáis a un acuerdo antes de que cierre la ronda, la partida se resuelve como empate. El cierre de cada ronda lo da el organizador, no es automático.

Si alguien abandona la liga, el grupo decide qué hacer con sus resultados.

## Convivencia

Medir claro, declarar intenciones, dados a la vista, sin *slow play*.

Dudas de reglas: se consulta; si no se resuelve en un par de minutos, dado (4+ decide) y se sigue.

Lo no previsto y cualquier cambio a las bases lo decide la mayoría del grupo.

Respeto siempre: el buen ambiente es lo primero.
`;
