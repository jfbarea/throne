# Plan por tracks — Calendario de verdad

**Spec (contrato):** `plan/specs/calendario-de-verdad.md` — `status: REVIEW`, v2.
**Rama de integración:** `feat/calendario-de-verdad`.
**Modo:** 6 tracks, 4 de ellos en paralelo, un agente por track.

> **Puerta.** La spec está en `REVIEW`, no en `APPROVED`. Este documento se
> puede leer, discutir y ajustar, pero **ningún track arranca** hasta que la
> spec esté aprobada. Es la regla de `/specs`, no una formalidad: los tracks
> se reparten por criterios de aceptación, y esos criterios todavía pueden
> cambiar.

La spec es el contrato. Si durante la implementación aparece algo que no
contempla o que la contradice, **el agente para y lo escala**; no se decide en
el código ni, mucho menos, en un track en paralelo donde nadie lo ve.

---

## Por qué estos cortes y no otros

Con varios agentes a la vez, el enemigo no es el trabajo: es el fichero
compartido. Los tracks están cortados para que **ningún fichero tenga dos
dueños**, y para que lo único que cruce de un track a otro sea una firma
acordada de antemano.

De ahí la forma: un track **bloqueante y corto** que fija los contratos, cuatro
tracks paralelos que no se tocan entre sí, y un track final que integra y
comprueba que lo que montaron los cuatro está de verdad montado.

```
T0 · contratos-y-fechas          [BLOQUEANTE, serial]
     │  fija firmas, lógica pura de fechas y fixtures
     ├──────────────┬──────────────┬──────────────┐
     ▼              ▼              ▼              ▼
T1 · guardas    T2 · rejilla   T3 · agendar   T4 · periferia
   (servidor)      (UI)           (UI)          (UI, pequeño)
     └──────────────┴──────────────┴──────────────┘
                          ▼
                 T5 · integración        [serial, al final]
```

**Coste en serie:** T0 + max(T1…T4) + T5 = tres etapas, en vez de nueve hitos
encadenados.

---

## Requisitos que aplican a TODOS los tracks

No se repiten en cada uno, pero ninguno se cierra sin ellos:

1. **El árbol compila y los tests pasan en cada commit** (`CLAUDE.md` del
   proyecto): `npm run lint`, `npm run test` y `npm run build` verdes.
2. **Cada criterio de la spec que el track cierra tiene un test que lo
   nombra** (`describe("AC-18: …")`) y que **falla antes del cambio**.
3. **Código y comentarios en inglés; UI, docs y mensajes en español.**
4. **Las guardas se comprueban en la acción de servidor**, nunca solo en el
   cliente, y se escriben como predicados puros (spec §7).
5. **Mobile-first, dark mode hard-coded**, y nada scrollea en horizontal salvo
   el documento.
6. **Ningún track toca un fichero que no sea suyo.** Si uno lo necesita, para y
   se escala: es señal de que el corte estaba mal.
7. **Cada track escribe su propio `plan/calendario-de-verdad/_state/<track>.json`.**
   No hay un `_state.json` único: cuatro agentes escribiendo el mismo fichero
   de estado es el primer conflicto garantizado del plan.

---

## Mecánica de ejecución

- Rama de integración `feat/calendario-de-verdad` salida de `main`.
- Un **worktree por track** (`git worktree add`), rama
  `feat/calendario-de-verdad/<track>` salida de la de integración. Los merges
  van hacia la de integración, nunca a `main` (rama protegida).
- Cada track: **builder → reviewer**, como el resto del proyecto. Un track no
  se considera cerrado con `APPROVED` del reviewer y `npm run test` verde
  **sobre la rama de integración ya mergeada**, no solo sobre la suya.
- T1…T4 se pueden mergear en cualquier orden. T5 arranca cuando los cuatro
  están dentro.

### Arranque de un worktree

Un worktree recién creado **no hereda nada de lo que ignora git**: ni
`node_modules/`, ni `.env`, ni `src/generated/prisma`. Lo primero que hace
cada agente en su worktree, antes de tocar código:

```bash
cp /Users/fran.barea/src/throne/.env .env
npm install        # el postinstall regenera el cliente Prisma
```

Los **tests no necesitan `.env`**: `vitest.config.ts` inyecta `DATABASE_URL`,
`SESSION_SECRET` y `ADMIN_PASSCODE` a propósito, «so tests never depend on the
real .env file». `npm install` y `npm run build` sí lo necesitan.

Cada worktree tiene su propio `test.db`, que `tests/db-global-setup.ts` borra
y vuelve a migrar en cada ejecución. No hay DB compartida entre tracks y por
tanto no hay `SQLITE_BUSY` cruzado.

---

## Mapa de propiedad de ficheros

Cada fichero tiene exactamente un dueño. Esta tabla es la que evita los
conflictos; si algo no está aquí, no se toca.

| Fichero | Dueño |
|---|---|
| `src/server/calendar.ts` *(nuevo)* | **T0** |
| `src/server/result-logic.ts` | **T0** |
| `tests/helpers/calendario.ts` *(nuevo)* | **T0** |
| `tests/calendar.test.ts` *(nuevo)* | **T0** |
| `src/server/match-actions.ts` | **T1** |
| `src/server/result-actions.ts` | **T1** |
| `tests/guardas-fecha.test.ts` *(nuevo)* | **T1** |
| `src/app/calendario/page.tsx` | **T2** |
| `src/app/calendario/MonthGrid.tsx` *(nuevo)* | **T2** |
| `src/app/calendario/DayDetail.tsx` *(nuevo)* | **T2** |
| `src/app/calendario/MatchRow.tsx` | **T2** |
| `tests/rejilla.test.tsx` *(nuevo)* | **T2** |
| `src/app/calendario/DaySchedulePicker.tsx` *(nuevo)* | **T3** |
| `src/components/ScheduleForm.tsx` | **T3** |
| `src/components/index.ts` | **T3** |
| `tests/agendar.test.tsx` *(nuevo)* | **T3** |
| `src/app/rondas/page.tsx` | **T4** |
| `src/app/mis-partidas/MatchCard.tsx` | **T4** |
| `tests/periferia.test.tsx` *(nuevo)* | **T4** |
| `tests/e2e/full-journey.spec.ts` | **T5** |
| `tests/montaje.test.tsx` *(nuevo)* | **T5** |
| `tests/trazabilidad.md` | **T5** |

**Nadie** toca `prisma/schema.prisma`: esta feature no tiene migración
(spec §6.3).

---

## T0 · `contratos-y-fechas` — BLOQUEANTE

**Estado:** PENDING
**Paraleliza con:** nadie. Es la condición de que los demás existan.
**Cierra criterios de la spec:** ninguno de punta a punta. Cierra el **nivel
unitario** de 3, 13, 17, 18-21, 23, 32 y 33.

Todo función pura sin DB y sin React. Es corto a propósito: cuanto antes
termine, antes arrancan cuatro agentes.

### Entrega 1 — `src/server/calendar.ts` (nuevo)

La lógica de fechas de la spec §4.12, §4.7 y §4.1, en `Europe/Madrid` fija:

```ts
export const LEAGUE_TZ = "Europe/Madrid";

export interface MonthKey { year: number; month: number } // month 1-12

export function parseMonthKey(raw: string | null): MonthKey | null; // "2026-10"
export function formatMonthKey(m: MonthKey): string;

/** El día (en LEAGUE_TZ) al que pertenece un instante. "2026-10-17" */
export function dayKeyOf(instant: Date): string;
export function monthKeyOf(instant: Date): MonthKey;

/** El mes de la ronda N, contado desde League.startMonth. */
export function monthOfRound(startMonth: Date, roundIndex: number): MonthKey;

/** Semanas completas empezando en lunes, con los días de relleno marcados. */
export function monthGridDays(m: MonthKey): DayCell[];

export function navigableMonths(rounds: RoundRef[], playoffDays: Date[]): MonthKey[];
export function entryMonth(nav: MonthKey[], rounds: RoundRef[], now: Date): MonthKey;

/** Los dos extremos de §4.7, ya como instantes comparables. */
export function scheduleBounds(
  startMonth: Date | null,
  roundDeadline: Date | null
): { min: Date | null; max: Date | null };
```

**El punto crítico de todo el plan vive aquí: §9.5.** `deriveDeadlines`
(`src/server/rounds.ts:800`) guarda el cierre como `Date.UTC(y, m+1, 0)`, o sea
el último día del mes **a las 00:00 UTC**. Si `scheduleBounds` devuelve ese
instante como `max`, **toda partida jugada el propio día del cierre queda fuera
de su ronda**. El `max` tiene que ser el **final de ese día en `Europe/Madrid`**.
El test que lo fija no es opcional.

### Entrega 2 — predicados en `src/server/result-logic.ts`

```ts
export type ScheduleRejection =
  | "AFTER_ROUND_DEADLINE"
  | "BEFORE_LEAGUE_START"
  | "ROUND_CLOSED"
  | "CLEARING_PLAYED_MATCH";

export function canScheduleAt(
  scheduledAt: Date | null,
  ctx: {
    roundDeadline: Date | null;   // null = playoff o sin ronda: sin techo
    roundClosedAt: Date | null;
    leagueStartMonth: Date | null;
    hasPlayedResult: boolean;     // resolution === "PLAYED"
  },
  isAdmin: boolean
): { ok: true } | { ok: false; reason: ScheduleRejection };

/** §4.8: sin fecha no hay resultado. No distingue rol, a propósito. */
export function canReportGivenSchedule(scheduledAt: Date | null): boolean;

/** §4.5 y §4.14: qué puede llevar este actor a un día de este mes. */
export function eligibleForDay(
  matches: EligibilityInput[],
  ctx: { month: MonthKey; playerId: string | null; isAdmin: boolean }
): string[]; // ids
```

`canReportGivenRoundClosed` (`result-logic.ts:195`) **se reutiliza tal cual**;
`canScheduleAt` lo llama por dentro. No se duplica la regla.

### Entrega 3 — stubs con firma real

T2 tiene que poder importar y montar lo que construye T3 desde el primer
commit. T0 crea los tres componentes nuevos **ya con sus props definitivas**,
renderizando un marcador visible:

```tsx
export const STUB_MARKER = "__STUB_SIN_IMPLEMENTAR__";
```

> **Un stub que devuelve `null` es la forma exacta en que este repo ya se ha
> equivocado tres veces.** En la PR #1, cuatro componentes se quedaron sin
> montar porque el punto de extensión devolvía `null` y la suite siguió en
> verde: *el test verificaba la función, no el camino*. Por eso el stub
> **renderiza un marcador visible**, y por eso T5 lleva un test que falla si
> `STUB_MARKER` sobrevive en `src/` (ver T5).

### Entrega 4 — `tests/helpers/calendario.ts` (nuevo)

Las fixtures que los cuatro tracks van a necesitar, escritas una vez: una liga
con `startMonth`, N rondas con sus deadlines, y partidas en todos los estados
que la spec nombra (sin fecha, con fecha, `PLAYED`, `WALKOVER`,
`UNPLAYED_DRAW`, de ronda cerrada, de playoff, con `roundId = null`).

Sin esto, cuatro agentes inventan cuatro semillas distintas y chocan en el
primer merge.

### Criterios de aceptación del track

- `dayKeyOf` sitúa el 1 de noviembre a las 00:30 hora española en el 1 de
  noviembre, no en el 31 de octubre (criterio 3, nivel unitario).
- `scheduleBounds` acepta una partida fechada **el mismo día del cierre** de su
  ronda a las 20:00 hora española (§9.5).
- `monthOfRound` y `monthGridDays` aciertan en meses de 28, 29, 30 y 31 días y
  en los **dos cambios de hora** del año.
- `canScheduleAt` devuelve el `reason` correcto en los cuatro rechazos, y `ok`
  para el admin en `AFTER_ROUND_DEADLINE` pero **no** en `BEFORE_LEAGUE_START`
  ni en `CLEARING_PLAYED_MATCH` (§4.7, §4.9).
- `npm run test:coverage` da **100 % de líneas y ramas** en
  `src/server/calendar.ts`.
- Ningún test depende del `TZ` de la máquina: la suite pasa con `TZ=UTC`,
  `TZ=Europe/Madrid` y `TZ=America/New_York`.

**No entra:** ninguna acción de servidor, ninguna consulta, ninguna UI real.

---

## T1 · `guardas-de-escritura`

**Estado:** PENDING
**Paraleliza con:** T2, T3, T4.
**Depende de:** T0 (entregas 1, 2 y 4).
**Cierra criterios:** 18, 19, 20, 21, 23, 24, 25, 26, 27, 28, 30, 31, 32, y la
mitad de servidor de 29 y de 34.

Solo servidor. No abre un `.tsx`.

- `setMatchSchedule` (`src/server/match-actions.ts:349`): llama a
  `canScheduleAt` y traduce cada `reason` al mensaje en español de **§5.5**,
  nombrando la ronda y su cierre o el mes de arranque. Añade
  `revalidatePath("/calendario")` donde falte.
- `reportResult` (`src/server/result-actions.ts:129`): añade
  `canReportGivenSchedule` a la cadena de guardas, **antes de abrir la
  transacción** y con el mismo patrón que las que ya tiene. No distingue rol.
- `declareWalkover` y `closeRound`: **no se tocan**. Que sigan funcionando sin
  fecha es un criterio (26, 27), no un descuido.

### Criterios de aceptación del track

Los criterios **18-21, 23-28 y 30-32** de la spec, cada uno con su
`describe("AC-N: …")`. Además:

- El rechazo de `reportResult` sin fecha **no crea `Result` ni escribe
  `AuditLog`** (criterio 25) — verificado contando filas, no solo mirando el
  `ok: false`.
- Un admin obtiene `ok: true` en el caso del criterio 19 y `ok: false` en el 20
  y el 29: la rama de rol se prueba en los dos sentidos.

**No entra:** UI, mensajes en pantalla, `min`/`max` del input.

---

## T2 · `rejilla`

**Estado:** PENDING
**Paraleliza con:** T1, T3, T4.
**Depende de:** T0 (entregas 1, 3 y 4).
**Cierra criterios:** 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 35, 36, 38, y la
mitad de presentación de 34.

El grueso visual. Spec §4.1, §4.2, §4.3, §4.4, §4.11.

- `src/app/calendario/page.tsx`: reescrita. Server Component que lee `?mes`,
  resuelve el mes de entrada con `entryMonth`, carga **solo las partidas del
  mes visible** más las sin fecha de su ronda, **sin** el filtro
  `phase: "LEAGUE"`, en una consulta sin N+1 al estilo de `getRoundsOverview`.
- `MonthGrid.tsx`: la rejilla, los puntos (§4.2), el día desplegado, las
  flechas como `<Link>` sobre `?mes`.
- `DayDetail.tsx`: el detalle del día, y **el montaje de
  `DaySchedulePicker`** (de T3) con las props que fijó T0.
- `MatchRow.tsx`: gana la marca de playoff (§4.11) y la de «jugada, falta la
  fecha» (§5.9).

### Criterios de aceptación del track

Los criterios **1-12, 35, 36 y 38**, cada uno con su `describe("AC-N: …")`.
Además:

- La consulta del mes se mide con el cliente Prisma instrumentado que ya usa
  `tests/rondas-overview.test.ts`: **sin N+1**.
- El criterio 38 (390px sin scroll horizontal) se prueba, no se mira.

**No entra:** el contenido del selector (es T3), las guardas de servidor (T1).

---

## T3 · `agendar`

**Estado:** PENDING
**Paraleliza con:** T1, T2, T4.
**Depende de:** T0 (entregas 1, 2 y 3). Llama a `setMatchSchedule`, cuya firma
**no cambia** — no espera a T1.
**Cierra criterios:** 13, 14, 15, 16, 17, 22, 33, y la mitad de UI de 29.

- `DaySchedulePicker.tsx`: sustituye el stub de T0. Presentación pura sobre
  `eligibleForDay`: la regla de «adelantar sí, retrasar no» **no se reimplementa
  aquí**, se consume.
- `ScheduleForm.tsx`: `min`/`max` desde `scheduleBounds` (criterio 22); el botón
  «Limpiar fecha» no se pinta con `resolution = PLAYED` (criterio 29).
- `src/components/index.ts`: si hay export nuevo, lo añade este track y solo
  este.

**Forma del selector:** abierta en §9.2. La decide este track, con la única
restricción de §7 (tocable y legible en 390px). Si la elección resulta cara,
se escala antes de construirla, no después.

### Criterios de aceptación del track

Los criterios **13-17, 22, 29 (UI) y 33**, cada uno con su `describe`. Además:

- El componente se prueba **montado y con clics reales**
  (`@testing-library/react`, como hizo `tests/admin-league-actions-mounted.test.tsx`
  en la PR #1), no invocando su handler a mano.

**No entra:** la rejilla, la carga de datos, las guardas de servidor.

---

## T4 · `periferia`

**Estado:** PENDING
**Paraleliza con:** T1, T2, T3.
**Depende de:** T0 (entrega 2, solo para el mensaje).
**Cierra criterios:** 37, y la explicación en pantalla que acompaña al 25.

El track pequeño. Se puede dar al agente más rápido o al último que quede
libre.

- `src/app/rondas/page.tsx`: el `h1` deja de ser «Calendario de la liga» y la
  bajada se ajusta (§4.13). **Nada más**: ni cupos, ni consultas, ni layout.
- `src/app/mis-partidas/MatchCard.tsx`: el botón de resultado explica por qué
  está deshabilitado cuando la partida no tiene fecha, y enlaza a ponerla.

### Criterios de aceptación del track

- Criterio **37**: `/rondas` ya no se titula «Calendario de la liga» y su
  contenido (cupos, cierres, badge abierta/cerrada) es **idéntico** al de hoy —
  probado comparando el render, no de palabra.
- Una partida sin fecha muestra en `MatchCard` el motivo y el camino para
  arreglarlo, sin que el usuario tenga que provocar el error del servidor.

---

## T5 · `integración`

**Estado:** PENDING
**Paraleliza con:** nadie. Arranca con T1-T4 mergeados.
**Cierra criterios:** 34 (completo), 38 (confirmación), 39, y el recorrido.

Este track existe porque **cuatro tracks verdes no son una feature verde**.

- `tests/montaje.test.tsx` (nuevo): el test que este repo ha echado de menos
  tres veces.
  - Falla si `STUB_MARKER` aparece en cualquier fichero de `src/`.
  - Recorre el camino real: montar `/calendario`, clicar un día, ver el
    selector, elegir una partida, ver la fecha puesta.
- `tests/e2e/full-journey.spec.ts`: el recorrido pasa por la rejilla en vez de
  por las listas, y **agenda antes de apuntar** — que es justo lo que la
  feature vuelve obligatorio.
- Criterio **34** de punta a punta: un `Result` `PLAYED` sin fecha (dato
  anterior a la spec) sigue contando en la clasificación, aparece marcado, y
  editarlo obliga a fechar la partida primero. Cruza T1 y T2: aquí es donde se
  comprueba junto.
- Criterio **39**: `npm run test` verde, incluidas `reportar-confirmar`,
  `incomparecencia` y `cierre-de-ronda` ajustadas donde la fecha pasa a ser
  precondición.
- `plan/calendario-de-verdad/trazabilidad.md`: los 39 criterios con el test que
  los cierra, como en `plan/rondas-con-fecha/trazabilidad.md`.

---

## Cobertura de la spec por track

| Criterios | Track |
|---|---|
| 1-12 | T2 |
| 13-17 | T3 |
| 18-21, 23 | T1 |
| 22 | T3 |
| 24-28, 30-32 | T1 |
| 29 | T1 (servidor) + T3 (UI) |
| 33 | T3 |
| 34 | T1 + T2, verificado en T5 |
| 35, 36 | T2 |
| 37 | T4 |
| 38 | T2 + T3, confirmado en T5 |
| 39 | T5 |

Los 39 criterios de la spec tienen dueño. Ninguno tiene dos.

---

## Riesgos propios de ejecutar esto en paralelo

Son distintos de los de la spec (§9), y se suman a ellos.

1. **T0 mal hecho envenena los cuatro.** Es el único track cuyo error no se
   detecta en su propio worktree: una firma incómoda o un `scheduleBounds` con
   el off-by-one de §9.5 aparece como cuatro tracks raros. Por eso T0 lleva
   100 % de cobertura y revisión antes de que nadie arranque.
2. **El stub que sobrevive.** Historial documentado en este repo: tres veces,
   componente construido y nunca montado, suite en verde. Mitigado con el
   marcador visible de T0 y el test de T5, no con buena voluntad.
3. **La ventana entre `canScheduleAt` y el `update`.** T1 hereda el patrón
   TOCTOU que `reportResult` ya resolvió (re-lectura dentro de la transacción,
   `RoundClosedDuringTransactionError`). Si T1 lo olvida, un `closeRound`
   concurrente deja pasar una escritura que el criterio 32 prohíbe. Está en los
   criterios de T1, pero conviene decirlo aquí: es un fallo que ningún test de
   T1 encuentra si nadie lo escribe a propósito.
4. **La PR #1 sigue abierta.** Mientras estos tracks corren, `feat/multi-liga`
   mueve los ficheros de T2, T3 y T4 (§9.1). Cuanto más duren los tracks en
   paralelo, peor el rebase. T0 y T1 son los menos expuestos: `calendar.ts`,
   `result-logic.ts`, `match-actions.ts` y `result-actions.ts` no cambian de
   ruta en #1.
5. **Cuatro agentes, una suite.** Cada track añade su fichero de tests, pero
   todos corren `npm run test` completo. Un track que deje la suite roja
   bloquea la señal de los otros tres. De ahí el requisito 1: verde **en cada
   commit**, no al final del track.
