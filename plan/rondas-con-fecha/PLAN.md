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
- `src/server/league-actions.ts` — `updateLeague` acepta los dos campos.
  **Sin** recálculo todavía (eso es H8): en este hito el cambio solo aplica a
  ligas en `SETUP`.
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

**Criterios de aceptación del hito:** los **9, 12 y 13** de la spec. El 12
(sin N+1) se verifica **contando queries** con una extensión de logging del
cliente Prisma en test, no mirando la pantalla (spec §7.3).

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
**idénticos** a los de hoy.

---

## H10 · `docs-e2e-y-cobertura`

**Estado:** PENDING
**Cierra criterios de la spec:** 38, 39, 40, 41, 42.

Cierre de la feature. Spec §6.1, §6.5, §6.6, §7.3.

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
