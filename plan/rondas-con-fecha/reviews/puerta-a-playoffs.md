# Review — H9 `puerta-a-playoffs`

**Commits revisados:** `21175ca` (H9) y `9854ccf` (hueco escalado y cerrado).

## Veredicto: APPROVED

La guarda nace endurecida de verdad —el patrón de D5/H5b/H8 aplicado
correctamente, con test que falla sin él, verificado por mí de forma
independiente con un disparador real (`addMissingLeagueMatches`) en vez de
una escritura cruda—, y el hueco de la liga sin ninguna `Round` está bien
diagnosticado, bien aplicado en los dos sitios, y no era una decisión de
producto. El criterio 37 está verificado con una comparación estructural
completa, no de conteos, y `tests/playoffs-bracket.test.ts` tiene diff
vacío confirmado. Encontré y reproduje una vía real por la que la
clasificación puede quedar obsoleta sin tocar `Round.closedAt` —la
justificación aceptada no es literalmente cierta en todos los casos—, pero
es exactamente la misma carrera admin-contra-admin que el propio código ya
declara aceptada, no un hueco nuevo que invalide la decisión.

## 1. El endurecimiento — reproducido con mi propia técnica, con el disparador real

No me limité a ejecutar `tests/puerta-a-playoffs.test.ts`. Además de
confirmar que los 4 tests que dependen del endurecimiento (los dos mensajes
de AC-36, el de "liga sin ninguna ronda" y el de la relectura con `tx`)
**fallan** revirtiendo `playoff-actions.ts`/`bracket.ts` al commit anterior a
H9 (`expected true to be false` en los cuatro, restaurado después con árbol
limpio), escribí mi propia reproducción independiente con un disparador
**real** en vez de un `prisma.round.create` crudo: una liga con una ronda
cerrada, y en la ventana entre el atajo de `startPlayoffs` (que ve la liga
completamente resuelta) y su transacción, un tercer jugador se da de alta de
verdad vía `addMissingLeagueMatches` — que internamente llama a
`redistributePending` y crea una ronda nueva **abierta**. Resultado:
`startPlayoffs` rechaza (`"todavía quedan rondas sin cerrar: ronda 2..."`),
sin `Bracket` creado y sin transición de `status`. Confirmé también, con el
propio test del builder, que un fallo genérico de DB dentro de la
transacción se propaga tal cual (`rejects.toThrow("simulated generic DB
failure")`), nunca se traduce a "faltan rondas por cerrar".

## 2. El hueco de la liga sin ninguna `Round` — no era decisión de producto, y está en los dos sitios

De acuerdo con no pararse a preguntar. La spec dice explícitamente en §4.11
que la precondición existe para garantizar que "los playoffs arrancan con
las `C(n,2)` partidas resueltas" — con cero filas `Round`, esa garantía no
se sostiene ni siquiera vacuamente (no hay ninguna partida resuelta en
ningún sitio, literalmente lo contrario de lo que la spec pide). No es una
interpretación nueva de la spec ni una regla de competición distinta: es la
misma garantía que el criterio 36 ya protege, aplicada a un caso límite que
la literalidad del criterio ("ninguna ronda sin `closedAt`") no cubre por
un tecnicismo de conjunto vacío. Alcanzable solo a través del hueco
no-atómico de `addMissingLeagueMatches` que yo mismo documenté en H8 — así
que es, con propiedad, un endurecimiento técnico de la misma familia que las
otras tres guardas de esta ronda (D5, H5b, H8), no una decisión nueva.

Confirmé que está aplicado en **los dos** sitios, no solo en uno como pasó
antes tres veces: el atajo (`roundsPreCheck.length === 0` → `NO_ROUNDS_MESSAGE`,
antes de abrir la transacción) y la relectura autoritativa
(`currentRounds.length === 0` → `throw new PlayoffsNoRoundsError()`, primera
instrucción dentro de la transacción, capturada por `instanceof` con el
mismo mensaje). Ejecuté el test del builder para este caso
("con status LEAGUE, cero Round y partidas con roundId: null...") y confirmé
que no crea ni `Bracket` ni `BracketSlot`.

## 3. Criterio 37 — comparación estructural completa, no de conteos

Los dos escenarios de `tests/puerta-a-playoffs.test.ts` (`playoffSize=4` sin
byes, `playoffSize=6` con 2 byes) comparan, campo a campo, cada slot
persistido (`roundIndex`, `position`, `playerId`, `feedsIntoSlotId`
resuelto contra el id real del slot padre) y cada `Match` asociado (bye
`CONFIRMED` sin rival, ronda 1 `SCHEDULED` con el home/away exacto que
predicen los seeds, rondas posteriores sin `Match` todavía) contra
`buildBracket(seedsFromStandings(computeStandings(...)))` calculado sobre
los mismos datos — no solo que el número de slots o de byes coincida.

Confirmé el `git diff` vacío yo mismo:
`git diff 1ed9faa..9854ccf -- tests/playoffs-bracket.test.ts` no devuelve
nada, y `git log --oneline -- tests/playoffs-bracket.test.ts` muestra que el
fichero no se ha tocado desde su commit original (`61ecb82`). Ejecuté el
fichero completo: **56 tests pasan**, sin ninguno nuevo ni modificado — la
señal que pedía el encargo (si algún test de bracket hubiera necesitado
tocarse, sería comportamiento alterado) no aparece.

## 4. El fallout del e2e — de acuerdo en no parchear ahora

Leí el test 10 completo: ya tenía, **desde antes de H9**, una rama de
`if (await startBtn.isVisible(...)) {...} else {... test.skip(); }` — no es
un parche nuevo que oculte el fallo, es el mismo mecanismo de degradación
que el propio test ya usaba para "no hay datos suficientes". Lo que cambia
es que ahora esa rama se activa también cuando las rondas no están cerradas
—el guion nunca las cierra—, así que el botón que antes aparecía sin guarda
ahora no aparece. El resultado es un **skip visible** (`2 skipped` en el
resumen, no un verde falso) y no una regresión de cobertura real: el
criterio 37 —el camino feliz de `startPlayoffs`— ya está probado de forma
exhaustiva y a nivel de DB en `tests/puerta-a-playoffs.test.ts`, que es
donde el reparto de arneses de la spec (§7.3) pone la responsabilidad de
verificación real; el e2e solo cubría el flujo de clic. Parchear el guion
ahora significaría adelantar parte del trabajo que `PLAN.md` ya asigna a H10
—cerrar una ronda de verdad dentro del recorrido— con el riesgo de
duplicar o chocar con esa reescritura. De acuerdo con dejarlo así.

## 5. Los standings fuera de la transacción — encontré la vía, pero es la misma que ya está aceptada

Reproduje directamente la pregunta del encargo: **sí hay** una vía por la
que la clasificación cambia sin tocar `Round.closedAt` entre la lectura y
el commit. Monté una liga con una ronda cerrada y un resultado real
(20-30, gana B), y en la ventana antes de la transacción de `startPlayoffs`
hice que el **admin** editara ese resultado con su override de §7.5
(`reportResult` sobre una ronda ya cerrada — permitido para el admin,
`canReportGivenRoundClosed` no exige `closedAt === null` cuando el actor es
admin) a 90-5 a favor de A. El bracket se construyó igualmente con éxito, y
el slot de local de la ronda 1 (el sembrado nº 1) fue **B**, el ganador de
la versión **obsoleta** del resultado — confirmado leyendo el `Match` de
playoffs persistido, que sigue con B como local pese a que el `Result` ya
dice que ahora gana A 90-5.

Esto confirma que la frase "el caso que importaba... siempre toca
`Round.closedAt`" no es literalmente cierta en todos los casos. Pero
comprobé que **no es un hueco nuevo**: es exactamente la carrera
admin-contra-admin que el propio comentario del código ya nombra
explícitamente ("editar un `Result` en una ronda ya cerrada vía el
override... es una carrera admin-vs-admin estrecha que precede a esta
feature") — mi reproducción usa precisamente ese mecanismo, no uno distinto.
La aceptación no estaba mal: el matiz es que la justificación escrita
("siempre toca `closedAt`") describe con precisión el caso de
alta/baja/cambio de cupo, pero **no** el de editar un resultado ya cerrado —
ese segundo caso ya estaba nombrado aparte en el propio párrafo, solo que
con una frase distinta ("lo que queda es..."). No cambio el veredicto por
esto: sigue siendo una carrera de dos acciones de admin simultáneas en una
liga privada de pocos administradores, ya divulgada, no descubierta ahora.

## 6. El mensaje del criterio 36 — nombra rondas concretas y fechas, no genérico

Verificado con el propio test: con dos rondas sin cerrar, el mensaje
contiene `"ronda 2 (cierre <fecha>)"` y `"ronda 3 (cierre <fecha>)"` por
separado, y **no** menciona `"ronda 1"` (la cerrada) en ningún punto
(`expect(attempt.error).not.toMatch(/ronda 1\b/)`). Con una sola ronda sin
cerrar, la nombra igual, sin exigir plural en el texto.

## 7. `formatOpenRoundsMessage` en `bracket.ts` — mi opinión: sitio razonable, no contamina nada

Es una función pura, sin acceso a DB, que dos consumidores comparten
(`startPlayoffs` y `admin/playoffs/page.tsx`) — el mismo patrón que
`quotaLabel` en `rounds.ts` (H2) o `formatPlayedCount` en `standings.ts`
(H7): un formateador de texto que vive junto al dominio que describe, sin
que eso lo convierta en código de presentación. La excepción es
`round-ui.ts` (H6), un módulo aparte creado porque ahí el formateo lo
comparten **dos vistas distintas** (`MatchCard` y `MatchRow`) sin ninguna
relación de dominio compartida entre sí más allá de la etiqueta. Aquí el
único consumidor de dominio es `bracket.ts` mismo (`startPlayoffs` ya
importa de ahí `buildBracket`/`seedsFromStandings`), así que no veo
necesidad de un módulo nuevo solo para esto — es el patrón más común de los
dos que ya existen en el código, no una desviación.

## 8. Alcance — confirmado con diff, incluye la sugerencia aplicada de la vuelta anterior

`git diff a784726..9854ccf -- src/server/rounds.ts src/server/round-actions.ts
src/server/standings.ts src/server/result-logic.ts src/server/result-actions.ts`
solo muestra **un** cambio: el comentario que pedí en la re-review de H8
(la colisión de índice de `Round` documentada directamente en
`redistributePending`, con la vía de recuperación), aplicado tal cual lo
sugerí. `rounds.ts`, `standings.ts`, `result-logic.ts` y `result-actions.ts`
quedan sin ningún cambio de comportamiento; las guardas de H4/H5/H5b
(`canReportGivenRoundClosed`, `closeRound`, `declareWalkover`) intactas.

## Regresión

- `npm run lint` → **0 errores, 0 warnings**.
- `npm run test` → `Test Files 17 passed (17)` / `Tests 496 passed (496)`.
- `npx tsc --noEmit` → limpio, sin salida.
- `npm run build` → compila, 21 rutas, sin errores.
- `npm run e2e` → ejecutado **dos veces**: **42 pasan, 2 skipped** en ambas
  corridas (baseline nuevo, consistente con el fallout documentado del
  punto 4), sin intermitencia.

## Bloqueantes

Ninguno.

## Sugerencias (no bloqueantes)

1. **(Punto 5)** Precisar en el comentario de `startPlayoffs` que la frase
   "siempre toca `Round.closedAt`" describe el caso de
   alta/baja/`matchesPerRound`, no el de un admin editando un `Result` en
   una ronda ya cerrada vía su override — ese segundo caso ya está nombrado
   en el mismo párrafo pero con otra formulación ("lo que queda es..."), y
   separarlo explícitamente evitaría que una futura lectura rápida del
   comentario dé por sentado que la cobertura es total.
2. Ninguna acción adicional sobre el fallout del e2e (punto 4): correcto
   dejarlo para H10 tal como está documentado.
