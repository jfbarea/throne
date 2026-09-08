# Review — H5 `incomparecencia`

**Commit revisado:** `b8f4520`.

## Veredicto: CHANGES_REQUESTED

Los criterios 23, 24 y 26 están bien implementados y verificados con evidencia
directa (bonus forzado a 0 comparado contra `calculateBonus` real, atomicidad
de la transacción probada inyectando un `throw`, validación del vencedor
irrompible). El criterio 25 también está cubierto para el escenario que la
spec describe literalmente. Pero la decisión de permitir que `declareWalkover`
sobrescriba un `Result` con `resolution = PLAYED` (una partida jugada de
verdad y ya apuntada) es una extensión del modelo de confianza de §4.10 que la
spec no sostiene. Lo reproduje: el propio ganador legítimo de un 45-40 puede
convertirlo unilateralmente en un 80-0 a su favor, sin que el rival intervenga
y sin que ninguna guarda existente lo impida. Esto no es "corregir una
autoadjudicación", es fabricar un resultado falso sobre una partida que sí se
jugó — con el impacto de VP en los desempates 2 y 3 que la propia spec avisa
que puede decidir un puesto de playoff (§9.1). Lo trato como bloqueante y lo
marco escalable a `/specs`, no como algo que deba resolverse en el código de
este hito.

## 1. El bloqueante: sobrescribir un `Result` `PLAYED` con un `WALKOVER` 80-0

Lo reproduje de la forma más directa: escribí y ejecuté un test que crea una
partida, hace que el jugador local reporte un resultado real y ajustado
(45-40, victoria legítima para él vía `reportResult`), y a continuación el
**mismo jugador que ya ganó de verdad** llama a `declareWalkover(matchId,
{winnerId: home.id})`. La acción tiene éxito: el `Result` pasa a
`homeVictoryPoints: 80, awayVictoryPoints: 0, resolution: WALKOVER`, con
`bonusHome = bonusAway = 0` de propina. Nadie más participa en la operación —
ni el rival, ni el admin — y ninguna guarda existente (`canReport`,
`canReportInStatus`, `canReportGivenRoundClosed`, la comprobación de
`winnerId`) distingue si el `Result` que se sobrescribe tenía
`resolution: PLAYED` o `WALKOVER`. Confirmé con `grep` que ninguna de las
guardas reutilizadas lee `resolution` en ningún punto de `result-logic.ts` ni
`result-actions.ts`.

Contrasté esto contra el texto exacto de §4.10, no contra el resumen del
`PLAN.md`. La frase "cualquiera de los dos puede sobrescribirla después (con
el resultado real si al final se juega, o cambiando el vencedor)" tiene como
sujeto "la incomparecencia" — habla de sobrescribir **una declaración de
walkover ya hecha**, con el resultado real (`reportResult`) o con otro
vencedor (`declareWalkover` de nuevo). No dice en ningún sitio que se pueda
sobrescribir **un resultado jugado de verdad** con una declaración de
walkover. Y la frase que el builder cita como respaldo — "No se previene la
autoadjudicación, se corrige: si un jugador se declara vencedor sin pacto, el
perjudicado entra y lo sobrescribe" — describe exactamente el mismo caso: A
declara un walkover sin pacto real, B (el perjudicado) entra y lo corrige. No
contempla en ningún momento "A y B ya jugaron una partida real, y ahora
cualquiera de los dos puede reescribirla como un walkover fabricado".

El propio test de regresión que el builder escribió para este caso
(`tests/incomparecencia.test.ts:406`, "permite sobrescribir un resultado ya
jugado con una incomparecencia") no ejercita el escenario adversarial: en ese
test es el jugador local, que había ganado 45-38, quien **cede** la victoria
al visitante declarándolo vencedor del walkover — un movimiento que solo
perjudica a quien lo ejecuta. El escenario que de verdad importa — el ganador
legítimo inflando su propio marcador real a 80-0, o el perdedor legítimo
robándole la victoria al rival — no tiene ningún test, y lo comprobé porque
no está cubierto: nada en la suite lo ejercita ni lo impide.

Esto no es un bug de implementación — el código hace exactamente lo que el
docstring dice que hace, y lo hace de forma atómica y auditada (ver punto 7).
Es una decisión de diseño que amplía el alcance de la incomparecencia más
allá de lo que la spec autoriza, tomada por el builder para no detener el
hito. Dado que toca directamente el riesgo que la propia spec reconoce como
asumido pero "mitigado en parte, no del todo" (§9.1, los ±80 VP en los
desempates 2 y 3), y que aquí el ±80 no viene de una incomparecencia real sino
de una partida que sí se jugó, no me parece una consecuencia legítima del
modelo de confianza de la spec — es una puerta que la spec no pretendía abrir.
Marco esto como bloqueante escalable a `/specs`: hay que decidir si
`declareWalkover` debe exigir que el `Result` existente (si lo hay) ya sea
`resolution = WALKOVER`, o si el modelo de confianza realmente se quiere tan
amplio como está hoy — pero esa decisión no me corresponde tomarla a mí ni al
builder en el código.

## 2. Criterio 24 — bonus forzado a 0, verificado contra el valor real

`tests/incomparecencia.test.ts:203-233` no se conforma con comprobar que el
bonus persistido es 0: llama a `calculateBonus(80, 0, "HOME_WIN", {...})` con
la config exacta del seed (`bonusEnabled: true`, `bonusMarginThreshold: 20`,
`bonusMinVP: 40`) y afirma que **daría** `{bonusHome: 2, bonusAway: 0}` antes
de comprobar que el `Result` real persistido lleva `{0, 0}`. Es la prueba
correcta: no basta con que el resultado sea 0, hay que demostrar que sin el
forzado sería distinto. Repasé las dos ramas de escritura en
`declareWalkover` (`create` y `update`, `result-actions.ts:454-486`): ambas
fijan `bonusHome: 0, bonusAway: 0` como literal, sin invocar `calculateBonus`
en ningún punto de la función. `grep -n "calculateBonus" src/server/result-actions.ts`
solo la encuentra en `reportResult`, nunca en `declareWalkover`.

## 3. La restricción a `phase = LEAGUE` — correcta, no inventada

El builder señaló esto como una decisión a auditar, pero la spec la respalda
explícitamente: la lista de "fuera de alcance" (línea 52-54) dice **"No se
toca el formato de playoffs. El bracket, el seeding y los byes de playoff se
quedan exactamente como están. Lo único que cambia es la precondición para
arrancarlos (§4.11)"**. Un mecanismo de incomparecencia para partidas de
playoff no es solo "una ambigüedad no cubierta que se podría haber
generalizado" — es una superficie que la spec dice explícitamente que no se
toca. La restricción `match.phase !== "LEAGUE"` con mensaje en español
(`result-actions.ts:339-344`) es la decisión correcta, no una limitación
arbitraria. No hay hueco equivalente sin cubrir en playoffs: antes de este
hito no existía ningún mecanismo de incomparecencia en ningún sitio, así que
no hay regresión de cobertura, solo una ausencia preexistente y fuera de
alcance de esta spec.

## 4. Validación del vencedor — irrompible en los tres frentes probados

Repasé el código y lo intenté romper:

- **`winnerId` de un tercero de la misma liga**: `tests/incomparecencia.test.ts:179-196`
  crea un tercer jugador y comprueba que `declareWalkover` rechaza con "uno de
  los dos participantes" y que el `Result` sigue siendo `null` después del
  intento — no hay escritura parcial.
- **El actor es un tercero que no participa ni es admin**: cubierto por
  `tests/incomparecencia.test.ts:163-177`, rechazado con "no eres
  participante".
- **`winnerId`/`matchId` de otra liga**: no hay test explícito, pero la
  comprobación es una simple igualdad de string
  (`winnerId !== match.playerHomeId && winnerId !== match.playerAwayId`) sobre
  los dos IDs reales de **esa** partida — el `leagueId` del `winnerId` es
  irrelevante para la comparación, así que un ID de otra liga simplemente no
  coincide con ninguno de los dos y cae en el mismo rechazo. No es una vía de
  ataque real porque los IDs de Prisma son globalmente únicos, no
  reutilizables entre ligas.

## 5. Las tres ambigüedades resueltas "por análisis"

- **Playoff sin ronda**: correcto, ver punto 3 — la spec lo respalda
  explícitamente, no es una decisión inventada.
- **Ronda cerrada**: reutiliza `canReportGivenRoundClosed` tal cual, sin
  ninguna rama nueva. Verificado con test (`tests/incomparecencia.test.ts:357-377`):
  un participante es bloqueado con "cerrada" en el mensaje y el admin conserva
  su override. Coherente con el criterio 21 de H4, sin regresión. Correcto no
  pararse aquí — es una reutilización literal sin ambigüedad real.
- **`Result` ya jugado**: es el punto 1. Aquí sí debió pararse y escalar en
  vez de decidir por análisis — la conclusión a la que llega ("mismo modelo de
  confianza que reportResult") no se sostiene en el texto de §4.10, y las
  consecuencias (falsificar un resultado real con impacto en desempates de
  playoff) son demasiado serias para resolverlas sin ratificación.

## 6. Recuento de tests: 12, no 16

`grep -c "it("` sobre `tests/incomparecencia.test.ts` da **12**, y
`npx vitest run tests/incomparecencia.test.ts` confirma **12 passed (12)**.
`npm run test` completo da **412 passed (412)**, que cuadra exactamente con
`400 (baseline) + 12`. El número correcto es 12; el "16" de la lista de
ficheros del informe del builder está mal y no corresponde a ningún cómputo
real (no hay `it.each` ni bloques de test adicionales en ningún otro fichero
tocado por este commit). No falta ningún test por los criterios numerados
23-26 — cada uno tiene su `describe` dedicado y pasa — pero sí falta cobertura
del escenario adversarial del punto 1, que es distinto de un hueco de
numeración: ese test no es un criterio de la spec sin cubrir, es el hallazgo
en sí sin un test que lo documente como tal (el test existente en la línea
406 documenta la variante inofensiva, no la peligrosa).

## 7. `resolution` en la cadena completa

Repasé las **cuatro** escrituras de `Result` que existen hoy en todo `src/server/`
(`grep -n "resolution:" src/server/*.ts`): `reportResult` (create/update,
ambas `PLAYED`), `closeRound` (`createMany`, `UNPLAYED_DRAW`), y
`declareWalkover` (create/update, ambas `WALKOVER`). Las cuatro fijan
`resolution` explícitamente; ninguna deja que el `@default(PLAYED)` del
schema decida. Sobrescribir una incomparecencia con el resultado real
(criterio 25, el escenario que sí describe la spec) devuelve `resolution` a
`PLAYED` correctamente — verificado con test
(`tests/incomparecencia.test.ts:239-277`) que además comprueba las dos
entradas de `AuditLog` (`REPORT_RESULT` primero, `EDIT_RESULT` después, con
los `actorId` correctos en cada una). El único punto donde `resolution` queda
en un estado que la spec no anticipó es precisamente el del punto 1: un
`Result` con `outcome`/VP fabricados por `WALKOVER` sobre una partida que
`resolution` decía que ya era `PLAYED` — no es una inconsistencia de datos (el
campo se escribe bien, de forma coherente con la nueva realidad), es que esa
nueva realidad no debería poder crearse así.

## 8. Guardas, Zod, `AuditLog`, transacciones

- `requireAuth()` es la primera instrucción de `declareWalkover`.
  `leagueId` nunca se recibe del cliente — se deriva de `match.findUnique`.
- Zod valida la forma del `winnerId` en el borde (`declareWalkoverSchema`);
  la pertenencia a la partida se valida después, aparte, contra los datos
  reales — correcto, un schema Zod no puede validar eso sin una query.
- `AuditLog` con el actor de la sesión, dentro de la misma transacción que la
  escritura del `Result` y el `Match`. Probé la atomicidad de forma directa
  inyectando un `throw` justo antes del `writeAuditLog` (después de
  `result.create`/`update` y `match.update`) y ejecutándolo contra la DB de
  test real: el `Result` queda `null`, el `Match` sigue `SCHEDULED`, y no hay
  ninguna entrada de `AuditLog` — rollback completo. Revertí el sabotaje
  después (`git checkout -- src/server/result-actions.ts`, `git status`
  limpio) y confirmé 412/412 de nuevo.
- `src/server/round-actions.ts` y `src/server/rounds.ts` no aparecen en
  `git diff 543753f..b8f4520` — cero cambios, confirmado por diff vacío, no
  por inspección visual.

## 9. Alcance: `calendario/MatchRow.tsx` y el sistema de las tres `resolution`

`git diff 543753f..b8f4520 -- src/app/calendario/MatchRow.tsx` está vacío —
no se toca. `mis-partidas/MatchCard.tsx` solo añade el badge puntual
"incomparecencia" cuando `resolution === "WALKOVER"`, sin generalizar el
etiquetado de las tres `resolution` (eso es H6, tal como dice la nota del
commit). Correcto, respeta el reparto de `PLAN.md`.

## Regresión

- `npm run lint` → limpio (el único aviso venía de `coverage/` local,
  gitignorado y con timestamps del propio builder, ajeno al commit —
  confirmado ejecutando `npx eslint --ignore-pattern coverage/` sin avisos).
- `npm run test` → `Test Files 12 passed (12)` / `Tests 412 passed (412)`.
- `npm run build` → compila, 20 rutas (Turbopack), sin errores.
- `npm run e2e` → **37 pasan, 1 skipped**, idéntico al baseline anterior a H5.

## Bloqueantes

1. **(Punto 1)** `declareWalkover` permite sobrescribir un `Result` con
   `resolution = PLAYED` (una partida real ya apuntada) con un 80-0 fabricado,
   sin que ninguna guarda distinga el `resolution` previo. Reproducido con un
   test directo: el ganador legítimo de un 45-40 se autoinflaciona a 80-0 sin
   intervención del rival ni del admin. El texto de §4.10 solo autoriza
   sobrescribir **una incomparecencia previa** (con el resultado real o
   cambiando el vencedor) y corregir una **autoadjudicación de walkover sin
   pacto** — no contempla fabricar un walkover sobre una partida que sí se
   jugó. Dado el impacto en los desempates 2/3 que la propia spec reconoce
   como riesgo asumido (§9.1), esto necesita ratificación explícita en
   `/specs` antes de cerrar el hito: o se acota `declareWalkover` a no tocar
   `Result` con `resolution = PLAYED` salvo por el admin, o se ratifica
   expresamente que el modelo de confianza es tan amplio como hoy. No debe
   decidirse en el código sin esa ratificación.

## Sugerencias (no bloqueantes)

1. Corregir el recuento de tests en el informe/estado: son 12, no 16 (punto 6).
2. Si tras la ratificación del punto 1 se decide mantener el comportamiento
   actual, añadir un test explícito del escenario adversarial (el ganador
   legítimo inflando su propio resultado real, no solo la variante de
   concesión que ya existe en la línea 406), para que quede documentado como
   comportamiento deliberado y no como un hueco de cobertura.
3. El texto de ayuda de `WalkoverForm.tsx` ("Úsalo solo si ya acordasteis
   fuera de la app quién gana") no avisa de que declarar una incomparecencia
   sobre una partida que **ya tiene un resultado apuntado** lo sobrescribe sin
   confirmación adicional — el mismo botón "Incomparecencia" aparece junto a
   "Editar resultado" en cualquier partida `REPORTED`. Si el punto 1 se
   ratifica tal cual, merece al menos un aviso distinto en ese caso.

## Riesgos

- El bloqueante del punto 1 no es solo teórico: es alcanzable por cualquier
  jugador desde la UI existente (`MatchCard.tsx` muestra el botón
  "Incomparecencia" en cualquier partida `REPORTED` donde el jugador es
  participante, sin distinguir si ya hay un resultado real apuntado).
- Si se ratifica la restricción sugerida (no tocar `Result` con
  `resolution: PLAYED` salvo admin), el cambio es pequeño y localizado
  (una comprobación adicional en `declareWalkover`), pero afecta al único
  test que hoy cubre "sobrescribir un resultado ya jugado"
  (`tests/incomparecencia.test.ts:406-430`), que tendría que reescribirse o
  eliminarse según lo que se decida.

---

# Re-review — D5 (commit `2d10f54`)

## Veredicto: CHANGES_REQUESTED

El fix cierra correctamente el escenario que motivó el bloqueante de la
primera vuelta: un participante en solitario ya no puede convertir un
`Result` `PLAYED` en un `WALKOVER` 80-0 con una sola llamada. Los siete puntos
que pedía verificar el coordinador están comprobados con evidencia directa
(puntos 2-7 más abajo), y el commit de lint (`e07c64f`) no ignora nada que no
debiera. Pero al comprobar específicamente la pregunta del punto 1 — la
carrera entre la lectura previa a la transacción y la escritura dentro —
encontré que **sí se puede colar algo entre las dos**: reproduje un TOCTOU real
que deja que un `WALKOVER` se escriba encima de un `Result` que en el momento
exacto de la escritura ya es `PLAYED`, precisamente porque `declareWalkover`
lee el `resolution` existente **antes** de abrir la transacción y no lo
vuelve a comprobar **dentro** de ella al escribir. Es un hallazgo distinto en
naturaleza al de la primera vuelta — no es una decisión de producto que haya
que escalar, es un bug de atomicidad con un arreglo de ingeniería concreto —
así que lo trato como bloqueante de esta vuelta, pero no como algo que exija
volver a parar el bucle de hitos para preguntarle al usuario.

## 1. El TOCTOU: reproducido con evidencia directa

`declareWalkover` (`src/server/result-actions.ts:434-458`) hace la lectura
`existingResult = await prisma.result.findUnique(...)` **fuera** de
`prisma.$transaction`, decide con esa lectura si rechaza (D5) o si continúa,
y si continúa, reutiliza ese mismo `existingResult` (capturado antes) dentro
de la transacción para decidir la rama `create`/`update` — sin volver a leer
`resolution` en ningún punto posterior. Antes de D5, ese `existing` se leía
**dentro** de la transacción (`tx.result.findUnique`, ver el diff de
`2d10f54`); el fix, al necesitar decidir el rechazo *antes* de abrir la
transacción, sacó esa lectura fuera de su límite de atomicidad — y ahí es
donde se abre el hueco.

Lo reproduje montando la interleaving exacta que se pide comprobar: creé una
partida con un `WALKOVER` ya declarado (estado que D5 permite sobrescribir
sin restricción), y dejé que, en el instante justo antes de que
`declareWalkover` abriera su propia transacción — es decir, **después** de
que su guarda ya hubiera leído `resolution: "WALKOVER"` y decidido continuar
—, una llamada completa y real a `reportResult` (otro participante,
resultado 45-40) se ejecutara y confirmara, dejando el `Result` en
`resolution: "PLAYED"`. La transacción de `declareWalkover`, que seguía
operando sobre el `existingResult` capturado (el `WALKOVER` viejo, no el
`PLAYED` recién escrito), completó sin problema y **sobrescribió el 45-40 real
con un 80-0**, sin que ninguna guarda lo detectara:

```
race declareWalkover result: { ok: true, data: { resultId: '...' } }
final Result after race: {
  homeVictoryPoints: 80, awayVictoryPoints: 0,
  outcome: 'HOME_WIN', resolution: 'WALKOVER', ...
}
```

Contexto de exploitabilidad, para no sobredimensionarlo ni restarle
importancia: no es alcanzable por un solo actor con una sola pulsación de
botón (a diferencia del bug original de la primera vuelta) — hace falta que
dos peticiones se solapen en el tiempo, una de ellas completando su
transacción entera exactamente en la ventana entre la lectura de D5 y la
apertura de la transacción de la otra. Esa ventana no tiene ningún `await`
intermedio dentro del mismo proceso (el cálculo de `outcome`/VP es síncrono),
pero sí puede abrirse por el propio bucle de eventos de Node mientras la
promesa de la lectura `findUnique` está pendiente de I/O — exactamente el
escenario en el que dos usuarios envían casi a la vez una acción cada uno
(uno reportando el resultado real, otro fabricando la incomparecencia), algo
plausible en un despliegue serverless contra Turso donde cada operación de
DB es una ida y vuelta de red. No es el escenario trivial que motivó D5, pero
sí defeats la garantía que D5 dice dar ("un participante no puede... el admin
sí") bajo una condición de carrera real y demostrada, no hipotética.

**Arreglo recomendado, sin decidir el código por el builder:** volver a
comprobar `resolution` **dentro** de la transacción, como primera instrucción
del callback (`tx.result.findUnique`, igual que se hacía antes de D5), y
abortar si ha cambiado a `PLAYED` entre medias y el actor no es admin. Una
vez dentro de una transacción interactiva de Prisma sobre SQLite/libSQL, una
lectura ahí sí ve el estado confirmado más reciente y ningún escritor
concurrente puede colarse antes de que esta transacción termine — cierra la
ventana sin necesitar bloqueo optimista ni columnas nuevas.

## 2. El admin sí puede, con `AuditLog` a su nombre

Verificado con test (`tests/incomparecencia.test.ts:476-510`): partida con
resultado real 45-38 apuntado por un jugador, el admin declara la
incomparecencia y tiene éxito; el `AuditLog` tiene dos entradas
(`REPORT_RESULT` del jugador, `EDIT_RESULT` del admin) y `logs[1].actorId`
es el `id` del admin, no el de ningún jugador. `canDeclareWalkoverOverExistingResult`
devuelve `true` incondicionalmente si `isAdmin`, antes de mirar
`existingResolution` — el override de §7.5 queda intacto.

## 3. Sin regresión en los dos casos que debían seguir permitidos

- **Declarar sobre una partida sin `Result`**: `tests/incomparecencia.test.ts:512-528`,
  ambos participantes (cada uno en una partida distinta) declaran con éxito.
- **Sobrescribir un `WALKOVER` existente cambiando de vencedor**:
  `tests/incomparecencia.test.ts:406-431` y `:530-549` — dos tests
  independientes que cubren el mismo caso desde ángulos distintos (uno
  centrado en el `Result` final, otro en que ambas llamadas devuelven `ok:
  true`), ambos pasan.

`canDeclareWalkoverOverExistingResult(null, false)` y
`canDeclareWalkoverOverExistingResult("WALKOVER", false)` devuelven `true`
en el predicado puro (ver punto 6) — la lógica no distingue estos dos casos
del `UNPLAYED_DRAW`, que también deja pasar a un participante. Repasé si
`UNPLAYED_DRAW` debería bloquearse igual que `PLAYED`: no hay forma de que un
`UNPLAYED_DRAW` exista con la ronda todavía abierta (solo lo produce
`closeRound`, que exige `closedAt` para existir), así que
`canReportGivenRoundClosed` ya bloquea a cualquier participante antes de
llegar a esta guarda — no es un hueco equivalente al del punto 1.

## 4. El test reescrito: ya no queda ningún rastro del comportamiento viejo

`grep -n "resultado ya jugado\|permite sobrescribir"` sobre el fichero
completo solo encuentra el nuevo test de D5 (rechaza) y el de "cambio de
vencedor" (no relacionado con `PLAYED`) — ninguna aserción afirma ya que
sobrescribir un `PLAYED` con éxito sea el comportamiento esperado. El test
reescrito (`tests/incomparecencia.test.ts:443-474`) no es tautológico:
compara el `Result` completo antes/después con `toEqual`, no solo que el
mensaje de error contenga cierta cadena — así que si el fix rechazara pero
dejara escrito algo parcial (un `match.update` a `REPORTED` sin escribir
`Result`, por ejemplo), este test lo cazaría.

## 5. `Result` jugado intacto tras el rechazo — comparación completa, no parcial

Confirmado en el mismo test del punto 4: `after` y `before` son objetos
`Result` completos leídos de la DB con `findUnique` sin `select`, comparados
con `toEqual`. Estructuralmente, además, todas las comprobaciones que
preceden a la guarda de D5 (incluida la propia guarda) son lecturas puras o
`return` tempranos — no hay ningún `tx.result.update`, `tx.match.update` ni
`writeAuditLog` antes de la guarda, así que el camino de rechazo no puede
dejar una escritura a medias por construcción, no solo porque el test no la
detectó.

## 6. El predicado puro: los 5 casos, en el sitio correcto

`canDeclareWalkoverOverExistingResult` vive en `src/server/result-logic.ts`,
junto a `canReportGivenRoundClosed` (mismo patrón: predicado puro sin DB,
`isAdmin` como segundo parámetro, override incondicional primero) — el sitio
correcto del módulo, coherente con cómo H4 organizó sus propias guardas.
Los 5 casos pedidos están, uno por test
(`tests/incomparecencia.test.ts:560-583`): `PLAYED`+participante → `false`,
`PLAYED`+admin → `true`, `null`+participante → `true`, `WALKOVER`+participante
→ `true`, `UNPLAYED_DRAW`+participante → `true`. Ejecutados directamente
(`npx vitest run` sobre ese `describe`) — los 5 pasan.

## 7. La guarda está antes de la transacción — confirmado sin ambigüedad

`src/server/result-actions.ts:434-458`: la lectura de `existingResult` y el
`return` de rechazo preceden a `await prisma.$transaction(...)` en el cuerpo
de la función, sin ningún camino de código que abra la transacción antes de
pasar por la guarda. Es precisamente esta separación — leer antes, decidir
antes, pero reutilizar la lectura vieja dentro sin refrescarla — la que
genera el TOCTOU del punto 1.

## `eslint.config.mjs` (`e07c64f`) — no se ha pasado

`coverage/**` y `src/generated/**` ya estaban en `.gitignore` antes de este
commit (confirmado leyendo el fichero), así que ignorarlos también en ESLint
solo alinea el linter con lo que ya no se versiona — no es un directorio de
código propio el que se deja de lintar en ninguno de los dos casos
(`coverage/` es el HTML/JS de terceros que genera el reporter de Vitest;
`src/generated/prisma` es el cliente generado por Prisma). No encontré nada
en el diff que excluya código escrito a mano.

## Regresión

- `npm run lint` → **0 errores, 0 warnings** (confirmado el efecto de
  `e07c64f`: antes de ese commit, el mismo árbol con `coverage/` generado
  localmente daba 1 warning ajeno al código, como ya documenté en la primera
  vuelta).
- `npm run test` → `Test Files 12 passed (12)` / `Tests 421 passed (421)` —
  coincide exactamente con el baseline anunciado (400 + 12 de H5 + 9 de D5).
- `npm run build` → compila, 20 rutas, sin errores.
- `npm run e2e` → **37 pasan, 1 skipped**, idéntico al baseline.

## Bloqueantes

1. **(Punto 1)** TOCTOU real y reproducido: `declareWalkover` decide si
   rechaza por D5 leyendo `resolution` **antes** de abrir su transacción, y
   reutiliza esa lectura sin refrescarla **dentro** de ella. Un `Result` que
   pasa de `WALKOVER`/`null` a `PLAYED` mediante una llamada concurrente y
   completa a `reportResult`, exactamente en esa ventana, sigue siendo
   sobrescrito por el `WALKOVER` del participante — burlando la garantía que
   D5 acaba de ratificar como regla de competición. Arreglo sugerido: releer
   `resolution` (con el cliente de la transacción, `tx.result.findUnique`)
   como primera instrucción dentro de `prisma.$transaction`, y abortar ahí si
   ha cambiado a `PLAYED` y el actor no es admin — no hace falta bloqueo
   optimista ni cambios de esquema, solo mover el punto de verificación
   dentro del límite de atomicidad, como ya se hacía con `existing` antes de
   este mismo commit.

## Sugerencias (no bloqueantes)

1. Una vez corregido el punto 1, añadir un test de regresión para la propia
   carrera (como el que usé para reproducirla, controlando el timing con un
   mock de `prisma.$transaction` que intercala una escritura real en medio),
   para que esta clase de hueco no pueda reintroducirse en silencio si en el
   futuro alguien vuelve a mover la lectura fuera de la transacción.
