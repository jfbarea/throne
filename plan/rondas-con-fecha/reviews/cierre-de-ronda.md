# Review — H4 `cierre-de-ronda`

**Commit revisado:** `543753f`. (`a57ccd0` es chore de estado, no toca código.)

## Veredicto: APPROVED (con un hallazgo transversal que no bloquea este hito pero exige decisión antes de cerrar la feature)

El cierre de ronda en sí —la parte que este hito escribe de verdad
(`closeRound`, la guarda `canReportGivenRoundClosed`, el fix de
`resolution`, la UI de `/admin/rondas`)— está bien construido: transacción
atómica de verdad (lo comprobé forzando un fallo a mitad), sin guarda de
adelantar, AC-19 compara el `Result` completo, y los tres puntos que el
builder decidió no cubrir están verificados y son correctos. El hallazgo
grande (punto 1) no es un bug de este commit — es una consecuencia visible
por primera vez porque este hito es el que empieza a producir
`UNPLAYED_DRAW` de verdad, pero la superficie que lo muestra mal
(`calendario`, `mis-partidas`) no es de H4 y ningún hito la tiene asignada
todavía. Lo trato como el hallazgo más importante del informe, no como un
bloqueante de este commit.

## 1. `status: "REPORTED"` en partidas saldadas — hallazgo real, transversal

Confirmado en código, no solo en teoría. `src/app/calendario/MatchRow.tsx:33`
etiqueta `REPORTED` literalmente como **"Jugada"**:

```ts
REPORTED: { label: "Jugada", variant: "brass" },
```

y `src/app/mis-partidas/MatchCard.tsx:49` lo etiqueta **"Apuntada"**, en el
mismo bloque que agrupa las partidas con resultado propio del jugador.
`grep -rn "resolution" src/app` **no devuelve ni una sola coincidencia en
todo el árbol** — ningún componente de UI lee o muestra `resolution` hoy.
Consecuencia directa: en cuanto un admin cierre una ronda de verdad, todo
participante que mire `/calendario` verá su partida de la ronda 1 —que
nunca jugó— con la etiqueta **"Jugada"**, 0-0, indistinguible de una
partida que de verdad se disputó y quedó en tablas. Contradice
directamente §4.9 de la spec, que dice explícitamente que `resolution`
existe para **"etiquetar la partida en la UI («incomparecencia»)"**.

Es necesario que `Match.status` pase a `REPORTED` — lo verifiqué yo mismo,
no solo el razonamiento del builder: sin ese cambio, `isConfirmedForStandings`
(`status ∈ {REPORTED, CONFIRMED} && result !== null`) descartaría la
partida saldada y **jamás contaría en la clasificación**, vaciando de
sentido todo el cierre de ronda. El cambio de status es correcto y
necesario. El problema es que **nada lee `resolution` para matizar esa
etiqueta**, y H4 no puede arreglarlo porque no toca ninguno de esos dos
ficheros (fuera de su lista de ficheros y de su sección en `PLAN.md`).

**Esto tampoco lo cierra H7 como parece esperarse.** Revisé la sección H7
de `PLAN.md`: solo toca `standings.ts` y `/app/clasificacion/page.tsx`, para
la columna agregada «PJ 11 (2 saldadas)» — un contador en la página de
clasificación, no una etiqueta por partida en `/calendario` o
`mis-partidas`. Tampoco lo cierra H5 (`incomparecencia`): su bullet de UI
("etiqueta «incomparecencia» donde se muestre") es específico de
`WALKOVER`, no de `UNPLAYED_DRAW`. **A día de hoy, ningún hito del plan
tiene asignado corregir esto para `calendario`/`mis-partidas`.** Recomiendo
añadir un ítem explícito (probablemente a H6, que sí toca esas dos vistas)
antes de dar la feature por completa — de lo contrario, es exactamente el
tipo de gap que se cuela en silencio hasta que un usuario real lo reporta
como "por qué me sale jugada una partida que no jugué".

No bloqueo H4 por esto: el cambio de status es correcto y necesario para
el propósito de este hito, y arreglar el label no está entre los ficheros
que este commit toca ni entre los que `PLAN.md` le asigna.

## 2. El bug de `resolution` en `reportResult` — arreglo correcto y completo

Repasé **todos** los sitios de escritura de `Result` en `src/` (`grep`
sobre `result.create`/`.update`/`.createMany`): son exactamente tres —
`reportResult` (create y update, ambos con `resolution: "PLAYED"` explícito
ahora) y `closeRound` (`createMany` con `resolution: "UNPLAYED_DRAW"`
explícito). No queda ninguna vía de escritura de `Result` sin fijar
`resolution` de forma explícita; el `@default(PLAYED)` del schema ya no lo
sostiene ningún flujo de producción.

Sobre H5: el diseño **encaja**, no lo dificulta. El futuro `WALKOVER` es
una acción nueva y separada (así lo describe H5 en `PLAN.md`: "escribe 80-0
... resolution = WALKOVER ... sin pasar por calculateBonus"), no una rama
dentro de `reportResult` — así que el `resolution: "PLAYED"` fijo en
`reportResult` no colisiona con ella. Y para el caso que sí toca a
`reportResult` en el futuro —según §4.10, "cualquiera de los dos puede
sobrescribirla después (con el resultado real si al final se juega)"—, que
`reportResult` fuerce `PLAYED` al editar es exactamente el comportamiento
correcto: sobrescribir un `WALKOVER` con el marcador real debe volver a
`PLAYED`, tal como ya hace hoy con `UNPLAYED_DRAW`.

## 3. Criterios 15 y 16 — confirmado que no se añadió ninguna guarda

`grep` sobre `roundIndex|adelant|posterior|earliest|orden` en
`result-actions.ts`, `result-logic.ts` y `round-actions.ts` no encuentra
ninguna comparación entre la ronda de una partida y la de otra. Las únicas
guardas de `reportResult` son `canReport` (participante/admin),
`canReportInStatus` (status) y `canReportGivenRoundClosed` (closedAt de
**su propia** ronda) — ninguna mira qué ronda es "la actual" del jugador ni
bloquea apuntar una posterior. Los tests AC-15 y AC-16 lo ejercitan de
punta a punta (adelantar sin error, y el saldo de la ronda propia
conviviendo con la partida adelantada intacta en la suya). Correcto, sin
regresión sobre §4.5.

## 4. Atomicidad de la transacción de cierre

La comprobé de verdad, no solo la leí: inyecté temporalmente un
`throw` en medio de la transacción de `closeRound` (después del
`result.createMany` y el `match.updateMany`, antes de `round.update` y del
`AuditLog`), lo ejecuté contra la DB de test real, y confirmé que **nada**
persiste — `Round.closedAt` sigue `null`, el `Match` sigue `SCHEDULED`, el
`Result` nunca se creó (rollback), y no hay entrada de `AuditLog`. Revertí
el cambio después (`git status` limpio, 12/12 tests de nuevo en verde). El
`createMany` de `Result` y la transición de status no pueden desincronizarse
porque viven en la misma transacción interactiva de Prisma: o se confirman
las dos, o ninguna.

## 5. AC-19 — comparación completa, no un subconjunto

`tests/cierre-de-ronda.test.ts:248-261`: `before`/`after` son objetos
`Result` completos leídos de la DB (`prisma.result.findUnique`, sin
`select`), y la comparación es `expect(after).toEqual(before)` — no
`toMatchObject` con una lista elegida de campos. Eso cubre VP, `outcome`,
`bonusHome`/`bonusAway`, `resolution`, `reportedById`, y también
`reportedAt`/`confirmedAt`/`confirmedById`/`id`/`matchId`, con `bonusEnabled`
activo en la liga de test para que un bonus mal calculado se notara. Más
completo de lo mínimo pedido.

## 6. El apaño del linter (`Date.now()` → `new Date().getTime()`)

Confirmé el comportamiento exacto del linter, no solo el relato del
builder: revertí `page.tsx` a `Date.now()` y `npm run lint` falla con
`Cannot call impure function during render` (regla `react-hooks/purity`);
con `new Date().getTime()` pasa limpio. Es ruido del linter, no un problema
de pureza real que se haya corregido: las dos expresiones leen exactamente
el mismo reloj de pared en el mismo instante, y el análisis estático de la
regla solo reconoce el patrón sintáctico `Date.now()`, no
`new Date().getTime()` — no hay ninguna diferencia de comportamiento entre
ambas.

Dicho esto, el sitio donde se calcula sí es el correcto, con o sin el
capricho del linter de por medio: `page.tsx` (Server Component) computa
`now` una vez por request y pasa `isPastDeadline`/`deadlineLabel` ya
resueltos como props a `CloseRoundButton.tsx` (Client Component), que nunca
lee el reloj por su cuenta — así que no hay riesgo real de purity en el
sentido que la regla protege (memoización/recomputación en cliente), esté
o no de acuerdo el linter. Sugerencia: dejar un comentario de una línea
junto a `new Date().getTime()` en `page.tsx` explicando que es un rodeo del
linter y no una corrección real — hoy esa explicación solo vive en
`_state.json`, y si `react-hooks/purity` cierra el hueco en una versión
futura, quien lo vea fallar sin ese contexto perderá tiempo pensando que
hay un bug de pureza de verdad.

## 7. Los tres puntos que el builder decidió no cubrir

- **Sin guarda por `League.status`**: correcto no añadirla. Un `Round` solo
  existe tras `generateLeagueMatches`, que ya transiciona la liga a
  `LEAGUE`; y para que la liga llegue a `PLAYOFFS` hará falta (H9) que
  **todas** las rondas ya estén cerradas, así que no hay escenario real en
  el que quede una ronda abierta que cerrar con la liga ya en playoffs.
- **Cerrar una ronda sin partidas**: correcto, y de hecho ya está probado
  sin que el builder lo llamara explícitamente así — el test
  `"permite cerrar una ronda cuya fecha límite ya pasó"` (AC-17) crea la
  ronda sin ninguna partida y `closeRound` tiene éxito.
- **`playerAwayId` nulo con `roundId`**: lo comprobé estructuralmente,
  revisando **todos** los `match.create`/`createMany` del árbol (5 sitios
  en total: 2 en `match-actions.ts`, 3 en `playoff-actions.ts`). Los tres
  de `playoff-actions.ts` (los únicos que alguna vez ponen
  `playerAwayId: null`, para byes) nunca incluyen `roundId` en absoluto. El
  único sitio que escribe `roundId` (`generateLeagueMatches`) construye los
  pares desde `roundRobinRounds`, tipado como `{ homeId: string; awayId:
  string }` — sin `null` posible en ese tipo. La afirmación es cierta en
  todo el código actual, no solo en la práctica.

## 8. Guardas, Zod, `AuditLog`, y `updateRoundDeadline` intacto

- `closeRound` y `updateRoundDeadline`: `requireAdmin()` como primera
  instrucción en ambas.
- `AuditLog` con el actor de la sesión, dentro de la misma transacción,
  confirmado con test y con mi propia prueba de atomicidad.
- `updateRoundDeadline`: `git diff 7039670 543753f -- src/server/round-actions.ts`
  muestra que su cuerpo (líneas 1-105 del fichero anterior) no cambia ni un
  carácter — solo el comentario de cabecera del fichero se actualiza y todo
  lo nuevo se añade después. Cero riesgo de regresión, confirmado por diff,
  no por confianza.

## Regresión

- `npm run lint` → limpio.
- `npm run test` → `Test Files 11 passed (11)` / `Tests 400 passed (400)` —
  coincide con la baseline anunciada.
- `npm run build` → compila, 20 rutas, sin errores.
- `npm run e2e` → **37 pasan, 1 skipped**, idéntico al baseline.

## Sugerencias (no bloqueantes)

1. **(La más importante — ver punto 1).** Añadir explícitamente a `PLAN.md`
   (probablemente H6, que ya toca `mis-partidas`/`calendario`) la tarea de
   leer `resolution` y matizar la etiqueta de las partidas `UNPLAYED_DRAW`
   (y, cuando llegue H5, `WALKOVER`) en esas dos vistas. Hoy no está
   asignada a ningún hito y el propio `H7` no la cubre pese a la
   expectativa de que "la matice".
2. Comentario en `src/app/admin/rondas/page.tsx` junto a
   `new Date().getTime()` explicando que es un rodeo de
   `react-hooks/purity`, no una corrección de un problema de pureza real.
