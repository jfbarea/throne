# Review — H3 `generar-con-rondas`

**Commit revisado:** `7039670`. (`e0dd6bd`, `8d679b3`, `f972167` son chores
de estado posteriores, no tocan código.)

## Veredicto: APPROVED

Revisé los ocho puntos que se pedían con lupa, más el resto del diff. No
encontré bloqueantes: el único hallazgo con sustancia (`fileParallelism`)
es sobre la **atribución histórica** del problema, no sobre si el arreglo
es correcto — lo es, y lo comprobé yo mismo con 20+ repeticiones en cada
sentido. El resto son matices menores, listados como sugerencias.

## 1. `fileParallelism: false` — el diagnóstico es correcto, la atribución histórica no

Reproduje esto de la forma más directa posible: monté un `git worktree`
sobre `47a53fe` (el cierre real de H2, antes de cualquier línea de H3) y
corrí `npm run test` **20 veces** con la configuración de esa época (sin
`fileParallelism`). **0 fallos en las 20.** Y tiene sentido estructural: en
esa baseline solo **un** fichero de test (`modelo-datos-rondas.test.ts`)
toca la DB real — `emparejamientos.test.ts` mockea `@/lib/db`. Con un solo
fichero escribiendo, la contención entre ficheros en paralelo que describe
el commit **no puede ocurrir todavía**: no hay con qué contender.

Volví a la rama actual (H3) y probé lo contrario: revertí
`fileParallelism` a `true` (con `git diff` limpio después) y corrí
`npm run test` 20 veces. **12 de 20 fallaron**, todas con el mismo patrón
exacto que describe el commit —
`PrismaClientKnownRequestError ... SQLITE_BUSY: database is locked` /
`Operation has timed out` — porque `tests/generar-con-rondas.test.ts` (el
fichero nuevo de este hito) **también** importa `@/lib/db` real, así que
ahora sí hay dos ficheros escribiendo contra el mismo `file:./test.db` en
procesos de test paralelos. Repuse `fileParallelism: false` y volví a
correr 15 veces: **0 fallos**.

**Conclusión:** el diagnóstico técnico es correcto (contención de escritor
único de SQLite/libSQL entre dos ficheros de test con conexiones
independientes al mismo fichero, no una fuga de conexión ni transacciones
solapadas dentro de un mismo fichero — no hay `.concurrent` ni
`Promise.all` en ningún test) y el arreglo (serializar la ejecución de
ficheros) es la mitigación estándar y legítima para este problema, no una
alfombra sobre un leak real. Pero la frase «ya presentes en el baseline de
H2» (commit y `_state.json`) **no la pude reproducir, y estructuralmente no
parece posible** en esa baseline con solo un fichero tocando la DB real. Lo
más preciso sería: *H3 introduce el segundo fichero de escritura real y
con él la contención se vuelve posible por primera vez* — no que ya
existiera y este hito solo la agravara. No cambia si el hito se aprueba
(el arreglo es correcto y necesario de todas formas), pero merece
corregirse en el registro para no dar por sentado en H4+ que este patrón
ya era un problema antes de lo que realmente fue.

## 2. Borrar las `Round` previas al regenerar

Seguro. Orden dentro de la misma transacción
(`src/server/match-actions.ts:136-152`): primero se borran los `Result`
de los `Match` de liga existentes, después los `Match` mismos, y **solo
entonces** las filas `Round` de esa liga. En el momento en que se ejecuta
`tx.round.deleteMany`, cero `Match` de esa liga siguen existiendo para
referenciarlas — no hay ventana en la que una partida quede con `roundId`
colgando. Además la FK de `Match.roundId` es `ON DELETE SET NULL` (H1), así
que incluso en un escenario imposible por diseño (una partida de otra fase
apuntando a esa `Round`) no reventaría, se limpiaría sola. El regenerar dos
veces seguidas está cubierto por un test de regresión que comprueba índices
sin colisión, y el guard de partidas con resultado ya reportado se
verifica **dentro** de la misma transacción (TOCTOU-safe) antes de tocar
nada, con test dedicado que confirma que las `Round` existentes no se tocan
si se bloquea la regeneración.

## 3. `startMonth`: tipos `z.input`/`z.output` y zona horaria

**Propagación de tipos:** revisé todos los usos de `LeagueConfigInput` /
`LeagueConfigOutput` en el árbol (`grep` completo). `createLeague` y
`updateLeague` declaran su parámetro como `LeagueConfigInput` (correcto:
reciben el dato **antes** de parsear) y usan `parsed.data` —tipado por
inferencia como la salida del schema, sin anotación manual que pudiera
desincronizarse— para todo lo que escriben en Prisma. `LeagueConfigOutput`
está exportado pero no se usa en ningún sitio explícitamente porque no
hace falta (la inferencia de `.safeParse()` ya lo resuelve solo); no hay
ningún consumidor que siga usando el tipo equivocado ni que compile «por
casualidad» — no encontré ningún `z.infer` residual sobre este schema.

**Zona horaria:** la sometí a los mismos extremos que ya usé en H2
(`TZ=Pacific/Kiritimati`, UTC+14, y `TZ=Pacific/Midway`, UTC-11) contra el
propio schema, con una fecha completa (`"2026-03-15"`) y con el primer día
exacto (`"2026-03-01"`): las dos dan `2026-03-01T00:00:00.000Z` en las tres
zonas horarias probadas, sin desplazamiento. Esto es así porque `new
Date("YYYY-MM-DD")` (y también `"YYYY-MM"`, lo probé también) es
**siempre** interpretado como UTC por el motor de JS, sea cual sea la
`TZ` del proceso — es el comportamiento del propio `Date` con formatos
"date-only" del estándar ECMA-262, no algo que dependa de este código. Y
`LeagueForm.tsx` siempre manda una cadena "YYYY-MM-01" (nunca un objeto
`Date` construido localmente), así que el borde cliente→schema nunca
introduce una hora local que pudiera desplazar el mes.

## 4. `matchesPerRound` con `.default(2)` — sugerencia, no bloqueante

Es un sitio razonable para el default, no un error: el default no lo
consume ningún flujo real hoy —`LeagueForm.buildInput()` siempre manda un
valor explícito, nunca omite el campo— así que en producción es papel
muerto; la única vía por la que se activa es un caller programático
(tests) que construye el objeto sin esa clave, tal como dice el commit. Y
el valor en sí (2) no es arbitrario: es literalmente «el valor por
defecto» que la propia spec le da a `matchesPerRound` en prosa (§4.2), no
solo un artefacto de compatibilidad de tests. Dicho esto, el comentario
en `schemas.ts` (líneas 91-98) no explica **por qué** 2 es un default
seguro — solo documenta el límite inferior y la ausencia de tope. Sugerencia:
añadir una línea que conecte el default con la razón real (coincide con el
valor por defecto del producto, no se ejercita desde la UI), para que quien
lo lea en H8 no interprete «para no romper tests previos» —la frase que sí
aparece en el commit— como que es un parche a retirar.

## 5. `addMissingLeagueMatches` sigue creando `roundId: null`

Comprobado que no revienta nada, en las tres superficies señaladas:

- **`/admin/rondas`**: consulta `prisma.round.findMany` y cuenta
  `_count.matches` por relación. Una partida con `roundId = null` no
  pertenece a ninguna `Round`, así que simplemente no aparece en el
  recuento de ninguna — no hay excepción, es una omisión silenciosa
  (invisible hasta que H8 la reparta), coherente con que H8 es quien debe
  cerrar esto.
- **`/calendario`**: no toca `Round` ni `roundId` en absoluto todavía
  (`grep` no encuentra ninguna referencia) — sigue funcionando exactamente
  como antes de esta feature, ajeno al cambio.
- **`/admin/emparejamientos`**: tampoco muestra nada relacionado con
  rondas.

Nada de esto "revienta" ninguna vista; es un estado incompleto y silencioso
tal como el plan lo prevé, no un bloqueante.

## 6. Criterio 14 — busqué más superficies de las que probó el builder

No me fié de la lista de dos tests. Busqué **todos** los sitios del árbol
que escriben `Match.roundId` o que llaman a `prisma.match.update`/
`.updateMany`:

- `Match.roundId` solo se escribe en un sitio de todo `src/`:
  `generateLeagueMatches` (la generación en sí, algorítmica).
- `prisma.match.update` solo aparece dos veces en todo el código:
  `setMatchSchedule` (`status`/`scheduledAt`/`location`, nunca `roundId`) y
  `reportResult` en `result-actions.ts` (solo `status: "REPORTED"`).

Ninguna otra acción, formulario o superficie tiene forma de escribir
`roundId` en un `Match` ya creado. El criterio 14 está cubierto de verdad,
no solo donde el builder decidió mirar.

## 7. Guardas, Zod, AuditLog, transacciones

`updateRoundDeadline` (la única acción nueva de este hito): `requireAdmin()`
es la primera instrucción, Zod valida el `deadline`, la escritura de
`Round` + `AuditLog` va en `prisma.$transaction`, y el actor del log es el
de la sesión (`session.playerId`), igual que `resetLeague`. Correcto.

`generateLeagueMatches` (modificada, no nueva) sigue **sin** `AuditLog` —
confirmé con `git show 7039670~1` que ya carecía de él antes de este hito
(hito 6, sin tocar por H3 en ese aspecto) y que `PLAN.md` §H3 no lo lista
como entregable. No es una regresión de este hito, pero sí es una escritura
multi-fila sustancialmente ampliada aquí (ahora borra y crea `Round`
además de `Match`) sin ningún rastro en el audit log. Lo dejo como
sugerencia para un hito posterior (o para escalarlo si se quiere cerrar
antes), no como bloqueante de H3: el requisito global de `AuditLog` en
escrituras multi-fila ya era papel mojado en esta función concreta antes de
que empezara esta feature.

## 8. Guarda de `startMonth = null`

Confirmado con test de escritura real (no solo lectura del código): la
liga se crea con `startMonth: null`, se generan jugadores, se llama a
`generateLeagueMatches`, y se comprueba `roundCount === 0` y
`matchCount === 0` en la DB **después** de la llamada fallida. El guard
está antes de cualquier lectura de jugadores o cómputo de reparto
(`match-actions.ts:83-89`), así que no hay ninguna ventana en la que algo
se escriba a medias.

## Regresión

- `npm run lint` → limpio (un aviso espurio de `coverage/block-navigation.js`
  apareció por una ejecución de `test:coverage` mía de la review anterior
  dejada en el árbol de trabajo — `coverage/` está en `.gitignore`; lo
  borré y vuelve a quedar limpio, no es del commit revisado).
- `npm run test` → `Test Files 10 passed (10)` / `Tests 383 passed (383)`.
- `npm run build` → compila y genera las 20 rutas, con `/admin/rondas` ya en
  el árbol.
- `npm run e2e` → **37 pasan, 1 skipped**, idéntico al baseline anterior a
  H3. `LeagueForm` con los dos campos nuevos no rompe el recorrido
  (`chromium` y `mobile-chrome`, incluido el paso 2 "Admin ve el panel y
  navega a configuración de liga" y el paso 3 "Admin genera
  emparejamientos").

## Sugerencias (no bloqueantes)

1. Corregir en `PLAN.md`/`_state.json` la atribución de la flakiness de
   SQLite: no está confirmado que existiera ya en el baseline de H2 (mi
   reproducción con 20 ejecuciones da 0 fallos ahí, y estructuralmente solo
   hay un fichero tocando la DB real en esa baseline); lo preciso es que H3
   la introduce al añadir el segundo fichero de escritura real. El arreglo
   (`fileParallelism: false`) es correcto de todas formas.
2. `src/lib/schemas.ts:94-98` — documentar en el propio comentario por qué
   `.default(2)` en `matchesPerRound` es seguro (coincide con el valor por
   defecto del producto en la spec §4.2, y ningún flujo de UI real lo
   ejercita), no solo "para no romper tests previos".
3. Considerar añadir `AuditLog` a `generateLeagueMatches` en un hito
   posterior — es deuda preexistente a esta feature, no algo que H3 haya
   empeorado, pero ahora la operación que audita menos (crear/borrar
   `Round` además de `Match`) es más grande que antes.
