# PLAN — throne

Plan de desarrollo incremental. Cada hito deja algo funcionando y debe poder
revisarse en menos de 30 minutos. Estado vivo en `plan/_state.json`.

Convenciones: código y comentarios en inglés; docs y mensajes en español;
commits convencionales; rama `main`. No empezar un hito sin que el anterior esté
en estado `done` y revisado.

---

## Hito 1 — `scaffold-minimo`

**Objetivo:** levantar el esqueleto Next.js + TypeScript + Tailwind + Prisma
(SQLite) con tooling de calidad, arrancable en local.

**Alcance:**

- `create-next-app` (App Router, TS), Tailwind con dark mode por defecto.
- Prisma instalado, `schema.prisma` con `datasource` SQLite vía `DATABASE_URL`,
  `prisma generate` y una migración vacía/inicial.
- ESLint + Prettier + Vitest configurados.
- `.env.example` con `DATABASE_URL`, `ADMIN_PASSCODE`, `SESSION_SECRET`.
- `README.md` en español con comandos de arranque.
- `CLAUDE.md` del proyecto rellenado (stack, comandos, estructura).

**Criterios de aceptación:**

- `npm install && npm run dev` arranca y sirve una página índice.
- `npx prisma migrate dev` corre sin error contra SQLite.
- `npm run lint` y `npm run test` pasan (aunque sea con tests triviales).
- `.env` real no está versionado; `.env.example` sí.

---

## Hito 2 — `modelo-datos-prisma`

**Objetivo:** plasmar el modelo de datos del SPEC en `schema.prisma` y migrar.

**Alcance:** modelos League, Player, Match, Result, Bracket, BracketSlot,
AuditLog con enums (`LeagueStatus`, `Role`, `MatchStatus`, `MatchPhase`,
`Outcome`) y relaciones de la sección 4 del SPEC. **No existe modelo `Round`**
(eliminado por ADR-007). El `Match` cuelga directamente de `League` (sin
`roundId`) y añade `scheduledAt` (DateTime nullable) y `location` (String
nullable); `isBye` solo aplica a partidas de playoff. Seed script con datos de
ejemplo (una liga en SETUP + ~12 jugadores ficticios).

**Criterios de aceptación:**

- Migración aplicada sin error; `prisma studio` muestra las tablas.
- No existe tabla/relación `Round`; `Match` tiene `scheduledAt` y `location`
  nullable y referencia a `League`, no a `Round`.
- `npm run seed` puebla la liga de ejemplo de forma idempotente.
- Tipos Prisma generados y usables desde TS.

---

## Hito 3 — `auth-sesion`

**Objetivo:** autenticación de admin y jugadores según sección 6 del SPEC.

**Alcance:** login admin (passcode env), login jugador (nombre + passcode →
verificación de `passcodeHash`), cookie de sesión firmada (HttpOnly), middleware
de autorización por rol, helper `getSession()`. Logout.

**Criterios de aceptación:**

- Un jugador con passcode correcto obtiene sesión; con uno incorrecto, no.
- Rutas/acciones de admin rechazan sesiones de jugador (test).
- El servidor deriva la identidad de la cookie, nunca de input del cliente.
- Cobertura de tests unit sobre verificación de passcode y guard de rol.

---

## Hito 4 — `admin-liga-jugadores`

**Objetivo:** panel de admin para configurar la liga y gestionar jugadores.

**Alcance:** CRUD de config de liga (nombre, temporada, `pointsWin/Draw/Loss`,
bonus, `playoffSize`, tiebreakers), alta/baja/edición de jugadores con
generación y reseteo de passcode (mostrado una vez al admin), edición de
facción. Validación con Zod.

**Criterios de aceptación:**

- El admin crea una liga y la deja en `SETUP`.
- Alta de 10-20 jugadores; passcode visible al crear/resetear.
- Validaciones rechazan config inválida (p.ej. `playoffSize` > nº jugadores).
- Un jugador no puede acceder a estas vistas.

---

## Hito 5 — `emparejamientos-y-fechas`

**Objetivo:** generación de los emparejamientos round-robin y agendado por fecha
libre (sección 7.2).

**Alcance:** función pura `generatePairings(players)` que devuelve todos los
pares únicos (`C(n,2)` partidas), sin rondas, sin circle method y sin byes;
reparto home/away estable al crear cada par. Acción de admin que persiste los
Matches de liga (`scheduledAt = null` al nacer). Acción de **fijar/editar/limpiar
fecha** (`scheduledAt`) y `location` de una partida, ejecutable por cualquiera de
los dos participantes o por el admin, sin aceptación del rival. Vista de
calendario como lista ordenable por fecha (partidas sin fecha + agendadas).
Guarda de regeneración según `status`/resultados confirmados (regenerar descarta
fechas previas).

**Criterios de aceptación:**

- Tests de `generatePairings`: se generan exactamente `C(n,2)` pares; nadie se
  empareja consigo mismo; cada par `{A,B}` aparece una sola vez; funciona para
  `n` par e impar sin generar byes ni rondas.
- El admin genera los emparejamientos y aparecen en la vista de calendario
  (inicialmente todos "sin fecha").
- Fijar la fecha (y opcional lugar) de una partida la persiste y la mueve a la
  sección/orden de "agendadas"; editarla y limpiarla también persisten.
- Cualquiera de los dos participantes puede fijar la fecha de su partida; un
  tercero no participante (no admin) no puede.
- Regenerar emparejamientos está bloqueado si hay resultados confirmados.

---

## Hito 6 — `reportar-confirmar-resultados`

**Objetivo:** flujo de apuntar y confirmar resultados (sección 7.5).

**Alcance:** vista "Mis partidas"; reportar VP + outcome (Match → `REPORTED`);
confirmar/disputar por el rival (`CONFIRMED`/`DISPUTED`); override y resolución
de disputa por admin; escritura en `AuditLog`. Cálculo y persistencia de bonus
en `Result`. Autorización: sólo participantes/admin actúan sobre una partida. El
ciclo de `status` es **independiente** de `scheduledAt`: se puede reportar una
partida tenga o no fecha, y tener fecha no cambia el `status`.

**Criterios de aceptación:**

- Un jugador reporta sólo en sus partidas; el rival confirma o disputa.
- Una partida no entra en standings hasta `CONFIRMED` (test).
- Reportar una partida **sin** `scheduledAt` funciona igual que con fecha
  (las dos dimensiones son independientes) y fijar fecha no altera el `status`.
- El admin resuelve una partida `DISPUTED` y queda traza en `AuditLog`.
- Bonus configurados se calculan y almacenan resueltos.

---

## Hito 7 — `standings`

**Objetivo:** clasificación con desempates (sección 7.3).

**Alcance:** función pura `computeStandings(matches, config)`; vista de
standings responsive con columnas (PJ, V, E, D, Pts, VP+, VP-, dif) y resalte de
zona de playoffs. Aplica cadena de desempates configurable.

**Criterios de aceptación:**

- Tests cubren: orden por puntos, desempate por dif VP, por VP+, por
  head-to-head, y desempate final determinista.
- Sólo cuenta Results `CONFIRMED`.
- La vista marca quién entra a playoffs según `playoffSize`.

---

## Hito 8 — `playoffs-bracket`

**Objetivo:** transición a playoffs y bracket de eliminatoria simple
(sección 7.4).

**Alcance:** acción de admin "cerrar liga → iniciar playoffs" que toma los
`playoffSize` mejores seeds, construye Bracket + BracketSlots con seeding
estándar y byes si no es potencia de 2. Avance del ganador al confirmar Result.
Vista de bracket. Empate inválido en playoffs.

**Criterios de aceptación:**

- Tests: seeding correcto (1 vs N…) y colocación de byes para tamaños no
  potencia de 2 (los byes solo existen aquí, no en la fase de liga).
- Confirmar una partida de playoff avanza al ganador al slot siguiente.
- La final determina campeón; `status` pasa a `FINISHED`.
- En playoffs no se acepta `outcome = DRAW`.

---

## Hito 9 — `pulido-responsive-e2e`

**Objetivo:** acabado mobile-first y tests end-to-end del recorrido completo.

**Alcance:** revisión responsive de todas las vistas (especialmente "Mis
partidas" para uso con una mano en la mesa), estados vacíos y de error, dark
mode coherente. Playwright e2e: login → fijar fecha → reportar → confirmar →
standings → playoffs. Repaso de README.

**Criterios de aceptación:**

- Recorrido e2e completo pasa en Playwright.
- Vistas usables en viewport móvil (sin scroll horizontal roto).
- `npm run lint`, `npm run test` y e2e en verde.

---

## Notas de portabilidad (transversal a todos los hitos)

- Toda regla de negocio (standings, pairings, bracket, bonus) vive en funciones
  puras en `src/server/`, sin SQL propietario, para mantener SQLite↔Postgres.
- No introducir dependencias atadas a un único proveedor de hosting.
