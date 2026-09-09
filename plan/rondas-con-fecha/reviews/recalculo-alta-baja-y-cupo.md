# Review — H8 `recalculo-alta-baja-y-cupo`

**Commit revisado:** `d50a7bc`.

## Veredicto: CHANGES_REQUESTED

El hito tiene un diseño cuidadoso — la reutilización de `assignPairsToRounds`
es limpia, el patrón TOCTOU de D5/H5b está bien aplicado dos veces, y la
cobertura de los criterios 30-33 es sólida. Pero al auditar el punto 1 del
encargo (el invariante del reparto, "el corazón del hito") encontré un
**bloqueante real y fácilmente reproducible, sin necesidad de ninguna
carrera**: `redistributePending` decide dónde va cada partida pendiente **sin
tener en cuenta el cupo que ya consumen, en la misma ronda abierta, las
partidas del mismo jugador que ya tienen `Result`**. Lo reproduje con el
disparador real del producto (`addMissingLeagueMatches`, una alta a mitad de
liga) y un jugador con una sola partida ya jugada: el recálculo le asigna una
partida pendiente a la **misma ronda** donde ya tenía la jugada, dejándolo con
2 partidas en una ronda de `matchesPerRound = 1` — viola el criterio 2 en el
caso más normal y esperado del hito, sin ninguna concurrencia de por medio.
Es más grave que la limitación que el propio builder señaló sin resolver (la
carrera de dos `redistributePending`), y no está documentada en ningún sitio.

Sobre la limitación que sí señaló el builder (la colisión de índice de
`Round`): la reproduje, y mi lectura coincide con la tuya — falla fuerte y
atómico dentro de la propia transacción de `redistributePending`, sin dejar
rondas a medio escribir. Pero encontré un matiz que cambia el veredicto sobre
si bloquea: en el disparador `addMissingLeagueMatches` (y, en menor medida,
`setPlayerActive`), el flujo compuesto **no es atómico de punta a punta** —
las partidas nuevas ya se crearon y confirmaron en su propia transacción
**antes** de invocar `redistributePending` por separado. Si esa segunda
llamada falla (por esta colisión o por cualquier otro motivo), las partidas
nuevas quedan con `roundId: null` — un estado que la UI ya sabe mostrar (H6,
"Sin ronda asignada"), no corrupto ni fatal, pero **no autorreparable
reintentando la misma acción**: `addMissingLeagueMatches` volvería a ver cero
pares por crear y no volvería a llamar a `redistributePending`. Dado que la
probabilidad de esta carrera concreta es baja (dos acciones de admin
simultáneas sobre la misma liga, en una liga privada de amigos con
presumiblemente un solo admin activo a la vez) y su efecto está acotado y ya
soportado por la UI, **no la trato como bloqueante por sí sola** — pero sí
recomiendo registrarla como deuda explícita con este matiz, no solo con el
paralelismo al doble-cierre de H5b que propone el builder.

## 1. El bloqueante: el reparto no cuenta el cupo ya consumido por partidas jugadas

Lo reproduje dos veces, primero contra `redistributePending` directamente y
después contra el disparador real del producto:

**Reproducción con el disparador real** (`addMissingLeagueMatches`, la vía de
"alta a mitad de liga" que describe la spec §5.1): liga con `matchesPerRound
= 1` y 4 jugadores (P, A, X, Y). `generateLeagueMatches` genera el K4 real.
Reporto de verdad la partida P-A (queda con `Result`, en la ronda donde el
algoritmo la puso). Añado un quinto jugador y llamo a
`addMissingLeagueMatches` — el flujo real que un admin dispara desde
`/admin/emparejamientos`. Resultado:

```
addMissingLeagueMatches result: { ok: true, data: { count: 4 } }
P's per-round match counts: { round-X: 1, round-Y: 2, round-Z: 1 }
P vs A's (resolved) round: round-Y
```

El jugador P termina con **2 partidas en la misma ronda** con
`matchesPerRound = 1` — la ronda donde ya tenía su P-A jugada, más una de las
nuevas que el recálculo le coló ahí. Ninguno de los 8 tests nuevos de H8 lo
detecta porque ninguno de sus escenarios construye esta forma exacta (un
jugador con una partida **jugada** y otra(s) **pendiente(s)** compartiendo
**la misma ronda abierta**): en AC-29 los resultados reales viven en rondas
que se **cierran** antes de la alta (fuera del alcance de la redistribución
por completo); en AC-34/35 el K6 de prueba se construye deliberadamente sin
ningún `Result`, con los dos jugadores que sí tienen un resultado cerrado en
una ronda aparte y con jugadores propios, para que "la matemática del
coloreado salga exacta" — ninguno de los dos escenarios llega a ejercitar el
caso.

**Causa raíz.** `assignPairsToRounds` (H2, `rounds.ts`) documenta
explícitamente su propio contrato: "esta función nunca ve, y por tanto nunca
reasigna, un par que ya tiene `Result` — excluirlos es responsabilidad de
quien la llama". `planRedistribution` cumple la mitad de ese contrato —
**excluye** las partidas con `Result` del conjunto a colorear — pero no
cumple la otra mitad: no le comunica al algoritmo, de ninguna forma, que un
jugador **ya tiene ocupado** un hueco de su cupo en una ronda abierta
concreta por una partida que no está en el conjunto a repartir. El
coloreado calcula un reparto perfectamente válido **para las partidas
pendientes en sí mismas** (nunca pone dos pendientes del mismo jugador en la
misma ronda — eso sí lo garantiza Misra-Gries) pero esa garantía es ciega a
lo que ya hay sentado en esas rondas por fuera del conjunto que está
coloreando.

Este no es un caso raro: es exactamente el escenario que describe la propia
spec en su ejemplo de cabecera de §5.1 ("un jugador que entra en el mes 3")
— con la única condición de que **alguien ya haya jugado una partida antes de
que la ronda en la que cayó se cierre**, algo que va a ser la norma, no la
excepción, en cuanto la liga lleve un par de semanas en marcha dentro de
cualquier ronda abierta.

**Este es un bloqueante**, no una decisión de producto que deba escalarse: la
spec es inequívoca en que el invariante del cupo (criterio 2, "ningún jugador
tiene más de `matchesPerRound` partidas en la misma ronda") se mantiene tras
cualquier recálculo, y el propio criterio 29 lo repite explícitamente
("repartidas respetando el criterio 2"). No hay ninguna lectura de la spec
que autorice esto.

## 2. El invariante del reparto — los tests solo lo verifican parcialmente

Antes de encontrar el bloqueante del punto 1, audité si `assertQuotaInvariant`
(el helper nuevo de H8) es una verificación real o solo cuenta rondas.
**Sí es real** para lo que comprueba: recorre TODAS las partidas con
`roundId` no nulo de la liga completa (no solo las recién movidas) y calcula,
por jugador y por ronda, cuántas partidas tiene — exactamente el criterio 2.
Lo confirmé rompiéndolo a propósito: saboteé `planRedistribution` para que
`planAssignments` descartara la **última** asignación del array (una partida
"perdida" en el reparto) y ejecuté la suite completa — 4 de los 8 tests lo
cazaron (`AC-29`, `AC-31`, `AC-34`, `AC-35`), con `assertQuotaInvariant`
fallando con un mensaje exacto de qué jugador y qué ronda excede el cupo.

Pero también descarté la **primera** asignación del array en vez de la
última, y en ese caso **los 8 tests pasaron** — la asignación descartada
resultó ser un no-op para ese escenario concreto (la partida ya estaba, por
casualidad, en la ronda a la que "no se movió"). Esto no es un fallo del
mismo calibre que el punto 1 —la suite sí caza la mayoría de formas de
"partida perdida", solo no todas, dependiendo de qué posición del array se
pierda y del escenario concreto— pero confirma que la cobertura no es
exhaustiva como la de H2: `assertValidReparto` (H2, con generación
aleatoria sobre muchos tamaños) no se reutiliza aquí, y los 8 escenarios de
H8 son concretos, no aleatorizados. Lo dejo como sugerencia de refuerzo, no
como bloqueante adicional — el bloqueante real de esta revisión es el punto
1, que ningún escenario ejercita en absoluto, no un caso que a veces se cuela.

## 3. La cota de `participantIds.length` — verificada, matemáticamente correcta

Verifiqué la prueba del código (`neededRounds = ceil(factors.length /
groupSize) ≤ factors.length ≤ Δ+1 ≤ participantIds.length`, válida tanto en
la rama de grafo completo —`decomposeCompleteGraph`, `factors.length` es
`n-1` o `n`— como en la general —`misraGriesColoring`, acotada por Vizing—) y
la confirmé computacionalmente: generé 660 subgrafos aleatorios (tamaños de 2
a 20 jugadores, `k` ∈ {1,2,3}, densidades de arista del 15 % al 100 %) y
llamé a `assignPairsToRounds` con exactamente `participantIds.length` índices
candidatos en cada caso. **Cero fallos** — nunca hizo falta más, y nunca se
quedó corto. La cota es real y suficiente, aunque generosa (no ajustada al
mínimo).

## 4. `scheduledAt` intacto (criterio 31) — el caso que importa, cubierto

AC-31 no se conforma con partidas "de prueba" sin fecha: crea las 10 parejas
de un K5 completo, **todas** con `scheduledAt` distinto, deliberadamente
amontonadas en una sola ronda (un estado de partida inválido a propósito, 4
partidas por jugador con cupo 2), llama a `redistributePending` y comprueba
que **cada** `scheduledAt` sigue intacto y que exactamente 5 de las 10 (las
que Walecki manda a la segunda ronda) cambiaron de `roundId`. Es precisamente
el caso que importa — partidas con fecha que sí cambian de ronda — no un caso
degenerado sin fecha.

## 5. Criterio 29 — comparación completa, no solo existencia

Confirmado leyendo el test: `resultsBefore`/`resultsAfter` son objetos
`Result` completos (`prisma.result.findMany` sin `select`), comparados con
`toEqual`, no solo verificando que sigan existiendo. Mismo patrón para
`roundsBefore`/`roundsAfter` (filas `Round` completas). Ambas rondas cerradas
antes de la alta, con dos resultados reales y el resto saldado 0-0 por
`closeRound` — el escenario mixto que de verdad ejercita "quedan idénticos".

## 6. Criterio 32 — el 80-0 sin bonus, con la config exacta del seed

`AC-32` usa `bonusEnabled: true, bonusMarginThreshold: 20, bonusMinVP: 40` —
la config exacta del seed— y prueba, con `calculateBonus` real, que un 80-0
con esa config **daría** 2 de bonus antes de comprobar que el `Result`
persistido por `setPlayerActive(false)` tiene `bonusHome: 0, bonusAway: 0`.
La partida ya jugada queda comparada byte a byte (`toEqual` contra una copia
previa) y una partida pendiente **no relacionada** (sin el jugador dado de
baja) se queda sin tocar (`result: null`).

## 7. `planRedistribution` — no duplica `rounds.ts`, que queda con diff vacío

`git diff 7404a4e..d50a7bc -- src/server/rounds.ts src/server/round-ui.ts
src/server/round-overview.ts src/server/standings.ts src/server/result-logic.ts`
da **vacío** para los cinco. Leí el cuerpo completo de `planRedistribution`:
una única llamada a `assignPairsToRounds` (sin reintentos ni bucles), una
única llamada a `deriveDeadlines`, y el resto es cableado — mapear el
resultado del coloreado (en términos de `Pairing`) a `matchId`s reales
(`pairKey`, un helper de una línea, explícitamente documentado como
duplicado trivial, no lógica de dominio) y derivar qué rondas nuevas hacen
falta. No hay ningún coloreado paralelo ni reimplementación del algoritmo.

## 8. El "autocuración" del segundo cierre de ventana — consistente con el defecto del punto 1, no un riesgo nuevo

Al principio pensé que excluir una partida que recibió un `Result` real
durante la ventana (en vez de abortar) podría dejar el reparto internamente
inconsistente si otra partida planificada aterrizaba, por coincidencia, en la
misma ronda donde la excluida se queda. Tras encontrar el bloqueante del
punto 1, la conclusión es que esto **no es un riesgo nuevo que introduzca el
patrón de autocuración**: el defecto de fondo (el planificador nunca sabe qué
cupo ya consumen, en cada ronda, las partidas con `Result` que quedan fuera
del conjunto a colorear) existe **con o sin ninguna carrera** — una partida
que se resuelve un segundo antes de que arranque `redistributePending` tiene
exactamente el mismo problema que una que se resuelve durante la ventana de
la transacción. El "autocuración" no agrava nada; simplemente hereda el
mismo defecto de fondo. Corregir el punto 1 corrige también este caso.

## 9. Fechas de las rondas nuevas (criterio 30) — exactas, sin caso de cruce de año probado

AC-30 comprueba fechas concretas (30 abr 2026, 31 may 2026), no solo el
conteo de rondas. No hay un test explícito del cruce diciembre→enero, pero
verifiqué que `Date.UTC(2026, 12, 1)` y `Date.UTC(2026, 11 + 1, 1)` dan
ambos `2027-01-01T00:00:00.000Z` — el desbordamiento de mes a año es un
comportamiento nativo de `Date.UTC`, no algo que este hito calcule a mano, y
es el mismo mecanismo que `deriveDeadlines` (H2, ya probado con este patrón)
usa desde el principio. Bajo riesgo; lo dejo como sugerencia de cobertura,
no como bloqueante.

## 10. Los cuatro casos no inventados — ninguno necesitaba escalarse

Incluido el que más me preocupaba: **el admin dándose de baja a sí mismo**
(también es `Player`). Tratarlo como cualquier participante —sin caso
especial— es consistente con cómo H6 ya documentó que el admin participa en
el reparto si está activo, y no hay ninguna razón de producto para que la
baja de un admin deba comportarse distinto a la de cualquier otro jugador; no
encontré ningún motivo para pararme aquí. Los otros tres (rondas añadidas
cuando no hay ninguna abierta, cupo 0 tras una baja, `matchesPerRound` tan
alto que cabe en una ronda) son extensiones directas y correctas de
mecanismos ya existentes (H2's `roundQuota`, el propio bucle de
`add rounds`), sin rama nueva que auditar.

## 11. El mock ampliado de `tests/emparejamientos.test.ts` — no debilita nada

`git diff 7404a4e..d50a7bc -- tests/emparejamientos.test.ts | grep "^-.*expect\|^-.*it("`
no encuentra **ninguna** línea de aserción ni de declaración de test
eliminada — el diff es enteramente aditivo (mocks nuevos para
`round`/`auditLog`/`match.updateMany`/`match.count`, y `requireAdmin` pasa a
devolver `{role, playerId}` real en vez de `undefined`). Los 43 tests del
fichero siguen en verde, incluidos los 9 de `missingPairings`. El cambio del
mock de nivel superior `prisma.match.findMany` (de `existingMatches` a `[]`)
está justificado con precisión: `addMissingLeagueMatches` nunca leyó ese
mock de nivel superior (usa `tx.match.findMany` dentro de su propia
transacción) — solo pasa a usarse ahora porque `redistributePending` hace su
propia lectura previa a la transacción, y devolver `[]` la convierte en un
no-op limpio sin alterar ninguna aserción existente.

## 12. Alcance — `closeRound` sin tocar, confirmado

El diff de `round-actions.ts` es enteramente aditivo tras la línea 305 (el
cierre de la función `closeRound` existente); ninguna línea del cuerpo de
`closeRound` aparece en el diff. No hizo falta endurecerlo más: H8 solo
necesita leer `Round.closedAt` (que `closeRound` ya mantiene correctamente
desde H5b), no escribir en él.

## Regresión

- `npm run lint` → **0 errores, 0 warnings**.
- `npm run test` → `Test Files 16 passed (16)` / `Tests 464 passed (464)`.
- `npx tsc --noEmit` → limpio, sin salida.
- `npm run build` → compila, 21 rutas, sin errores.
- `npm run e2e` → ejecutado **dos veces**: **43 pasan, 1 skipped** en ambas
  corridas, sin intermitencia.

## Bloqueantes

1. **(Punto 1)** `redistributePending` puede exceder `matchesPerRound` para
   un jugador que tiene, en una misma ronda abierta, una partida ya jugada
   (`Result` real) y otra que el recálculo le asigna ahí sin saber que la
   primera ya ocupaba su cupo. Reproducido con el disparador real del
   producto (`addMissingLeagueMatches`), sin ninguna concurrencia — es el
   caso normal, no un extremo. Rompe el criterio 2 y, con él, los criterios
   29, 32, 34 y 35 (todos dependen de la misma función). Necesita que
   `planRedistribution` tenga en cuenta, al construir el plan, cuánto cupo
   consume ya cada jugador en cada ronda abierta por partidas fuera del
   conjunto a colorear — no es una decisión de producto que deba escalarse,
   la spec ya exige el invariante explícitamente.

## Sugerencias (no bloqueantes)

1. **(La limitación que señaló el builder, con el matiz que encontré)**
   Registrar la colisión de índice de `Round` entre dos `redistributePending`
   concurrentes como deuda explícita, con esta precisión añadida: en
   `addMissingLeagueMatches` el fallo no es autorreparable con un simple
   reintento de la misma acción (las partidas ya creadas quedarían con
   `roundId: null` de forma permanente hasta que otro disparador —cambiar
   `matchesPerRound`, por ejemplo— vuelva a invocar `redistributePending`).
   No lo until bloqueo por su baja probabilidad (requiere dos acciones de
   admin simultáneas sobre la misma liga) y su efecto acotado (estado ya
   soportado por la UI de H6, no corrupción), pero merece quedar anotado con
   precisión, no solo como "análogo al doble-cierre de H5b".
2. **(Punto 2)** Reforzar la cobertura del invariante del reparto con algo
   más cercano a `assertValidReparto` de H2 (generación aleatoria sobre
   varios tamaños/densidades), ya que los 8 escenarios concretos de H8 no
   cazan de forma consistente una partida "perdida" del plan según en qué
   posición del array se pierda.
3. Un test explícito del cruce de año (una ronda que cierra en diciembre,
   la siguiente derivada cae en enero del año siguiente) para el criterio
   30, aunque el mecanismo subyacente (`Date.UTC`) ya esté probado en H2.

---

# Re-review — precoloreado en `assignPairsToRounds` (commit `a784726`)

## Veredicto: APPROVED

El fix cierra el bloqueante de raíz, no con un parche en `redistributePending`
sino dándole al propio algoritmo de coloreado la información que le faltaba
— una decisión de diseño más honesta que envolverlo desde fuera, y que
comprobé que cumple las dos condiciones que se le exigieron: el camino sin
precoloreado es idéntico byte a byte al de antes (confirmado por diff, no
solo por descripción), y el docstring no promete ninguna cota que el caso
precoloreado no tenga — corrige exactamente el tipo de error que costó una
vuelta entera en H2 (D4). Verifiqué la cota de seguridad computacionalmente
con datos adversariales (no solo aleatorios) y no encontré ninguna otra forma
de romper el invariante. El único hallazgo es un hueco de documentación
menor: la colisión de índice de `Round` entre dos `redistributePending`
concurrentes —la limitación aceptada como deuda en la vuelta anterior— no
tiene comentario en el sitio donde ocurriría de verdad (`redistributePending`
mismo, junto a `tx.round.create`), solo en sus dos llamadores. No bloquea,
pero lo señalo como sugerencia.

## 1. El caso reproducido — pinneado exactamente, falla sin el fix

`tests/recalculo-alta-baja-y-cupo.test.ts`, el test nuevo
("El bloqueante de la review... reproducción exacta del reviewer") usa
**mis mismos parámetros**: 4 jugadores, `matchesPerRound = 1`, `reportResult`
real sobre la partida P-A, alta de un 5º jugador vía `addMissingLeagueMatches`
— el disparador real, no una llamada directa a `redistributePending`. Lo
verifiqué revirtiendo `rounds.ts`, `round-actions.ts`, `league-actions.ts` y
`match-actions.ts` a `d50a7bc` (el commit que audité en la primera vuelta) y
ejecutando solo ese test: falla con `expected 2 to be less than or equal to
1` dentro de `assertValidReparto` — el mismo síntoma exacto que documenté.
Restauré los cuatro ficheros después (`git status` limpio) y vuelve a pasar.

## 2. El invariante, ahora en serio — lo intenté romper de nuevo y no pude

Además de ejecutar los 8 tests de H8 (ahora con `assertValidRepartoInDb`,
que reutiliza `assertValidReparto` de H2 en vez del `assertQuotaInvariant`
más débil de la vuelta anterior) y la nueva batería de precoloreado de
`tests/rondas.test.ts`, hice mi propia verificación independiente, con datos
**adversariales** a propósito, no solo aleatorios:

- **566 casos** con precoloreado hostil: para cada tamaño (2-15 jugadores) y
  `k` ∈ {1,2,3}, generé un subgrafo pendiente aleatorio y **agoté hasta el
  cupo completo** (`k` de `k`, no solo `k-1`) de jugadores al azar en las
  rondas existentes con partidas "precoloreadas" ficticias, antes de llamar a
  `assignPairsToRounds` con `participantIds.length` candidatos extra. Cero
  violaciones de cupo, cero fallos inesperados.
- **Caso estrella extremo**: un jugador P con partidas pendientes contra
  **los otros 11** (`n=12`, `k=2`), con P precoloreado a `k-1` en las 5
  rondas abiertas existentes (solo una plaza libre por ronda) — el reparto
  resultante respeta el cupo de P en las 8 rondas que termina usando (5
  existentes + 3 nuevas), verificado campo a campo.
- **Caso de infactibilidad real** (3 jugadores, `k=1`, un jugador ya agotado
  en la única ronda ofrecida): lanza el error diagnosticable
  (`no open round has enough remaining capacity`), no corrompe nada.

No encontré ninguna forma adicional de romper el invariante. Los 8 tests de
H8 y la batería de `tests/rondas.test.ts` (24 tests nuevos: el caso
pinneado, cupo agotado, cupo justo, 18 combinaciones de tamaño/`k`, el test
de "vacío = idéntico a antes", el de infactibilidad, y un property test de
33 casos con PRNG de semilla fija) cubren el terreno con solidez.

## 3. El caso libre — diff acotado a una sola función, lógica idéntica

`git diff d50a7bc..a784726 -- src/server/rounds.ts` tiene **un único hunk**,
desde la línea 573 (la declaración de `RoundAssignment`/el docstring de
`assignPairsToRounds`) hasta el final de la función — nada por encima se
toca: `misraGriesColoring`, `decomposeCompleteGraph`, `isCompleteGraph`,
`waleckiFactors`, `roundRobinRounds`, `deriveDeadlines`, `roundQuota`,
`quotaLabel` quedan exactamente como estaban. Dentro de la función, comparé
línea a línea el cuerpo de la rama `if (preassigned.length === 0)` contra el
cuerpo completo de la función **antes** de este commit: mismo cálculo de
`groupSize`, mismo `neededRounds`, mismo mensaje de error, mismo bucle de
construcción de `assignments` — literalmente el mismo código, solo movido
dentro de un `if` con un `return` al final. No hay ninguna rama compartida
entre los dos caminos que pudiera arrastrar un cambio de comportamiento al
caso libre: `assignFactorsRespectingPreassignedCapacity` es una función
aparte, solo alcanzable cuando `preassigned.length > 0`.

## 4. La cota de seguridad — verificada, se sostiene con precoloreado

Confirmé la prueba matemática: `factors` se calcula **antes** de tocar
`preassigned` (`misraGriesColoring`/`decomposeCompleteGraph` no reciben
`preassigned` en ningún punto), así que `factors.length` no cambia por la
precoloración — sigue acotado por `Δ+1 ≤ participantIds.length` exactamente
como en el caso libre. Lo que sí puede crecer es cuántas **rondas** hacen
falta para colocar esos mismos factores (en el peor caso, uno por ronda si
cada ronda existente está agotada para alguno de sus jugadores), pero nunca
más de `factors.length` rondas — porque un factor siempre cabe en una ronda
completamente nueva y vacía (su grado interno por jugador es como mucho
`matchesPerRound`, así que `remaining(nueva, jugador) = matchesPerRound ≥
demanda` siempre). De ahí que `participantIds.length` candidatos extra sigan
siendo suficientes en el peor caso, confirmado también en mis 566+2 pruebas
adversariales sin ni un solo fallo de "no cabe" cuando de verdad cabía.

## 5. El docstring — sin promesas indebidas

Leí el docstring completo de `assignPairsToRounds` y el nuevo de
`assignFactorsRespectingPreassignedCapacity`. El primero dice explícitamente
**"the `Δ + 1` bound does not carry over"** para el caso precoloreado, con
la razón (precoloring-extension es un problema conocido más duro, no un
defecto de esta implementación) y mantiene la garantía `Δ+1` intacta y
explícita para el caso libre. El segundo solo promete "determinista" — no
reclama ninguna cota de optimalidad. Ninguna frase del código nuevo
menciona `Δ+1` en relación con el caso precoloreado salvo para decir que
**no** aplica.

## 6. Cobertura — 100 % real, verificado contra `coverage-final.json`

`npm run test:coverage` da **489/489** tests. Leí `coverage-final.json`
directamente (no el resumen de consola, que ni siquiera lista `rounds.ts`
por estar al 100 %): `s` (statements) tiene **259/259** cubiertos, `b`
(branches) **86/86**, cero ids sin cubrir en ninguna de las dos listas.
Confirmé con `grep` que solo hay **una** pareja `v8 ignore start`/`stop` en
todo el fichero (líneas 460/476) — la guarda defensiva de H2, fuera por
completo del rango que toca este diff (que empieza en la línea 573). No se
añadió ninguna exclusión nueva. Sobre si el 100 % se logró con tests
significativos: los 24 tests nuevos de `tests/rondas.test.ts` no son relleno
— cubren específicamente el caso pinneado, el cupo exacto al límite, el cupo
agotado, la infactibilidad diagnosticable, la equivalencia con el
comportamiento anterior, y un property test de 33 combinaciones — cada uno
ejercitando una rama distinta de `assignFactorsRespectingPreassignedCapacity`
(la búsqueda de ronda con hueco, el `throw` cuando no hay ninguna, la
acumulación de `demand`/`consumed`), no un test genérico repetido.

## 7. `tests/helpers/reparto.ts` — extracción fiel, sin debilitar nada

Comparé el cuerpo de `assertValidReparto`/`groupByRoundIndex` en el nuevo
fichero contra la versión que vivía en `tests/rondas.test.ts` antes de este
commit (`git show d50a7bc:tests/rondas.test.ts`): son **idénticos**, solo
cambia dónde viven. `tests/rondas.test.ts` ahora importa desde
`./helpers/reparto` en vez de declarar las funciones localmente — confirmé
que no queda ninguna declaración duplicada. Ejecuté el fichero completo:
**135 tests pasan** (111 de H2 + 24 nuevos de precoloreado), así que la
extracción no rompió ni debilitó ninguno de los tests que ya dependían de
este helper.

## 8. La corrección del fixture de AC-32 — arregla un bug del test, no del criterio

El estado inicial anterior amontonaba **3** partidas de p1 (la jugada p1-p2
más las pendientes p1-p3 y p1-p4) en una sola ronda con `matchesPerRound =
2` — ya inválido antes de que `setPlayerActive` hiciera nada, un bug del
*fixture*, no del producto. La corrección separa p1-p4 a una segunda ronda
(round1 queda con p1-p2 jugada + p1-p3 pendiente = exactamente 2, al
límite). Comparé las aserciones sustantivas del test antes y después del
commit: **ninguna cambió** — el resultado ya jugado sigue comparado byte a
byte (`toEqual`), los dos WALKOVER siguen verificados con `bonusHome: 0,
bonusAway: 0` forzado pese a que `calculateBonus` daría 2 (con la prueba
explícita de ese valor), y la partida no relacionada sigue sin tocar. Lo
único que se añade es `assertValidRepartoInDb` al final — el criterio 32
sigue probando exactamente lo que pedía, y además ahora también verifica
que la redistribución posterior a la baja no rompe el cupo, que es
precisamente la forma que destapó el bloqueante original.

## 9. `setPlayerActive` gateado en `!active` — verificado con mi propia sonda

Confirmé el razonamiento del cambio con una prueba propia, aparte de AC-33:
desactivé a un jugador (1 entrada `REDISTRIBUTE_PENDING` en `AuditLog`),
lo reactivé (**sigue en 1** — la reactivación no dispara redistribución,
confirmado empíricamente, no solo leyendo que `!active` es `false` cuando
`active: true`), y volví a llamar a `setPlayerActive(id, false)` sobre un
jugador ya inactivo (sube a **2** — la redistribución se reintenta, tal como
documenta el commit, mientras que `SETTLE_PLAYER_DEACTIVATION` se queda en
**1**: no vuelve a saldar partidas ya saldadas). Esto confirma las dos
mitades del cambio: el criterio 33 (reactivar no revierte) sigue intacto —
AC-33 pasa sin cambios en sus aserciones sustantivas—, y la nueva vía de
recuperación (reintentar la misma llamada tras un fallo de
`redistributePending`) funciona de verdad, no solo sobre el papel.

## 10. Los comentarios de las limitaciones — presentes, con un hueco en el origen

- `addMissingLeagueMatches` (`match-actions.ts`): comentario explícito,
  en el docstring exportado, con la vía de recuperación exacta ("cualquier
  otro disparador de este hito... o simplemente llamar a
  `redistributePending(leagueId)` directamente"). Bien situado — es donde
  un futuro lector de esa función necesita verlo.
- `setPlayerActive` (`league-actions.ts`): mismo patrón, con el matiz de que
  esta acción **sí** se autorrepara reintentando, explicado con precisión.
- **Hueco encontrado**: `redistributePending` en sí —donde de verdad ocurre
  la colisión de `@@unique([leagueId, index])`, en las llamadas a
  `tx.round.create`— no tiene ningún comentario sobre esta limitación. Los
  otros dos riesgos de la misma función (la carrera de `closeRound` y el
  "autocuración" del `Result` recibido en la ventana) sí están documentados
  justo donde ocurren; este tercero solo se explica en sus dos llamadores,
  no en el sitio donde realmente pasa. No es un hueco de conocimiento (la
  información existe y es correcta), pero sí de ubicación — quien audite
  `redistributePending` en solitario, sin mirar sus callers, no se
  encontraría con el aviso. Sugerencia, no bloqueante: añadir un comentario
  corto junto al bucle `for (const nr of plan.newRounds) { tx.round.create(...) }`.

## Regresión

- `npm run lint` → **0 errores, 0 warnings**.
- `npm run test` → `Test Files 16 passed (16)` / `Tests 489 passed (489)`.
- `npx tsc --noEmit` → limpio, sin salida.
- `npm run build` → compila, 21 rutas, sin errores.
- `npm run e2e` → ejecutado **dos veces**: **43 pasan, 1 skipped** en ambas
  corridas, sin intermitencia.
- `npm run test:coverage` → 489/489; `src/server/rounds.ts` **259/259**
  statements, **86/86** branches (verificado contra `coverage-final.json`,
  no solo el resumen de consola), con la misma y única exclusión de H2 sin
  ninguna nueva.

## Bloqueantes

Ninguno.

## Sugerencias (no bloqueantes)

1. **(Punto 10)** Añadir un comentario corto en `redistributePending`, junto
   al bucle que crea las `Round` nuevas (`for (const nr of plan.newRounds)
   { tx.round.create(...) }`), documentando la colisión de índice entre dos
   `redistributePending` concurrentes en el sitio exacto donde ocurriría —
   hoy solo se explica en sus dos llamadores.
2. (Heredada de la vuelta anterior, ya registrada como deuda por el
   coordinador) Ninguna acción adicional necesaria de mi parte; confirmado
   que el matiz sobre la no-autorreparación de `addMissingLeagueMatches`
   quedó documentado con precisión en el propio código, tal como se pidió.
