# PLAN — multi-liga

**Spec**: `plan/specs/multi-liga.md` (`APPROVED`, v7, 47 criterios de aceptación).
**Contexto global**: `SPEC.md`.

Plan organizado en **lanes paralelos**. Los hitos se derivan de los criterios de
aceptación de la spec; cada hito declara cuáles cierra, y la cobertura completa
está al final (§Cobertura).

```
  ┌── C0 ── C1 ── C2 ──┐                        cimientos (secuencial)
                       │
                       ├── A1 ── A2 ─────┐      lane A · rutas de jugador
                       ├── B1 ── B2 ─────┤      lane B · admin
                       ├── C3 ── C4 ─────┼── Z1 ── Z2   cierre
                       ├── D1 ── D2 ─────┤      lane D · ciclo de vida
                       └── E1 ── E2 ─────┘      lane E · bases
```

## Restricción que atraviesa todos los lanes

**§7.1 de la spec — continuidad en producción.** Un usuario de producción no debe
notar el cambio más allá de que le cambie la URL: ni volver a iniciar sesión, ni
perder un marcador, ni leer algo distinto. Ningún hito puede cerrarse rompiendo
esto. En todo momento: `SessionPayload` sigue siendo `{ playerId, role }`, las
rutas antiguas siguen respondiendo, y la migración es aditiva.

## Regla de contrato

La spec es el contrato. Si durante la implementación aparece algo que la spec no
contempla o que la contradice, **no se decide en el lane**: se para y se resuelve
en `/specs`. Vale especialmente para las tres invariantes que sostienen la
feature: la liga nunca viaja en la cookie, el actor de una acción de admin es
siempre un `Player` de la misma liga, y ninguna consulta de datos de liga va sin
`leagueId`.

---

# Cómo se trabaja en paralelo

## Ramas

- Rama de integración: `feat/multi-liga`. Los cimientos se construyen aquí.
- Cada lane sale de `feat/multi-liga` **cuando C2 está mergeado**, en su propia
  rama: `feat/multi-liga-a-rutas-jugador`, `-b-admin`, `-c-identidad`,
  `-d-ciclo-vida`, `-e-bases`.
- Cada lane vuelve a `feat/multi-liga` por su cuenta, en cuanto pasa su review.
  No hay orden entre lanes.
- Un lane que lleve tiempo abierto rebasa sobre `feat/multi-liga`; no al revés.

## Propiedad de ficheros

Esta tabla es lo que hace que los lanes no se pisen. **Un fichero tiene un solo
dueño.** Si un lane necesita tocar un fichero ajeno, para y se habla: es señal de
que el reparto está mal o de que falta algo en los cimientos.

| Fichero / zona | Dueño |
|---|---|
| `prisma/schema.prisma`, migraciones | C0 (cimientos) |
| `src/server/slug.ts` | C0 |
| `src/lib/league-context.ts` | C1 (cimientos) |
| `src/server/league/*.ts` (módulos nuevos) | C1 crea, luego un lane por módulo |
| `src/app/liga/[slug]/layout.tsx` | C2 lo crea; **tras C2 pasa a A** |
| `src/app/admin/[slug]/layout.tsx` | C2 lo crea; **tras C2 pasa a B** |
| `src/lib/league-context.ts` | C1 lo crea; **tras C2 queda congelado**: si un lane necesita cambiar una firma, para y se habla |
| `src/components/LeagueIndicator.tsx`, `LeagueNotFoundScreen.tsx` | C2 los crea; **tras C2 pasan a B** |
| `src/app/liga/[slug]/{clasificacion,calendario,rondas,bracket,mis-partidas}` | **A** |
| Rutas antiguas de jugador (redirecciones) | **A** |
| `src/app/admin/page.tsx`, `src/app/admin/[slug]/{liga,jugadores,emparejamientos,rondas,playoffs}` | **B** |
| `src/components/AppHeader.tsx`, `AdminMenu.tsx` | **B** |
| `src/server/league/config.ts` (`updateLeague`) | **B** |
| `src/app/api/auth/*`, `src/lib/auth.ts` | **C** |
| `src/server/result-actions.ts` | **C** |
| `src/server/league/players.ts` | **C** |
| `src/components/AppHeaderUser.tsx`, `src/app/mi-perfil` | **C** |
| `src/server/league/lifecycle.ts` | **D** |
| `src/app/admin/nueva/*`, UI de archivar/duplicar/borrar en el índice | **D** |
| `src/server/league/rules.ts`, plantilla de bases | **E** |
| `src/app/liga/[slug]/bases`, `src/app/admin/[slug]/bases`, `src/app/bases` | **E** |
| `prisma/seed.ts`, `tests/e2e/*` | **Z** (cierre) |

Choque conocido y resuelto en cimientos: `src/app/admin/page.tsx` lo necesitan B
(índice, contadores por liga) y D (botones de archivar/duplicar/borrar). Lo
**posee B**; D aporta sus acciones como componentes propios en
`src/components/admin/`, que B monta desde el índice. El contrato de esos
componentes se fija en C2.

---

# Cimientos — secuencial, bloquea todos los lanes

Tres hitos que no cambian ningún comportamiento visible. Su única razón de ser es
que después cinco lanes puedan avanzar sin tocarse.

## C0 — `modelo-liga-slug-archivado`

**Objetivo.** Poner en el esquema lo que todos los lanes necesitan.

**Alcance.**
- `prisma/schema.prisma`, modelo `League`: `slug String @unique`,
  `archivedAt DateTime?`, `rulesMarkdown String @default("")`.
- Migración aditiva con backfill de `slug`; `archivedAt` a `null`;
  `rulesMarkdown` con la plantilla por defecto (fichero de plantilla creado aquí
  vacío de contenido definitivo — E lo rellena con el texto extraído).
- `src/server/slug.ts`: `slugify(name, season)` y `uniqueSlug(base, taken)`
  puras. Kebab-case ASCII, sin tildes, sufijo numérico ante colisión.

**Criterios de la spec que cierra.** 19, 20, 41, 47.

**Criterios de aceptación del hito.**
1. `slugify("Liga de los Martes", "Primavera 2026")` →
   `liga-de-los-martes-primavera-2026`.
2. `uniqueSlug` sobre un slug tomado devuelve `-2`, y `-3` si también lo está.
3. Sobre copia de la base actual, la liga existente queda con `slug` no vacío,
   `archivedAt` a `null` y `rulesMarkdown` no vacío.
4. La migración no contiene `DELETE` ni `UPDATE` de columnas preexistentes.
5. `npm run build` y `npm run test` pasan: nadie lee aún los campos nuevos.

## C1 — `contexto-de-liga-y-modulos`

**Objetivo.** Publicar los contratos que los cinco lanes van a consumir, y partir
el fichero que sería el mayor foco de conflictos.

**Alcance.**
- `src/lib/league-context.ts` con la implementación real y sus tests:
  - `resolveLeagueBySlug(slug)` → liga o `null`;
  - `requireLeagueAccess(slug, session)` → liga, o la redirección de §4.2
    (jugador a la suya en silencio, admin a cualquiera);
  - `assertLeagueWritable(league)` → error si `archivedAt` no es nulo;
  - `resolveActingPlayerId(leagueId, session)` → `playerId` del jugador, o el
    `Player` con `role = ADMIN` de esa liga si la sesión es de admin.
- **Cablear `assertLeagueWritable` en las 16 acciones de escritura** que enumera
  §5.6 de la spec. Hoy no rechaza nada porque ninguna liga está archivada: el
  comportamiento no cambia, pero D no tendrá que tocar cinco ficheros ajenos
  después.
- Partir `src/server/league-actions.ts` en `src/server/league/{config,players,lifecycle,rules}.ts`,
  reexportando desde el módulo viejo para no romper ningún import. Movimiento
  puro, sin cambios de lógica.

**Criterios de la spec que cierra.** Ninguno por sí solo: habilita 5, 6, 9, 11,
12, 23.

**Criterios de aceptación del hito.**
1. Los cuatro helpers tienen test unitario con liga propia, ajena, archivada e
   inexistente.
2. `assertLeagueWritable` aparece en las 16 acciones de §5.6.
3. `git diff` del split no muestra cambios de lógica: solo movimientos e
   imports.
4. `npm run test` pasa sin tocar ningún test existente.

## C2 — `andamiaje-de-rutas`

**Objetivo.** Que las carpetas con `[slug]` existan y validen el parámetro antes
de que cinco lanes empiecen a meter páginas dentro.

**Alcance.**
- `src/app/liga/[slug]/layout.tsx` y `src/app/admin/[slug]/layout.tsx`:
  resolución del slug y guarda de acceso vía C1, cabecera con el indicador de
  liga, y el manejo de slug que no resuelve.
- Contrato de los componentes de acción del índice de admin que D va a aportar y
  B va a montar (props y firma, sin implementación).

**Criterios de la spec que cierra.** Ninguno por sí solo: habilita 1-9, 33-40.

**Criterios de aceptación del hito.**
1. Una página de prueba bajo `/liga/[slug]/` recibe la liga ya resuelta.
2. Un slug inexistente no llega nunca al cuerpo de la página.
3. Los layouts no consultan la base más de una vez por petición.
4. `npm run build` pasa con las carpetas nuevas vacías de páginas reales.

---

# Lane A — Rutas de jugador

Sale de `feat/multi-liga` tras C2. No depende de ningún otro lane.

## A1 — `vistas-de-jugador-con-slug`

**Alcance.** Mover `clasificacion`, `calendario`, `rondas`, `bracket` y
`mis-partidas` a `/liga/[slug]/…`, eliminando el `findFirst` de las cinco y
tomando la liga del layout de C2.

**Criterios de la spec que cierra.** 1, 2, 3, 4.

**Criterios de aceptación del hito.**
1. `grep -rn "league.findFirst"` sobre esas cinco rutas no devuelve nada.
2. Con dos ligas sembradas, la clasificación de A contiene exactamente los
   jugadores de A.
3. La clasificación de A con dos ligas en base es idéntica, fila a fila, a la
   calculada con A como única liga.
4. Crear la liga B no altera ninguna de las cinco vistas de un jugador de A.

## A2 — `redirecciones-de-rutas-antiguas`

**Alcance.** `/clasificacion`, `/calendario`, `/rondas`, `/bracket` y
`/mis-partidas` pasan a redirigir resolviendo el slug como manda §4.3:
`cookie.playerId → Player.leagueId → League.slug`. Admin corta antes y va a
`/admin`; sin sesión, a `/login`.

**Criterios de la spec que cierra.** 5, 6, 7, 46.

**Criterios de aceptación del hito.**
1. Un jugador de A pidiendo `/liga/<slug-B>/clasificacion` acaba en la suya, sin
   mensaje.
2. Un slug inexistente produce para ese jugador exactamente la misma respuesta:
   no se distingue «no existe» de «no es tuya».
3. `/clasificacion` con sesión de jugador acaba en su equivalente con slug.
4. Con sesión previa al deploy, las cinco rutas antiguas llevan a la misma
   página dentro de su liga, sin pasos intermedios.
5. La redirección hace **una** consulta, y ninguna si la sesión es de admin o no
   hay sesión.

---

# Lane B — Admin: índice, rutas y renombrado

Sale de `feat/multi-liga` tras C2. No depende de ningún otro lane.

## B1 — `indice-de-ligas-y-pantallas-con-slug`

**Alcance.** `/admin` como índice (en circulación / archivadas, contadores **por
liga**); mover las cinco pantallas de admin a `/admin/[slug]/…` eliminando su
`findFirst`; `AppHeader` y `AdminMenu` construyendo rutas con el slug; montar los
componentes de acción que aporta D según el contrato de C2.

**Criterios de la spec que cierra.** 8, 9.

**Criterios de aceptación del hito.**
1. `grep -rn "league.findFirst" src/app` no devuelve ninguna línea.
2. `/clasificacion` con sesión de admin acaba en `/admin`.
3. El admin abre las pantallas de A y de B en la misma sesión, sin cerrar ni
   reabrir nada, y cada una lista su roster.
4. El contador de cada tarjeta coincide con los jugadores activos de esa liga,
   no con el total (hoy `admin/page.tsx:29` cuenta global).
5. La cabecera indica la liga del contexto.

## B2 — `renombrado-y-liga-no-encontrada`

**Alcance.** `updateLeague` (ahora en `src/server/league/config.ts`) recalcula el
slug al cambiar `name` o `season`, aplicando `uniqueSlug`. Pantalla de «esa liga
no existe» para el admin, con la lista de ligas disponibles.

**Criterios de la spec que cierra.** 21.

**Criterios de aceptación del hito.**
1. Renombrar cambia el slug y la URL nueva resuelve.
2. El slug anterior deja de resolver y el admin ve la pantalla con la lista, no
   un 404 seco.
3. Renombrar hasta colisionar con otra liga no falla: desambigua con sufijo.
4. Un jugador que llega al slug viejo sigue acabando en su liga, sin ver la
   pantalla del admin.

---

# Lane C — Identidad, actor y nombres

Sale de `feat/multi-liga` tras C2. No depende de ningún otro lane.

## C3 — `sesion-de-admin-sin-playerid`

**Alcance.** `POST /api/auth/login-admin` deja de resolver `playerId`
(`route.ts:35`) y firma con `playerId: null`. El actor pasa a derivarse por liga
con `resolveActingPlayerId` de C1, en `Result.reportedById`
(`result-actions.ts:279`, `:298`) y `AuditLog.actorId` (`:314`, `:646`).
`/mi-perfil` con sesión de admin redirige a `/admin`. `AppHeaderUser` funciona
con `playerId: null`.

**Criterios de la spec que cierra.** 10, 11, 12.

**Criterios de aceptación del hito.**
1. Tras el login de admin, el payload del JWT lleva `playerId: null`.
2. Un resultado apuntado por el admin en la liga B tiene `reportedById`
   apuntando a un `Player` cuyo `leagueId` es el de B.
3. El `AuditLog` de esa acción tiene `actorId` apuntando a ese mismo `Player`.
4. `/mi-perfil` con sesión de admin redirige en vez de reventar.
5. La cabecera con sesión de admin renderiza sin `playerId`.

## C4 — `nombres-unicos-y-login`

**Alcance.** La comprobación de `displayName` pasa de intra-liga
(`league-actions.ts:213`, ahora `league/players.ts`) a global entre ligas **no
archivadas**, exigida solo entre filas con `role = PLAYER`, en un punto único que
consumirán también D (duplicación) y B. `verifyPlayerPasscode`
(`src/lib/auth.ts:56`) añade `role: "PLAYER"` y liga no archivada.
`deletePlayer` rechaza borrar al `Player` ADMIN de una liga.

**Criterios de la spec que cierra.** 14, 15, 16, 17, 18.

**Criterios de aceptación del hito.**
1. Alta en B de un nombre ya usado en A (en circulación): error en el campo, sin
   crear fila.
2. Ese mismo alta funciona si la liga que tenía el nombre está archivada.
3. Con «Javi» en archivada y «Javi» en circulación, el login entra en la de
   circulación.
4. Un jugador de liga archivada no inicia sesión, con el error genérico.
5. El admin, con fila homónima en cada liga, no rompe ninguna comprobación.
6. `deletePlayer` sobre el `Player` ADMIN devuelve error y la fila sigue ahí.

---

# Lane D — Ciclo de vida de la liga

Sale de `feat/multi-liga` tras C2. Consume `assertLeagueWritable`, ya cableado en
C1, y el punto único de unicidad de nombres de C4 — mientras C4 no esté, D usa la
comprobación vieja y la cambia en el merge. Es la única dependencia blanda entre
lanes, y está acotada a una llamada.

## D1 — `archivado-de-ligas`

**Alcance.** `archiveLeague` / `unarchiveLeague` en `league/lifecycle.ts`.
Desarchivar falla listando los nombres en conflicto. Un jugador con sesión
abierta cuya liga se archiva vuelve a `/login`. Componentes de acción de
archivar/desarchivar para el índice, según el contrato de C2.

**Criterios de la spec que cierra.** 22, 23, 24, 25.

**Criterios de aceptación del hito.**
1. Archivar saca la liga del bloque de circulación y la deja en el de
   archivadas.
2. Cada una de las acciones de escritura de §5.6, invocada **directamente**
   sobre una liga archivada, devuelve error y no modifica nada.
3. Un jugador con sesión abierta cuya liga se archiva acaba en `/login` en su
   siguiente petición.
4. Desarchivar con nombres en conflicto falla, los lista todos y deja
   `archivedAt` sin tocar.
5. El admin puede leer todas las pantallas de una liga archivada.

## D2 — `crear-duplicar-borrar`

**Alcance.** `/admin/nueva` (creación en blanco, que además crea el `Player` con
`role = ADMIN` en la misma transacción, con nombre precargado del de la liga en
circulación más reciente). `duplicateLeague`: copia configuración y la prosa de
las bases; el roster **solo si el origen está archivado**, con passcodes nuevos
listados una vez; atómica. `deleteLeague`: solo con `status = SETUP` y cero
`Match`.

**Criterios de la spec que cierra.** 13, 26, 27, 28, 29, 30, 31, 32.

**Criterios de aceptación del hito.**
1. Toda liga creada —en blanco o duplicada— contiene exactamente un `Player` con
   `role = ADMIN`.
2. Duplicar una liga archivada produce una liga en `SETUP` con la misma
   configuración y una fila `Player` por jugador **activo** del origen.
3. Esa liga destino tiene cero `Match`, cero `Round` y ningún `Bracket`.
4. Los jugadores duplicados tienen `passcodeHash` distinto del de su origen, y
   la pantalla final lista los pares nombre + passcode una sola vez.
5. Duplicar una liga en circulación crea la liga con la configuración copiada y
   sin jugadores más allá del ADMIN.
6. Si la duplicación falla a mitad, no queda ni liga ni jugador creados.
7. Borrar una liga en `SETUP` sin partidas la elimina junto a sus jugadores.
8. Borrar una liga con al menos una partida falla y conserva sus datos.

---

# Lane E — Bases

Sale de `feat/multi-liga` tras C2. No depende de ningún otro lane.

## E1 — `bases-por-liga`

**Alcance.** Extraer el texto actual de `src/app/bases/page.tsx` (259 líneas de
JSX fijo) a la plantilla por defecto de `rulesMarkdown`, quitando lo que pasa a
generarse. `/liga/[slug]/bases`, **pública**: bloque generado desde `League`
(puntuación, bonus, orden real de `tiebreakers`, `matchesPerRound`,
`playoffSize`) + prosa renderizada con la maqueta actual.
`/admin/[slug]/bases`: `textarea` markdown con vista previa y `updateLeagueRules`,
bloqueado sobre liga archivada.

**Criterios de la spec que cierra.** 33, 35, 36, 37, 38, 39, 45.

**Criterios de aceptación del hito.**
1. Las bases de A y de B devuelven textos distintos y ninguna menciona datos de
   la otra.
2. Cambiar `pointsWin` de 3 a 2 cambia el bloque de puntuación sin editar ningún
   texto. Ídem `matchesPerRound`, `playoffSize`, `bonusEnabled` y el orden de
   `tiebreakers`.
3. Editar la prosa de A cambia las bases de A y no las de B.
4. Con la prosa vacía, la página sigue en pie con solo el bloque generado.
5. Las bases de una liga archivada se leen; guardarlas falla.
6. La página renderizada tras la migración dice lo mismo que dice hoy
   `src/app/bases/page.tsx`: mismas secciones y mismos valores.

## E2 — `bases-publicas-y-ruta-antigua`

**Alcance.** `/liga/[slug]/bases` accesible **sin sesión**. `/bases` a secas:
jugador → las suyas; admin → `/admin`; sin sesión y una sola liga en circulación
→ **las bases de esa liga**; sin sesión y dos o más → página que pide el enlace
concreto. Nunca lista ligas.

**Criterios de la spec que cierra.** 34, 40, 44.

**Criterios de aceptación del hito.**
1. Las bases de A y de B responden sin sesión, con 200.
2. `/bases` sin sesión, con una sola liga en circulación, devuelve 200 con las
   bases de esa liga, no una redirección a `/login`.
3. Con dos ligas en circulación y sin sesión, `/bases` pide el enlace concreto.
4. `/bases` no lista ligas en ningún caso, con o sin sesión.

---

# Cierre — secuencial, tras el merge de los cinco lanes

## Z1 — `seed-y-e2e-con-dos-ligas`

**Alcance.** `prisma/seed.ts` y `tests/e2e/seed-e2e.ts` con dos ligas de rosters
disjuntos y el admin en ambas. `tests/e2e/*` con las rutas nuevas, más un
recorrido de admin que salta entre ligas.

**Criterios de la spec que cierra.** 42.

**Criterios de aceptación del hito.**
1. El seed produce dos ligas con rosters disjuntos y un `Player` ADMIN en cada
   una.
2. Los e2e pasan con las dos ligas sembradas.
3. `npm run test` pasa entera.

## Z2 — `auditoria-de-continuidad`

**Alcance.** Demostrar §7.1, no asumirla. Test de que una cookie firmada con el
payload anterior al deploy sigue siendo aceptada, y repaso de la tabla de §7.1
punto por punto.

**Criterios de la spec que cierra.** 43, 46 (refuerzo), 47 (verificación final).

**Criterios de aceptación del hito.**
1. Una cookie firmada con `{ playerId, role }` antes del cambio sigue siendo
   válida: el jugador no vuelve a ver el login.
2. Con sesión previa, cada una de las cinco rutas antiguas lleva a la misma
   página dentro de su liga, sin pasos intermedios.
3. `/bases` sin sesión sigue respondiendo 200 con una sola liga.
4. La migración no borra ni reescribe ninguna fila preexistente.
5. La tabla de §7.1 queda repasada punto por punto, con el resultado anotado en
   la review del hito.

---

## Cobertura de los 47 criterios de la spec

| Criterios | Hito |
|---|---|
| 1, 2, 3, 4 | A1 |
| 5, 6, 7 | A2 |
| 8, 9 | B1 |
| 10, 11, 12 | C3 |
| 13 | D2 |
| 14, 15, 16, 17, 18 | C4 |
| 19, 20 | C0 |
| 21 | B2 |
| 22, 23, 24, 25 | D1 |
| 26–32 | D2 |
| 33, 35, 36, 37, 38, 39 | E1 |
| 34, 40, 44 | E2 |
| 41, 47 | C0 (verificación final en Z2) |
| 42 | Z1 |
| 43 | Z2 |
| 45 | E1 |
| 46 | A2 · Z2 |

Ningún criterio de la spec queda sin hito.

## Suposiciones de este plan, que la spec no fija

1. **Partir `src/server/league-actions.ts`** en `src/server/league/{config,players,lifecycle,rules}.ts`
   (C1). La spec lo nombra como fichero a tocar; el split es decisión de este
   plan, y existe para que cuatro lanes no se peleen por un fichero de 500+
   líneas. Es un movimiento puro, sin cambio de lógica.
2. **Cablear `assertLeagueWritable` en C1**, antes de que exista el archivado.
   No cambia comportamiento (ninguna liga está archivada todavía) y evita que D
   tenga que editar cinco ficheros que pertenecen a otros lanes.
3. **Los componentes de acción del índice de admin los aporta D y los monta B**,
   con el contrato fijado en C2. Es la forma de que `admin/page.tsx` tenga un
   solo dueño.

## Hallazgos de los cimientos, ya implementados

Los recoge aquí el plan para que ningún lane los redescubra ni los deshaga.

1. **`League.slug` lleva `@default(cuid())`** como red de seguridad, no como
   fuente de slugs reales. Existe porque una decena de ficheros de test crean
   `League` sin pasar slug y la constraint `NOT NULL UNIQUE` los rompería.
   `createLeague` y `duplicateLeague` (lane D) **siempre** calculan y pasan el
   slug explícitamente: en el camino de producción ese default es código muerto.
   Ningún lane debe apoyarse en él.
2. **`confirmResult` no existe en el código.** §5.6 de la spec lo enumera entre
   las acciones de escritura, pero el flujo de confirmación del rival quedó
   superseded por el Hito 15 de `rondas-con-fecha` (`result-actions.ts`: "No hay
   confirmación del rival"). C1 guardó `reportResult`, y añadió además
   `declareWalkover`, que la spec no nombra pero comparte fichero y patrón con
   `reportResult`: sin ella, el criterio 23 quedaría en falso. La spec queda
   desactualizada en ese punto; es un error de la lista, no de la regla.
3. **`requireLeagueAccess` admite un tercer parámetro `samePagePath`**, añadido
   en C1 para que el lane A pueda preservar la página exacta en la redirección
   silenciosa (criterio 5) sin tocar los layouts.
4. **`/liga/[slug]/layout.tsx` no exige sesión de forma incondicional**, a
   diferencia de `/admin/[slug]`. Es deliberado: `/liga/[slug]/bases` (lane E)
   tiene que seguir siendo pública. Cada página protegida bajo ese layout llama
   a `requireAuth` por su cuenta, igual que hacen hoy las páginas sin slug.
5. **`resolveLeagueBySlug` va envuelta en `React.cache()`** para deduplicar la
   consulta entre layout y página dentro de la misma petición.
6. **La pantalla de «liga no encontrada» del admin es mínima** y no lista las
   ligas disponibles todavía. Completarla es exactamente el criterio 21, que
   pertenece a B2.
