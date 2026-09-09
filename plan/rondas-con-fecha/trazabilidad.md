# Trazabilidad — `rondas-con-fecha`

Mapa criterio → test para los 43 criterios de aceptación de
`plan/specs/rondas-con-fecha.md` §8 (criterios 41 y 42 del propio hito H10).
Ninguno queda huérfano.

Convención: cada test que cierra un criterio numerado lo nombra en su
`describe`/`test.describe` como `AC-N: …` (spec §7.3), así que la
correspondencia se puede auditar por nombre, no solo por lectura del código.

## 1. Mapa criterio → test (los 43 de §8)

**Reparto**

| # | Criterio (resumen) | Test | Harness |
| - | --- | --- | --- |
| 1 | `n`, `k` → `C(n,2)` partidas y `ceil((n-1)/k)` rondas | `tests/rondas.test.ts` — `describe("AC-1: …")` | Vitest, puro |
| 2 | Ningún jugador con más de `k` partidas en la misma ronda (`n` par/impar, `k` ∈ {1,2,3}) | `tests/rondas.test.ts` — `describe("AC-2: …")` | Vitest, puro |
| 3 | `n` par: exactamente `k` partidas por ronda salvo la última | `tests/rondas.test.ts` — `describe("AC-3: …")` y `describe("AC-3 (Walecki): …")` (caso `n` impar / `k` par) | Vitest, puro |
| 4 | `n` impar: sin partida de bye, sigue siendo `C(n,2)` | `tests/rondas.test.ts` — `describe("AC-4: …")` | Vitest, puro |
| 5 | El reparto es determinista | `tests/rondas.test.ts` — `describe("AC-5: …")` | Vitest, puro |
| 6 | Subgrafo arbitrario respeta el criterio 2 y no reasigna partidas con `Result` | `tests/rondas.test.ts` — `describe("AC-6: …")` | Vitest, puro |

**Fechas de ronda**

| # | Criterio (resumen) | Test | Harness |
| - | --- | --- | --- |
| 7 | Fechas derivadas del mes de arranque (marzo 2026 → 6 cierres) | `tests/rondas.test.ts` — `describe("AC-7: …")` | Vitest, puro |
| 8 | Editar la fecha de cierre no reasigna partidas ni toca `scheduledAt` | `tests/generar-con-rondas.test.ts` — `describe("AC-8: …")` | Vitest, DB de test |

**Cupo y UI**

| # | Criterio (resumen) | Test | Harness |
| - | --- | --- | --- |
| 9 | Mis partidas agrupa por ronda, cierre más próximo primero, cerradas al final | `tests/ui-cupo-y-rondas.test.ts` — `describe("AC-9: …")` | Vitest, puro (`sortRoundBlocks`) |
| 10 | Contador de cupo «falta N de K» / «falta 1 de 1» en la última ronda | `tests/rondas.test.ts` — `describe("AC-10: …")` | Vitest, puro (`quotaLabel`) |
| 11 | Partida con `scheduledAt` futuro y sin `Result` cuenta como pendiente | `tests/rondas.test.ts` — `describe("AC-11: …")` | Vitest, puro (`roundQuota`) |
| 12 | `/rondas` sin N+1 (una sola query de partidas) | `tests/rondas-overview.test.ts` — `describe("AC-12: …")` | Vitest, DB de test instrumentada (`$extends`) |
| 13 | `/rondas` accesible con sesión, redirige a `/login` sin ella | `tests/e2e/rondas.spec.ts` — `test.describe("AC-13: …")` | Playwright |

**Ronda fija y adelantar**

| # | Criterio (resumen) | Test | Harness |
| - | --- | --- | --- |
| 14 | La ronda de una partida no se puede cambiar desde ninguna superficie | `tests/generar-con-rondas.test.ts` — `describe("AC-14: …")` | Vitest, DB de test (barrido de `match.update`/`create`) |
| 15 | Jugador a 0/2 puede apuntar sin error una partida de una ronda posterior | `tests/cierre-de-ronda.test.ts` — `describe("AC-15: …")` | Vitest, DB de test |
| 16 | Al cerrar su ronda recibe el saldo; la partida adelantada queda intacta | `tests/cierre-de-ronda.test.ts` — `describe("AC-16: …")` | Vitest, DB de test |

**Cierre de ronda**

| # | Criterio (resumen) | Test | Harness |
| - | --- | --- | --- |
| 17 | «Cerrar ronda N» rechazado/deshabilitado antes de la fecha de cierre | `tests/cierre-de-ronda.test.ts` — `describe("AC-17: …")` | Vitest, DB de test |
| 18 | Al cerrar, todas las partidas sin `Result` reciben 0-0 `UNPLAYED_DRAW` | `tests/cierre-de-ronda.test.ts` — `describe("AC-18: …")` | Vitest, DB de test |
| 19 | Las partidas que ya tenían `Result` quedan intactas | `tests/cierre-de-ronda.test.ts` — `describe("AC-19: …")` | Vitest, DB de test |
| 20 | El cierre escribe una entrada de `AuditLog` con el admin como actor | `tests/cierre-de-ronda.test.ts` — `describe("AC-20: …")` | Vitest, DB de test |
| 21 | Tras el cierre, un participante recibe error; el admin edita y no reabre | `tests/cierre-de-ronda.test.ts` — `describe("AC-21: …")` (integración) + `tests/reportar-confirmar.test.ts` — `describe("AC-21: canReportGivenRoundClosed …")` (predicado puro) | Vitest, DB de test + Vitest puro |
| 22 | Se puede cerrar la ronda 4 con la 3 abierta | `tests/cierre-de-ronda.test.ts` — `describe("AC-22: …")` | Vitest, DB de test |

**Incomparecencia**

| # | Criterio (resumen) | Test | Harness |
| - | --- | --- | --- |
| 23 | Cualquiera de los dos declara la incomparecencia eligiendo vencedor → 80-0 `WALKOVER` | `tests/incomparecencia.test.ts` — `describe("AC-23: …")` | Vitest, DB de test |
| 24 | Bonus 0-0 aunque `calculateBonus` daría 2 (config del seed) | `tests/incomparecencia.test.ts` — `describe("AC-24: …")` | Vitest, DB de test |
| 25 | El otro participante sobrescribe con el resultado real; dos entradas de `AuditLog` | `tests/incomparecencia.test.ts` — `describe("AC-25: …")` | Vitest, DB de test |
| 26 | En la clasificación, el vencedor suma 3 pts/80 VP a favor; el ausente 0 pts/80 VP en contra | `tests/incomparecencia.test.ts` — `describe("AC-26: …")` | Vitest, DB de test |

**Clasificación**

| # | Criterio (resumen) | Test | Harness |
| - | --- | --- | --- |
| 27 | `PJ 11 (2 saldadas)` | `tests/standings.test.ts` — `describe("AC-27: computeStandings cuenta las saldadas …")` y `describe("AC-27: formatPlayedCount …")` | Vitest, puro |
| 28 | Puntos/VP/desempates de 80-0 y 0-0 sin ninguna rama especial | `tests/standings.test.ts` — `describe("AC-28: …")` | Vitest, puro |

**Alta y baja de jugador**

| # | Criterio (resumen) | Test | Harness |
| - | --- | --- | --- |
| 29 | Alta con rondas 1-2 cerradas: intactas; el resto se reparte respetando el criterio 2 | `tests/recalculo-alta-baja-y-cupo.test.ts` — `describe("AC-29: …")` | Vitest, DB de test |
| 30 | El recálculo añade rondas al final con fechas derivadas del mes siguiente al último cierre | `tests/recalculo-alta-baja-y-cupo.test.ts` — `describe("AC-30: …")` | Vitest, DB de test |
| 31 | El recálculo no modifica el `scheduledAt` de ninguna partida | `tests/recalculo-alta-baja-y-cupo.test.ts` — `describe("AC-31: …")` | Vitest, DB de test |
| 32 | Baja salda pendientes como 80-0 `WALKOVER` con bonus 0; lo ya jugado queda intacto | `tests/recalculo-alta-baja-y-cupo.test.ts` — `describe("AC-32: …")` | Vitest, DB de test |
| 33 | Reactivar no revierte esos resultados | `tests/recalculo-alta-baja-y-cupo.test.ts` — `describe("AC-33: …")` | Vitest, DB de test |

**Configuración**

| # | Criterio (resumen) | Test | Harness |
| - | --- | --- | --- |
| 34 | `matchesPerRound` editable; el recálculo mantiene el criterio 2 con el valor nuevo | `tests/recalculo-alta-baja-y-cupo.test.ts` — `describe("AC-34: …")` | Vitest, DB de test |
| 35 | Subir 2→3 reduce rondas; bajar 2→1 las aumenta; las cerradas no cambian | `tests/recalculo-alta-baja-y-cupo.test.ts` — `describe("AC-35: …")` | Vitest, DB de test |

**Playoffs**

| # | Criterio (resumen) | Test | Harness |
| - | --- | --- | --- |
| 36 | `startPlayoffs` falla con mensaje mientras exista una ronda sin `closedAt`, nombrándolas | `tests/puerta-a-playoffs.test.ts` — `describe("AC-36: …")` | Vitest, DB de test |
| 37 | Con todas cerradas, mismo bracket/seeding/byes que antes de este hito | `tests/puerta-a-playoffs.test.ts` — `describe("AC-37: …")` (más `tests/playoffs-bracket.test.ts`, diff vacío) | Vitest, DB de test |

**Regresión y cobertura de la propia spec**

| # | Criterio (resumen) | Test / mecanismo | Harness |
| - | --- | --- | --- |
| 38 | `npm run lint`, `npm run test`, `npm run e2e` y `npm run build` pasan sin errores | Los cuatro comandos, verificados al cierre de H10 (ver §3 de este documento) | Regresión completa |
| 39 | Tests existentes de `standings`, `pairings` y `reportar-confirmar` verdes o actualizados con justificación | `tests/standings.test.ts`, `tests/emparejamientos.test.ts`, `tests/reportar-confirmar.test.ts` — ver §2 de este documento | Vitest |
| 40 | `tests/e2e/full-journey.spec.ts` actualizado al flujo con rondas y pasa | `tests/e2e/full-journey.spec.ts` (reescrito en H10) | Playwright |
| 41 | Mapa criterio → test escrito y consultable | Este documento | — |
| 42 | Cada test falla antes de su cambio (o guarda de regresión declarada como tal) | Acreditado hito a hito en §4 de este documento | — |
| 43 | `npm run test:coverage` al 100 % de líneas y ramas en los módulos puros nuevos de dominio | `src/server/rounds.ts` — ver §5 de este documento | Vitest coverage (v8) |

## 2. Criterio 39 — `standings`, `pairings` y `reportar-confirmar`

Los tres ficheros que la spec nombra explícitamente siguen verdes al cierre de
H10. Ninguno se dejó "verde por accidente": cada cambio está justificado.

- **`tests/standings.test.ts`** — H7 amplió `StandingsMatch.result` con
  `resolution` opcional (retrocompatible: tratado como `PLAYED` si falta, así
  que ninguna llamada preexistente a `computeStandings` tuvo que tocarse) y
  añadió el `describe("AC-27…")`/`describe("AC-28…")` nuevos. Los tests
  previos a `rondas-con-fecha` no cambiaron de comportamiento.
- **`tests/emparejamientos.test.ts`** — H8 amplió el mock de `@/lib/db` porque
  `addMissingLeagueMatches` pasó a invocar `redistributePending` (nuevo en
  H8): el mock ganó `round.findMany/create/delete`, `auditLog.create` y
  `match.count/updateMany`, y `requireAdmin` pasó a devolver una sesión real
  con `playerId` (lo necesita el `AuditLog` de la redistribución). Verificado
  en su momento que los 43 tests previos del fichero seguían pasando exacto
  igual tras el cambio de mock.
- **`tests/reportar-confirmar.test.ts`** — H4 añadió la guarda de ronda
  cerrada (`canReportGivenRoundClosed`) a `reportResult`, cubierta con 5 tests
  puros del predicado; H5b la reforzó con el patrón de relectura dentro de la
  transacción. Los tests del flujo de apuntar/editar sin rondas (anteriores a
  esta feature) no cambiaron de comportamiento — solo se añadió la guarda
  nueva encima.

## 3. Criterio 38 — regresión completa (salida real de H10)

Salida real de los cuatro comandos al cerrar H10 (documentación/e2e/trazabilidad
únicamente — ningún fichero de `src/server/` ni `prisma/` tocado, así que la
salida es idéntica a la de H9 salvo el propio `full-journey.spec.ts`):

- `npm run lint` → 0 errores, 0 warnings.
- `npx tsc --noEmit` → limpio.
- `npm run test` → **496/496** (idéntico a la baseline de H9; H10 no añade
  tests de dominio porque no cierra criterios de dominio nuevos).
- `npm run build` → compila y genera las 19 rutas de la app (sin cambios de
  árbol de rutas).
- `npm run e2e` → **54/54 pasan, 0 skipped**, repetido dos veces seguidas sin
  intermitencia (antes de H10: 42 pasan / 2 skipped). El aumento de 43→54
  tests es el propio guion reescrito (más pasos: alta de jugadores a escala,
  incomparecencia, cierre de rondas, overflow de `/rondas`) más el test de
  playoffs que deja de saltarse.

## 4. Criterio 42 — fallo antes del cambio, hito a hito

Acreditación consolidada a partir de las notas de `_state.json` y de los
nueve informes de `plan/rondas-con-fecha/reviews/*.md`, sin reejecutar cada
`git stash` de nuevo en H10 (el propio criterio 41 pide consultar esto, no
repetirlo).

| Hito | Mecanismo | Evidencia |
| --- | --- | --- |
| H1 | `tests/modelo-datos-rondas.test.ts` es fichero nuevo contra un esquema nuevo (`Round`, `Resolution`); el test de nulabilidad de `startMonth` se revirtió a `DateTime` y falló con `PrismaClientValidationError` (no tautológico). | Notas H1, review 2 |
| H2 | `tests/rondas.test.ts` es fichero nuevo: cualquier test contra `src/server/rounds.ts` falla por construcción antes del hito (el fichero no existía). Además, `invertKempeChain` se deshabilitó a propósito y 22 tests fallaron con el mensaje de jugador repetido, confirmando que `assertValidReparto` detecta un reparto inválido de verdad. | Notas H2, review 3 |
| H3 | `tests/generar-con-rondas.test.ts` es fichero nuevo contra funciones nuevas (`generateLeagueMatches` con rondas, `updateRoundDeadline`); fallan por construcción contra el código previo a H3. | Notas H3 |
| H4 | `tests/cierre-de-ronda.test.ts` es fichero nuevo contra `closeRound` (no existía). El atajo verificado con un throw a mitad de transacción: sin fix, no persiste `Round`/`Match`/`Result`/`AuditLog`. | Notas H4, review 1 |
| H5 | **Falla-antes-del-cambio verificado revirtiendo los 4 ficheros a HEAD**: los tests nuevos de `declareWalkover` fallan con `"declareWalkover is not a function"`. Tras D5, **fallo-antes-del-fix confirmado con `git stash`**: el test del ganador legítimo falla con `expected false got true` sin el fix. | Notas H5 |
| H5b | 8 tests nuevos; **fallo-antes-del-fix confirmado revirtiendo los dos ficheros de producción a `b5763ac`** (criterios 1, 2 y el doble cierre fallan con `expected true to be false`). | Notas H5b |
| H6 | `tests/ui-cupo-y-rondas.test.ts` y `tests/rondas-overview.test.ts` son ficheros nuevos contra `round-ui.ts`/`round-overview.ts` (no existían). El N+1 real inyectado por el reviewer en `getRoundsOverview` lo cazó la instrumentación al instante (4→5, 16→17 queries), confirmando que el test cuenta de verdad. | Notas H6, review 1 |
| H7 | **Fallo-antes-del-cambio confirmado con `git stash` sobre `src/server/standings.ts`**: 6 de los 9 tests nuevos fallan (los 3 de conteo AC-27 con `settled` undefined, los 3 de `formatPlayedCount` con `"is not a function"`). **Honestidad documentada**: los 3 de AC-28 pasan igual sin el cambio porque `resolution` nunca se leía en el cálculo — eso ya era cierto por construcción antes de este hito (`isConfirmedForStandings` no cambia). Son **guarda de regresión hacia adelante**, no un fallo-antes-del-cambio literal; el reviewer reprodujo el mismo `git stash` y confirmó por nombre de test que fallan exactamente 6 de 9. | Notas H7, review 1 |
| H8 | **Fallo-antes-del-fix verificado con `git stash` de los tres ficheros de producción**: los 8 tests nuevos fallan los 8. Tras el bloqueante de la review (cupo agotado por partidas precoloreadas), **24 tests fallan con los 4 ficheros de producción revertidos**. | Notas H8, review 1 y 2 |
| H9 | Los 4 tests que dependen del endurecimiento de `startPlayoffs` **fallan revirtiendo al commit anterior**; el reviewer escribió su propia reproducción independiente con el disparador real (`addMissingLeagueMatches`, alta a mitad de liga genuina) y confirmó el mismo resultado. | Notas H9, review 1 |
| H10 | `tests/e2e/full-journey.spec.ts` reescrito: los pasos nuevos (cierre de ronda, incomparecencia, overflow de `/rondas` a escala real, recuperación del test de playoffs) ejercitan código que ya existía desde H1-H9 — no hay fallo-antes-del-cambio propio de H10 porque H10 no añade dominio nuevo, solo documentación y e2e. Los tests unitarios que sí prueban ese dominio (H1-H9) ya están acreditados arriba. | — |

## 5. Criterio 43 — cobertura de los módulos puros nuevos

`npm run test:coverage` sobre `src/server/rounds.ts` (el módulo de dominio
puro de esta feature: reparto, cupo, fechas de ronda). Verificado en H10
directamente contra `coverage/coverage-final.json` (el reporte de texto de
`vitest run --coverage` omite de la tabla los ficheros al 100 % en las
cuatro métricas, así que la cifra hay que leerla del JSON, no de la tabla
impresa):

| Fichero | Statements | Branches | Functions |
| --- | --- | --- | --- |
| `src/server/rounds.ts` | 259/259 (100 %) | 86/86 (100 %) | 50/50 (100 %) |
| `src/server/pairings.ts` | 27/27 (100 %) | 6/6 (100 %) | 6/6 (100 %) |
| `src/server/result-logic.ts` | 41/41 (100 %) | 44/44 (100 %) | 7/7 (100 %) |

Idéntico al baseline de H8/H9 (259/259 statements, 86/86 branches en
`rounds.ts`), con una única exclusión documentada in situ
(`/* v8 ignore */`, invariante defensivo inalcanzable por construcción una
vez que `assertValidReparto` garantiza un reparto válido). El resto de los
módulos con lógica de rondas (`round-actions.ts`, `round-ui.ts`,
`round-overview.ts`, `result-actions.ts`) hacen I/O de DB o presentación y no
son el "módulo puro" al que se refiere literalmente el criterio 43 — el
reparto de criterios de `PLAN.md` asigna la cobertura 100 % exclusivamente a
`src/server/rounds.ts`, en H2.
