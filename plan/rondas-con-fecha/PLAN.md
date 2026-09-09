# Plan de desarrollo — Rondas con fecha

**Spec (contrato):** `plan/specs/rondas-con-fecha.md` — `status: APPROVED`, v6.
**Rama:** `feat/rondas-con-fecha`.

La spec es el contrato. Si durante la implementación aparece algo que no
contempla o que la contradice, **el builder para y lo escala**; no se decide
aquí ni en el código. Se resuelve en `/specs` y se vuelve.

## Requisitos que aplican a TODOS los hitos

No se repiten en cada hito, pero ninguno se cierra sin ellos:

1. **El árbol compila y los tests pasan en cada commit** (`CLAUDE.md` del
   proyecto): `npm run lint`, `npm run test` y `npm run build` verdes.
2. **Verificación 100 % automática** (spec §7.3): ningún criterio se valida a
   ojo. Cada criterio de aceptación que el hito cierra tiene al menos un test
   que **lo nombra** (`describe("AC-15: …")`) y que **falla antes del cambio**.
3. **Código y comentarios en inglés; UI, docs y mensajes en español**.
4. **Zod en el borde** y `requireAdmin` / `requireAuth` en la primera
   instrucción de cada acción nueva; el `leagueId` nunca viene del cliente.
5. **Escrituras multi-fila en `prisma.$transaction`**, con `AuditLog`.
6. **Sin SQL propietario**: la lógica vive en `src/server/` como funciones puras.
7. **Mobile-first, dark mode hard-coded.**

## Desviaciones de la spec pendientes de ratificar

Se resuelven en implementación para no detener el bucle de hitos, **sin tocar la
spec `APPROVED`**. Hay que ratificarlas (o revertirlas) al revisar la feature.

| # | Spec dice | Se implementa | Por qué |
| --- | --- | --- | --- |
| D1 | §6.2: `startMonth DateTime` | `startMonth DateTime?` **nullable**, sin `@default` | Una liga en `SETUP` no tiene mes de arranque hasta que el admin lo fija. Sin nullable, `createLeague` no compila y la alternativa —`@default(now())`— inventa un timestamp con hora del que se derivarían **todas** las fechas de cierre (§4.4), en silencio y sin que nadie se enterase. Nullable convierte ese estado en explícito e imposible de confundir, y H3 añade la guarda que impide generar sin él. Fiel a la intención de §4.4; desvía solo la anotación del campo. |
| D2 | §4.2: `rondas = ceil((n-1)/matchesPerRound)` | `max(ceil((n-1)/k), ceil(C(n,2) / floor(n·k/2)))` | La fórmula de la spec es **matemáticamente infactible** cuando `n` y `k` son **ambos impares**, porque un grafo `k`-regular sobre `n` vértices impares no existe (apretón de manos) y la capacidad de una ronda cae a `floor(n·k/2)`. Casos reales: `n` impar con `k=1` (siempre), y n=13 o n=19 con `k=3`. La fórmula nueva **coincide con la de la spec en todos los casos factibles** y solo se separa donde está demostrado que no lo es. Verificado para n ∈ {10,11,12,13,15,17,19,20} × k ∈ {1,2,3}. |
| D3 | §5.3: con `n` impar «un jugador tiene una partida menos en la ronda donde cae su descanso» | Con `k` **par** nadie descansa: cupo uniforme de `k` en todas las rondas, también con `n` impar | §5.3 describe una consecuencia del **agrupamiento de jornadas**, no una regla de competición. Para `n` impar y `k` par, la descomposición de Walecki parte `K_n` en `(n-1)/2` ciclos hamiltonianos (2-factores, grado exactamente 2), y agrupar `k/2` da cupo uniforme sin descansos. Es **mejor** que lo especificado —reparto más justo y una ronda menos— y lo normativo de §5.3, «no se crea `Match` de bye», se mantiene intacto. Con `k` impar sigue haciendo falta el agrupamiento y §5.3 aplica tal cual. |
| D4 | §4.3: «un coloreado **voraz por grado descendente** necesita como mucho `Δ+1` colores (Vizing)» | Coloreado de **Misra & Gries** (Vizing constructivo, con reparación por cadenas de Kempe) | **La afirmación de la spec es falsa.** La cota de Vizing es real, pero un voraz simple no la alcanza: solo garantiza `2Δ-1`. Verificado contra el código: `K_12` menos **una** arista (`Δ=11`) gastaba **15** colores con el límite en 12, y 7 de 10 subgrafos probados violaban la cota. No es un caso rebuscado: «`K_n` menos unas pocas aristas» es la forma exacta de las partidas pendientes cuando entra un jugador al principio de la liga (§5.1), y con el cupo por defecto se traduce en **8 rondas en vez de 6**. La consecuencia que la spec deriva de la cota —«la liga se alarga como mucho una ronda más de lo estrictamente necesario»— solo se sostiene con el algoritmo correcto. Error de redacción de la spec, no cambio de decisión: se implementa lo que la spec **quería** decir. |
| D5 | §4.10: «cualquiera de los dos participantes… declara la incomparecencia… y **cualquiera de los dos puede sobrescribirla** después» | Un participante **no** puede declarar incomparecencia sobre una partida que ya tiene `Result` con `resolution = PLAYED`; **solo el admin**, con su override de §7.5 y `AuditLog` | **Decidido por el usuario el 8 de septiembre de 2026**, tras destapar la review de H5 que ninguna guarda miraba el `resolution` previo: el ganador de un 45-40 real podía autoinflarse a un 80-0 unilateralmente. §4.10 autoriza sobrescribir **una incomparecencia**, no fabricar una sobre una partida que sí se jugó, y §9.1 ya advierte de que esos ±80 VP pesan en los desempates 2 y 3 y pueden decidir un puesto de playoff. La vía del admin conserva el caso legítimo («lo apuntamos mal, en realidad nadie se presentó»). **No es una desviación técnica: es una regla de competición ratificada.** |

Origen: D1 del bloqueante de `reviews/modelo-datos-rondas.md`; D2 y D3 de un hallazgo del builder en H2, acotado tras verificar la matemática (su propuesta inicial, `ceil(n/k)` para todo `n` impar, metía **una ronda de más** —un mes de liga— en todos los tamaños impares con el cupo por defecto `k=2`); D4 de un bloqueante de `reviews/dominio-reparto-y-fechas.md` que se les escapó al builder y al coordinador.

**D4 obliga a corregir `SPEC.md` y la spec en H10**: la frase de §4.3 sobre el voraz no puede quedar escrita, porque es matemáticamente incorrecta y alguien la reimplementaría igual de mal.

## Cobertura de la spec

Los 43 criterios de aceptación de `plan/specs/rondas-con-fecha.md` §8 quedan
repartidos así. Ninguno queda huérfano.

| Criterios | Hito |
| --- | --- |
| 1, 2, 3, 4, 5, 6, 7, 10, 11, 43 | H2 |
| 8, 14 | H3 |
| 15, 16, 17, 18, 19, 20, 21, 22 | H4 |
| 23, 24, 25, 26 | H5 |
| 9, 12, 13 | H6 |
| 27, 28 | H7 |
| 29, 30, 31, 32, 33, 34, 35 | H8 |
| 36, 37 | H9 |
| 38, 39, 40, 41, 42 | H10 |

**H1 no cierra ningún criterio numerado**: es el cimiento de esquema del que
dependen todos los demás. Sus criterios de aceptación son propios y están
abajo. Lo señalo explícitamente para que no parezca un descuido.

---

## H1 · `modelo-datos-rondas`

**Estado:** PENDING
**Cierra criterios de la spec:** ninguno (cimiento). Ver spec §6.2.

Esquema y datos de partida. Nada de comportamiento todavía.

- `prisma/schema.prisma`:
  - `model Round` con `id`, `leagueId`, `index Int`, `deadline DateTime`,
    `closedAt DateTime?`, relación a `League` y a `Match`,
    `@@unique([leagueId, index])`.
  - `League`: `matchesPerRound Int @default(2)`, `startMonth DateTime`,
    relación `rounds Round[]`.
  - `Result`: enum `Resolution` (`PLAYED` | `WALKOVER` | `UNPLAYED_DRAW`) y
    campo `resolution` con `@default(PLAYED)`.
  - `Match`: `roundId String?` + relación (nullable porque los playoff no
    pertenecen a ronda).
- Migración versionada en `prisma/migrations/`.
- `prisma/seed.ts`: `startMonth` y `matchesPerRound` en la liga sembrada.
- `tests/e2e/seed-e2e.ts` y `tests/e2e/global-setup.ts`: la liga e2e se siembra
  con rondas.

**Criterios de aceptación del hito:**

1. `npx prisma migrate dev` corre sin errores y `npx prisma generate` produce el
   cliente con `Round` y `Resolution`.
2. `Match.roundId` es nullable y `Result.resolution` tiene `@default(PLAYED)`:
   los `Result` existentes siguen siendo válidos sin tocarlos.
3. `@@unique([leagueId, index])` impide dos rondas con el mismo índice en una
   liga (test que espera el fallo de constraint).
4. `npm run seed` deja la liga con `matchesPerRound = 2` y un `startMonth`.
5. `npm run lint`, `npm run test`, `npm run e2e` y `npm run build` verdes.

**No entra:** ninguna lógica de reparto, ninguna acción, ninguna UI.

---

## H2 · `dominio-reparto-y-fechas`

**Estado:** PENDING
**Cierra criterios de la spec:** 1, 2, 3, 4, 5, 6, 7, 10, 11, 43.

El corazón de la feature, y todo función pura sin DB. Spec §4.2, §4.3, §4.6.

- `src/server/rounds.ts` (nuevo):
  - `roundRobinRounds(playerIds, matchesPerRound)` — circle method → `n-1`
    jornadas → agrupación en rondas de `matchesPerRound` jornadas.
  - `assignPairsToRounds(pairs, playerIds, matchesPerRound, openRoundIndexes)` —
    el **caso general**: coloreado de aristas voraz por grado descendente sobre
    un subgrafo arbitrario, para el recálculo de H8. Sobre `K_n` tiene que
    coincidir con el circle method.
  - `roundsCount(n, matchesPerRound)` = `ceil((n-1)/matchesPerRound)`.
  - `deriveDeadlines(startMonth, roundsCount)` — último día de cada mes.
  - `roundQuota(playerId, roundIndex, matches)` — exigidas y resueltas; el cupo
    cuenta **partidas con `Result`**, no agendadas.
  - `quotaLabel(resolved, required)` — «falta 1 de 2», «faltan 2 de 2»,
    «falta 1 de 1». Es cálculo, no presentación: vive aquí para poder testearlo
    en Vitest (spec §7.3).
- `tests/rondas.test.ts` (nuevo) y ampliación de `tests/emparejamientos.test.ts`.

**Criterios de aceptación del hito:** los criterios **1-7, 10, 11 y 43** de la
spec, cada uno con su `describe("AC-N: …")`. Además:

- El coloreado voraz nunca usa más de `Δ+1` colores (test con subgrafos
  generados).
- `deriveDeadlines` acierta en meses de 28, 29, 30 y 31 días, incluido febrero
  de año bisiesto.
- `npm run test:coverage` da **100 % de líneas y ramas** en `src/server/rounds.ts`
  (criterio 43).

**No entra:** persistencia, acciones, UI.

---

## H3 · `generar-con-rondas`

**Estado:** PENDING
**Cierra criterios de la spec:** 8, 14.

Conectar el dominio de H2 con la generación y la configuración. Spec §4.3, §4.4.

- `src/server/match-actions.ts` — `generateLeagueMatches` crea las `Round` con
  sus `deadline` derivadas y asigna `roundId` a cada `Match`, en transacción.
- `src/lib/schemas.ts` — Zod para `matchesPerRound` (entero `>= 1`, sin tope) y
  `startMonth` (normalizado al primer día del mes a medianoche).
- `src/server/league-actions.ts`:
  - `updateLeague` acepta los dos campos. **Sin** recálculo todavía (eso es H8):
    en este hito el cambio solo aplica a ligas en `SETUP`.
  - **`createLeague` tiene que fijar `startMonth`** (y `matchesPerRound`). Viene
    del bloqueante de la review de H1: `startMonth` quedó `DateTime?` nullable
    precisamente para que una liga sin mes de arranque sea un estado explícito y
    no un valor inventado, así que **crear** una liga también tiene que
    resolverlo o dejarlo deliberadamente en `null`.
- **`generateLeagueMatches` se niega si `startMonth` es `null`**, con mensaje en
  español. Es el gancho que hace imposible derivar fechas de cierre de un mes de
  arranque que nadie fijó (spec §4.4). Sin esta guarda, el nullable solo mueve el
  problema en vez de cerrarlo.
- `src/app/admin/liga/LeagueForm.tsx` — los dos campos nuevos.
- `src/app/admin/rondas/page.tsx` (nuevo) — lista de rondas con índice, fecha de
  cierre y estado, y **acción de editar la fecha**. Sin botón de cierre (H4).
- Verificación explícita de que **ninguna superficie permite mover una partida
  de ronda** (criterio 14).

**Criterios de aceptación del hito:** los **8 y 14** de la spec. Además:

- Generar con 12 jugadores y `matchesPerRound = 2` crea 6 rondas y 66 partidas,
  todas con `roundId` no nulo y `phase = LEAGUE`.
- Editar la fecha de una ronda no altera `roundId` ni `scheduledAt` de ninguna
  partida (criterio 8), y no exige que las fechas queden ordenadas (spec §4.4).
- `matchesPerRound = 0` o negativo se rechaza en Zod con mensaje en español.
- **`generateLeagueMatches` con `startMonth = null` falla** con mensaje en
  español y **no crea ninguna ronda ni ninguna partida** (test de escritura que
  comprueba que la DB queda intacta).
- **Ninguna liga puede nacer con un mes de arranque inventado**: tras
  `createLeague`, `startMonth` es o el valor que se le pasó o `null`, nunca un
  `now()` implícito. Test que lo fija.
- El `startMonth` que persiste `updateLeague` está **normalizado al primer día
  del mes a medianoche**, sea cual sea el día que envíe el formulario.

---

## H4 · `cierre-de-ronda`

**Estado:** PENDING
**Cierra criterios de la spec:** 15, 16, 17, 18, 19, 20, 21, 22.

Spec §4.7, §5.7, §5.8, §5.9, §4.5.

- `src/server/round-actions.ts` (nuevo) — `closeRound(roundId)`:
  - `requireAdmin()` en la primera instrucción.
  - Rechaza si `deadline` es futura (criterio 17) y si ya está cerrada.
  - En una transacción: `Result` de 0-0 `DRAW` con
    `resolution = UNPLAYED_DRAW` y `bonusHome = bonusAway = 0` para cada partida
    de la ronda **sin resultado**; sella `closedAt`; una entrada de `AuditLog`
    con el admin como actor.
  - **No** toca las partidas que ya tenían `Result` (criterio 19).
  - **No** tiene precondición de orden: se puede cerrar la 4 con la 3 abierta
    (criterio 22).
- `src/server/result-logic.ts` — predicado puro de ronda cerrada; `reportResult`
  lo aplica: participante recibe error, admin puede editar, y editar **no
  reabre** (criterio 21).
- **Confirmar la ausencia de guarda de adelantar** (criterios 15, 16): un
  jugador a 0 de 2 puede apuntar una partida de ronda posterior, y al cerrarse
  su ronda actual recibe igualmente el saldo mientras la adelantada queda
  intacta.
- `src/app/admin/rondas/` — botón «Cerrar ronda N», deshabilitado hasta la
  fecha, con recuento de cuántas partidas se van a saldar.

**Criterios de aceptación del hito:** los **15-22** de la spec, con tests de
escritura contra `file:./test.db`.

---

## H5 · `incomparecencia`

**Estado:** PENDING
**Cierra criterios de la spec:** 23, 24, 25, 26.

Spec §4.8, §4.9, §4.10.

- `src/server/result-actions.ts` — acción de incomparecencia: recibe el
  `matchId` y el **vencedor**, escribe 80-0 a su favor, `outcome`
  `HOME_WIN`/`AWAY_WIN`, `resolution = WALKOVER` y
  `bonusHome = bonusAway = 0` **sin pasar por `calculateBonus`** (criterio 24).
- Autorización: `canReport` / `canReportInStatus` tal cual — cualquiera de los
  dos participantes o el admin; sobrescribible por el otro (criterio 25), con
  `REPORT_RESULT` y `EDIT_RESULT` en `AuditLog`.
- El marcador de 80 vive en una constante nombrada del dominio, no incrustada.
- UI en `mis-partidas` para declararla eligiendo vencedor, y etiqueta
  «incomparecencia» donde se muestre.

**Criterios de aceptación del hito:** los **23-26** de la spec. El 24 se prueba
con la config del seed (`bonusEnabled: true`, `bonusMarginThreshold: 20`,
`bonusMinVP: 40`), donde `calculateBonus` daría 2 y el resultado tiene 0.

---

## H5b · `endurecer-guardas-transaccionales`

**Estado:** PENDING
**Cierra criterios de la spec:** ninguno (corrección de defecto). Refuerza los
**18, 21** y **23-26**, que sin esto son burlables.

Hito **añadido**, no previsto en el plan original. Sale de la re-review de H5:
al cerrar el TOCTOU de la guarda de D5, el reviewer aplicó el mismo criterio a
la guarda de **ronda cerrada** y encontró el defecto idéntico, esta vez
**preexistente desde H4**.

**El defecto.** `match.round?.closedAt` se lee **una sola vez antes** de abrir
`prisma.$transaction` y **nunca se refresca dentro**, en `declareWalkover` **y**
en `reportResult`. Reproducido: un participante puede colar un resultado —o una
incomparecencia— justo en la ventana en la que el admin cierra la ronda, y la
escritura entra en una ronda ya cerrada. Eso rompe el criterio **21** («tras el
cierre, un participante que intenta apuntar recibe error») y contamina el saldo
del criterio **18**.

La ventana es real: el despliegue es serverless contra Turso, con latencia de red
en cada operación de DB.

**Qué hacer.** El mismo patrón que resolvió el TOCTOU de D5, ya validado:

- La lectura previa se queda como **atajo de UX** (rechazo rápido, mensaje en
  español, sin abrir transacción).
- **Dentro** de la transacción, como primera instrucción, **releer con `tx`** el
  `closedAt` de la ronda y aplicar **el mismo predicado puro**
  `canReportGivenRoundClosed`. La de dentro manda.
- Aplicarlo en **las dos** acciones: `reportResult` y `declareWalkover`.
- Abortar con un error tipado y capturarlo **acotado** (`instanceof`), para que
  un fallo real de DB no se traduzca al mensaje de ronda cerrada. En D5 se hizo
  así y el reviewer lo verificó inyectando un fallo genérico.

**Barrido, no solo estos dos.** Revisar **toda** acción que decida con datos
leídos fuera de la transacción y escriba dentro: la validación del `winnerId`,
la guarda de regeneración de `generateLeagueMatches`, `closeRound`,
`updateRoundDeadline`. Documentar cuáles se endurecen y cuáles no lo necesitan,
con el motivo.

**Criterios de aceptación del hito:**

1. Test que **falla sin el fix**: un participante intenta apuntar y el cierre de
   ronda del admin aterriza en la ventana entre la lectura previa y la
   transacción → la escritura se **rechaza** y la ronda queda cerrada y coherente.
2. El mismo test para `declareWalkover`.
3. Un fallo real de DB dentro de la transacción **no** se reporta como «la ronda
   está cerrada».
4. El override del admin sigue funcionando en ronda cerrada (criterio 21) y
   editar **no reabre** la ronda.
5. Sin regresión: los 422 tests actuales siguen verdes.
6. El barrido está escrito, con el veredicto de cada acción revisada.

## H6 · `ui-cupo-y-rondas`

**Estado:** PENDING
**Cierra criterios de la spec:** 9, 12, 13.

Spec §4.6.

- `src/app/mis-partidas/page.tsx` — reagrupación **por ronda** (hoy agrupa por
  estado: Apuntadas / Pendientes / Historial), ordenada por cierre más próximo
  primero y con las cerradas al final, usando `roundQuota`/`quotaLabel` de H2.
- `src/app/rondas/page.tsx` (nuevo) — `requireAuth`; todas las rondas con su
  fecha, cuántas partidas resueltas y el **cupo de cada jugador**. **Una sola
  query** de partidas con `roundId` y `Result`, agregando en memoria.
- `src/app/calendario/` — la ronda como agrupador o etiqueta.
- `src/components/AppHeader.tsx` — entrada de navegación a `/rondas`.
- **`src/app/calendario/MatchRow.tsx` y `src/app/mis-partidas/MatchCard.tsx` —
  etiquetar según `resolution`.** Hueco del plan detectado en la review de H4:
  hoy los dos componentes etiquetan `status: REPORTED` como «Jugada» /
  «Apuntada» y **ninguno lee `resolution`** (`grep -rn "resolution" src/app` no
  devuelve nada). En cuanto el admin cierre una ronda, el jugador vería una
  partida que **nadie jugó** como «Jugada». La spec §4.9 asigna a `resolution`
  precisamente ese trabajo —«se usa para etiquetar la partida en la UI
  («incomparecencia»)»—, así que no es una desviación: es una tarea que no
  estaba asignada a ningún hito. H7 solo cubre el contador agregado de
  `/clasificacion`.

**Criterios de aceptación del hito:** los **9, 12 y 13** de la spec. El 12
(sin N+1) se verifica **contando queries** con una extensión de logging del
cliente Prisma en test, no mirando la pantalla (spec §7.3). Además:

- Una partida con `resolution = UNPLAYED_DRAW` **no** se etiqueta «Jugada» ni
  «Apuntada» en `calendario` ni en `mis-partidas`: se distingue como saldada sin
  jugar.
- Una partida con `resolution = WALKOVER` se etiqueta **«incomparecencia»**
  (§4.9), en las dos vistas.
- Una partida con `resolution = PLAYED` mantiene **exactamente** las etiquetas
  de hoy: este cambio no altera lo que ve el usuario en el caso normal.

---

## H7 · `clasificacion-saldadas`

**Estado:** PENDING
**Cierra criterios de la spec:** 27, 28.

Spec §4.6, §4.9.

- `src/server/standings.ts` — conteo de saldadas (`resolution != PLAYED`) junto
  a las jugadas. `isConfirmedForStandings` **no cambia**.
- `src/app/clasificacion/page.tsx` — columna «PJ 11 (2 saldadas)».

**Criterios de aceptación del hito:** los **27 y 28** de la spec. El 28 se
prueba comprobando que `computeStandings` procesa un 80-0 `WALKOVER` y un 0-0
`UNPLAYED_DRAW` **sin ninguna rama especial**: mismos puntos y VP que un
resultado `PLAYED` con los mismos números.

---

## H8 · `recalculo-alta-baja-y-cupo`

**Estado:** PENDING
**Cierra criterios de la spec:** 29, 30, 31, 32, 33, 34, 35.

El hito con más aristas. Spec §5.1, §5.5, §5.6.

- `src/server/round-actions.ts` — `redistributePending(leagueId)`:
  - Rondas **cerradas** y partidas **con `Result`** intactas.
  - Reparte todas las partidas de liga sin resultado entre las rondas **no
    cerradas** con `assignPairsToRounds` de H2.
  - **Añade** rondas al final si no cabe el cupo, con fechas derivadas de los
    meses siguientes al último cierre; **elimina** las del final que queden
    vacías.
  - **No** modifica ningún `scheduledAt` (criterio 31).
- `src/server/match-actions.ts` — `addMissingLeagueMatches` la invoca tras crear
  los pares nuevos (criterios 29, 30, 31).
- `src/server/league-actions.ts` — `setPlayerActive(false)` salda las pendientes
  del jugador en rondas abiertas como **80-0 al rival**,
  `resolution = WALKOVER`, bonus 0, con `AuditLog`, y luego redistribuye
  (criterio 32). Reactivar **no revierte** (criterio 33).
- `updateLeague` invoca la redistribución al cambiar `matchesPerRound`
  (criterios 34, 35).

**Criterios de aceptación del hito:** los **29-35** de la spec, con tests de
escritura. El 35 verifica que subir 2 → 3 reduce el número de rondas y bajar
2 → 1 lo aumenta, sin tocar las cerradas.

---

## H9 · `puerta-a-playoffs`

**Estado:** PENDING
**Cierra criterios de la spec:** 36, 37.

Spec §4.11.

- `src/server/playoff-actions.ts` — guarda nueva en `startPlayoffs`: falla
  mientras exista una ronda sin `closedAt`, con mensaje que **nombre las rondas
  que faltan y su fecha de cierre**.
- `src/app/admin/playoffs/page.tsx` — refleja el bloqueo.

**Criterios de aceptación del hito:** los **36 y 37** de la spec. El 37 verifica
que con todas las rondas cerradas el bracket, el seeding y los byes salen
**idénticos** a los de hoy. Además:

- **La guarda nace endurecida, con el patrón de H5b.** Viene de una sugerencia
  de la review de H5b: la precondición «ninguna ronda sin `closedAt`» es
  exactamente la clase de comprobación que sufrió el TOCTOU en `reportResult`,
  `declareWalkover` y `closeRound`. Si se lee **fuera** de la transacción de
  `startPlayoffs`, una ronda reabierta —o nunca cerrada— puede colarse en la
  ventana y el bracket se construye con la clasificación incompleta. Releer
  dentro de la transacción con `tx`, error tipado, `catch` acotado por
  `instanceof`. **No repitamos el defecto tres veces y lo arreglemos a la
  cuarta.**
- Test que **falla sin ese endurecimiento**, con la misma técnica de mock de
  `prisma.$transaction` ya usada en D5 y H5b.

---

## H10 · `docs-e2e-y-cobertura`

**Estado:** PENDING
**Cierra criterios de la spec:** 38, 39, 40, 41, 42.

Cierre de la feature. Spec §6.1, §6.5, §6.6, §7.3.

- **Poner al día la ficción de confirmación y disputas** (deuda **preexistente**,
  ajena a esta feature). Detectado al arrancar H10, el primer trabajo que lee la
  feature entera de golpe: `SPEC.md`, `docs/guia-de-uso.md` y
  `docs/guion-de-pruebas.md` describen íntegramente un flujo con **confirmación
  del rival y disputas** (`REPORTED → CONFIRMED/DISPUTED`, ruta
  `/admin/disputas`, standings que solo cuentan `CONFIRMED`) que **el hito 15
  `resultados-directos` eliminó del código el 4 de junio de 2026** en `1ed9faa`.
  Ese commit **no tocó ni `SPEC.md` ni `docs/`**: verificado, 0 ficheros de
  documentación en su diff. Hoy `docs/guia-de-uso.md:182` manda al usuario a
  `/admin/disputas`, que **no existe**.

  **Se corrige aquí, y la razón es que no hay alternativa buena**: H10 reescribe
  §7.4 y §7.5, que **son** las secciones del flujo de disputa. Escribirlas
  dejando la ficción alrededor produce un documento que se contradice a sí mismo
  —unas frases dicen «cuenta al confirmar el rival», otras «cuenta en cuanto se
  apunta»—, y añadir pasos a un guion de pruebas que ordena visitar una ruta que
  da 404 entrega un guion inservible.

  **Solo documentación, cero cambio de producto.** No es una desviación de esta
  spec (no entra en D1-D5): es una corrección de deuda ajena que este hito no
  puede esquivar sin entregar algo peor.

- `SPEC.md` — reescribir §4.3 («(Eliminada) Round»), §7.2, §7.4, §7.5, §8, y
  añadir el **ADR nuevo** que registra la derogación parcial de ADR-007 (cae la
  entidad `Round` y el circle method; se mantienen «sin byes de liga» y
  «calendario por fecha libre»).
- `src/app/bases/page.tsx` — bases públicas con las rondas, el cupo, la
  incomparecencia 80-0 y el 0-0.
- `README.md` y el guion de pruebas manual del hito 11 — documentación de uso,
  **no** mecanismo de verificación.
- `tests/e2e/full-journey.spec.ts` — actualizado al flujo con rondas (hoy sus
  pasos 3 y 4 dan por hecho el flujo sin ellas).
- **Mapa criterio → test** escrito en las notas del hito en `_state.json`.
- **Test de overflow horizontal para `/rondas` a escala real.** Sugerencia de la
  review de H6: los tests de overflow existentes cubren `login`,
  `mis-partidas`, `clasificacion`, `calendario` y `bracket`, pero **ninguno
  visita `/rondas`**, que es justo la vista más ancha (cupo de 12-20 jugadores)
  y el requisito explícito de §7.2. Añadirlo con la liga e2e a **escala real**,
  no con los 6 jugadores del seed mínimo.
- **El e2e tiene que llegar a producir una partida saldada.** Sugerencia de la
  review de H7: **ningún paso** de `full-journey.spec.ts` declara una
  incomparecencia ni cierra una ronda, así que el recorrido automático **nunca
  genera** un `WALKOVER` ni un `UNPLAYED_DRAW`. Consecuencia: las etiquetas de
  H6 («incomparecencia», «saldada sin jugar») y el texto «PJ 11 (2 saldadas)»
  de H7 **no los ejercita nadie de punta a punta** — solo los tests unitarios.
  El e2e reescrito tiene que pasar por el cierre de una ronda y por una
  incomparecencia, y comprobar las etiquetas y el contador **en la pantalla**.

**Criterios de aceptación del hito:** los **38-42** de la spec. El 42 (cada test
falla antes del cambio) se acredita en las notas, criterio a criterio.

---

## Orden y dependencias

```
H1 modelo-datos-rondas
 └─ H2 dominio-reparto-y-fechas         (puro; no depende de H1 para testear)
     └─ H3 generar-con-rondas
         ├─ H4 cierre-de-ronda
         │   └─ H5 incomparecencia      (comparte el camino de Result)
         ├─ H6 ui-cupo-y-rondas
         ├─ H7 clasificacion-saldadas
         └─ H8 recalculo-alta-baja-y-cupo
             └─ H9 puerta-a-playoffs
                 └─ H10 docs-e2e-y-cobertura
```

H2 no necesita H1 para escribirse ni testearse (es puro), pero se ordena después
para que el tipo `Resolution` ya exista y no haya que duplicarlo.

---

# Hitos nacidos del feedback en `HUMAN_REVIEW`

La feature volvió a `BUILDING` el 9 de septiembre de 2026 con dos peticiones del
usuario tras probarla en local.

## H11 · `fix-desplegables-header`

**Estado:** READY_FOR_REVIEW · **e2e sin verificar** (ver abajo)
**Cierra criterios de la spec:** ninguno (regresión de H6).

«No se despliega el desplegable de Admin.» **Regresión de H6.**

`AdminMenu` abre su panel con `position: absolute` dentro de un `div.relative`
que vivía dentro del `<nav>` al que H6 añadió `overflow-x-auto`. **Declarar
`overflow-x` hace que el eje vertical pase de `visible` a `auto`** (especificación
CSS de overflow), así que el nav se volvió contenedor de scroll en los dos ejes y
recortaba el panel en una franja de ~40 px: el menú se abría y no se veía nada.

**Afectaba a los dos dropdowns**, no solo al de admin: `UserMenu.tsx:77` usa el
mismo `absolute`.

**Arreglo:** el scroll horizontal envuelve **solo los enlaces planos**;
`AdminMenu` y `AppHeaderUser` salen fuera del contenedor que recorta. Se conserva
el arreglo de desbordamiento de H6.

**Por qué se coló once hitos de revisión** — lo importante de este hito:
**ningún test abría un dropdown.** Los tests de overflow miden el `scrollWidth`
del `body`, y el `reviewer` de H6 verificó el arreglo por esa vía, correctamente
para lo que medía. El e2e recorre catorce pantallas sin pulsar el botón de Admin.

**Criterios de aceptación:**

1. El menú de Admin se abre y **sus seis enlaces son visibles** —no solo
   presentes en el DOM, que es lo que producía el bug— y uno se puede pulsar
   hasta navegar.
2. El menú de usuario se abre y su acción de salir es visible.
3. El arreglo de desbordamiento de H6 sigue en pie: `/rondas` y el resto no
   desbordan el body a 390 px.
4. Los 496 tests y el e2e siguen verdes.

## H12 · `guia-de-usuario`

**Estado:** PENDING
**Cierra criterios de la spec:** ninguno (feature nueva, fuera de la spec de
rondas).

Ruta nueva **`/guia`, pública**, con la guía de uso para jugadores.

- Contenido derivado de `docs/guia-de-uso.md`, que H10 acaba de poner al día.
  Reescrito **para jugadores**: cómo entrar, apuntar un resultado, declarar una
  incomparecencia, ver tu cupo de la ronda y qué pasa al cerrarse.
- **Pública, sin sesión**, como `/bases`.
- **Enlazada en los dos sitios**, y esto importa: `/bases` hoy se enlaza **solo
  desde el formulario de login** (`LoginForm.tsx:231`), y ni `/bases` ni
  `/login` renderizan el `AppHeader`. Si `/guia` va solo en el header, quien no
  tiene sesión no la encuentra nunca — que es justo lo contrario de hacerla
  pública. Va en el menú **y** junto a «Bases» en el login.
- Séptimo elemento del header (6 enlaces + menú de admin + usuario). El nav ya
  scrollea desde H6, pero **verificar que no reaparece el desbordamiento** ni el
  recorte de H11.

**Criterios de aceptación:**

1. `/guia` responde **sin sesión** (no redirige a `/login`).
2. Está enlazada desde el header con sesión **y** desde `/login` sin ella.
3. Cubre las cinco secciones: entrar, apuntar resultado, incomparecencia y 0-0,
   cupo de la ronda, cierre de ronda.
4. No desborda el body a 390 px, y los dropdowns del header siguen abriéndose
   (criterios 1-3 de H11).
5. Español llano, para jugadores, sin jerga técnica. Mobile-first, dark mode.
