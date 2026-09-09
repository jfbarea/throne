# Review — H7 `clasificacion-saldadas`

**Commit revisado:** `7404a4e`.

## Veredicto: APPROVED

Hito pequeño y bien acotado. Verifiqué el criterio 28 (el que importa) leyendo
el código entero, no el informe: `resolution` se lee en un único punto de
`standings.ts` y no alimenta ni la aritmética de puntos/VP ni la cadena de
desempates. La honestidad del informe sobre qué tests fallan sin el cambio es
exacta — la comprobé con `git show <padre>` y ejecución real, no de palabra.
El único hallazgo real de esta revisión es que la comprobación automática del
overflow móvil con el texto «(N saldadas)» **no existe de verdad** en el e2e
—lo comprobé yo mismo produciéndolo a mano, y no desborda—, así que la
afirmación del informe sobre ese punto concreto es imprecisa aunque el
comportamiento subyacente sea correcto. Lo dejo como sugerencia, no
bloqueante.

## 1. Criterio 28 — leí las tres funciones de comparación, no solo los tests

`grep -n "resolution\|settled" src/server/standings.ts` da exactamente seis
coincidencias: la declaración del campo opcional en `StandingsMatch`, su
comentario, la declaración de `StandingsRow.settled`, su comentario, la
inicialización a `0`, y **una única lectura real**:

```ts
if ((r.resolution ?? "PLAYED") !== "PLAYED") {
  home.settled += 1;
  away.settled += 1;
}
```

Leí el cuerpo completo de `compareRows`, `applyCriterion` y
`compareHeadToHead` (líneas 272-390): ninguna de las tres menciona
`resolution` ni `settled` en ningún punto — `applyCriterion` es un `switch`
exhaustivo sobre `POINTS | VP_DIFF | VP_FOR | HEAD_TO_HEAD | LOSSES |
ID_ORDER`, y ninguna rama toca esos campos. La acumulación de puntos/VP
(líneas 217-238) usa exclusivamente `r.homeVictoryPoints`,
`r.awayVictoryPoints`, `r.outcome`, `r.bonusHome`, `r.bonusAway` — nunca
`r.resolution`. No es una afirmación de que "los tests no lo detectarían";
es que el dato, estructuralmente, no llega a ningún sitio donde importaría.

## 2. La honestidad del informe — confirmada, no solo creída

Reproduje el `git stash` que dice el builder: revertí `standings.ts` a la
versión anterior a este commit (`git show 7404a4e~1:...`) y corrí los 9
tests nuevos. Resultado exacto:

```
6 failed | 3 passed | 41 skipped (50)
```

Los 6 que fallan son los 3 de conteo (`AC-27: computeStandings cuenta las
saldadas...`, con `settled` como `undefined`) y los 3 de
`formatPlayedCount` (`TypeError: formatPlayedCount is not a function`). Los
3 que **pasan igual** son exactamente los 3 de
`describe("AC-28: computeStandings sin ramas especiales por resolution")` —
comprobado por nombre, no solo por cuenta. Es coherente con el punto 1: si
`resolution` nunca se leía en el cálculo antes de este hito, un test que
compara la aritmética de un `WALKOVER` contra un `PLAYED` no tiene forma de
fallar en el código viejo. El informe llama a esto "guarda de regresión
hacia adelante, no fallo-antes-del-cambio literal" en vez de maquillarlo
como si los 9 fallaran — es la descripción correcta, y coincide con lo que
observé. Restauré el fichero después (`git diff` vacío, 50/50 tests en
verde de nuevo).

Sobre si el test del valor inventado (`NOT_A_REAL_RESOLUTION_VALUE`) es
decorativo: no lo es. Los otros dos tests de AC-28 usan valores reales del
enum (`WALKOVER`, `UNPLAYED_DRAW`) comparados contra `PLAYED`, así que
cazarían una rama del tipo `if (resolution === "WALKOVER") { ... }`. El
tercer test cubre un caso **distinto**: un `switch`/cadena `if-else`
exhaustiva sobre los tres valores conocidos con una rama `default`/`else`
que tratara "cualquier otra cosa" de forma diferente (por ejemplo, poniendo
VP a cero por seguridad) — ese patrón pasaría los dos primeros tests sin
problema (`WALKOVER` y `UNPLAYED_DRAW` seguirían teniendo su propia rama
explícita) pero fallaría con un valor fuera del enum. Son dos formas de
introducir una rama por `resolution`, y cada test cubre una.

## 3. `resolution` opcional, `PLAYED` por defecto — correcto, no esconde nada

Revisé los tres consumidores reales de `computeStandings` en `src/`:
`clasificacion/page.tsx` (tocado por este hito: ahora selecciona y pasa
`resolution: true` explícitamente, así que el caso real siempre lo lleva),
y `playoff-actions.ts`/`admin/playoffs/page.tsx` (sin tocar, fuera del
alcance de H7). En `startPlayoffs`, `computeStandings` se llama **sin**
pasar `resolution` — así que ese `StandingsRow.settled` queda potencialmente
inexacto para esa llamada concreta. Pero comprobé que **no importa**:
`startPlayoffs` solo lee `points`/`vpDiff`/`rank` de las filas devueltas
para calcular el seeding (`seedsFromStandings`), nunca `settled` — y el
criterio 28, ya verificado en el punto 1, garantiza que la ausencia de
`resolution` no cambia ni un punto ni un VP. Además, a nivel de esquema,
`Result.resolution` tiene `@default(PLAYED)` no nulo desde H1 — ningún
`Result` real de la base de datos carece de él nunca; la opcionalidad en
`StandingsMatch` es puramente para no obligar a tocar llamadas/tests que
construyen el DTO a mano sin ese campo. No encontré ningún escenario donde
un `resolution` ausente debiera ser un error: forzarlo habría exigido tocar
`playoff-actions.ts`, explícitamente fuera del alcance de este hito de dos
criterios.

## 4. Criterio 27 — conteo y texto

`tests/standings.test.ts` cubre los tres casos con test dedicado: 11
jugadas con 2 saldadas → `played=11, settled=2`; una partida sin
`resolution` explícito cuenta como jugada (`settled=0`); cero saldadas da
`settled=0` "no negativo ni indefinido". `formatPlayedCount` tiene sus tres
formas cubiertas y las ejecuté: `(11, 2)` → `"11 (2 saldadas)"`, `(5, 1)` →
`"5 (1 saldada)"` (singular correcto), `(11, 0)` → `"11"` sin paréntesis
(`expect(text).not.toContain("(")`, no solo una comparación de igualdad —
cazaría también un `"()"` vacío, no solo un `"(0 saldadas)"` literal).

## 5. `StatCell`/`MobileStat` generalizados — el resto de columnas, intactas

`grep` sobre los usos de `StatCell value=`/`MobileStat label=` en
`clasificacion/page.tsx`: solo la columna "PJ" pasa a
`formatPlayedCount(...)` (un `string`); `wins`, `draws`, `losses`, `vpFor`,
`vpAgainst` siguen pasando `row.X` en crudo, sin tocar. El único lugar
donde el tipo `number | string` podría causar un problema real —el
`showSign` de `MobileStat`, que antepone `+` si el valor es positivo— está
protegido con `typeof value === "number"` antes de comparar `value > 0`,
así que una cadena nunca entra en esa rama (y de hecho `showSign` no se usa
nunca junto a la columna PJ). `fontVariantNumeric: "tabular-nums"` sigue
aplicado también a la cadena con paréntesis — es inocuo, esa propiedad CSS
solo afecta al ancho de los glifos numéricos, no rompe nada con letras o
signos de puntuación alrededor.

## 6. Móvil — el comportamiento es correcto; la cobertura automática, no del todo

Confirmé el desbordamiento (o su ausencia) **produciendo el texto de
verdad**, no solo con la liga vacía o con partidas jugadas normales. Generé
una liga de e2e completa por fuera del arnés automático (emparejamientos
reales vía `roundRobinRounds`, un `Result` con `resolution: WALKOVER`
escrito directamente) y visité `/clasificacion` a 390px de ancho con sesión
de jugador: el texto `"1 (1 saldada)"` aparece en la página y
`document.body.scrollWidth === document.documentElement.clientWidth ===
390` — sin desbordamiento.

Pero al revisar qué produce el **e2e automático** existente, `grep` sobre
`declareWalkover|closeRound|WALKOVER|UNPLAYED` en `tests/e2e/full-journey.spec.ts`
no encuentra nada: el recorrido nunca crea una incomparecencia ni cierra una
ronda, así que ningún `Result` de la suite automática lleva jamás
`resolution` distinto de `PLAYED`. El test "clasificacion no tiene overflow
horizontal" pasa siempre, pero con `formatPlayedCount` devolviendo números
sin paréntesis — nunca ejercita el texto largo. La afirmación de
`_state.json` ("el test de overflow horizontal de `/clasificacion` ...
sigue sin desbordar con el texto '11 (2 saldadas)' más largo") describe un
comportamiento que **es cierto** (lo acabo de verificar yo, por fuera del
arnés) pero que la suite automática **no comprueba** — el texto largo nunca
se produce durante esa corrida. No lo trato como bloqueante porque el
comportamiento en sí es correcto y ya lo he verificado con evidencia
directa, pero la cobertura automática de esa afirmación concreta no existe
todavía.

## 7. Alcance — diff vacío en todo lo que debía quedar intacto

`git diff 4af216f..7404a4e -- src/server/rounds.ts src/server/round-ui.ts
src/server/round-overview.ts src/server/round-actions.ts
src/server/result-actions.ts src/server/result-logic.ts` da **vacío** — H2,
H4, H5, H5b y H6 quedan exactamente como estaban. `isConfirmedForStandings`
tampoco se toca: el diff de `standings.ts` es enteramente aditivo (nuevos
campos, un `if` nuevo, una función nueva al final del fichero); ninguna
línea de esa función cambia, confirmado leyendo su cuerpo completo tras el
commit.

## Regresión

- `npm run lint` → **0 errores, 0 warnings**.
- `npm run test` → `Test Files 15 passed (15)` / `Tests 456 passed (456)`.
- `npx tsc --noEmit` → limpio, sin salida.
- `npm run build` → compila, 21 rutas, sin errores.
- `npm run e2e` → **43 pasan, 1 skipped**, idéntico al baseline.

## Bloqueantes

Ninguno.

## Sugerencias (no bloqueantes)

1. **(Punto 6)** Añadir un test e2e (o extender `full-journey.spec.ts`) que
   genere al menos una incomparecencia o cierre una ronda con partidas
   pendientes antes de comprobar el overflow de `/clasificacion`, para que
   la afirmación de "el texto largo no desborda" quede verificada
   automáticamente y no dependa de una comprobación manual como la de esta
   review.
2. Documentar en `playoff-actions.ts` (un comentario junto a la llamada a
   `computeStandings`) que no pasar `resolution` es intencional y seguro
   porque `settled` no se lee ahí — para que quien lo audite en H8/H9 no se
   pregunte si es un descuido.
