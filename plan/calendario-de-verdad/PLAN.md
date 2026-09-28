# Calendario de verdad — plan paralelo

**Spec:** `plan/specs/calendario-de-verdad.md` (v3, `APPROVED`).
**Rama:** `feat/calendario-de-verdad`.
**Razonamiento del reparto:** `plan/calendario-de-verdad/TRACKS.md` (por qué
estos cortes y no otros). **Este fichero es el operativo**: si divergen en
mecánica, manda este.

La spec es el contrato. Si durante la implementación aparece algo que no
contempla o que la contradice, **el worker para y lo escala**; no se decide en
el código ni en un worker en paralelo donde nadie lo ve.

## Mecánica

Todos los workers de una ola escriben en **el mismo árbol**, cada uno dentro de
su partición de ficheros. No hay worktrees: la partición es disjunta, y
compartir árbol es lo que permite reconciliar con `git status --porcelain` y
correr un solo gate de integración sobre el conjunto.

**Los workers no commitean y no escriben estado.** Commitea el orquestador, una
vez por tarea y en orden topológico, para que cada commit siga siendo un cambio
lógico aunque el trabajo se hiciera en paralelo.

## Tareas

| id | tarea | ola | deps | criterios | ficheros |
|----|-------|-----|------|-----------|----------|
| t00 | `contratos-y-fechas` | 1 | — | unitario de 3, 13, 17, 18-21, 23, 32, 33 | `src/server/calendar.ts`, `src/server/result-logic.ts`, `tests/helpers/calendario.ts`, `tests/calendar.test.ts`, `src/app/calendario/MonthGrid.tsx`, `src/app/calendario/DayDetail.tsx`, `src/app/calendario/DaySchedulePicker.tsx` |
| t01 | `guardas-de-escritura` | 2 | t00 | 18, 19, 20, 21, 23, 24, 25, 26, 27, 28, 30, 31, 32, 29ᵃ, 34ᵃ | `src/server/match-actions.ts`, `src/server/result-actions.ts`, `tests/guardas-fecha.test.ts` |
| t02 | `rejilla` | 2 | t00 | 1-12, 35, 36, 38ᵃ, 34ᵇ | `src/app/calendario/page.tsx`, `src/app/calendario/MonthGrid.tsx`, `src/app/calendario/DayDetail.tsx`, `src/app/calendario/MatchRow.tsx`, `tests/rejilla.test.tsx` |
| t03 | `agendar` | 2 | t00 | 13, 14, 15, 16, 17, 22, 33, 29ᵇ, 38ᵇ | `src/app/calendario/DaySchedulePicker.tsx`, `src/components/ScheduleForm.tsx`, `src/components/index.ts`, `tests/agendar.test.tsx` |
| t04 | `periferia` | 2 | t00 | 37 | `src/app/rondas/page.tsx`, `src/app/mis-partidas/MatchCard.tsx`, `tests/periferia.test.tsx` |
| t05 | `integración` | 3 | t01, t02, t03, t04 | 34, 38, 39 | `tests/e2e/full-journey.spec.ts`, `tests/montaje.test.tsx`, `plan/calendario-de-verdad/trazabilidad.md` |
| t07 | `selector-navegable` | 4 | t05 | §4.5 / §9.2 (forma) | `src/app/calendario/DaySchedulePicker.tsx`, `tests/agendar.test.tsx`, `tests/montaje.test.tsx`, `tests/e2e/full-journey.spec.ts` |

ᵃ mitad de servidor · ᵇ mitad de UI. Los criterios repartidos entre dos tareas
se verifican juntos en t05.

**La ola 3 tiene una sola tarea, así que no es una ola.** t05 se ejecuta en
secuencia, al estilo de `/feature`: no hay nada que paralelizar y el ciclo
secuencial sale más barato.

**Cobertura de la spec:** los 39 criterios tienen dueño. Ninguno tiene dos
dueños sin que t05 los cierre junto.

---

## t00 — `contratos-y-fechas` · ola 1 · **DONE**

**Objetivo:** fijar la lógica pura de fechas en `Europe/Madrid`, los predicados
de agenda, las fixtures compartidas y las props de los tres componentes nuevos,
para que cuatro workers puedan arrancar sin asumir nada.

**Hecho:** commits `4ce86b7`, `84e8302`, `a9a55dc`. 69 tests nuevos, 600/600 en
la suite, 100 % de líneas y ramas en `src/server/calendar.ts`, verde con
`TZ=UTC`, `Europe/Madrid`, `America/New_York`.

**§9.5 resuelto:** `scheduleBounds` devuelve
`max = endOfDay(dayKeyOf(roundDeadline))`, no la deadline guardada. Para
octubre de 2026 el techo pasa de `2026-10-31T00:00:00Z` a
`2026-10-31T22:59:59.999Z`: una partida el propio día del cierre a las 20:00
hora española entra. Verificado por sabotaje.

**Desviación respecto a `TRACKS.md`, ya repartida:** `eligibleForDay` recibe
`rounds: RoundRef[]` dentro de su `ctx`. Con solo `month` no se puede saber qué
ronda cubre ese mes, que es justo lo que necesita «adelantar sí, retrasar no».

Detalle en `plan/calendario-de-verdad/_state/t0.json`.

---

## t01 — `guardas-de-escritura` · ola 2

**Objetivo:** que el servidor haga cumplir el rango de fechas (§4.6, §4.7), la
guarda de ronda cerrada (§4.14), la prohibición de apuntar sin fecha (§4.8) y
la de borrar la fecha de una partida jugada (§4.9).

**Criterios que cierra:** 18, 19, 20, 21, 23, 24, 25, 26, 27, 28, 30, 31, 32,
la mitad de servidor de 29 y de 34.

**Ficheros (exhaustivo):** `src/server/match-actions.ts`,
`src/server/result-actions.ts`, `tests/guardas-fecha.test.ts` (crear).

- `setMatchSchedule` llama a `canScheduleAt` y traduce cada `reason` al mensaje
  de §5.5, nombrando la ronda y su cierre o el mes de arranque.
- `reportResult` añade `canReportGivenSchedule` a su cadena de guardas, antes
  de abrir la transacción, con el patrón de las que ya tiene. **No distingue
  rol.**
- `declareWalkover` y `closeRound` **no se tocan**: que sigan funcionando sin
  fecha es criterio (26, 27), no descuido.

**Hecho cuando:** los 13 criterios tienen su `describe("AC-N: …")`; el rechazo
del criterio 25 se verifica **contando filas** de `Result` y `AuditLog`, no
mirando el `ok: false`; la rama de admin se prueba en los dos sentidos (19
acepta, 20 y 29 rechazan).

**Ojo, TOCTOU:** `reportResult` ya resuelve la ventana entre la lectura y la
escritura con una re-lectura dentro de la transacción
(`RoundClosedDuringTransactionError`). `setMatchSchedule` hereda el mismo
problema con el criterio 32: un `closeRound` concurrente entre el
`canScheduleAt` y el `update` deja pasar una escritura prohibida. Es un fallo
que ningún test encuentra si nadie lo escribe a propósito.

---

## t02 — `rejilla` · ola 2

**Objetivo:** convertir `/calendario` en la rejilla mensual de §4.1-§4.4 y
§4.11.

**Criterios que cierra:** 1-12, 35, 36, la mitad de presentación de 34 y de 38.

**Ficheros (exhaustivo):** `src/app/calendario/page.tsx`,
`src/app/calendario/MonthGrid.tsx`, `src/app/calendario/DayDetail.tsx`,
`src/app/calendario/MatchRow.tsx`, `tests/rejilla.test.tsx` (crear).

- `page.tsx` reescrita: Server Component que lee `?mes`, resuelve el mes de
  entrada con `entryMonth`, y carga **solo las partidas del mes visible** más
  las sin fecha de su ronda, **sin** el filtro `phase: "LEAGUE"`, en una
  consulta sin N+1.
- `MonthGrid` y `DayDetail` sustituyen sus stubs. La cadena de montaje
  `MonthGrid → DayDetail → DaySchedulePicker` ya está viva: **no la rompas**.
- `MatchRow` gana la marca de playoff (§4.11) y la de «jugada, falta la fecha»
  (§5.9).

**Hecho cuando:** los 15 criterios con su `describe`; la consulta del mes medida
con el cliente Prisma instrumentado de `tests/rondas-overview.test.ts` (sin
N+1); el criterio 38 probado, no mirado.

**No entra:** el contenido del selector (t03), las guardas de servidor (t01).

---

## t03 — `agendar` · ola 2

**Objetivo:** el selector del día (§4.5) y los límites del formulario de fecha.

**Criterios que cierra:** 13, 14, 15, 16, 17, 22, 33, la mitad de UI de 29 y de
38.

**Ficheros (exhaustivo):** `src/app/calendario/DaySchedulePicker.tsx`,
`src/components/ScheduleForm.tsx`, `src/components/index.ts`,
`tests/agendar.test.tsx` (crear).

- `DaySchedulePicker` sustituye su stub. Presentación pura sobre
  `eligibleForDay`: la regla «adelantar sí, retrasar no» **no se reimplementa**,
  se consume.
- `ScheduleForm`: `min`/`max` desde `scheduleBounds` (criterio 22) y el botón
  «Limpiar fecha» oculto con `resolution = PLAYED` (criterio 29). **Cuidado con
  el huso**: el `datetime-local` tiene semántica de hora local del navegador
  (así construye hoy su valor `toInputValue`); t00 devuelve `Date` a propósito
  y no expone helper de formateo.
- La **forma** del selector está abierta en §9.2 y la decide esta tarea, con la
  única restricción de §7 (tocable y legible en 390px). Si sale cara, escala
  **antes** de construirla.

**Hecho cuando:** los 9 criterios con su `describe`, y el componente probado
**montado y con clics reales** (`@testing-library/react`, como
`tests/admin-league-actions-mounted.test.tsx`), no invocando su handler a mano.

---

## t04 — `periferia` · ola 2

**Objetivo:** los dos retoques que la feature arrastra fuera del calendario.

**Criterios que cierra:** 37, y la explicación en pantalla que acompaña al 25.

**Ficheros (exhaustivo):** `src/app/rondas/page.tsx`,
`src/app/mis-partidas/MatchCard.tsx`, `tests/periferia.test.tsx` (crear).

- `/rondas`: el `h1` deja de ser «Calendario de la liga» y la bajada se ajusta
  (§4.13). **Nada más**: ni cupos, ni consultas, ni layout.
- `MatchCard`: el botón de resultado explica por qué está deshabilitado cuando
  la partida no tiene fecha, y enlaza a ponerla.

**Hecho cuando:** el criterio 37 probado comparando el render, no de palabra: el
contenido de `/rondas` (cupos, cierres, badge abierta/cerrada) es **idéntico**
al de hoy.

---

## t05 — `integración` · ola 3 (secuencial)

**Objetivo:** comprobar que cuatro tareas verdes son una feature verde.

**Criterios que cierra:** **22** (que la ola 2 dejó probado pero no vivo), 34 de
punta a punta, 38 confirmado, 39.

**Ficheros (exhaustivo), ampliados tras la review de la ola 2:**

| Fichero | Por qué |
|---|---|
| `src/server/calendar.ts` | `CalendarMatch` gana `roundDeadline` **por partida** (C1) |
| `src/app/calendario/page.tsx` | bajar `League.startMonth` y la deadline de cada partida |
| `src/app/calendario/MatchRow.tsx` | cablear las cotas al `ScheduleForm` |
| `src/app/mis-partidas/page.tsx` | lo mismo para la otra ruta |
| `src/app/mis-partidas/MatchCard.tsx` | cablearlas vía `scheduleFormPropsFor` |
| `tests/helpers/calendario.ts` | exportar `nextCreatedAt` (C8) |
| `tests/rejilla.test.tsx` | quitar el selector `stub-` que dejaría pasar un stub |
| `tests/agendar.test.tsx`, `tests/periferia.test.tsx` | el criterio 22, ahora vivo |
| `tests/montaje.test.tsx` *(crear)* | el guardián de `STUB_MARKER` y el camino real |
| `tests/e2e/full-journey.spec.ts`, `tests/e2e/calendario.spec.ts` *(crear)* | el recorrido y el criterio 38 a 390px |
| `plan/calendario-de-verdad/trazabilidad.md` *(crear)* | los 39 criterios con su test |

**Por qué se amplía:** el criterio 22 lo asignó el plan a t03 en solitario, y esa
asignación estaba mal — cruza cuatro particiones. `ScheduleForm` sabe pintar
`min`/`max`, pero ningún call site le pasa las cotas, así que son siempre
`undefined` y su test se las da a mano. Arreglarlo exige tocar el contrato de
t00, las dos páginas y las dos filas. Al ser t05 la única tarea en vuelo, la
exclusión mutua ya no aplica.

**Ojo con el techo por partida:** no vale reenviar el `roundDeadline` que
`page.tsx` ya pasa a `MonthGrid` — ése es el de la ronda **del mes visible**, y
sería el techo equivocado para las partidas de §5.2 (`roundId = null`) y para
las de playoff, que no tienen techo.

- `tests/montaje.test.tsx`: falla si `STUB_MARKER` aparece en cualquier fichero
  de `src/`, y recorre el camino real — montar `/calendario`, clicar un día,
  ver el selector, elegir una partida, ver la fecha puesta.
- `full-journey.spec.ts`: el recorrido pasa por la rejilla en vez de por las
  listas, y **agenda antes de apuntar**.
- `trazabilidad.md`: los 39 criterios con el test que los cierra, como
  `plan/rondas-con-fecha/trazabilidad.md`.

**Por qué existe esta tarea:** en la PR #1 de este repo, cuatro componentes se
quedaron sin montar porque el punto de extensión devolvía `null` y la suite
siguió en verde. Pasó **tres veces**: *el test verificaba la función, no el
camino*. Es el modo de fallo propio de trabajar en paralelo con puntos de
montaje, y `tests/montaje.test.tsx` existe para cerrarlo.

---

## t07 — `selector-navegable` · ola 4 (secuencial)

**Nace del feedback del usuario en `HUMAN_REVIEW`**, 20 de septiembre de 2026:

> «las partidas que se muestren para seleccionar en un día de un mes lo suyo es
> que aparezcan separadas visualmente por rondas y con un buscador porque son
> muchas y es difícil encontrar la que quieres»

**No es un cambio de spec.** §4.5 fija *qué* ofrece el selector y §9.2 dejó su
**forma** explícitamente abierta («hoja inferior, lista inline bajo la celda,
modal… se cierra al implementar»). Agrupar y buscar caen dentro de esa
apertura: no se toca qué partidas son elegibles, solo cómo se encuentran entre
ellas. La spec sigue en v3 y no se reabre.

**El problema es real y peor de lo que parece.** Para un jugador, el primer mes
ofrece sus partidas de todas las rondas: con 13 jugadores, 12 candidatas. Para
un **admin**, `eligibleForDay` no aplica la regla de rondas (criterio 17), así
que puede ver **las 78 partidas de la liga** en una lista plana sin cortes.

**Objetivo:** que el selector siga siendo la lista en línea de §9.2 — sin
modal, sin portal, sin scroll propio — pero navegable: agrupada por ronda y
filtrable por nombre.

**Ficheros (exhaustivo):** `src/app/calendario/DaySchedulePicker.tsx`,
`tests/agendar.test.tsx`, `tests/montaje.test.tsx`,
`tests/e2e/full-journey.spec.ts`.

**Hecho cuando:**

1. Las candidatas salen **agrupadas por ronda**, con una cabecera por grupo
   (`Ronda 2`), en orden ascendente de ronda. Las que no tienen ronda
   (playoff, o `roundId = null`) van en su propio grupo al final.
2. Dentro de cada grupo se conserva el orden en que llegan: la elegibilidad y
   su orden los decide `eligibleForDay`, no este componente.
3. Hay un **buscador** que filtra por el nombre de cualquiera de los dos
   jugadores, **insensible a mayúsculas y a acentos** (`Martín` se encuentra
   escribiendo `martin`). Un grupo que se queda sin candidatas tras filtrar no
   se pinta.
4. El buscador aparece **solo con más de 6 candidatas**. Por debajo, la lista
   agrupada cabe de un vistazo y un campo de texto es ruido. *(Umbral elegido
   aquí, no por la spec: revisable.)*
5. Filtrar hasta cero resultados muestra un estado vacío que lo dice, no una
   lista en blanco.
6. Se conserva todo lo que ya cumplía: el segundo paso de la hora, que elegir
   una partida ya fechada la **mueve**, que no se envía `location`, que con
   `candidates: []` el componente devuelve `null`, y los 390px sin scroll
   horizontal.

**No entra:**

- **No se toca `eligibleForDay` ni `SchedulableMatch`.** Si para agrupar
  hiciera falta un dato que el tipo no lleva —el mes de la ronda, por ejemplo—
  se agrupa con lo que hay (`roundIndex`) en vez de ensanchar el contrato.
- No se toca la página, ni la rejilla, ni el servidor.
- El buscador es estado local del componente: no va a la URL ni se persiste.
