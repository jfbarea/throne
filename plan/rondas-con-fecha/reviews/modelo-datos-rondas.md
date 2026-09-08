# Review — H1 `modelo-datos-rondas`

**Commit revisado:** `2bf830c` (código) + `205a9b5` (estado). `cda2d69` es
posterior y ajeno a H1 (fix de aserciones e2e preexistentes) — no se revisa
aquí, se confirma solo que explica por qué `npm run e2e` está verde ahora.

## Veredicto: CHANGES_REQUESTED

El esquema, la migración, el seed y los tests de H1 son correctos y cumplen
la spec §6.2 al pie de la letra en todo excepto un punto. Ese punto es
suficiente para no cerrar el hito tal cual, porque es exactamente el tipo de
situación que el propio plan dice que hay que parar y escalar, no decidir en
el código.

## Bloqueantes (must-fix)

1. **`League.startMonth @default(now())` contradice la spec y se decidió en
   el código en vez de escalarse — `prisma/schema.prisma:103`.**
   La spec (§6.2) muestra el bloque Prisma exacto de los campos nuevos de
   `League` y es deliberada en el contraste: `matchesPerRound Int
   @default(2)` lleva default (el texto dice "por defecto 2"); `startMonth
   DateTime` no lleva ninguno. No es un olvido de la spec, es una ausencia
   intencional: `startMonth` es un dato real que siempre debe llegar del
   admin, nunca un valor calculado. Añadir `@default(now())` reintroduce
   silenciosamente un default que la spec explícitamente no contempla para
   ese campo, y el propio PLAN.md dice: *"Si durante la implementación
   aparece algo que no contempla o que la contradice, el builder para y lo
   escala; no se decide aquí ni en el código"* (línea 6-8). El builder lo
   documentó con mucha transparencia (commit message, notas de
   `_state.json`), pero documentar no sustituye a escalar: implementó la
   desviación en vez de pararse en `/specs` antes de tocar el schema.
   He verificado que el problema que dice tener es real — sin el default,
   `npm run build` rompe exactamente como describe (reproducido quitando
   `@default(now())` del schema: `src/server/league-actions.ts:55` falla en
   TypeScript porque `startMonth` pasa a ser obligatorio en
   `LeagueCreateInput` y `createLeague` no lo proporciona). El conflicto es
   genuino: H1 no puede tocar `src/server/`, la spec no admite un default, y
   el build tiene que quedar verde en cada commit. Precisamente por ser un
   conflicto genuino entre dos restricciones del propio plan, la resolución
   no le corresponde al código: es un caso de manual para `/specs`.

   Además, nada obliga a H3 a quitarlo:
   - `plan/rondas-con-fecha/PLAN.md` (H3, líneas 130-136) solo dice que
     `updateLeague` "acepta los dos campos" nuevos. No menciona
     `createLeague` en ningún momento. Si H3 se implementa literalmente como
     está descrito, toda liga nueva seguirá naciendo con
     `startMonth = now()` (un timestamp con hora, no "el primer día del mes
     a medianoche" que exige la spec) y quedará así hasta que el admin
     entre a editar la configuración y la guarde de nuevo vía
     `updateLeague`. Esto no es un caso límite raro: es el flujo normal de
     "crear liga" si nadie actualiza explícitamente el ticket de H3 para
     que `createLeague` también reciba `startMonth`.
   - No hay ningún test que documente esta expiración ni que falle si el
     default sigue presente después de H3. Es deuda sin gancho que la
     recoja.

   **Qué corregir:** no proponer un parche en código. Escalar a `/specs`
   antes de continuar: decidir si el spec admite explícitamente un valor de
   arranque transitorio para `startMonth` (y con qué semántica — no
   "ahora mismo", sino algo que preserve la invariante "primer día del mes a
   medianoche", p. ej. el primer día del mes de creación) y, si se admite,
   dejar registrado en la propia spec y en el H3 del PLAN.md que
   `createLeague` también debe fijar `startMonth`/`matchesPerRound` y que el
   default de bootstrap se retira en ese hito. Sin esa constancia escrita,
   apruebo el riesgo de que este default sea invisible y permanente.

## Sugerencias (nice-to-have)

1. `tests/modelo-datos-rondas.test.ts:235` — el test de H1-AC4 solo comprueba
   `toBeInstanceOf(Date)` para `startMonth`. Ya que el seed fija un valor
   determinista (`new Date(Date.UTC(2026, 2, 1))`), el test ganaría
   precisión comprobando el valor exacto en vez de solo el tipo.
2. Documentar en el propio `prisma/schema.prisma` (junto al comentario que ya
   explica el default transitorio) el commit/hito exacto donde se espera que
   se retire, para que quien lea el schema en H4 o H5 no tenga que ir a buscar
   el commit de H1 para enterarse.

## Riesgos

- Si el proceso de escalado a `/specs` decide mantener un default
  transitorio, el riesgo real de que una liga de producción quede con
  `startMonth` incorrecto es bajo mientras el desarrollo viva en la rama
  `feat/rondas-con-fecha` sin desplegarse a `main` hasta que la feature esté
  completa (no hay exposición intermedia). El riesgo se activa si en algún
  momento se decide mergear hitos parciales a `main`, o si H3 no actualiza
  `createLeague` como se señala arriba.
- Ninguno de los demás hallazgos de la revisión representa riesgo: schema,
  migración, seed, aislamiento de `test.db`/`dev.db`/`e2e.db`, alcance
  (`git show 2bf830c --stat` confirma que no toca `src/server/` ni
  `src/app/`) y los 5 criterios de aceptación del hito, cada uno con su
  `describe("H1-ACn: …")` y verificados contra la DB de test real (el test
  de `@@unique` espera de verdad `P2002`, no lo simula). `npm run lint`,
  `npm run test` (256/256) y `npm run build` verdes, reproducidos en esta
  revisión. `npm run e2e` verde (37 pasan, 1 skipped) gracias a `cda2d69`,
  confirmado ajeno a H1 (el fallo era preexistente en `caddbc0`, antes de
  cualquier commit de esta feature).

---

## Re-review — fix del bloqueante (`b11cff0`)

**Alcance de esta pasada:** solo el fix del bloqueante D1 (`startMonth`
nullable en vez de `@default(now())`). No se ha vuelto a auditar en detalle
lo ya aprobado en la primera vuelta (schema base, migración de H1, seed,
aislamiento de `test.db`, criterios H1-AC1 a H1-AC3), que sigue en pie.

### Veredicto: APPROVED

### 1. ¿Es correcta la decisión de hacer `startMonth` nullable?

Sí. Nullable es mejor que el `@default(now())` original en el punto exacto
que motivó el bloqueante: convierte "no configurado todavía" en un estado
explícito (`null`) en vez de un valor calculado que se hacía pasar por dato
real (`now()`, con hora, violando "primer día del mes a medianoche" de
§6.2). No es una alternativa "mejor decidida en código" del mismo tipo de
problema — es la salida que no necesita escalar a `/specs` porque la spec
no dice nada sobre la nulabilidad del campo (silencio, no contradicción), y
la ausencia de mes de arranque en una liga en `SETUP` es coherente con §4.4
("mientras no haya mes de arranque, no hay nada que derivar"). Estoy de
acuerdo con el criterio y con dejarlo registrado como D1 en la tabla de
desviaciones de `PLAN.md` en vez de tocar la spec `APPROVED` — es proporcionado
al tamaño real del cambio (una anotación de nulabilidad, no una regla de
producto nueva).

Sobre la pregunta concreta — **¿hay alguna ruta por la que un `startMonth`
nulo llegue a un cálculo de fechas y reviente en runtime en vez de fallar
limpio?** — en el estado actual del árbol, no: confirmé con
`grep -rn "startMonth"` que ningún fichero de `src/app/` ni `src/server/`
lee ese campo todavía (los únicos usos son `prisma/seed.ts`,
`tests/e2e/seed-e2e.ts`, `tests/modelo-datos-rondas.test.ts` y el cliente
Prisma generado). H1 solo puede introducir el estado, no consumirlo, tal
como dice el mensaje del coordinador, y así es en este commit. El riesgo se
traslada correctamente a H3, y el PLAN.md ya dice exactamente lo que hace
falta para cerrarlo ahí: `createLeague` tiene que fijar `startMonth`, y
`generateLeagueMatches` se niega si es `null`. Ese es el sitio correcto para
la guarda — la comprobaré en la review de H3 cuando llegue, en concreto que
el mensaje de error sea el que se ve primero (falla limpio) y no un
`TypeError` por desreferenciar `null` en `deriveDeadlines` o similar.

### 2. La migración

`prisma/migrations/20260908160808_make_start_month_nullable/migration.sql`:
mismo patrón `RedefineTables` de SQLite que la migración de H1. Confirmado
columna por columna:

- La `CREATE TABLE "new_League"` declara las mismas 16 columnas que la tabla
  `League` de la migración de H1, con el único cambio de
  `"startMonth" DATETIME` (sin `NOT NULL`, sin `DEFAULT`) frente a
  `"startMonth" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP`.
- El `INSERT INTO "new_League" (...) SELECT (...) FROM "League"` lista las
  16 columnas en ambos lados, incluida `startMonth` — no se pierde ningún
  valor existente, solo se relaja la restricción. No hay narrowing de tipo
  ni truncamiento.
- No toca `Match` ni `Result` (correcto: este fix es solo sobre `startMonth`).
  La migración original de H1 (`20260908154638_add_rounds_and_resolution`)
  se deja intacta, tal como dice el commit — nueva migración, no edición de
  la anterior.
- Reversible en el sentido estructural: relajar `NOT NULL` a nullable no
  pierde datos en ningún sentido; revertirla (volver a `NOT NULL`) sería el
  único caso con matices — exigiría backfill si ya hubiera filas `NULL` —
  pero no aplica hoy: no hay ninguna liga con `startMonth = NULL` en ningún
  entorno real todavía (rama sin mergear, y toda liga que exista hoy fue
  creada con el `@default(now())` de la versión anterior de H1 o con un
  valor explícito del seed).

**Sobre la cadena de migraciones desde cero:** no ejecuté
`npx prisma migrate reset` directamente — Prisma bloqueó el intento con su
guarda de seguridad para agentes de IA ("Prisma Migrate detected that it was
invoked by Claude Code… forbidden from performing this action without
explicit consent"), porque es un comando destructivo. No usé la variable de
entorno para saltármela: no tengo ese consentimiento explícito en esta
conversación, y no me correspondía dároslo yo mismo. En su lugar usé la vía
equivalente y no destructiva que ya ejecuta exactamente ese escenario:
`tests/db-global-setup.ts` borra `test.db` (y sus sidecars) y aplica
`prisma migrate deploy` contra una base vacía **antes de cada `npm run
test`**, es decir, aplica las cinco migraciones en orden
(`init` → `modelo_datos_dominio` → `remove_bracketslot_matchid` →
`add_rounds_and_resolution` → `make_start_month_nullable`) desde cero. Con
`npm run test` en verde (257/257, incluidos los 9 tests de
`modelo-datos-rondas.test.ts` contra esa base recién migrada) doy por
verificado que la secuencia completa deja el esquema coherente. Si el
coordinador quiere el resultado literal de `migrate reset`, hace falta que
el usuario dé el consentimiento explícito que pide la guarda.

### 3. Alcance: ¿se coló algo en `src/server/` o `src/app/`?

No. `git show b11cff0 --name-only` (verificado yo mismo, no de palabra del
builder):

```
prisma/migrations/20260908160808_make_start_month_nullable/migration.sql
prisma/schema.prisma
tests/modelo-datos-rondas.test.ts
```

Ningún fichero de `src/`.

### 4. Los tests nuevos

- **`describe("H1-AC4: startMonth es nullable…")`**: lo comprobé
  directamente, no de oídas. Revertí temporalmente `startMonth DateTime?` a
  `startMonth DateTime` en `prisma/schema.prisma` (dejando la migración/DB
  tal cual — solo el tipo del cliente), regeneré el cliente Prisma y corrí
  `npx vitest run tests/modelo-datos-rondas.test.ts`: el test nuevo falla
  con `PrismaClientValidationError: Argument startMonth is missing`; los
  otros 8 tests del fichero siguen en verde. Restauré el schema original
  (`git status` confirma cero diff tras restaurar) y volví a correr el
  fichero: 9/9 en verde de nuevo. El test sí falla si se restaura el
  `NOT NULL` — no es tautológico.
- **Test del seed**: ahora usa
  `expect(league?.startMonth).toEqual(new Date(Date.UTC(2026, 2, 1)))` en
  vez de `toBeInstanceOf(Date)` — sí es más estricto, compara el valor
  exacto que fija `prisma/seed.ts` (`LEAGUE_START_MONTH`), no solo el tipo.
  Aplica la sugerencia 1 de la primera vuelta.

### 5. Comentario del schema (sugerencia 2 de la primera vuelta)

Sin objeto, confirmado: ya no hay ningún `@default` transitorio que
documentar su retirada. El comentario nuevo (`prisma/schema.prisma:96-101`)
describe la semántica del `null` ("a league in SETUP has no starting month
until the admin sets one — there is no plausible computed default (§4.4)")
sin arrastrar ninguna referencia al `@default(now())` anterior ni a
`createLeague`/H3 (eso ahora vive correctamente en `PLAN.md`, no en el
schema). Bien.

### Regresión

Reproducido en esta pasada, sobre `b11cff0` (`HEAD` en el momento de la
revisión):

- `npm run lint` → limpio, sin salida de errores/warnings.
- `npm run test` → `Test Files 8 passed (8)` / `Tests 257 passed (257)`.
- `npm run build` → compila, typecheck y generación de páginas estáticas sin
  errores (misma lista de rutas que en la primera vuelta).

### Cierre de la segunda mitad del hallazgo original

Confirmado en `plan/rondas-con-fecha/PLAN.md` (sección H3, no modificada por
mí): `createLeague` pasa a estar obligado a fijar `startMonth`,
`generateLeagueMatches` se niega si es `null`, `updateLeague` normaliza al
primer día del mes a medianoche, y el criterio de aceptación de H3 añade
explícitamente el caso `startMonth = null`. Con eso, la vía por la que una
liga podía nacer y quedarse para siempre con un mes de arranque implícito
queda cerrada en el plan, no solo prometida en la nota de un commit. Lo
volveré a comprobar contra el código real cuando H3 llegue a review — por
ahora, en el plan está.
