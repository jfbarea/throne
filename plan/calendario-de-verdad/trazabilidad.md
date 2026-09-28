# Trazabilidad — `calendario-de-verdad`

Mapa criterio → test para los **39 criterios de aceptación** de
`plan/specs/calendario-de-verdad.md` §8. Ninguno queda huérfano y ninguno se
marca cerrado sin un test que lo compruebe.

Convención heredada de `plan/rondas-con-fecha/trazabilidad.md`: cada test que
cierra un criterio lo nombra en su `describe` / `test.describe` como `AC-N: …`,
así que la correspondencia se audita por nombre, no solo leyendo el código. Los
`describe("T0-AC…")` de `tests/calendar.test.ts` son los del track de contratos
(t00), que cubren la **lógica pura** que varios criterios comparten; se citan
como apoyo, nunca como el cierre de un criterio por sí solos.

**Leyenda de estado**

| Estado | Significado |
| --- | --- |
| ✅ | Cerrado: hay test, y el test recorre lo que el criterio afirma. |
| ⚠️ | Cerrado con matiz: el test cubre el criterio literal, pero hay una parte acotada que no alcanza. El matiz está escrito, no escondido. |

No hay ningún criterio abierto. Los dos matices (17 y el hueco de los playoffs
sin fecha) están en §5, con su alcance exacto.

---

## 1. Mapa criterio → test (los 39 de §8)

### La rejilla (1-12)

| # | Criterio (resumen) | Test | Harness | Estado |
| - | --- | --- | --- | --- |
| 1 | 7 columnas desde lunes, semanas completas, relleno apagado e inerte | `tests/rejilla.test.tsx` — `describe("AC-1: …")` | Vitest + jsdom, página real y DB de test | ✅ |
| 2 | Cabecera `Mes Año · Ronda N · cierra el D` desde `Round.deadline` | `tests/rejilla.test.tsx` — `describe("AC-2: …")` | Vitest + jsdom, página real | ✅ |
| 3 | El punto cae en el día de `Europe/Madrid` (1 nov 00:30 es 1 nov) | `tests/rejilla.test.tsx` — `describe("AC-3: …")`; puro en `tests/calendar.test.ts` — `describe("T0-AC1: …")` | Vitest + jsdom / puro | ✅ |
| 4 | Punto en `--accent` con resultado, apagado sin él | `tests/rejilla.test.tsx` — `describe("AC-4: …")` | Vitest + jsdom | ✅ |
| 5 | El punto de una partida del jugador de la sesión se distingue | `tests/rejilla.test.tsx` — `describe("AC-5: …")` | Vitest + jsdom | ✅ |
| 6 | 6 partidas → 4 puntos y `+2`; el detalle lista las 6 | `tests/rejilla.test.tsx` — `describe("AC-6: …")` | Vitest + jsdom | ✅ |
| 7 | Tocar despliega el detalle; volver a tocar lo cierra; uno a la vez | `tests/rejilla.test.tsx` — `describe("AC-7: …")` | Vitest + jsdom, clics reales | ✅ |
| 8 | `?mes=AAAA-MM` en el servidor, flechas como enlaces, `?mes` inválido sin error | `tests/rejilla.test.tsx` — `describe("AC-8: …")`; puro en `describe("T0-AC5: …")` | Vitest + jsdom / puro | ✅ |
| 9 | Mes de entrada: hoy → primera ronda abierta → última ronda | `tests/rejilla.test.tsx` — `describe("AC-9: …")` | Vitest + jsdom, reloj congelado | ✅ |
| 10 | `←` muerta en el primer mes, `→` en el último | `tests/rejilla.test.tsx` — `describe("AC-10: …")` | Vitest + jsdom | ✅ |
| 11 | El bloque «Sin fecha · Ronda N» es el de la ronda del mes y cambia al navegar | `tests/rejilla.test.tsx` — `describe("AC-11: …")` | Vitest + jsdom | ✅ |
| 12 | Playoffs pintados; mes sin ronda → «Playoffs» y «Sin fecha · Playoffs» | `tests/rejilla.test.tsx` — `describe("AC-12: …")` | Vitest + jsdom | ✅ |

### Agendar desde la rejilla (13-17)

| # | Criterio (resumen) | Test | Harness | Estado |
| - | --- | --- | --- | --- |
| 13 | El selector ofrece la ronda del mes y las posteriores, con su fecha, nunca las anteriores | `tests/agendar.test.tsx` — `describe("AC-13: …")`; regla pura en `tests/calendar.test.ts` — `describe("T0-AC4c: …")` | Vitest + jsdom, componente montado y clicado | ✅ |
| 14 | Elegir una partida ya fechada la mueve a ese día | `tests/agendar.test.tsx` — `describe("AC-14: …")`; camino completo en `tests/montaje.test.tsx` — `describe("Montaje: de /calendario a la fecha puesta …")` | Vitest + jsdom / página real con `setMatchSchedule` real | ✅ |
| 15 | El selector está en un día vacío y al pie del detalle de un día con partidas | `tests/agendar.test.tsx` — `describe("AC-15: …")`; montaje desde la página en `tests/rejilla.test.tsx` — `describe("AC-7: …")` (último `it`) y `tests/montaje.test.tsx` | Vitest + jsdom | ✅ |
| 16 | Un día sin nada agendable no abre selector | `tests/agendar.test.tsx` — `describe("AC-16: …")`; desde la página en `tests/montaje.test.tsx` — `it("un día del que la sesión no puede llevar nada no abre selector …")` | Vitest + jsdom | ✅ |
| 17 | El selector de un admin ofrece partidas de cualquier ronda | `tests/agendar.test.tsx` — `describe("AC-17: …")`; regla pura en `describe("T0-AC4c: …")` | Vitest + jsdom | ⚠️ ver §5.1 |

### El rango de fechas (18-24)

| # | Criterio (resumen) | Test | Harness | Estado |
| - | --- | --- | --- | --- |
| 18 | Rechaza al participante una fecha posterior a la deadline, nombrando ronda y cierre | `tests/guardas-fecha.test.ts` — `describe("AC-18: …")`; predicado en `describe("T0-AC4: …")` | Vitest, DB de test + acción real | ✅ |
| 19 | La misma llamada, hecha por un admin, se acepta | `tests/guardas-fecha.test.ts` — `describe("AC-19: …")` | Vitest, DB de test | ✅ |
| 20 | Rechaza, para cualquier rol, una fecha anterior al día 1 de `startMonth` | `tests/guardas-fecha.test.ts` — `describe("AC-20: …")` | Vitest, DB de test | ✅ |
| 21 | Una fecha pasada dentro del rango se acepta para cualquier rol | `tests/guardas-fecha.test.ts` — `describe("AC-21: …")` | Vitest, DB de test | ✅ |
| 22 | El `datetime-local` lleva `min` y `max` coherentes con los dos extremos | `tests/montaje.test.tsx` — `describe("AC-22 (vivo, desde la página): …")`; costuras en `tests/agendar.test.tsx` — `describe("AC-22: …")` y `describe("AC-22 (vivo): MatchRow …")`, y `tests/periferia.test.tsx` — `describe("AC-22 en /mis-partidas: …")` | Vitest + jsdom, **páginas reales** | ✅ ver §4 |
| 23 | Una partida de playoff (`roundId = null`) acepta cualquier fecha desde el suelo | `tests/guardas-fecha.test.ts` — `describe("AC-23: …")` | Vitest, DB de test | ✅ |
| 24 | Cambiar solo el `location` de una partida fuera de rango no se rechaza | `tests/guardas-fecha.test.ts` — `describe("AC-24: …")` | Vitest, DB de test | ✅ |

### Sin fecha no hay resultado (25-31)

| # | Criterio (resumen) | Test | Harness | Estado |
| - | --- | --- | --- | --- |
| 25 | `reportResult` sin fecha se rechaza, también para el admin, sin `Result` ni `AuditLog` | `tests/guardas-fecha.test.ts` — `describe("AC-25: …")` (cuenta filas, no mira `ok:false`); en pantalla, `tests/periferia.test.tsx` — `describe("AC-25 (en pantalla): …")`; de punta a punta, `tests/e2e/full-journey.spec.ts` paso 7 | Vitest DB + Vitest render + Playwright | ✅ |
| 26 | `declareWalkover` sin fecha sigue funcionando y crea `WALKOVER` | `tests/guardas-fecha.test.ts` — `describe("AC-26: …")` | Vitest, DB de test | ✅ |
| 27 | `closeRound` sigue saldando a `UNPLAYED_DRAW` las partidas sin fecha | `tests/guardas-fecha.test.ts` — `describe("AC-27: …")` | Vitest, DB de test | ✅ |
| 28 | `reportResult` con `scheduledAt` futura se acepta | `tests/guardas-fecha.test.ts` — `describe("AC-28: …")` | Vitest, DB de test | ✅ |
| 29 | `scheduledAt: null` sobre `PLAYED` se rechaza; «Limpiar fecha» no se pinta | Servidor: `tests/guardas-fecha.test.ts` — `describe("AC-29 (servidor): …")`. UI: `tests/agendar.test.tsx` — `describe("AC-29 (UI): …")` y `tests/periferia.test.tsx` — `describe("AC-29 en /mis-partidas: …")` | Vitest DB + Vitest render | ✅ |
| 30 | La misma llamada sin `Result`, o con `WALKOVER`/`UNPLAYED_DRAW`, se acepta | `tests/guardas-fecha.test.ts` — `describe("AC-30: …")` | Vitest, DB de test | ✅ |
| 31 | Cambiar la fecha (no borrarla) de una `PLAYED` se acepta dentro del rango | `tests/guardas-fecha.test.ts` — `describe("AC-31: …")` | Vitest, DB de test | ✅ |

### Ronda cerrada (32-33)

| # | Criterio (resumen) | Test | Harness | Estado |
| - | --- | --- | --- | --- |
| 32 | El participante no fecha en ronda cerrada; el admin sí; predicado `canReportGivenRoundClosed` | `tests/guardas-fecha.test.ts` — `describe("AC-32: …")`, incluida la ventana TOCTOU | Vitest, DB de test | ✅ |
| 33 | El selector no ofrece a un jugador partidas de rondas cerradas | `tests/agendar.test.tsx` — `describe("AC-33: …")`; regla pura en `describe("T0-AC4c: …")` | Vitest + jsdom | ✅ |

### Datos existentes y casos límite (34-39)

| # | Criterio (resumen) | Test | Harness | Estado |
| - | --- | --- | --- | --- |
| 34 | Un `PLAYED` sin fecha **sigue contando en la clasificación**, se ve marcado «jugada, falta la fecha», y editarlo obliga a fechar primero | Clasificación: `tests/montaje.test.tsx` — `describe("AC-34 (clasificación): …")`. Presentación: `tests/rejilla.test.tsx` — `describe("AC-34: …")`. Edición: `tests/guardas-fecha.test.ts` — `describe("AC-34 (servidor): …")` | Vitest + jsdom + DB de test | ✅ ver §4 |
| 35 | Liga sin `startMonth`: rejilla de hoy, vacía, con el mensaje y las flechas muertas | `tests/rejilla.test.tsx` — `describe("AC-35: …")` | Vitest + jsdom | ✅ |
| 36 | `roundId = null` aparece en el bloque de la primera ronda abierta, «Sin ronda», sin tope | `tests/rejilla.test.tsx` — `describe("AC-36: …")` (presentación); sin tope en `tests/guardas-fecha.test.ts` — `describe("AC-23: …")` y en `tests/montaje.test.tsx` (el input sin `max`) | Vitest + jsdom + DB de test | ✅ |
| 37 | `/rondas` ya no se titula «Calendario de la liga» y su contenido es el de hoy | `tests/periferia.test.tsx` — `describe("AC-37: …")`, comparando el render contra una captura literal del markup anterior | Vitest, render de la página | ✅ |
| 38 | La rejilla y el detalle caben en 390px sin scroll horizontal del documento | `tests/e2e/calendario.spec.ts` — `test.describe("AC-38: …")` (4 tests, viewport 390×844, medida real de `scrollWidth`). Heurísticas estáticas de apoyo: `tests/rejilla.test.tsx` y `tests/agendar.test.tsx` — `describe("AC-38 …")` | **Playwright** + Vitest | ✅ ver §3 |
| 39 | La suite existente sigue verde, incluidas `reportar-confirmar`, `incomparecencia` y `cierre-de-ronda` | `npm run test` → **717/717**, 25 ficheros. Ver §2 para el detalle de los tres ficheros que la spec nombra | Vitest, suite completa | ✅ |

---

## 2. Criterio 39 — los tres ficheros que la spec nombra

Ninguno se dejó «verde por accidente»: el cambio de cada uno está justificado
contra la spec, y está revisado en `plan/calendario-de-verdad/reviews/wave-2.md`
(«El trabajo de gate del orquestador»).

- **`tests/reportar-confirmar.test.ts`** — es el ajuste que más merecía
  discusión, y es exactamente lo que §4.8 pide. Ese fichero afirmaba que
  apuntar un resultado sobre una partida **sin fecha** funcionaba; §4.8 invierte
  esa invariante y §6.3 lo llama «rompe hacia atrás, a propósito». La aserción
  que sobrevive es la que la spec sí conserva; el rechazo nuevo está probado
  contra la acción real en `tests/guardas-fecha.test.ts` — `describe("AC-25: …")`.
- **`tests/incomparecencia.test.ts`** y **`tests/cierre-de-ronda.test.ts`** —
  tocados en el commit `31548e2`, pero **solo en la precondición**: las partidas
  que el test lleva a `reportResult` ganan fecha al crearse. Las que tienen que
  seguir resolviéndose **sin** fecha se quedan sin ella a propósito, que es lo
  que los criterios 26 y 27 exigen; ninguna aserción cambió.
- **`tests/endurecer-guardas-transaccionales.test.ts`** y
  **`tests/recalculo-alta-baja-y-cupo.test.ts`** — el mismo ajuste de
  precondición, por la misma razón.

---

## 3. Criterio 38 — lo que cambió respecto de la ola 2

Al cerrar la ola 2 el criterio 38 estaba comprobado **estructuralmente**: ni
anchos fijos declarados, ni `overflow-x`, ni celdas sin `min-w-0`. Eso es una
heurística sobre las causas habituales del desbordamiento, no el criterio —
jsdom no calcula layout, así que allí `scrollWidth` vale siempre 0 y «cabe en
390px» no se puede afirmar.

`tests/e2e/calendario.spec.ts` lo mide de verdad, en un navegador, a 390×844, en
los tres estados que son tres layouts distintos:

1. la rejilla sola;
2. la rejilla con un día desplegado (§4.3);
3. el detalle con el selector abierto (§4.5), lo más ancho que esta pantalla
   llega a pintar.

Y en cada uno comprueba dos cosas: que el **documento** no desborda
(`documentElement.scrollWidth − clientWidth ≤ 1`) y que ni la rejilla, ni el
detalle, ni el selector scrollean por su cuenta — §7: «el que scrollea es el
documento». Un cuarto test mide las 7 columnas de una semana: ninguna se sale
por la derecha y ninguna baja de 36 px, que es lo que hace de la celda un
objetivo táctil (§7).

Las heurísticas de jsdom **se conservan**: son baratas, corren en cada `npm run
test` y cazan la regresión en el commit que la introduce, no en el `npm run e2e`
de después.

---

## 4. Los dos criterios que la ola 2 dejó a medias

### 4.1. Criterio 22 — estaba probado pero no vivo

Hallazgo C1 de `reviews/wave-2.md`. `ScheduleForm` sabía pintar `min`/`max`
desde `scheduleBounds`, pero **ningún call site de `src/` le pasaba las cotas**:
eran siempre `undefined`, y el test que lo cubría se las daba a mano. Era
literalmente «un test que prueba una función que nadie llama».

Cerrado en t05 ampliando el contrato de t00: `CalendarMatch`
(`src/server/calendar.ts`) gana `roundDeadline` y `leagueStartMonth` **por
partida**, las dos páginas los bajan de la base de datos
(`src/app/calendario/page.tsx`, `src/app/mis-partidas/page.tsx`) y las dos filas
los cablean al formulario (`MatchRow`, `MatchCard` vía `scheduleFormPropsFor`).

**El techo es por partida y no del mes visible, a propósito.** Reenviar el
`roundDeadline` que `page.tsx` ya pasa a `MonthGrid` habría sido el techo
equivocado para dos casos que la spec nombra: las partidas de §5.2
(`roundId = null`, que se listan en el bloque de **otra** ronda) y las de
playoff, que no tienen techo (§4.11). Ambos casos tienen su test: el input sale
sin `max`.

El cierre se comprueba **desde la página**, no pasando props:
`tests/montaje.test.tsx` — `describe("AC-22 (vivo, desde la página): …")` monta
`/calendario` y `/mis-partidas` con filas reales, abre el formulario con un clic
real y lee los atributos del input. Fallo-antes-del-cambio verificado por
sabotaje: quitando las dos props de `MatchRow` fallan 3 tests de
`agendar.test.tsx` y 2 de `montaje.test.tsx`; devolviendo `null` en las dos cotas
de `mis-partidas/page.tsx` falla el tercero.

### 4.2. Criterio 34 — la clasificación no la afirmaba nadie

§5.9 promete tres cosas de un `Result` PLAYED sin fecha anterior a la spec. Dos
tenían dueño en la ola 2 (se ve marcado «jugada, falta la fecha», t02; editarlo
obliga a fechar primero, t01). La tercera — **«siguen contando en la
clasificación exactamente igual»** — no la afirmaba ningún test: se daba por
cierta porque `computeStandings` nunca ha mirado `scheduledAt`.

Es una buena razón, pero es un razonamiento, no una comprobación, y es justo el
tipo de cosa que una guarda nueva rompe en silencio. `tests/montaje.test.tsx` —
`describe("AC-34 (clasificación): …")` renderiza `/clasificacion` sobre la
fixture y comprueba las tres cifras de la fila de Bob (PJ 2, VP+ 130, VP- 135),
de las que la partida legacy sin fecha aporta 1, 70 y 55. Fallo-antes-del-cambio
verificado por sabotaje: filtrando las partidas sin `scheduledAt` en
`src/app/clasificacion/page.tsx`, el test falla.

---

## 5. Desviaciones y limitaciones conocidas

Las tres están **ratificadas**, no descubiertas aquí: las dos primeras las
anotó `reviews/wave-2.md` y el usuario está informado. Se recogen porque un
documento de trazabilidad que las omitiera diría que la feature está más cerrada
de lo que está.

### 5.1. Criterio 17: el admin y las partidas ya fechadas de otro

El criterio dice «el selector de un admin ofrece partidas de cualquier ronda», y
eso es literalmente cierto: `eligibleForDay` no aplica la regla de rondas al
admin, y hay test. El matiz es de la **consulta**, no de la regla:
`src/app/calendario/page.tsx` carga las partidas del mes visible, **todas** las
que no tienen fecha, y las del jugador de la sesión estén donde estén. Un admin
sin `Player` asociado (§5.11) no tiene «las suyas», así que una partida de otro
jugador que **ya esté fechada en otro mes** no está entre las candidatas de su
selector: para moverla, navega a su mes.

Las sin fecha de cualquier ronda sí se le ofrecen siempre, que es la lectura
literal del criterio, y mover una partida ya fechada tiene su camino propio (el
botón «Fecha» de la fila). No es un callejón sin salida.

### 5.2. §4.11 vs §5.1: el sufijo «· Playoffs» solo si el mes tiene contenido

§4.11 dice que un mes sin ronda se titula «Playoffs». §5.1 pide pintar la
rejilla **del mes de hoy** para una liga en SETUP, que tampoco tiene ronda — y
llamar «Playoffs» a ese mes vacío sería falso.

t02 lo resolvió pintando el sufijo solo si el mes tiene contenido de playoff
(`MonthGrid`: `roundIndex === null && (matches.length > 0 || unscheduled.length
> 0)`). El razonamiento es bueno y los dos casos tienen test (criterio 12 para
el mes de playoff, criterio 35 para el mes vacío de SETUP), pero **se decidió en
un comentario en vez de escalarse**, que es el hábito que el modelo paralelo
intenta evitar. Queda aquí como **desviación ratificada**: el comportamiento es
el que se quiere, y la spec no se reescribe por ello.

### 5.3. Partidas de playoff sin fecha, cuando no hay ningún mes de playoff navegable

El rango de meses navegable se deriva de las rondas **y de los playoffs
fechados** (§4.11). Si todas las partidas de playoff están sin fechar, no hay
ningún mes de playoff navegable, y por tanto no hay ningún sitio donde se pinte
su bloque «Sin fecha · Playoffs».

**No hay callejón sin salida**: el selector del día sí las ofrece (§4.5 no
aplica la regla de rondas a las partidas sin ronda), así que se pueden fechar
desde cualquier día navegable, y en cuanto una se fecha su mes entra en el rango
y el bloque aparece. Ningún criterio de §8 exige lo contrario — el criterio 12
prueba el bloque en un mes de playoff navegable, que es lo que pide.

Queda anotado como **limitación conocida**, no como fallo. Si molestara, la
salida natural sería ampliar `navigableMonths` con los meses de playoff sin
fecha, y eso es un cambio de §4.11 que se decide en `/specs`, no aquí.

---

## 6. Salida real del gate al cerrar t05

Los cuatro comandos, sobre la rama `feat/calendario-de-verdad`:

| Comando | Resultado |
| --- | --- |
| `npm run lint` | limpio — 0 errores, 0 warnings |
| `npx tsc --noEmit` | limpio |
| `npm run test` | **717/717**, 25 ficheros |
| `npm run build` | compila; 21 rutas, sin cambios de árbol |
| `npm run e2e` | **78/78**, 0 skipped, en los dos proyectos (chromium y mobile-chrome) |

Reparto de los tests de la feature por fichero:

| Fichero | Tests | Qué cubre |
| --- | --- | --- |
| `tests/calendar.test.ts` | 66 | La lógica pura de fechas y los predicados (t00) |
| `tests/guardas-fecha.test.ts` | 29 | Las guardas de servidor (t01) |
| `tests/rejilla.test.tsx` | 38 | La rejilla, por la página real (t02) |
| `tests/agendar.test.tsx` | 26 | El selector y el formulario de fecha (t03) |
| `tests/periferia.test.tsx` | 19 | `/rondas` y `MatchCard` (t04) |
| `tests/montaje.test.tsx` | 8 | El guardián de stubs y el camino real (t05) |
| `tests/e2e/calendario.spec.ts` | 4 × 2 proyectos | El criterio 38 medido a 390px (t05) |

---

## 7. Fallo-antes-del-cambio

Lo que t05 añade se verificó por sabotaje, no por confianza:

| Test nuevo | Sabotaje | Resultado |
| --- | --- | --- |
| `AC-22 (vivo): MatchRow …` (3 tests) | Quitar `leagueStartMonth`/`roundDeadline` del `<ScheduleForm>` de `MatchRow` | 3 fallan |
| `AC-22 (vivo, desde la página)` en `/calendario` (2 tests) | El mismo sabotaje | 2 fallan |
| `AC-22 (vivo, desde la página)` en `/mis-partidas` | Devolver `null` en las dos cotas de `mis-partidas/page.tsx` | falla |
| `Montaje: ningún stub sobrevive en src/` | Reintroducir `STUB_MARKER` en `DayDetail.tsx` | falla |
| `Montaje: de /calendario a la fecha puesta …` | Devolver `null` donde `DayDetail` monta `DaySchedulePicker` | falla |
| `AC-34 (clasificación)` | Filtrar las partidas sin `scheduledAt` en `clasificacion/page.tsx` | falla |
| `AC-38` en Playwright | No se sabotea: lo que mide es layout de navegador, y la heurística de jsdom que sustituye ya estaba verde con el mismo código — que es precisamente el motivo de que exista |

El endurecimiento de `tests/rejilla.test.tsx` (quitar el selector
`[data-testid='stub-day-schedule-picker']` que aceptaba un stub como
alternativa) se acredita con el mismo sabotaje del stub: con el selector viejo
ese test pasaba contra el placeholder; con el nuevo, no.
