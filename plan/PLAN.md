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

## Hito 3 — `sistema-diseno-ui`

**Objetivo:** establecer el **sistema de diseño visual base** de throne a partir
de un fichero de diseño de Anthropic, antes de construir las vistas reales, para
que login, paneles, calendario, standings y bracket nazcan ya sobre una capa de
estilo coherente y se evite re-estilar cada vista al final.

**Posición y justificación:** se inserta deliberadamente **después del modelo de
datos (Hito 2) y antes del primer hito con UI real (`auth-sesion`)**. No depende
de la DB, así que no necesita ir más tarde; y aplicarlo aquí —como sistema de
diseño que guía las vistas posteriores— ahorra el retrabajo de re-maquetar todo
en `pulido-responsive-e2e`. No va antes porque el Hito 2 ya está en curso
(`current`) y no se reordena trabajo en marcha.

**Alcance (instrucción literal para el builder, ejecutar tal cual):**

> Fetch this design file, read its readme, and implement the relevant aspects of
> the design.
> https://api.anthropic.com/v1/design/h/ckbrsCRFDbBIYnbIF6xNwA
> Implement: the designs in this project

Es decir: descargar ese fichero de diseño, **leer su README** y **aplicar los
aspectos relevantes del diseño a este proyecto (throne)**. En concreto, traducir
el diseño a la capa base de UI: tokens de color/espaciado/tipografía en la config
de Tailwind y/o `globals.css`, primitivos reutilizables en `src/components/`
(p. ej. botón, input, card, tabla/lista, badge de estado) y la página índice
existente como demostración del sistema.

**Conciliación con las preferencias del proyecto (obligatoria):**

- **Dark mode** es la base fija del proyecto (ADR-006 + preferencias del usuario).
  Si el diseño descargado viene en light mode o trae light/dark, se **adapta a
  dark mode hard-coded**: no se añade toggle ni `prefers-color-scheme`; la paleta
  oscura vive en `:root`/config de Tailwind.
- **Mobile-first**: los primitivos y la demostración deben verse bien en viewport
  móvil primero; nada de asumir desktop.
- No se implementan aún las vistas de negocio (login, standings, etc.): esto es
  solo la **capa de diseño base** que esas vistas consumirán en hitos siguientes.

**Criterios de aceptación:**

- El fichero de diseño de la URL se ha descargado y su **README se ha leído**
  (queda constancia de qué aspectos del diseño se han considerado relevantes y
  cuáles se han descartado/adaptado).
- Los aspectos relevantes del diseño están aplicados a la UI: tokens en Tailwind/
  `globals.css` y primitivos en `src/components/`, demostrados en la página índice.
- **Dark mode** sigue siendo la base; si el diseño traía light mode, se ha
  adaptado a dark sin toggle ni dependencia del SO. Mobile-first respetado.
- `npm run lint`, `npm run test` y `npm run build` siguen en verde.

---

## Hito 4 — `auth-sesion`

**Objetivo:** autenticación de admin y jugadores según sección 6 del SPEC.

**Alcance:** login admin (passcode env), login jugador (nombre + passcode →
verificación de `passcodeHash`), cookie de sesión firmada (HttpOnly), middleware
de autorización por rol, helper `getSession()`. Logout. La pantalla de login usa
los primitivos del sistema de diseño del Hito 3.

**Criterios de aceptación:**

- Un jugador con passcode correcto obtiene sesión; con uno incorrecto, no.
- Rutas/acciones de admin rechazan sesiones de jugador (test).
- El servidor deriva la identidad de la cookie, nunca de input del cliente.
- Cobertura de tests unit sobre verificación de passcode y guard de rol.

---

## Hito 5 — `admin-liga-jugadores`

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

## Hito 6 — `emparejamientos-y-fechas`

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

## Hito 7 — `reportar-confirmar-resultados`

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

## Hito 8 — `standings`

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

## Hito 9 — `playoffs-bracket`

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

## Hito 10 — `pulido-responsive-e2e`

**Objetivo:** acabado mobile-first y tests end-to-end del recorrido completo.

**Alcance:** revisión responsive de todas las vistas (especialmente "Mis
partidas" para uso con una mano en la mesa), estados vacíos y de error, dark
mode coherente con el sistema de diseño del Hito 3. Playwright e2e: login →
fijar fecha → reportar → confirmar → standings → playoffs. Repaso de README.

**Criterios de aceptación:**

- Recorrido e2e completo pasa en Playwright.
- Vistas usables en viewport móvil (sin scroll horizontal roto).
- `npm run lint`, `npm run test` y e2e en verde.

---

## Hito 11 — `documentacion-y-guion-pruebas`

**Objetivo:** producir la documentación de usuario y configuración de throne (en
**español**, según convención del repo) más un guión de pruebas manual, para que
el admin de la liga sepa usar y configurar bien la app y disponga de un walkthrough
reproducible para probarla de extremo a extremo. Es documentación: no introduce ni
cambia lógica de la aplicación.

**Posición y justificación:** va el **último** porque documenta el producto ya
completo (flujo terminado en Hitos 6-9 y pulido en el Hito 10). Documentar antes
correría riesgo de quedar desactualizado respecto a vistas, comandos y variables
que aún cambian.

**Alcance:**

- **Guía de uso** (manual de usuario) en `docs/` (español): cómo funciona la app de
  principio a fin, diferenciando rol **admin** y rol **jugador**, con la terminología
  de dominio del SPEC. Flujo completo:
  - El admin crea la liga y la configura (Hito 5); la deja en `SETUP`.
  - El admin da de alta a los jugadores y reparte sus passcodes (mostrados una vez).
  - Cómo entra un jugador (login por nombre + passcode) frente al login admin.
  - Generar los emparejamientos round-robin (`C(n,2)` partidas, sin rondas ni byes).
  - Fijar/editar/limpiar la **fecha** de las partidas (fecha libre, `scheduledAt`),
    por cualquiera de los dos participantes o el admin, sin aceptación del rival.
  - Reportar resultado (VP + outcome) y confirmar/disputar por el rival; override y
    resolución de disputa por el admin.
  - Consultar la clasificación (standings con desempates y zona de playoffs).
  - Transición a playoffs e interpretación del bracket hasta el campeón.
- **Guía de configuración** en `docs/` (español):
  - Variables de entorno (`DATABASE_URL`, `ADMIN_PASSCODE`, `SESSION_SECRET`): qué
    son y **cómo generarlas** (p. ej. secreto aleatorio para `SESSION_SECRET`),
    partiendo de `.env.example`.
  - Configuración de la liga: sistema de puntos (`pointsWin/Draw/Loss`), bonus,
    `playoffSize` y tiebreakers (cadena de desempates configurable).
  - Comandos reales del proyecto de arranque, seed y migración (`npm run dev`,
    `npm run seed`, `npx prisma migrate dev`, etc.).
  - Nota breve sobre el despliegue **futuro**: ahora corre en local con SQLite y el
    diseño es Postgres-ready (portabilidad ADR/transversal), sin entrar en pipeline
    cloud ni proveedor concreto.
- **Guión de pruebas** (`docs/` o `TESTING.md`, español): walkthrough paso a paso
  para **probar manualmente** la app de extremo a extremo con la app corriendo en
  local, con el **resultado esperado** en cada paso. Puede apoyarse en el seed de
  ejemplo (liga en `SETUP` + ~12 jugadores). Recorrido: login admin → crear/configurar
  liga → alta de varios jugadores → generar emparejamientos → fijar fechas → reportar
  y confirmar resultados → ver standings → iniciar playoffs → resolver bracket →
  campeón.
- **README**: revisar/actualizar `README.md` para que **enlace** a estos documentos
  de `docs/` (uso, configuración y guión de pruebas).

**Criterios de aceptación:**

- Existen en `docs/` (o, para el guión, en `docs/`/`TESTING.md`) los tres documentos
  —guía de uso, guía de configuración y guión de pruebas—, todos en **español**.
- La guía de uso cubre **ambos roles** (admin y jugador) y el **flujo de dominio
  completo**: liga, jugadores/passcodes, emparejamientos, fechas, reporte/confirmación,
  standings, playoffs y campeón, con la terminología del SPEC.
- Las variables de entorno (`DATABASE_URL`, `ADMIN_PASSCODE`, `SESSION_SECRET`) y los
  comandos documentados **coinciden con los reales** del proyecto (`.env.example`,
  `package.json`, migraciones Prisma).
- El guión de pruebas es un recorrido paso a paso, seguible con la app en local, con
  resultados esperados en cada paso, y se apoya en el seed de ejemplo donde aplique.
- El `README.md` enlaza la documentación de `docs/`.
- `npm run lint`, `npm run test` y `npm run build` siguen en verde (la documentación
  no debe romper nada).

---

## Hito 12 — `altas-mitad-liga`

**Objetivo:** permitir que un jugador se incorpore con la liga ya en marcha y
**añadir solo los emparejamientos que faltan** sin destruir partidas, fechas ni
resultados ya existentes. Hoy la única acción (`generateLeagueMatches`) borra y
regenera todo: se bloquea en cuanto hay una partida `CONFIRMED` y, si no, descarta
las fechas acordadas. Esto hace inviable dar de alta a alguien a mitad de liga.

**Posición y justificación:** va al final, como extensión del Hito 6
(`emparejamientos-y-fechas`) sobre un producto ya completo. No reordena ni toca
ningún hito previo: añade una acción nueva y un botón nuevo, dejando intacta la
regeneración total existente (que sigue siendo útil en `SETUP`).

**Decisiones de producto (acordadas con el usuario):**

- **Dos acciones separadas.** Se mantiene "Regenerar emparejamientos" (borra todo,
  solo permitido sin partidas confirmadas) y se añade **"Añadir los que faltan"**
  (incremental, seguro, funciona aunque la liga esté en marcha con partidas jugadas).
- **La acción incremental nunca borra.** Solo crea los pares que faltan entre
  jugadores **activos**. Las partidas de un jugador dado de baja (inactivo) se
  conservan con sus fechas/resultados, coherente con el soft-delete del histórico.
  Un par nuevo solo se genera entre dos jugadores activos.

**Alcance:**

- Función pura nueva en `src/server/pairings.ts`:
  `missingPairings(players, existingPairs)` → calcula el round-robin completo entre
  los activos (reutilizando `generatePairings`) y devuelve **solo los pares no
  presentes**, comparando de forma **no ordenada** (el par `{A,B}` cuenta como
  existente sea cual sea su home/away actual). Home/away de los pares nuevos sigue
  el orden lexicográfico estable existente. No accede a DB.
- Server Action nueva `addMissingLeagueMatches(leagueId)` en
  `src/server/match-actions.ts` (guard `requireAdmin()`): carga activos y los pares
  `LEAGUE` existentes, computa los que faltan y los crea en una transacción con
  `phase=LEAGUE`, `status=SCHEDULED`, `scheduledAt=null`, `isBye=false`. **No borra
  nada.** Funciona con o sin partidas `CONFIRMED`. Si la liga está en `SETUP` y se
  crean partidas, transiciona a `LEAGUE` (igual que la generación). Devuelve el número
  de partidas añadidas (0 si ya estaba todo). Revalida `/admin/emparejamientos`,
  `/calendario`, `/admin`.
- UI en `src/app/admin/emparejamientos/`: una segunda tarjeta/acción "Añadir los que
  faltan" junto a la de regenerar, que muestra **cuántas partidas se añadirían**
  (calculado en el server component vía `missingPairings`) y un mensaje claro de que
  es la opción segura cuando la liga ya está en marcha. Nuevo componente cliente
  (p. ej. `SyncButton.tsx`) análogo a `GenerateButton`. El botón de regenerar y su
  guarda actuales no cambian.

**Criterios de aceptación:**

- Tests de `missingPairings`: con todos los pares ya presentes devuelve `[]`; al
  añadir 1 jugador a `n` existentes devuelve exactamente `n` pares (el nuevo contra
  cada activo) y ninguno duplicado; reconoce pares existentes con home/away invertido
  como presentes (comparación no ordenada); no genera autopares ni byes.
- `addMissingLeagueMatches` añade solo lo que falta y **deja intactas** las partidas
  existentes y sus `scheduledAt`/`Result` (test o verificación): el conteo de
  partidas previas se conserva y se suman las nuevas.
- La acción incremental funciona **aunque existan partidas `CONFIRMED`** (no la
  bloquea la guarda de regeneración), a diferencia de `generateLeagueMatches`.
- Un jugador dado de baja (inactivo) no genera pares nuevos y sus partidas previas
  se conservan.
- La vista de admin muestra ambas acciones y el número de partidas que se añadirían;
  un jugador no admin no puede ejecutar ninguna (guard).
- `npm run lint`, `npm run test` y `npm run build` en verde; no se rompe el recorrido
  e2e existente.

---

## Hito 13 — `persistencia-turso`

**Objetivo:** poder desplegar throne en hosting serverless (Netlify o similar)
moviendo la persistencia de **producción** a **Turso** (libSQL gestionado),
manteniendo SQLite en fichero para desarrollo y tests. SQLite en fichero es
efímero en serverless (FS de solo lectura que se descarta entre invocaciones);
Turso es el gemelo remoto del driver adapter libSQL que el proyecto **ya usa**.

**Posición y justificación:** va el último, como hito de infraestructura sobre un
producto ya completo (Hitos 1-12). No cambia lógica de dominio: solo la capa de
conexión (`src/lib/db.ts`), la configuración de entorno y la documentación de
despliegue. Honra ADR-002 (portabilidad, sin SQL propietario) y la nota de
"DB futuro"; se elige Turso sobre Postgres por **fricción mínima**: el proyecto ya
depende de `@prisma/adapter-libsql` y del generador `prisma-client` (sin motor
Rust nativo), lo que evita los problemas habituales de Prisma en serverless.

**Decisiones de producto (acordadas con el usuario):**

- **Dual local vs. producción.** Dev y tests siguen con SQLite en fichero
  (`file:./dev.db`, `file:e2e.db`) — rápido, offline, sin credenciales.
  Producción usa Turso vía `DATABASE_URL=libsql://...` + `DATABASE_AUTH_TOKEN`.
- **El adapter ya instalado no cambia.** Solo se le pasa un `authToken` **opcional**
  desde env: ausente en local (no rompe el `file:` URL), presente en producción.
- **Migraciones.** Se siguen creando en local contra SQLite (`prisma migrate dev`).
  Para Turso se aplican los `.sql` ya versionados de `prisma/migrations/` al remoto
  (turso CLI / script documentado). No se cambia el dialecto: libSQL es compatible
  con las migraciones SQLite existentes.

**Alcance:**

- `src/lib/db.ts`: pasar `authToken: process.env.DATABASE_AUTH_TOKEN` a
  `PrismaLibSql` (opcional; `undefined` en local mantiene intacto el comportamiento
  `file:`). Sin otros cambios de lógica ni de la lógica de dominio.
- `.env.example`: documentar `DATABASE_URL` (`file:` en local, `libsql://` en prod)
  y añadir `DATABASE_AUTH_TOKEN` (vacío en local; token de Turso en prod).
- Forma reproducible de aplicar las migraciones versionadas a Turso: script npm
  (p. ej. `db:migrate:turso`) que recorre `prisma/migrations/**/migration.sql` con
  la turso CLI, o el comando equivalente documentado. No reescribe el dialecto.
- `docs/despliegue.md` (español): provisión de Turso (crear DB, obtener URL + token),
  aplicar migraciones al remoto, sembrar datos iniciales si aplica, variables de
  entorno en Netlify, y nota de build (`prisma generate` ya en `postinstall`;
  generador `prisma-client` + driver adapter → sin motor nativo, apto para
  serverless). El `README.md` enlaza el doc.

**Criterios de aceptación:**

- `db.ts` lee `DATABASE_AUTH_TOKEN` y lo pasa al adapter; con `file:./dev.db` y sin
  token, dev y la suite completa de tests siguen en verde (no se requiere Turso ni
  red para test/dev/e2e).
- `.env.example` documenta `DATABASE_URL` (local vs. prod) y `DATABASE_AUTH_TOKEN`.
- Existe forma reproducible (script npm o comando documentado) de aplicar las
  migraciones existentes a una base Turso, sin reescribir el dialecto.
- `docs/despliegue.md` en español cubre: crear la DB Turso, URL+token, aplicar
  migraciones, env vars de Netlify y el detalle de build serverless; el README lo
  enlaza.
- `npm run lint`, `npm run test` y `npm run build` siguen en verde.

---

## Hito 14 — `deploy-netlify`

**Objetivo:** dejar el repo listo para desplegar en **Netlify** (build serverless de
Next.js 16), como capa de hosting sobre la persistencia ya migrada a Turso (Hito 13).
Solo configuración de build y documentación: ninguna lógica de dominio ni schema.

**Posición y justificación:** sucede a `persistencia-turso` (Hito 13). La capa de
datos ya es agnóstica al host; este hito añade exclusivamente la configuración del
host elegido (Netlify) y la guía de despliegue concreta. No reordena ni toca hitos
previos.

**Decisiones (acordadas con el usuario):**

- **Host: Netlify** (el usuario ya tiene cuenta). Se usa el plugin oficial
  `@netlify/plugin-nextjs`, pinneado como dependencia para build reproducible (no se
  confía solo en la autodetección de Netlify).
- **Reparto de responsabilidades.** Este hito cubre solo la **parte repo**
  (`netlify.toml`, dependencia, docs). La provisión de la DB Turso, el alta de env
  vars en el panel de Netlify y el push a `main` los hace el usuario, guiado por la
  doc; no forman parte de los criterios de aceptación automatizables.

**Alcance:**

- `netlify.toml`: `command = "npm run build"`, `NODE_VERSION` fijado (Next 16 requiere
  Node 20+), y `[[plugins]] package = "@netlify/plugin-nextjs"`.
- `package.json` + `package-lock.json`: añadir `@netlify/plugin-nextjs` como
  devDependency pinneada.
- `docs/despliegue.md`: sección **Netlify** concreta — conectar el repo de GitHub,
  configurar las 4 env vars (`DATABASE_URL`, `DATABASE_AUTH_TOKEN`, `ADMIN_PASSCODE`,
  `SESSION_SECRET`), y el flujo de deploy. Nota: `prisma generate` ya corre en
  `postinstall`; el generador `prisma-client` + driver adapter no requiere motor
  nativo → build serverless limpio.

**Criterios de aceptación:**

- `netlify.toml` existe con el build command, `NODE_VERSION` y el plugin
  `@netlify/plugin-nextjs`.
- `@netlify/plugin-nextjs` está en `devDependencies` y `package-lock.json` actualizado.
- `docs/despliegue.md` incluye los pasos concretos de Netlify (repo, env vars, deploy).
- `npm run lint`, `npm run test` y `npm run build` siguen en verde.
- No se toca lógica de dominio, `schema.prisma` ni otros hitos.

---

## Notas de portabilidad (transversal a todos los hitos)

- Toda regla de negocio (standings, pairings, bracket, bonus) vive en funciones
  puras en `src/server/`, sin SQL propietario, para mantener SQLite↔Postgres.
- No introducir dependencias atadas a un único proveedor de hosting.
