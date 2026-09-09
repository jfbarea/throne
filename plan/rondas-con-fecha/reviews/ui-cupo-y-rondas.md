# Review — H6 `ui-cupo-y-rondas`

**Commits revisados:** `4af216f` (H6), `3ba90da` (fix del e2e, autorizado por el
coordinador). `a45c2e7` (tipos de `tests/emparejamientos.test.ts`) comentado al
final, ajeno al hito.

## Veredicto: APPROVED

Los tres criterios (9, 12, 13) y los tres de etiquetado están cubiertos con
evidencia verificable, no solo con tests que pasan. Rompí yo mismo la
instrumentación de queries del criterio 12 inyectando un N+1 real y la cazó;
comparé el etiquetado nuevo contra el código exacto que reemplaza, campo a
campo, y coincide para el caso `PLAYED`; confirmé que `page.tsx` no añade
queries propias más allá de la búsqueda de liga (un patrón ya presente en
**todas** las páginas de la app, no algo nuevo de este hito); y audité los
tres casos raros con la spec en la mano — ninguno necesitaba escalarse. El
fix del e2e (`3ba90da`) es robusto de verdad, no solo desplaza la asunción:
lee el DOM en vez de asumir un orden. `npx tsc --noEmit` limpio por primera
vez, y el resto de la regresión (lint, test, build, e2e ×2) verde y estable.

## 1. Criterio 12 — probé la instrumentación con un N+1 real, no confié en que el test pasara

No me limité a ejecutar `tests/rondas-overview.test.ts`. Inyecté
temporalmente un `for` que llama a `db.player.findUnique` una vez por
jugador dentro de `getRoundsOverview` (un N+1 de libro) y volví a correr la
suite: el test de 4 jugadores pasó de esperar `Player: 1` a recibir
**`Player: 5`**, y el de 16 jugadores pasó a **`Player: 17`** — exactamente
`1 + N`, la firma de un N+1 real. La instrumentación (`$extends({query:
{$allModels: {$allOperations}}})`) cuenta de verdad lo que se ejecuta contra
el cliente Prisma, no un proxy que se le escape: revertí el sabotaje después
(`git diff` vacío) y los 5 tests volvieron a verde.

Sobre si `page.tsx` hace consultas por su cuenta además de las tres: **sí
hace una**, `prisma.league.findFirst({orderBy: {createdAt: "desc"}})`, para
resolver la liga activa antes de llamar a `getRoundsOverview`. Lo comprobé
con `grep` y confirmé que **no es un añadido de este hito ni un descuido**:
es el mismo patrón, literal, que usan `calendario/page.tsx`,
`clasificacion/page.tsx` y `mis-partidas/page.tsx` — las cuatro páginas del
árbol resuelven "la liga activa" con la misma query de coste constante,
ajena al número de jugadores o rondas. El criterio 12 dice explícitamente
"**una sola query de partidas**" (no "una sola query en toda la página"), y
esta query no es de partidas ni escala con nada — no es el N+1 que el
criterio prohíbe. El resto de la página (el `.map` sobre `rounds` para
pintar las tarjetas) no toca la base de datos en ningún punto: leí
`src/app/rondas/page.tsx` completo y las únicas dos líneas con `await
prisma`/`await getRoundsOverview` son las que ya cuenta el test.

## 2. Los tres criterios de etiquetado — comparados campo a campo contra el código que sustituyen

No me fié de que los tests de `resolveMatchStatusLabel` pasaran; comparé la
tabla `STATUS_LABEL` que existía en cada componente **antes** de este hito
(`git show 368a71a:src/app/mis-partidas/MatchCard.tsx` y el equivalente de
`MatchRow.tsx`) contra la salida de `resolveMatchStatusLabel` para
`resolution: "PLAYED"` (o `null`, el caso `SCHEDULED`):

| Estado | Antes (`MatchCard`) | Antes (`MatchRow`) | Ahora (`resolveMatchStatusLabel`) |
| --- | --- | --- | --- |
| `SCHEDULED` | `{Pendiente, neutral}` | `{Pendiente, neutral}` | `{Pendiente, neutral}` — igual |
| `REPORTED` + `PLAYED` | `{Apuntada, brass}` | `{Jugada, brass}` | `{playedLabel, brass}` con `playedLabel="Apuntada"`/`"Jugada"` — igual |
| `CONFIRMED` | `{Confirmada, moss}` | `{Confirmada, moss}` | `{Confirmada, moss}` — igual |
| `DISPUTED` | `{Disputada, ember}` | `{Disputada, ember}` | `{Disputada, ember}` — igual |

Coincide en las cuatro filas, en las dos vistas — el caso normal no cambia,
tal como exige el tercer criterio de etiquetado. Y para los dos casos
nuevos: `WALKOVER` → `{Incomparecencia, ember}` y `UNPLAYED_DRAW` →
`{Saldada sin jugar, ash}`, verificados con test para las dos vistas cada
uno (`tests/ui-cupo-y-rondas.test.ts`, los 8 casos de etiquetado, ejecutados
y en verde). Confirmé además que ninguno de los dos componentes reimplementa
esta lógica por su cuenta: `grep` sobre `MatchCard.tsx`/`MatchRow.tsx`
encuentra una sola llamada a `resolveMatchStatusLabel` en cada uno, y la
antigua tabla `STATUS_LABEL` está borrada del todo (no quedó como código
muerto que alguien pudiera reactivar por error). El badge duplicado
"incomparecencia" que `MatchCard` pintaba aparte para `WALKOVER` (de H5)
también se retira — correcto, es exactamente el mismo dato que ahora ya dice
el badge principal.

## 3. El fix del e2e (`3ba90da`) — robusto de verdad, no un desplazamiento de la asunción

Verifiqué el mecanismo, no solo el resultado. El test ya no asume que el
primer botón "Apuntar resultado" cae en una partida con Alfa de local: lee
el nombre del jugador local directamente de la tarjeta
(`ancestor::div[contains(@class,'rounded') and contains(@class,'border')
and contains(@class,'p-4')]`, primer `<p>`, primer `<span>`) y decide en
qué lado poner el marcador ganador antes de rellenar el formulario. Confirmé
que el XPath resuelve al elemento correcto leyendo el JSX real de
`MatchCard.tsx`: el div raíz de la tarjeta es exactamente
`className="rounded border p-4"`, y su primer `<p>` es la línea
"Home vs Away" cuyo primer `<span>` es `match.playerHomeName` — no hay
ningún otro `<div>` con esas tres clases entre el botón y ese contenedor
(el propio botón es un `<button>`, no un `<div>`, así que el eje `ancestor::div`
no lo confunde consigo mismo). Esto sí es robusto al orden: da igual qué
partida salga primero, porque el test averigua quién es local en tiempo de
ejecución en vez de darlo por supuesto.

Sobre los pasos 7 y 8: los leí en detalle. El paso 7 rellena VP fijos
(`60`/`40`) sin comprobar qué lado es Alfa, pero su única aserción tras el
envío es un texto genérico de estado (`/Apuntadas|Apuntada/i`) — **nunca**
comprueba un nombre de ganador ni un lado, y ya tenía una rama de
`isBtnVisible` con *fallback* si no encuentra "Editar resultado". El paso 8
solo comprueba que los dos nombres aparezcan en `/clasificacion`,
independientemente de quién ganó. Ninguno de los dos depende de qué
partida salga primero ni de quién sea local — la afirmación del commit es
correcta, no un supuesto sin comprobar.

## 4. `/rondas` en móvil — el bug real, confirmado; la cobertura automática, parcial

El bug del quinto enlace lo verifiqué indirectamente: los tests de overflow
horizontal ya existentes en `full-journey.spec.ts` (`login`, `mis-partidas`,
`clasificacion`, `calendario`, `bracket`) ejercitan el mismo `AppHeader`
compartido —con los 5 enlaces ya presentes— en cada página, y los cinco
pasan tanto en `chromium` como en `mobile-chrome`; si el `overflow-x-auto` +
`min-w-0` del `nav` no funcionara, se habrían roto. Añadí además mi propia
comprobación puntual, aparte de la suite (creada y borrada, no forma parte
del commit): cargué `/rondas` a 390px de ancho con sesión de jugador y
comparé `scrollWidth` contra `clientWidth` del documento —
`{scrollWidth: 390, clientWidth: 390}`, sin desbordamiento, con los ~7
jugadores del *seed* de e2e.

Lo que **no** está cubierto automáticamente: ningún test de overflow visita
`/rondas` específicamente, y el *fixture* de e2e tiene ~7 jugadores, no los
12-20 que la spec §7.2 menciona como el caso a soportar. El patrón CSS usado
(`grid-template-columns: repeat(auto-fill, minmax(132px, 1fr))` sin ningún
`overflow-x`, con `min-w-0`/`truncate` en cada celda) es estructuralmente
correcto para envolver en vez de desbordar — no tengo dudas de que
**funciona** — pero la cobertura automática de esa afirmación concreta
("12-20 jugadores caben") descansa en el razonamiento sobre el CSS y en mi
comprobación manual de esta review, no en un test que quede en el repo. Lo
dejo como sugerencia, no como bloqueante: el criterio de aceptación del
hito no lo pide como un AC numerado propio (es un requisito transversal de
§7.2, no uno de los tres que cierra H6).

## 5. Los tres casos raros — auditados con la spec en la mano

- **`roundId = null` en un bloque "Sin ronda asignada"**: es la decisión que
  más merece explicarse, y la juzgo correcta, con un matiz importante sobre
  a qué escenario responde. §5.4 dice que un `Match` de liga con
  `roundId = null` es un estado inválido que "la UI tiene que tratar como
  liga sin generar, no reventar" — pero ese texto describe **datos que
  sobrevivieran a una migración sin reinicio**, un escenario que en la
  práctica no ocurre (el reinicio es el único camino de migración,
  spec-mandated, y la app está en desarrollo). La situación real que este
  bloque cubre es **distinta**: `addMissingLeagueMatches` (ya existente,
  con un botón activo en `/admin/emparejamientos/SyncButton.tsx`, confirmado
  con `grep`) crea partidas de liga con `roundId = null` a propósito cuando
  se añade un jugador a mitad de liga, hasta que H8 las reparta — un estado
  intencional y ya señalado como "omisión silenciosa, coherente con el plan"
  en la propia review de H3. Antes de H6, esas partidas **ya eran visibles**
  para el jugador (la página agrupaba por estado, no por ronda, así que una
  partida sin ronda caía sin más en "Pendientes"). Si H6 las hubiera dejado
  caer silenciosamente al pasar a agrupar por ronda, habría sido una
  **regresión real** — un jugador con una partida pendiente de verdad
  dejaría de verla en ningún sitio. Mostrarlas en un bloque con una etiqueta
  que un usuario entiende sin conocer la implementación ("Sin ronda
  asignada", no "roundId null" ni jerga de desarrollador) evita esa
  regresión sin inventar una ronda falsa ni reventar — cumple la letra de
  §5.4 (ni revienta, ni fabrica un dato) aplicada al escenario que sí es
  alcanzable hoy. No lo habría escalado yo tampoco.
- **El admin viendo agregado por ronda en vez de cupo individual**: la spec
  no dice nada sobre qué debe ver el admin en una vista que mezcla a todos
  los jugadores a la vez — su mockup de "Mis partidas" es de un jugador. Y
  `/rondas` (spec-mandado, criterio 12) ya cubre exactamente la necesidad de
  "cupo de cada jugador en cada ronda" para quien necesite esa vista
  agregada de verdad. Sustituir un "cupo individual" sin sentido (¿de quién?
  con una lista mixta) por un contador resuelto/total por ronda es una
  decisión de bajo riesgo y razonable, no algo que necesitara pararse a
  preguntar.
- **Las partidas de playoff**: confirmé que el filtro `phase: "LEAGUE"` en
  `mis-partidas/page.tsx` **ya existía antes de H6** (`git show
  368a71a:src/app/mis-partidas/page.tsx` lo tiene idéntico) — este hito no
  cambia nada sobre cómo se tratan los playoffs ahí. `getRoundsOverview`
  también filtra `phase: "LEAGUE"` explícitamente en su única query de
  partidas — coherente con que los playoffs no tienen `Round` (mismo
  argumento, ya validado en H5, de que la spec dice "no se toca el formato
  de playoffs"). Correcto excluirlos sin caso especial.

## 6. `requireAuth` en `/rondas` — primera instrucción, confirmado

`src/app/rondas/page.tsx:30`: `await requireAuth();` es literalmente la
primera línea del cuerpo de la función, antes de cualquier acceso a la
base de datos. `tests/e2e/rondas.spec.ts` (AC-13) lo ejercita de verdad
contra un servidor real: sin sesión redirige a `/login`, con sesión de
jugador y con sesión de admin entra — los tres pasan, los ejecuté yo mismo
dos veces dentro de la corrida completa de e2e.

## 7. Ficheros aprobados, sin tocar

`git diff 368a71a..4af216f -- src/lib/guards.ts src/server/rounds.ts
src/server/round-actions.ts src/server/result-actions.ts
src/server/result-logic.ts` da diff **vacío** — ninguno de los cinco
ficheros de H2/H4/H5/H5b se toca en el commit de H6. `3ba90da` y `a45c2e7`
solo tocan ficheros de test, confirmado por sus `--stat`.

## 8. Las funciones puras no se duplican en la UI

`sortRoundBlocks` se usa una vez en `mis-partidas/page.tsx` (no en
`rondas/page.tsx`, que ordena por índice de ronda a propósito — es un
calendario de liga, no la vista de urgencia de un jugador, y la nota del
builder lo explica; correcto no forzar el mismo orden ahí).
`resolveMatchStatusLabel` se usa una vez en `MatchCard.tsx` y una vez en
`MatchRow.tsx`, y ninguno de los dos componentes vuelve a decidir la
etiqueta por su cuenta — confirmado arriba (punto 2) al no encontrar
ninguna tabla de etiquetas residual.

## Sobre `a45c2e7` (tipos de `tests/emparejamientos.test.ts`)

El cast no me parece mal: es exactamente el mismo patrón de "castear a
través de `unknown`" que ya se usa en otros puntos de la suite cuando el
tipo inferido por un mock no coincide con lo que el test sabe que es cierto
en tiempo de ejecución, y está confinado a un test que lee argumentos de un
mock (no a lógica de producción). Confirmé que `npx tsc --noEmit` está
limpio ahora mismo, sin ningún error — el cambio hace lo que dice.

## Regresión

- `npm run lint` → **0 errores, 0 warnings**.
- `npm run test` → `Test Files 15 passed (15)` / `Tests 447 passed (447)`.
- `npx tsc --noEmit` → limpio, sin salida.
- `npm run build` → compila, **21 rutas** con `/rondas` en el árbol.
- `npm run e2e` → ejecutado **dos veces** por el estado compartido de
  `e2e.db`: **43 pasan, 1 skipped** en ambas corridas, sin intermitencia.

## Bloqueantes

Ninguno.

## Sugerencias (no bloqueantes)

1. **(Punto 4)** Añadir `/rondas` a los tests de overflow horizontal de
   `full-journey.spec.ts` (o a `tests/e2e/rondas.spec.ts`), y considerar un
   *fixture* con más jugadores que los ~7 del *seed* actual para que la
   afirmación de §7.2 ("12-20 jugadores caben en móvil") quede verificada
   automáticamente a la escala que la spec menciona, no solo razonada sobre
   el CSS y comprobada manualmente en esta review.
2. Documentar en el propio código de `mis-partidas/page.tsx` (un comentario
   junto al filtro de `unassignedMatches`) la distinción entre el escenario
   de §5.4 (datos migrados sin reinicio, no alcanzable en la práctica) y el
   de `addMissingLeagueMatches` (alcanzable hoy, hasta H8) que este bloque
   cubre de verdad — la nota ya vive en `_state.json`, pero no en el código
   que alguien leería al auditar esto de nuevo más adelante.
