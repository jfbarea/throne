# Partidas por jornada — plan paralelo

**Spec:** `plan/specs/partidas-por-jornada.md` (v2, `APPROVED`).
**Rama:** `feat/partidas-por-jornada`, desde `main` (`ee6e0e8`).

La spec es el contrato. Si durante la implementación aparece algo que no
contempla o que la contradice, **el worker para y lo escala**. No se decide en
el código.

## Mecánica

- Todos los workers de una ola escriben en **el mismo árbol**, cada uno dentro
  de su partición de ficheros.
- **Los workers no commitean y no escriben estado.** Commitea el orquestador,
  una vez por tarea y en orden topológico.
- Los criterios se citan como `CA-N`, con el número de §8 de la spec. Un sufijo
  `u` (p. ej. `CA-7u`) indica que la tarea cubre la parte unitaria o pura del
  criterio y que otra tarea lo cierra en pantalla.

## Tareas

| id | tarea | ola | deps | criterios | ficheros |
|----|-------|-----|------|-----------|----------|
| t00 | `contratos-y-dominio` | 1 | — | CA-7, CA-6u, CA-11u, CA-15u, CA-16u, CA-21u | `src/server/match-search.ts`, `src/server/round-ui.ts`, `src/server/partidas-view.ts`, `src/app/mis-partidas/browser-contract.ts`, `src/app/mis-partidas/PartidasBrowser.tsx`, `src/app/mis-partidas/VistaTabs.tsx`, `tests/partidas-dominio.test.ts` |
| t01 | `navegador` | 2 | t00 | CA-8, CA-9, CA-10, CA-11, CA-12, CA-13, CA-14, CA-15, CA-16, CA-17, CA-18, CA-19ᵇ, CA-22ᵇ | `src/app/mis-partidas/PartidasBrowser.tsx`, `tests/partidas-browser.test.tsx` |
| t02 | `pagina-y-pestanas` | 2 | t00 | CA-1, CA-2, CA-3, CA-4, CA-5, CA-6, CA-19ᵃ, CA-20 | `src/app/mis-partidas/page.tsx`, `src/app/mis-partidas/VistaTabs.tsx`, `src/server/partidas-blocks.ts`, `tests/partidas-pagina.test.tsx` |
| t03 | `buscador-compartido` | 2 | t00 | CA-21 | `src/app/calendario/DaySchedulePicker.tsx`, `src/components/FactionSelect.tsx`, `src/app/guia/sections.ts` |
| t04 | `e2e` | 2 | t00 | CA-22ᵃ, CA-23 | `tests/e2e/full-journey.spec.ts` |

ᵃ/ᵇ: criterio repartido entre dos tareas. Se verifica entero en el gate de la
ola 2.

**Una ola 1 con una sola tarea no es una ola.** t00 se ejecuta en secuencia
con un solo `worker`, sin ciclo paralelo. Es el contrato que importan los
cuatro de la ola 2: con las firmas y los `testid` ya escritos en el árbol,
nadie tiene que suponer nada.

## t00 — contratos-y-dominio

**Objetivo:** dejar en el árbol todo lo que importan las tareas de la ola 2.
Las funciones puras van implementadas y testeadas, porque son pequeñas y los
tests de componente de la ola 2 las usan de verdad. Los dos componentes quedan
como stubs con sus props definitivas.

- `src/server/match-search.ts` (nuevo):
  - `foldText(text: string): string`: NFD + rango `[̀-ͯ]` +
    minúsculas, el mismo que `DaySchedulePicker.tsx:95`.
  - `matchesPlayerQuery(match: { playerHomeName: string; playerAwayName:
    string | null }, query: string): boolean`: recorta y pliega `query`; si
    queda vacía, casa todo (§4.2).
- `src/server/round-ui.ts`: añade
  `pickCurrentRoundId(rounds: { id: string; index: number; deadline: Date;
  closedAt: Date | null }[], now: Date): string | null` (§4.1 y los empates de
  §5). No toca `sortRoundBlocks` ni `rounds.ts`.
- `src/server/partidas-view.ts` (nuevo):
  - `type Vista = "MIAS" | "TODAS"` y `resolveVista(role: "ADMIN" | "PLAYER",
    param: string | string[] | undefined): Vista`. Solo `ADMIN` con
    `"todas"` da `TODAS` (§4.4).
  - `type StatusFilter = "PENDIENTES" | "JUGADAS" | "TODAS"` y
    `DEFAULT_STATUS_FILTER = "PENDIENTES"`.
  - `isPendingMatch(m: { status: string; result: unknown | null }): boolean`:
    `status === "SCHEDULED"` y sin resultado (§4.6).
  - `matchesStatusFilter(m, filter, stickyPendingIds?: ReadonlySet<string>)`:
    las «recién resueltas» de §4.6 casan con `PENDIENTES` si su id está en el
    set.
- `src/app/mis-partidas/browser-contract.ts` (nuevo): el contrato entre la
  página y el navegador, y entre ambos y el e2e.
  - `BrowserBlock`: `{ key: string; kind: "ROUND" | "UNASSIGNED" | "LEGACY";
    title: string; subtitle: string; matches: MatchCardMatch[] }`. `title` es
    p. ej. `Ronda 3`; `subtitle` es el texto actual sin el número de partidas,
    que lo añade el navegador (§4.5).
  - `PartidasBrowserProps`: `{ blocks: BrowserBlock[]; currentBlockKey: string
    | null; currentPlayerId: string; isAdmin: boolean; vista: Vista; scope:
    "PLAYER" | "LEAGUE" }`. `scope` elige el texto del aviso de §5 («No te
    queda…» o «…en la liga»).
  - `VistaTabsProps`: `{ vista: Vista }`.
  - `TEST_IDS` y `LABELS`: los `data-testid` y textos visibles que usan los
    tests y el e2e. Por ejemplo `block-<key>`, `block-toggle-<key>`,
    `search-input`, `status-filter`, las etiquetas del segmentado y de las
    pestañas («Mis partidas», «Toda la liga»), y los avisos de §5.
- `PartidasBrowser.tsx` y `VistaTabs.tsx`: stubs `"use client"` con las props
  definitivas, que pintan lo mínimo (los bloques desplegados y dos enlaces),
  para que la página compile y el e2e tenga contra qué escribir.
- `tests/partidas-dominio.test.ts`: todas las ramas de `pickCurrentRoundId`
  (CA-7, empates, `deadline === now`), `matchesPlayerQuery` (acentos,
  espacios, `playerAway = null`), `resolveVista`, `isPendingMatch` y
  `matchesStatusFilter` con el set de recién resueltas.

**Hecho cuando:** `npm run test`, `npm run lint` y `npm run build` en verde, y
la página actual sigue funcionando igual, porque aún no importa nada nuevo.

## t01 — navegador

**Objetivo:** implementar `PartidasBrowser`: buscador, filtro de estado,
bloques plegables y los avisos de vacío.

- Monta un `MatchCard` por partida, sin cambiarlo.
- Plegado con `<details>`/`<summary>` y `open` controlado (§7).
- Plegado inicial según `currentBlockKey`: «Sin ronda asignada» e «Historial»
  siempre plegados (§4.1b). El plegado a mano se conserva entre revalidaciones:
  el estado se indexa por `key` y un bloque nuevo toma el valor por defecto.
  El componente se remonta al cambiar de pestaña, y ahí se pierde (§4.3).
- Buscador: al empezar a escribir guarda el plegado; con texto, solo los
  bloques que casan, todos desplegados; al vaciar, restaura (§4.3).
- Filtro: segmentado de tres, `PENDIENTES` por defecto. Oculta los bloques
  vacíos y no despliega nada. Guarda el set de recién resueltas al entrar en
  `PENDIENTES` (§4.6). Se combina con el buscador con un Y.
- Cabecera: `título · subtítulo · N partidas` o `M de N partidas` (§4.5).
- **Persistencia del buscador y del filtro al cambiar de pestaña (CA-14,
  CA-16).** Navegar de `/mis-partidas` a `?vista=todas` es una navegación
  suave a la misma página. Next reconcilia el árbol y un componente de cliente
  en la misma posición y con la misma `key` conserva su estado. Por tanto, el
  texto y el filtro sobreviven sin guardarse en ningún sitio, y recargar los
  vacía. Lo que **sí** tiene que reiniciarse al cambiar `vista` es el plegado
  y el set de recién resueltas (§4.3, §4.6): se resetean cuando cambia la
  prop `vista`, no con `key` en el componente entero. Nada de URL ni de
  `sessionStorage`. Si al probarlo el estado no sobrevive a la navegación,
  **para y escala**.
- Fila sticky con buscador y segmentado bajo el `AppHeader`. El offset se toma
  de la altura real del header (una variable CSS o una medida), no de un
  número mágico (§9). Etiquetas abreviadas por debajo de ~400 px, con
  `aria-label` completo. `type="search"` y sin `autoFocus`.
- Avisos de §5: búsqueda sin resultados (su botón vacía solo el buscador),
  `PENDIENTES` sin nada pendiente («Ver jugadas») y `JUGADAS` sin nada jugado.

**Tests (`// @vitest-environment jsdom`, montando y pulsando de verdad, como
`tests/agendar.test.tsx`):** CA-8 a CA-18 y la parte de CA-19 que toca al
filtro. El server action de `MatchCard` se dobla igual que allí.

## t02 — pagina-y-pestanas

**Objetivo:** que `page.tsx` quede delgado: consulta, decide la vista y monta.

- `page.tsx` lee `searchParams` (en Next 16 es una `Promise`) y llama a
  `resolveVista`. Filtra por jugador si la vista es `MIAS`, o si el usuario es
  un jugador.
- Carga las rondas de la liga, calcula `pickCurrentRoundId(rounds, new
  Date())` y arma los bloques.
- Monta `<PartidasBrowser>` **sin `key` que dependa de `vista`**, siempre en la
  misma posición del árbol. Es lo que permite que el buscador y el filtro
  sobrevivan al cambio de pestaña (ver t01).
- Título, eyebrow y línea de recuentos por pestaña (§4.4). Cupo del admin en
  `MIAS` (CA-4). Recuentos sobre la pestaña (CA-5).
- Admin sin partidas propias en `MIAS`: aviso y enlace «Ver todas las partidas
  →» (CA-20).
- `src/server/partidas-blocks.ts` (nuevo): la lógica que hoy vive en la
  página (agrupar por ronda, «Sin ronda», «Historial», `sortRoundBlocks`,
  subtítulos con cupo o agregado, `toCardProps`) pasa a una función pura
  `buildBrowserBlocks(...)`. Es lo que abarata el rebase de PR #1 (§7).
- `VistaTabs.tsx`: dos `next/link`, «Mis partidas» y «Toda la liga», con
  `aria-current` en la activa. Solo se montan si `isAdmin` (CA-19ᵃ). Van
  fuera de la fila sticky (§4.5).

**Tests (`tests/partidas-pagina.test.tsx`):** `buildBrowserBlocks` (orden,
subtítulos, cupo en `MIAS` frente a agregado en `TODAS`, recuentos) y
`VistaTabs` montado (CA-1, CA-2, CA-6 vía `resolveVista`, CA-19ᵃ). CA-3
(recarga) lo cubre el e2e de t04.

## t03 — buscador-compartido

- `DaySchedulePicker.tsx` borra su `fold`/`matchesQuery` e importa
  `matchesPlayerQuery` de `src/server/match-search.ts`. Sin cambio de
  comportamiento: `tests/agendar.test.tsx` tiene que pasar **sin tocarlo**
  (CA-21).
- `FactionSelect.tsx` importa `foldText` y le añade su quitado de apóstrofos
  (`['’]`), que el `fold` del calendario no tiene. Mismo comportamiento
  que hoy: `tau` sigue encontrando `Imperio T'au`.
- `src/app/guia/sections.ts`: el bullet de «Mis partidas» (línea ~50) pasa a
  mencionar las jornadas plegadas, el buscador y que por defecto solo salen
  las pendientes. Si algún test afirma ese texto, se busca con `grep` y se
  escala en vez de tocarlo, porque está fuera de la partición.

## t04 — e2e

Contra los `TEST_IDS`/`LABELS` de `browser-contract.ts` y la spec, **no**
contra la implementación, que se escribe en paralelo.

- Pasos 7-9: antes de pulsar «Apuntar resultado» sobre la Ronda 1, desplegarla
  (o buscar por el rival). El paso 8 pasa el filtro a `Jugadas`. El paso 6 no
  depende de ver «Ronda 1» con el filtro por defecto (§6).
- Paso nuevo de admin: `/mis-partidas` muestra «Mis partidas» activa;
  «Toda la liga» lleva a `?vista=todas`; recargar la conserva (CA-1 a CA-3).
- A 390 px: scroll hasta el final; buscador y filtro visibles bajo el header;
  pestañas fuera de vista; sin overflow; foco fuera del buscador (CA-22ᵃ).
- Se mantiene el test existente «mis-partidas no tiene overflow horizontal».

## Gate de la ola 2

`npm run test`, `npm run lint`, `npm run build` y `npx playwright test
tests/e2e/full-journey.spec.ts`, sobre el conjunto. Después, `integrator`.
