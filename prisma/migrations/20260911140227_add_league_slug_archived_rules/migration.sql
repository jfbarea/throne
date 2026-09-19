-- Hito C0 (modelo-liga-slug-archivado, multi-liga spec §6.1, §7.1, criterios
-- 19, 20, 41, 47). Adds three columns to League: `slug` (unique, backfilled
-- below), `archivedAt` (nullable, left NULL — nothing archives itself) and
-- `rulesMarkdown` (backfilled with the default bases template below).
--
-- Purely additive at the data level: every existing row is copied through
-- unchanged on every pre-existing column; only the three new columns get a
-- value. No DELETE, no UPDATE of a pre-existing column.
--
-- The `rulesMarkdown` literal below (bounded by the RULES_MARKDOWN_TEMPLATE_
-- BEGIN/END markers) is kept byte-for-byte identical to
-- src/server/league/default-rules.ts's `DEFAULT_RULES_MARKDOWN` constant —
-- multi-liga E3 (plantilla-completa-en-la-migracion). This migration isn't
-- deployed anywhere yet (verified: not in dev.db, not merged to main), so
-- it's still safe to rewrite; once it IS deployed, this comment (and the
-- one at E1 that assumed otherwise) stop applying to future edits, but the
-- byte-for-byte requirement doesn't change — tests/default-rules-migration-
-- parity.test.ts extracts this literal via the markers and fails the suite
-- if it and the TS constant ever diverge.
--
-- Hand-written, not `prisma migrate dev`'s output as-is (SQLite note in
-- PLAN.md C0): a NOT NULL + UNIQUE column added to a non-empty table can't
-- get its value from a single constant DB-level DEFAULT, so this fills
-- `slug` per-row via the CTE below instead — same construction Prisma itself
-- uses for structural SQLite changes (RedefineTables), extended with a
-- computed SELECT instead of a plain column copy.
--
-- Slug backfill approximates `src/server/slug.ts`'s `slugify(name, season)`
-- in plain SQL (SQLite has no regex/Unicode-normalization builtins): known
-- Spanish diacritics are mapped to their base letter, remaining punctuation
-- users are known to have used ("—", "¡") is folded to "-" alongside
-- whitespace, runs of "-" are collapsed, and edges are trimmed. It only has
-- to be correct for whatever data exists today (verified against a copy of
-- dev.db — see the builder's report); it does not need to handle every
-- character a future league name could contain, because every league
-- created through the app from this point on always gets its slug from the
-- real `slugify`/`uniqueSlug` functions (lane D/B), never from this
-- one-time backfill. Collisions between two existing rows that reduce to
-- the same base slug get "-2", "-3", … via ROW_NUMBER(), same convention as
-- `uniqueSlug`.
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;

CREATE TABLE "new_League" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "season" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "archivedAt" DATETIME,
    "rulesMarkdown" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'SETUP',
    "pointsWin" INTEGER NOT NULL DEFAULT 3,
    "pointsDraw" INTEGER NOT NULL DEFAULT 1,
    "pointsLoss" INTEGER NOT NULL DEFAULT 0,
    "bonusEnabled" BOOLEAN NOT NULL DEFAULT false,
    "bonusMarginThreshold" INTEGER,
    "bonusMinVP" INTEGER,
    "playoffSize" INTEGER NOT NULL DEFAULT 4,
    "matchesPerRound" INTEGER NOT NULL DEFAULT 2,
    "startMonth" DATETIME,
    "tiebreakers" TEXT NOT NULL DEFAULT '["POINTS","VP_DIFF","VP_FOR","HEAD_TO_HEAD","LOSSES","ID_ORDER"]',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

INSERT INTO "new_League" (
    "id", "name", "season", "slug", "archivedAt", "rulesMarkdown",
    "status", "pointsWin", "pointsDraw", "pointsLoss", "bonusEnabled",
    "bonusMarginThreshold", "bonusMinVP", "playoffSize", "matchesPerRound",
    "startMonth", "tiebreakers", "createdAt", "updatedAt"
)
WITH accent_folded AS (
    SELECT
        id,
        replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(
            name || ' ' || season,
            'á','a'),'Á','a'),'é','e'),'É','e'),'í','i'),'Í','i'),'ó','o'),'Ó','o'),'ú','u'),'Ú','u'),'ñ','n'),'Ñ','n'
        ) AS folded
    FROM "League"
),
lowered AS (
    SELECT id, lower(folded) AS lowered FROM accent_folded
),
punctuation_dashed AS (
    SELECT
        id,
        replace(replace(replace(replace(replace(replace(replace(replace(replace(
            lowered,
            '—','-'),'–','-'),' ','-'),'.','-'),',','-'),'''','-'),'¡','-'),'¿','-'),'!','-'
        ) AS dashed
    FROM lowered
),
collapsed AS (
    -- Six passes of "--" -> "-" collapse any run of up to 64 consecutive
    -- dashes into one — comfortably more than any real league name produces.
    SELECT
        id,
        replace(replace(replace(replace(replace(replace(
            dashed,
            '--','-'),'--','-'),'--','-'),'--','-'),'--','-'),'--','-'
        ) AS collapsed
    FROM punctuation_dashed
),
trimmed AS (
    SELECT
        id,
        CASE WHEN substr(collapsed, 1, 1) = '-' THEN substr(collapsed, 2) ELSE collapsed END AS left_trimmed
    FROM collapsed
),
based AS (
    SELECT
        id,
        CASE
            WHEN substr(left_trimmed, -1, 1) = '-'
            THEN substr(left_trimmed, 1, length(left_trimmed) - 1)
            ELSE left_trimmed
        END AS base_slug
    FROM trimmed
),
numbered AS (
    SELECT
        id,
        base_slug,
        ROW_NUMBER() OVER (PARTITION BY base_slug ORDER BY id) AS rn
    FROM based
)
SELECT
    l."id", l."name", l."season",
    CASE WHEN n.rn = 1 THEN n.base_slug ELSE n.base_slug || '-' || n.rn END AS "slug",
    NULL AS "archivedAt",
    -- RULES_MARKDOWN_TEMPLATE_BEGIN
    '## Formato

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
' AS "rulesMarkdown",
    -- RULES_MARKDOWN_TEMPLATE_END
    l."status", l."pointsWin", l."pointsDraw", l."pointsLoss", l."bonusEnabled",
    l."bonusMarginThreshold", l."bonusMinVP", l."playoffSize", l."matchesPerRound",
    l."startMonth", l."tiebreakers", l."createdAt", l."updatedAt"
FROM "League" l
JOIN numbered n ON n.id = l.id;

DROP TABLE "League";
ALTER TABLE "new_League" RENAME TO "League";
CREATE UNIQUE INDEX "League_slug_key" ON "League"("slug");

PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
