# Review — H2 `dominio-reparto-y-fechas`

**Commits revisados:** `f6d88e4` (primera versión) → `00b7394` (corrección
Walecki). Estado final en `HEAD` (`fe95579` es solo el chore de
`PLAN.md`/`_state.json`, no toca código).

## Veredicto: CHANGES_REQUESTED

La primera corrección (Walecki para `n` impar/`k` par) es correcta y una
mejora real sobre la fórmula literal de la spec. D2 y D3 están bien
razonadas. Pero he encontrado un problema nuevo, no detectado ni por el
builder ni por la verificación previa del coordinador: **el voraz `Δ+1`
para subgrafos arbitrarios (`greedyMatchings`, el que consumirá H8) no
respeta la cota que dice respetar**, y esto sí es una de las cosas que este
hito se compromete a garantizar (bullet propio de H2 en `PLAN.md`: *"El
coloreado voraz nunca usa más de Δ+1 colores"*). Detalle en el punto 3.

## 1. Los tres regímenes de `decomposeCompleteGraph`

Correctos. Verifiqué de forma independiente (script en TypeScript contra el
módulo real, no reimplementando la lógica) 308 combinaciones de
`n ∈ {2..23}` × `k ∈ {1,2,3,4,5,6,7,8,10,15,20,25,30,50}`, incluidos los
bordes que pedías:

- **n par** (circle method): siempre `n-1` jornadas de grado 1, agrupadas en
  `ceil((n-1)/k)` rondas.
- **n impar, k par** (Walecki): siempre `(n-1)/2` factores 2-regulares.
  Verificado también que cuando `(n-1)/2` no es múltiplo de `k/2` la última
  ronda queda con cupo uniformemente reducido para **todos**, nunca con un
  jugador a 0 y el resto a tope (ejemplo real: n=11,k=4 → rondas de grado
  4,4,2 — nadie descansa, el "menos" cae parejo, coherente con D3).
- **n impar, k impar** (rotación con bye): siempre exactamente `n` jornadas;
  el histograma de grados por ronda confirma que el "descanso" se reparte
  (con `k>1` pueden ser varios jugadores distintos a `k-1` en la misma ronda,
  nunca uno solo a 0 con los demás a tope), y nunca se excede `k`.
- **Bordes n=2,3,4**: n=2 siempre 1 ronda con la única pareja; n=3,k=1 → 3
  rondas de 1 partida con 1 jugador descansando cada vez (el triángulo es
  Clase 2, correcto); n=3,k≥2 → 1 ronda con las 3 partidas (el ciclo de
  Walecki de un único factor); n=4,k=1 → 3 rondas del circle method clásico.
  Todos verificados con el código real, no a mano.
- **k mayor que las jornadas disponibles** (k=10, k=15, k=20, k=25, k=30,
  k=50 contra n pequeños): siempre colapsa a 1 ronda con todas las
  `C(n,2)` partidas, tal como dice la spec ("un valor mayor que n-1 produce
  simplemente una sola ronda"). Sin errores, sin rondas vacías.

En las 308 configuraciones: recuento total de partidas correcto
(`C(n,2)`), cero pares duplicados, cero auto-emparejamientos, ningún
jugador supera `k` por ronda, y `rounds.length === roundsCount(n,k)` en
todos los casos, incluido con `roundsCount` calculado de forma
independiente (no reimplementando `Math.max(...)`, sino con la fórmula
escrita aparte). 0 fallos.

También reproduje D2/D3 con mi propio script (n hasta 300, k hasta 100): la
fórmula `max(ceil((n-1)/k), ceil(C(n,2)/floor(n·k/2)))` coincide con
`ceil((n-1)/k)` en todo caso no-ambos-impares, y con `ceil(n/k)` en todo
caso ambos-impares, sin ninguna excepción. **D2 y D3 están bien razonadas**,
de acuerdo con el criterio del coordinador.

## 2. Determinismo (criterio 5)

Revisado línea a línea, no solo confiando en el test. Todo `Set`/`Map` del
módulo se usa únicamente para membership o para construir un valor que
luego se ordena explícitamente antes de iterar para producir salida:

- `roundRobinRounds`: `[...new Set(playerIds)].sort(...)` — el `Set` solo
  deduplica, el orden de salida lo fija el `.sort()` posterior.
- `assignPairsToRounds`: mismo patrón con `idSet`/`sortedIds`.
- `isCompleteGraph`: el `Set` de `pairKey` solo se usa por `.size`, nunca se
  itera para producir orden.
- `greedyMatchings`: el `Map` de grados solo se **consulta** (`.get()`)
  dentro del comparador de un `.sort()` explícito con desempate
  lexicográfico total (`homeId`, luego `awayId`) — nunca se itera el `Map`
  en sí para generar orden. Confirmé además el comentario que lo dice
  explícitamente (línea 420-424) y until es cierto.
- `waleckiFactors`/`oddCompleteGraphJourneys`/`circleMethodJourneys`: solo
  arrays y aritmética modular, cero estructuras no ordenadas.

No encontré ningún punto donde el orden de inserción de un `Set`/`Map`
afecte la salida. Determinismo confirmado también empíricamente: n=13,k=2
ejecutado en dos procesos `tsx` separados produce el mismo JSON.

## 3. El voraz `Δ+1` para subgrafos arbitrarios — BLOQUEANTE

**No respeta la cota que dice respetar.** Escribí un script de stress
aleatorio (PRNG determinista, sin `Math.random`) contra el módulo real,
generando subgrafos de densidad variable (10%-95%) sobre `K_n` para
`n = 4..25`, y comprobando `journeysUsed ≤ Δ+1` vía
`assignPairsToRounds(pairs, ids, 1, openRoundIndexes)` (exactamente como
hace el test existente, solo que con más densidad). De 440 combinaciones,
**17 violan la cota**. Dos ejemplos concretos, reproducibles:

- `K_9` menos **una sola arista** (35 de 36 pares, `Δ=8`): el voraz usa
  **10** jornadas. `Δ+1 = 9`. El propio Vizing dice que 9 (o menos) es
  alcanzable —de hecho `K_{2m+1}` menos una arista es "Clase 1", su índice
  cromático real es `Δ=8`, no `Δ+1=9`— y el algoritmo se queda incluso por
  encima de esa cota.
- `K_12` menos 3 aristas (`Δ=11`): el voraz usa **13** jornadas. `Δ+1 = 12`.

Esto **no es un caso raro fabricado a propósito**: son subgrafos casi
completos, exactamente la forma que tiene "todas las partidas de liga sin
resultado" cuando una alta o un cambio de `matchesPerRound` (§5.1, §5.5)
ocurre **pronto** en la liga, con solo un puñado de partidas ya resueltas.
Si el subgrafo pendiente fuera literalmente `K_n` completo,
`isCompleteGraph` lo detecta y delega a la construcción exacta —eso está
bien y no falla—; el bug aparece justo en el caso intermedio, "casi
completo pero no del todo", que es plausible en un alta temprana.

**Por qué pasa, y por qué no es sorpresa dado lo que el propio módulo ya
sabe:** el comentario de `oddCompleteGraphJourneys` (línea 173-177)
reconoce explícitamente que "la cota de peor caso de libro de texto para el
coloreado voraz de aristas en un orden arbitrario es `2Δ-1`, no `Δ+1`" y
que probaron esto en carne propia con `K_11` (13 jornadas en vez de 11).
Esa lección se aplicó para blindar el caso `K_n` con una construcción
exacta — pero **`greedyMatchings`, usado para el caso general (H8), sigue
siendo el mismo voraz sin reparación por cadenas de Kempe**, y su docstring
(línea 401-403) sigue afirmando sin matices: *"By Vizing's theorem this
style of algorithm never needs more than Δ + 1 journeys"*. Esa frase es
falsa como está escrita — Vizing garantiza que **existe** una coloración con
`Δ+1` colores, no que este voraz concreto la encuentre. El propio módulo
hace esa distinción correctamente en un sitio y la pierde en el otro.

**Esto también es un problema de la spec, no solo del código.** §4.3 dice
literalmente: *"un coloreado voraz por grado descendente necesita como
mucho Δ+1 colores (Vizing)"*. Esa frase, tal cual, es matemáticamente
incorrecta para un voraz sin reparación — es exactamente lo que la propia
implementación demuestra en `oddCompleteGraphJourneys`. No creo que haga
falta escalarlo a `/specs` como una desviación de producto (la spec no dicta
un pseudocódigo exacto, solo pide "voraz por grado descendente" y una cota;
un algoritmo que sí logre `Δ+1` de verdad —Misra-Gries, o el propio voraz con
reparación por cadenas de Kempe que el módulo ya menciona como el ingrediente
que falta— sigue siendo fiel a la intención de la spec y no cambia ningún
comportamiento de producto). Pero si el equipo prefiere no tocar el
algoritmo ahora, entonces sí hace falta corregir la afirmación en §4.3 (y en
el docstring) para no prometer una cota que no se cumple, y ajustar el
diseño de H8 para que no asuma "como mucho una ronda más" al reservar
capacidad — tiene que poder crecer y reintentar si `assignPairsToRounds`
lanza, no asumir `Δ+1` de antemano.

**¿Falla limpio o corrompe?** Falla limpio, esto es lo único que tranquiliza
el hallazgo: `assignPairsToRounds` lanza un `Error` explícito
("necesita X ronda(s) ... solo Y abiertas") en vez de asignar de más o
silenciar el problema — lo comprobé en el propio script, no es una
suposición. No hay corrupción de reparto. El riesgo real es de robustez de
producto en H8 (una alta de jugador o un cambio de cupo podría fallar con un
error interno en vez de completar la redistribución, en el caso concreto de
liga temprana con pocas partidas resueltas), no de integridad de datos.

**Por qué lo bloqueo en vez de anotarlo como riesgo para H8:** porque es un
bullet de aceptación **propio de este hito** ("El coloreado voraz nunca usa
más de Δ+1 colores — test con subgrafos generados"), está tal cual en
`PLAN.md`, y el código y el test existente afirman cumplirlo cuando no es
cierto en general. El test que debía probarlo (`"coloreado voraz por grado
descendente: nunca usa más de Δ+1 colores"`, con densidades de 0.3-0.9 sobre
subgrafos curados) no lo detecta porque ninguno de sus casos es
suficientemente denso/simétrico — es exactamente el patrón que pedías
vigilar en el punto 7 (100% de cobertura sin que eso signifique tests que
de verdad aprieten la propiedad).

## 4. `deriveDeadlines`

Correcto y robusto frente a zona horaria. Repetí los tests de AC-7 con
`TZ=Pacific/Kiritimati` (UTC+14) y `TZ=Pacific/Midway` (UTC-11) — los dos
extremos del globo — y los 6 tests de `AC-7` pasan igual en ambos casos, sin
tocar el código. `Date.UTC(year, month, 0)` + lectura exclusiva de
`getUTCFullYear`/`getUTCMonth` hace lo que dice: nunca lee la hora local de
la máquina. Cubre 28/29 de febrero, 30/31 de otros meses y el cruce de año,
todo con tests explícitos.

## 5. `roundQuota` y `quotaLabel`

`required` se deriva de `matches.filter(...).length` — las partidas que el
jugador **realmente tiene** en esa ronda, nunca de la constante `k` — tal
como exige §5.2/§5.3 y como confirma el propio comentario del código
(línea 588-597), que además explica correctamente por qué **no** se puede
derivar de `matchesPerRound`: con Walecki (k par) el cupo siempre coincide
con `k`, pero con la rotación de bye (k impar) puede ser `k-1` para el
jugador que descansa, y derivarlo de la constante rompería ese segundo
caso. `hasResult`, no `scheduledAt`, decide "resuelto" (criterio 11),
confirmado por el test dedicado que crea una partida con fecha pero sin
`Result` y comprueba que sigue contando como pendiente.

Concordancia singular/plural correcta: `quotaLabel` usa "falta 1 de X"
(singular) solo cuando `missing === 1`, y "faltan N de X" (plural) en
cualquier otro caso positivo, con "cumplido" para `missing <= 0` (cubre
también el caso `required = 0` de un jugador sin partidas en esa ronda —
nada que deba, nada que falte).

## 6. Pureza y alcance

- `grep -n "prisma\|Prisma\|SQL\|sql"` sobre `src/server/rounds.ts` no
  devuelve más que un comentario que menciona la palabra "Prisma" para decir
  que **no** hay tipos suyos filtrando ahí. Cero imports de infraestructura,
  cero efectos.
- `git diff cf2a1a5 HEAD --stat` (desde el cierre de H1) solo toca
  `src/server/rounds.ts`, `tests/rondas.test.ts`, `plan/rondas-con-fecha/PLAN.md`
  y `plan/rondas-con-fecha/_state.json`. Nada en `src/app/`.
- `src/server/pairings.ts` no aparece en el diff de `f6d88e4` ni de
  `00b7394` — intacto. Su suite (`tests/emparejamientos.test.ts`) sigue en
  verde: **43/43** (no 9 — probablemente una cifra de otro momento del
  proyecto; en cualquier caso, el fichero está intacto y su suite pasa
  entera).

## 7. Cobertura del criterio 43

Verificado por el camino correcto, no por la tabla de texto (que en efecto
oculta los ficheros al 100%, confirmado — `rounds.ts` ni `pairings.ts`
aparecen en el resumen de `npm run test:coverage`, solo `lib/` y `server/`
con huecos). Leyendo `coverage/coverage-final.json` directamente:

```
src/server/rounds.ts   → statements 172/172, branches 55/55, functions 27/27
src/server/pairings.ts → statements  27/27,  branches  6/6,  functions  6/6
```

100% real, no una interpretación. Sobre si son tests **significativos**: en
general sí — el bloque de "guardas defensivas" prueba comportamientos reales
(errores por `matchesPerRound` inválido, por jugador fuera de `playerIds`,
por falta de capacidad de rondas, detección de `K_n` con home/away
invertido, no-detección de `K_n` con un duplicado exacto), no relleno de
líneas. La excepción es precisamente el bloque de "coloreado voraz... nunca
usa más de Δ+1", que sí cubre las líneas del voraz al 100% sin realmente
apretar la propiedad que dice probar (punto 3). Cobertura de línea/rama no
es lo mismo que verificación de la propiedad — exactamente el caso que
pedías vigilar.

## 8. Los tests fallarían antes del cambio

Sí. Volví a poner temporalmente el `rounds.ts` de `f6d88e4` (antes del fix
de Walecki) y corrí el `tests/rondas.test.ts` **actual** (el de `00b7394`)
contra él: **8 tests fallan** — los 5 de
`"AC-3 (Walecki): n impar con k par..."` (para n=11,13,15,17,19,k=2, todos
esperaban `(n-1)/2` rondas y la versión vieja daba una más) y 3 del bloque
de infactibilidad. Restauré el fichero después y confirmé 93/93 de nuevo.
No es un test que pasara igual contra el código viejo.

## Regresión

Reproducida en `HEAD` (`fe95579`):

- `npm run lint` → limpio.
- `npm run test` → `Test Files 9 passed (9)` / `Tests 350 passed (350)`.
- `npm run test:coverage` → `350 passed`, cobertura real de `rounds.ts` y
  `pairings.ts` al 100% (ver punto 7); otros ficheros del árbol (fuera del
  alcance de H2) no llegan al 100%, es esperado — no son de este hito.
- `npm run build` → compila y genera las 19 rutas sin errores.

## Qué corregir

1. **(Bloqueante)** `src/server/rounds.ts:396-451` (`greedyMatchings`) no
   logra la cota `Δ+1` que su propio docstring y el bullet de aceptación de
   H2 en `PLAN.md` afirman. Reproducido con `K_9` menos una arista (`Δ=8`,
   usa 10) y `K_12` menos 3 aristas (`Δ=11`, usa 13). Corregir el algoritmo
   para que de verdad logre `Δ+1` (p. ej. Misra-Gries, o el propio voraz con
   reparación por cadenas de Kempe que el módulo ya identifica como el
   ingrediente que falta en el comentario de `oddCompleteGraphJourneys`), y
   ampliar el test de "coloreado voraz... Δ+1" con subgrafos densos
   (`K_n` menos un puñado de aristas, no solo estrellas y densidades
   ≤ 0.9 sobre subgrafos curados) para que de verdad reviente si se
   regresa. Si no se corrige el algoritmo, como mínimo hay que corregir la
   afirmación de §4.3 de la spec (el "Vizing" ahí citado no respalda a un
   voraz sin reparación) y documentar en `PLAN.md`/H8 que
   `assignPairsToRounds` puede necesitar más de `Δ+1` rondas y debe poder
   reintentar creciendo la capacidad, no asumirla de antemano.

---

## Re-review — fix de Misra & Gries (`b7c8ee8`)

**Alcance de esta pasada:** solo el reemplazo del voraz simple por
`misraGriesColoring`. No repito lo ya aprobado en las dos vueltas
anteriores (regímenes de `decomposeCompleteGraph`, `deriveDeadlines`,
`roundQuota`/`quotaLabel`, pureza, D2/D3), que sigue en pie.

### Veredicto: CHANGES_REQUESTED

El algoritmo en sí está bien implementado — lo sometí a 525 configuraciones
independientes y no encontré ni un fallo. Pero hay dos huecos de rigor, uno
de ellos exactamente el que el coordinador ya sospechaba, que sí bloqueo:
falta la comprobación de validez real en los tests nuevos, y se cambió un
`throw` defensivo por una aserción no nula que, si el invariante alguna vez
se rompe, no falla limpio — lo comprobé forzándolo.

### 1. La implementación de Misra & Gries

Leí la construcción del abanico, la inversión de la cadena de Kempe y la
rotación línea a línea contra la referencia del algoritmo (abanico maximal
de `x` empezando en `y`; `c` libre en `x`, `d` libre en el último del
abanico; invertir el camino alternante `c`/`d` desde `x`; rotar el abanico
hasta el primer vértice donde `d` queda libre). Coincide con el algoritmo de
libro, incluida la parte delicada: el `wIndex = fan.findIndex(...)` que
recalcula dónde quedó libre `d` **después** de invertir la cadena (en vez de
asumir que sigue siendo el último del abanico), que es precisamente el
punto donde una implementación ingenua suele romperse.

No me fié de la lectura: la sometí a un script propio, independiente,
contra el módulo real (no una reimplementación) —525 configuraciones entre
`K_n` menos 1/2/3/5 aristas (`n` de 3 a 30), subgrafos aleatorios de
densidad 5%-98% (`n` de 4 a 30), ciclos impares, estrellas y grafos
circulantes 3-regulares y 4-regulares— comprobando en cada uno:

1. **Todo par de entrada aparece exactamente una vez en la salida** (nada
   perdido, duplicado ni inventado).
2. **Ninguna ronda tiene un jugador repetido** (la validez real del
   coloreado, no solo el recuento de colores).
3. `colores usados ≤ Δ+1`.

**0 fallos en las tres comprobaciones, en las 525.** También repetí a mano
los 6 casos de la tabla del builder más los 2 que yo mismo había usado para
tumbar la versión anterior:

```
K_12 menos 1: Δ=11, Δ+1=12, usa 12
K_11 menos 1: Δ=10, Δ+1=11, usa 11
K_10 menos 1: Δ=9,  Δ+1=10, usa 10
K_13 menos 2: Δ=12, Δ+1=13, usa 13
K_14 menos 3: Δ=13, Δ+1=14, usa 14
K_15 menos 4: Δ=14, Δ+1=15, usa 15
K_9  menos 1: Δ=8,  Δ+1=9,  usa 9   (el caso que reventaba antes: usaba 10)
K_12 menos 3: Δ=11, Δ+1=12, usa 12  (el caso que reventaba antes: usaba 13)
```

Coincide exactamente con la tabla del coordinador y con mis propios
hallazgos del bloqueante anterior, ahora en el límite teórico en los 8
casos. No encontré ningún camino donde deje una arista sin colorear (la
comprobación 1 lo habría detectado) ni donde produzca un coloreado inválido
(la comprobación 2 lo habría detectado).

### 2. Validar la propiedad, no solo la cota — hueco real en los tests nuevos

Aquí sí hay un hallazgo. Miré qué comprueban de verdad los tests que añade
`b7c8ee8` (el describe `"Misra & Gries: nunca usa más de Δ+1 colores"`,
incluidos los 6 de regresión, el de "K_n menos 1 arista" y el property
test): **ninguno comprueba que el coloreado sea válido** (que ninguna ronda
tenga un jugador repetido) ni que **cada par de entrada aparezca
exactamente una vez en la salida**. Todos calculan `journeysUsed` (cuántos
`roundIndex` distintos aparecen) y comparan contra `Δ+1` — es decir,
comprueban la **cota**, no la **propiedad**. `grep -n "countAppearances"` en
`tests/rondas.test.ts` confirma que ese helper (el único que valida
jugadores repetidos por ronda) no se usa en ningún test del bloque de
Misra & Gries; el único sitio donde aparece con `matchesPerRound=2` es la
suite `AC-6`, preexistente, que además no serviría para esto: con `k=2` un
jugador **puede** legítimamente aparecer dos veces en una ronda (son 2
colores agrupados), así que ese test no distingue "coloreado correcto" de
"coloreado con una arista mal duplicada en el mismo color".

Es exactamente el hueco de rigor que ya apareció en la primera vuelta: 100%
de cobertura sin que eso pruebe la propiedad que importa. El código pasa mi
verificación externa, pero el propio repositorio no se defiende a sí mismo
de una regresión futura en esta propiedad — si alguien toca
`misraGriesColoring` en H8 y rompe la validez del coloreado sin tocar el
recuento de colores usados, ningún test actual lo detectaría.

**Corregir:** añadir al menos un test que, sobre los subgrafos ya generados
(los 6 de regresión, o el property test), verifique explícitamente
`assigned` completo: cada par de `pairs` aparece una vez en `assigned` y
ninguna ronda repite jugador — el patrón que usé en mi script, adaptado a
Vitest.

### 3. ¿Ha desaparecido el voraz de verdad?

Sí. `grep -rn "greedyMatchings" src/ tests/` no devuelve nada — ni código
vivo ni comentario residual. `misraGriesColoring` es la única función que
alimenta el camino de subgrafo arbitrario en `assignPairsToRounds`
(`src/server/rounds.ts:612`).

### 4. Docstrings

Ninguno promete ahora una garantía que el código no dé. Confirmé los dos
que el builder dice haber corregido (la atribución de la construcción
"`n` impar, `k` impar" pasa de `greedyMatchings` a
`oddCompleteGraphJourneys` en el docstring de `roundsCount` — línea 102— y
en el de `circleMethodJourneys` —línea 126—, y el de `oddCompleteGraphJourneys`
ya no dice que un voraz plano "no es suficientemente bueno aquí" como si
solo aplicara a `K_n`, sino que directamente evita invocar
`misraGriesColoring` porque no hace falta). El único sitio que sigue citando
`Δ+1`/Vizing es el docstring de `misraGriesColoring` mismo, que es
precisamente el que sí lo demuestra y lo cumple — correcto que sea el único.
`grep -n "Δ\|Vizing\|greedy"` sobre todo el fichero no deja ninguna frase
suelta que contradiga esto.

### 5. Determinismo con el algoritmo nuevo

Todas las elecciones libres de Misra & Gries están desambiguadas de forma
estable, verificado línea a línea:

- **Orden de procesamiento de aristas**: `edges` se ordena explícitamente
  por `(índice de homeId, índice de awayId)` antes de colorear
  (`src/server/rounds.ts:438-440`) — no depende del orden de `pairs` de
  entrada.
- **Construcción de adyacencia**: cada `adjacency[x]` se ordena
  ascendentemente (`list.sort((a,b) => a-b)`, línea 445) antes de usarse.
- **`smallestFreeColor`**: recorre `allColors` (array ordenado 0..N) y toma
  el primero libre — determinista por construcción, no por iteración de
  `Set`/`Map` (el `Set` ahí solo se usa para membership, `used.has(c)`).
- **`buildMaximalFan`**: cuando hay varios candidatos válidos para extender
  el abanico, toma `Math.min(...candidates)` explícitamente (línea 509) —
  esta es la única elección genuinamente libre del algoritmo (cualquier
  candidato válido sirve matemáticamente) y está desambiguada.
- **`invertKempeChain`**: el comentario razona correctamente por qué aquí
  **no** hace falta desambiguar — en un coloreado propio, a lo sumo un
  vecino puede tener el color buscado, así que `adjacency[current].find(...)`
  no tiene empate real que resolver.

Repetí el test de determinismo del propio commit (`K_14 menos 3`, dos
llamadas) y además crucé `K_13 menos 2` con `JSON.stringify` en dos
procesos `tsx` separados: mismo resultado byte a byte en ambos casos.

### 6. Cobertura al 100% y el `throw` eliminado — BLOQUEANTE

Verificado por el camino correcto (`coverage/coverage-final.json`, no la
tabla de texto): `src/server/rounds.ts` da **230/230 statements, 64/64
branches, 46/46 functions** — 100% real, coincide con lo que reporta el
builder.

Sobre el `throw` sustituido por una aserción no nula
(`smallestFreeColor`, línea 461:
`return allColors.find((c) => !used.has(c))!;`): **no era mentira que sea
matemáticamente inalcanzable dado un Misra & Gries correcto** — el propio
comentario lo razona bien (`|used| ≤ degree(x) ≤ maxDegree < colorCount`).
Pero esto es distinto de los otros dos `!` que quedan en la misma función
(`color[a].get(b)!` en la inversión de cadena, `index.get(p.homeId)!` al
volcar la salida): esos dos se deducen de una comprobación **local**, tres
líneas antes, dentro de la misma función — imposibles de que fallen salvo
que el propio bloque que los precede esté mal. El de `smallestFreeColor` en
cambio depende de un invariante **global**, mantenido por *todo* el resto
del algoritmo (abanico + inversión + rotación) en cada llamada anterior —
exactamente la clase de cosa que puede romperse por un bug futuro en
cualquier otra parte de esta función delicada, sin que nada cerca de la
línea 461 avise.

Lo comprobé forzando el invariante a mano (rebajé `colorCount` en una copia
temporal del fichero, restaurada después, `git status` limpio) sobre un
5-ciclo (impar, `Δ=2`, necesita 3 colores, no es grafo completo así que sí
pasa por `misraGriesColoring`): con el invariante roto, **no falla limpio**.
Explota más adelante, en un punto totalmente ajeno a la causa real:

```
THREW: Cannot read properties of undefined (reading 'push')
```

en `matchings[color[u].get(v)!].push(p)` — porque `color[u].get(v)` fue
`undefined` desde `smallestFreeColor` varias llamadas atrás, y el `!` dejó
pasar ese `undefined` sin decir nada hasta que revienta en un sitio que no
tiene nada que ver con el diagnóstico real. Es exactamente el patrón que
señalabas: se cambió una excepción de invariante clara y localizada por
"código sin guarda" que, si el invariante se rompe alguna vez (un futuro
retoque de `misraGriesColoring` en H8, por ejemplo), no da un mensaje
accionable — da un `TypeError` genérico varias funciones más allá del
origen.

**Sí es lo segundo, no lo primero: se quitó una red de seguridad real para
que cuadrara el número de cobertura**, aunque la aserción en sí sea cierta
hoy. Pido restaurar un `throw` explícito con mensaje ("Misra–Gries
invariant violated: no free color at vertex …") en el sitio original, y
para no perder el 100% honesto, marcarlo con el comentario de exclusión de
cobertura que ya usa el proyecto en otros sitios de este mismo módulo para
guardas defensivas comprobadamente inalcanzables (o el equivalente de v8:
`/* v8 ignore next */`) — igual que ya se hace correctamente para las
guardas de `assignPairsToRounds` (esas si tienen throw explícito, cubierto
por test, porque son alcanzables por el caller; esta es la misma familia de
guarda pero inalcanzable, así que la diferencia debe ser la anotación de
cobertura, no la ausencia del throw).

### 7. El property test

PRNG con semilla fija: `pseudoRandom(seed)` es el mismo generador
congruencial lineal ya usado en la suite (`s = (s * 1103515245 + 12345) &
0x7fffffff`), sin `Math.random` en ningún punto nuevo. Las semillas se
derivan de `n`, `density` y un contador (`n * 10007 +
Math.round(density*1000) + seed`) — deterministas, reproducibles hoy y
mañana. El `expect(casesChecked).toBeGreaterThan(100)` confirma que el
bucle realmente ejecuta (no un property test que se queda vacío por un
filtro demasiado agresivo). Correcto.

### Regresión

Reproducida en `HEAD` (`e332620`, que solo añade el chore de D4 sobre
`b7c8ee8`):

- `npm run lint` → limpio.
- `npm run test` → `Test Files 9 passed (9)` / `Tests 367 passed (367)`.
- `npm run test:coverage` → 367 tests en verde; `rounds.ts` 230/230
  statements, 64/64 branches, 46/46 functions (100% real, verificado en
  `coverage-final.json`, no en la tabla de texto).
- `npm run build` → compila y genera las 19 rutas sin errores.

### Qué corregir

1. **(Bloqueante)** `src/server/rounds.ts:461` — restaurar un `throw`
   explícito y descriptivo en `smallestFreeColor` para el caso "ningún
   color libre" en vez de la aserción no nula `!`. Confirmado que, si el
   invariante se rompe, la aserción no falla limpio: revienta más tarde con
   un `TypeError: Cannot read properties of undefined (reading 'push')` en
   un punto sin relación aparente con la causa. Usar una anotación de
   cobertura (`/* v8 ignore next */` o equivalente) para mantener el 100%
   sin sacrificar el diagnóstico.
2. **(Bloqueante)** `tests/rondas.test.ts`, describe de Misra & Gries — los
   tests nuevos (los 6 de regresión, "K_n menos 1 arista" y el property
   test) solo comprueban `journeysUsed ≤ Δ+1`, nunca que el coloreado sea
   **válido** (ninguna ronda con jugador repetido) ni que **cada par de
   entrada aparezca exactamente una vez** en la salida. Añadir esa
   comprobación explícita — es la que de verdad importa para el producto,
   tal como se pedía revisar, y hoy nada en la suite la protege de una
   regresión futura en `misraGriesColoring` (p. ej. durante H8).
