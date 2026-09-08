# Review — H5b `endurecer-guardas-transaccionales`

**Commit revisado:** `87ab9d5`. (`12fd4b0` es el fix de timeout del coordinador,
comentado al final; `b5763ac` y `368a71a` son chores de estado, no tocan código.)

## Veredicto: APPROVED

El fix cierra el TOCTOU de la guarda de ronda cerrada exactamente con el
patrón validado en D5, en las dos acciones que lo tenían (`reportResult` y
`declareWalkover`), y lo demostré cerrado repitiendo mi propio experimento de
forma independiente al test del builder, no solo ejecutando su suite. El
barrido encontró y corrigió además un defecto real y distinto (doble cierre
concurrente de `closeRound`), reproducido y verificado sin regresión en el
camino no concurrente (los 12 tests de H4 sobre `closeRound` — criterios
15-22 — siguen en verde sin tocar). Auditar los tres "no lo necesita" no
encontró ningún hueco equivalente sin cubrir; el más discutible (la
generación de emparejamientos usando una config leída antes de la
transacción) es una carrera admin-vs-admin de baja severidad, autocorregible
regenerando, no un bypass de ninguna garantía de competición — lo dejo
anotado como sugerencia, no como bloqueante.

## 1. El TOCTOU de ronda cerrada — cerrado, verificado con mi propio experimento

No me limité a ejecutar el test del builder. Repliqué mi experimento
original —el mismo método que usé para destapar el defecto de D5 y luego el
de esta misma guarda— de forma independiente, en un fichero de test propio,
contra las dos acciones:

- **`declareWalkover`**: un participante lee la ronda abierta, decide
  continuar; en la ventana antes de que su transacción se abra, el admin
  cierra la ronda de verdad (`closeRound`, completo). Resultado:
  `{ok: false, error: 'La ronda de esta partida ya está cerrada. Solo el
  admin puede editar el resultado.'}`.
- **`reportResult`**: mismo montaje, mismo resultado — rechazado con el
  mismo mensaje.

Leí el mecanismo: `src/server/result-actions.ts` relee `Round.closedAt` con
`tx.round.findUnique({where: {id: match.roundId}})` como primera instrucción
dentro de `prisma.$transaction`, en **ambas** acciones, aplicando el mismo
predicado `canReportGivenRoundClosed` que ya se usaba fuera. Si falla, lanza
`RoundClosedDuringTransactionError`, capturada justo fuera del `$transaction`
y traducida al mismo mensaje en español que ya daba el atajo de fuera. La
lectura previa se mantiene solo como rechazo rápido de UX — la de dentro es
la que manda, exactamente como pedía `PLAN.md`.

## 2. ¿La ventana se ha movido a otro sitio? Auditoría de los "no lo necesita"

- **`winnerId`**: confirmé con `grep` en todo `src/server/*.ts` que
  `playerHomeId`/`playerAwayId` **solo** aparecen como claves de escritura en
  llamadas `.create()` (en `match-actions.ts` y `playoff-actions.ts`) —
  ninguna de las cuatro llamadas a `match.update`/`updateMany` que existen en
  todo el árbol (`round-actions.ts:256`, `match-actions.ts:403`,
  `result-actions.ts:308,639`) toca ninguno de los dos campos. Los
  participantes de un `Match` son, en efecto, inmutables una vez creado — no
  hay ninguna vía de reasignarlos, así que no hay TOCTOU posible sobre un
  dato que no cambia.
- **`startMonth === null` y `players.length < 2` en `generateLeagueMatches`**:
  el razonamiento del builder se sostiene, pero con un matiz que merece
  quedar anotado. La única escritura verdaderamente destructiva de esta
  acción — borrar partidas/rondas existentes y sustituirlas — vive dentro de
  `prisma.$transaction`, y el guard que de verdad importa (bloquear si hay
  partidas `CONFIRMED`/`REPORTED`, es decir, partidas ya jugadas) **ya
  estaba** relaído con `tx` antes de este hito (el propio comentario en el
  código, "TOCTOU fix: the confirmed-count check now lives INSIDE the
  transaction", lo confirma como un arreglo anterior a H5b, no tocado por
  `87ab9d5`). Lo que sí queda fuera de la transacción es el **cómputo** del
  reparto (`roundRobinRounds`/`deriveDeadlines`), que usa una foto de
  `league.startMonth`/`matchesPerRound`/jugadores activos tomada antes de
  abrir la transacción. Si otro admin cambia esa configuración (edita
  `matchesPerRound`, desactiva un jugador) en la ventana, el reparto que se
  escribe será el calculado con la config vieja — no corrompe nada
  irreversible (el guard de partidas ya jugadas sigue protegiendo dentro de
  la transacción) y es autocorregible con solo volver a generar. Es admin
  contra admin, no un participante burlando una regla de competición, así
  que la clasificación de "no lo necesita" es razonable — pero es una
  garantía más débil que las de D5/H5b (esas cierran un bypass de una regla;
  esto es una posible foto obsoleta de config, de bajo impacto). Lo dejo como
  sugerencia, no como bloqueante.
- **`updateRoundDeadline`**: confirmado leyendo el código
  (`src/server/round-actions.ts:78-124`) — la única decisión tomada a partir
  de una lectura previa es "¿existe la ronda?" (falla si no, lo cual es
  seguro incluso si la ronda se borra justo después: el `tx.round.update`
  fallaría con un error real de Prisma, no con un éxito silencioso
  incorrecto). El `tx.round.update` en sí escribe `deadline: newDeadline`
  incondicionalmente, sin comprobar `closedAt` ni ningún otro campo — no hay
  ninguna guarda de la clase que D5/H5b arreglan porque no hay ninguna
  decisión de "permitir o no" basada en un dato que pueda quedar obsoleto.
  Correcto no tocarlo. (Cuestión aparte, fuera del alcance de este hito: el
  campo `previousDeadline` del `AuditLog` sí podría quedar desincronizado si
  otro `updateRoundDeadline` concurrente cambia la fecha en esa ventana —
  imprecisión cosmética del log de auditoría, no una guarda burlable.)
- **Alcance excluido (`playoff-actions.ts`, `league-actions.ts`)**: de
  acuerdo. Repasé `startPlayoffs`: la única escritura verdaderamente
  irreversible (crear el `Bracket`) ya comprueba "no existe bracket previo"
  **dentro** de su transacción — el resto de guardas leídas antes
  (`league.status`, jugadores activos) son, otra vez, admin-vs-admin de baja
  severidad, y la precondición nueva de §4.11 ("todas las rondas cerradas")
  que sí introduciría un guard de la clase D5/H5b **todavía no existe en el
  código** — es trabajo de H9. No hay nada que endurecer hoy porque no hay
  guard todavía. Mismo argumento para `league-actions.ts`: es CRUD de
  admin sin el patrón participante-vs-admin que motiva este hito. Correcto
  posponerlo, con la salvedad de que H9 debería aplicar este mismo criterio
  en cuanto añada esa precondición.

## 3. El doble cierre concurrente de `closeRound` — reproducido y corregido sin regresión

Lo reproduje yo mismo revirtiendo temporalmente `result-actions.ts` y
`round-actions.ts` a `b5763ac` (antes de este commit) y ejecutando
`tests/endurecer-guardas-transaccionales.test.ts`: los tests de los
criterios 1 y 2, y el del doble cierre, fallan los tres con
`expected true to be false` — exactamente lo que dice el informe del
builder. Restauré el código después (`git diff` vacío, confirmado) y los 8
pasan.

Sobre el arreglo en sí: `closeRound` ahora relee `Round.closedAt` y
`Round.deadline` con `tx.round.findUnique` como primera instrucción dentro de
su transacción, y aborta con `CloseRoundGuardFailedError` (con una razón
tipada: `not_found`/`already_closed`/`not_due`) si cualquiera de las dos
guardas falla contra el estado fresco. Verifiqué que **no cambia el camino no
concurrente**: los 12 tests de `tests/cierre-de-ronda.test.ts` (criterios
15-22, aprobados en H4) siguen en verde sin ninguna modificación —
en particular AC-17 ("rechaza cerrar una ronda que ya está cerrada") sigue
dando exactamente el mismo mensaje ("La ronda ya está cerrada") que antes.
Comparé además, línea por línea, los tres mensajes del atajo de fuera
(`round-actions.ts:180-192`) contra los tres del `catch` de dentro
(`round-actions.ts:275-287`): son las mismas tres cadenas exactas, así que el
caso no concurrente no puede notar la diferencia. El test del doble cierre
confirma **un solo** `CLOSE_ROUND` en `AuditLog` tras la carrera — el segundo
intento nunca escribe.

## 4. El `catch` acotado en los tres sitios — sin solape entre errores

Inyecté fallos de DB genéricos dentro de las tres transacciones (con el
mismo mecanismo que usé para D5) y comprobé que ninguno se traduce al mensaje
de guarda: en `reportResult` y `declareWalkover`, un `Error` sin relación se
propaga tal cual (confirmado con `rejects.toThrow` sobre el mensaje
inyectado, tests del criterio 3 del builder, que repetí y pasan). En
`declareWalkover` hay ahora **dos** sentinelas
(`RoundClosedDuringTransactionError` y `WalkoverBlockedByPlayedResultError`)
en el mismo `catch`: leí el orden — se comprueba primero
`RoundClosedDuringTransactionError`, luego `WalkoverBlockedByPlayedResultError`,
y solo si ninguna de las dos aplica se relanza el error tal cual. Como son
clases distintas y `instanceof` es una comprobación de tipo exacta (no hay
herencia entre ellas — ambas extienden `Error` directamente, no una de la
otra), no hay solape posible: un error de un tipo nunca puede ser capturado
por la rama del otro.

## 5. Fallo antes del fix — confirmado, no solo de palabra

Además de la reproducción del punto 3 (que ya cubre los criterios 1, 2 y el
doble cierre), confirmé que los tests de los criterios 3 y 4 **pasan también
contra el código viejo** — es el resultado correcto y esperado: el criterio 3
(propagación de errores genéricos) y el criterio 4 (override del admin) no
ejercitan el defecto que este commit corrige, así que no tienen por qué
fallar sin el fix. El informe del builder es preciso al decir que fallan
"los criterios 1, 2 y doble cierre", no los 8.

## 6. Criterio 4 — override del admin, confirmado tras el endurecimiento

`tests/endurecer-guardas-transaccionales.test.ts` líneas 317-388: el admin
cierra la ronda, luego edita con `reportResult` (o declara con
`declareWalkover`) sobre esa misma ronda cerrada — ambas tienen éxito, y
`round.closedAt` sigue sin ser `null` después (no se reabre). Ejecutados
ambos, pasan.

## Sobre el arreglo del timeout intermitente (`12fd4b0`)

Correcto, y el enfoque adecuado: el test H1-AC4 lanza el seed real vía
`execSync("npx tsx prisma/seed.ts", ...)` de forma síncrona porque el
criterio exige comprobar la salida real del seed, no una reimplementación.
Medir ~5,4 s contra un timeout de 5 s es un problema del *presupuesto de
tiempo* del test, no de su corrección — subir el tercer argumento de `it()` a
`30_000` es la vía correcta de Vitest para esto, y no toca ninguna aserción
ni debilita lo que el test comprueba (sigue comparando el `startMonth` exacto
y `matchesPerRound` reales tras ejecutar el seed de verdad). Lo confirmé
ejecutando la suite completa **tres veces seguidas**: 430/430 estable en las
tres, sin ninguna señal de intermitencia.

## Regresión

- `npm run lint` → **0 errores, 0 warnings**.
- `npm run test` → ejecutado **tres veces**: `Test Files 13 passed (13)` /
  `Tests 430 passed (430)` en las tres corridas, sin intermitencia.
- `npm run build` → compila, 20 rutas, sin errores.
- `npm run e2e` → ejecutado **dos veces**: **37 pasan, 1 skipped** en ambas,
  idéntico al baseline.

## Bloqueantes

Ninguno.

## Sugerencias (no bloqueantes)

1. **(Punto 2)** `generateLeagueMatches` computa el reparto
   (`roundRobinRounds`/`deriveDeadlines`) con una foto de
   `startMonth`/`matchesPerRound`/jugadores activos tomada antes de abrir la
   transacción. Es admin-vs-admin y autocorregible (basta con regenerar), no
   un bypass de ninguna garantía de competición, así que no lo trato como
   bloqueante — pero documentarlo explícitamente (un comentario junto a la
   lectura de `players`/`league`) evitaría que alguien lo confunda con un
   descuido si se audita de nuevo más adelante.
2. Cuando H9 añada la precondición de §4.11 ("todas las rondas cerradas") a
   `startPlayoffs`, aplicar el mismo criterio de este hito: si esa
   comprobación decide con datos leídos antes de la transacción, releerla
   dentro con el mismo patrón (`tx`, error tipado, `instanceof`).
3. El `payload` de `AuditLog` en `updateRoundDeadline` guarda
   `previousDeadline` a partir de una lectura previa a la transacción; bajo
   una carrera con otro `updateRoundDeadline` concurrente sobre la misma
   ronda, ese campo del log podría no reflejar el valor inmediatamente
   anterior real. Es una imprecisión cosmética del audit trail, no una
   guarda burlable — no bloqueante, pero vale la pena saberlo si algún día se
   audita el historial de cambios de fecha con precisión.
