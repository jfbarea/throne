---
slug: multi-liga
status: APPROVED
version: 7
---

# multi-liga

> Llevar dos (o más) ligas a la vez en la misma instancia de throne.

## 1. Problema

throne funciona, y eso ha creado la necesidad: **hay un segundo grupo de amigos
que quiere su propia liga**, con sus jugadores, su calendario y su clasificación,
corriendo a la vez que la actual y sin mezclarse con ella.

Hoy la app no puede: da por hecho que existe una sola liga y resuelve "la liga"
como la más reciente de la base de datos, en diez páginas distintas. Crear una
segunda liga con la app tal cual no produce dos ligas — produce una liga que
tapa a la otra: la nueva sería la más reciente y todas las vistas pasarían a
mostrarla, dejando al primer grupo sin acceso a la suya.

El admin (una sola persona, un solo `ADMIN_PASSCODE`) juega en los dos grupos y
administra los dos.

### Estado actual del código (verificado)

- La suposición de liga única está hard-codeada en 10 páginas, todas con la misma
  llamada `prisma.league.findFirst({ orderBy: { createdAt: "desc" } })`:
  `src/app/clasificacion/page.tsx:26`, `src/app/calendario/page.tsx:19`,
  `src/app/rondas/page.tsx:33`, `src/app/mis-partidas/page.tsx:28`,
  `src/app/bracket/page.tsx:17`, `src/app/admin/liga/page.tsx:12`,
  `src/app/admin/jugadores/page.tsx:13`,
  `src/app/admin/emparejamientos/page.tsx:17`,
  `src/app/admin/rondas/page.tsx:18`, `src/app/admin/playoffs/page.tsx:15`.
- `Player` ya cuelga de `League` (`Player.leagueId`): hoy, un mismo amigo en dos
  ligas serían dos filas `Player` distintas, con passcode y facción separados.
- `SessionPayload` (`src/lib/session.ts`) solo lleva `playerId` y `role`. No hay
  noción de liga en la sesión.
- El login de jugador no filtra por liga:
  `prisma.player.findFirst({ where: { displayName, active: true } })`
  (`src/lib/auth.ts:56`). Dos jugadores homónimos en ligas distintas colisionan.
- El admin no está scoped a liga: `ADMIN_PASSCODE` global y
  `player.findFirst({ where: { role: "ADMIN" } })`
  (`src/app/api/auth/login-admin/route.ts:35`).
- El seed crea una liga con id fijo `seed-league-001` (`prisma/seed.ts:106`).

## 2. Alcance

En comportamiento observable, entra esto:

- La app sostiene **N ligas simultáneas** sin que ninguna tape a otra.
- Cada liga tiene **sus propias bases**, públicas y en su propia URL.
- Cada jugador entra y ve **su** liga, exactamente como hoy, sin enterarse de que
  hay otras.
- El admin ve un **índice de ligas** y trabaja sobre la que elige, con la liga
  siempre explícita en la URL.
- El admin puede **crear** una liga en blanco, **duplicar** otra, **archivarla**
  cuando termina y **borrarla** mientras no tenga partidas.
- Las ligas tienen **slug legible** en la URL.
- El admin actúa como jugador dentro de cada liga sin cambiar de sesión.

### 2.1. Identidad de jugador — decisión

**Las ligas tienen rosters disjuntos: ningún jugador está en dos ligas a la vez,
con una única excepción — el admin, que juega en todas.**

Consecuencias:

- **No** se introduce entidad de cuenta ni tabla de inscripción. `Player` sigue
  colgando de `League` tal cual está hoy (`Player.leagueId`), y un jugador
  pertenece a exactamente una liga.
- Como el `Player` determina la liga, la liga "actual" de un jugador autenticado
  se **deriva de su fila `Player`**, sin necesidad de guardarla en la sesión.
- El roster disjunto es una **invariante de producto, no del esquema**: nada en
  la base de datos lo impide. Ver §5 para qué hace la app si el admin intenta
  dar de alta en una liga un nombre que ya existe en otra.
- **El admin es la excepción**: tiene una fila `Player` con `role = ADMIN` en
  cada liga, y juega en todas. Es el único caso en que una misma persona tiene
  varias filas `Player`.

### 2.1.1. Lo que rompe hoy el admin multi-liga (verificado)

`POST /api/auth/login-admin` rellena la sesión con
`prisma.player.findFirst({ where: { role: "ADMIN", active: true } })`
(`src/app/api/auth/login-admin/route.ts:35`) — **sin filtrar por liga**. Ese
`playerId` se usa después como:

- `AuditLog.actorId` (`src/server/result-actions.ts:314`, `:646`;
  `src/server/league-actions.ts:380`),
- `Result.reportedById` (`src/server/result-actions.ts:279`, `:298`).

Con dos ligas, un resultado apuntado por el admin en la liga B quedaría firmado
por su fila `Player` de la liga A: un `Result` cuya FK `reportedById` apunta a un
jugador que no pertenece a esa liga. **La sesión deja de llevar un `playerId` de
admin fijo** (ver §4).

Por el mismo motivo, `verifyPlayerPasscode` (`src/lib/auth.ts:56`) busca por
`displayName` en todas las ligas: con el admin presente en ambas con el mismo
nombre, `findFirst` devuelve una fila arbitraria.

### 2.2. Visibilidad — decisión

**Un jugador solo ve su liga. La existencia de otras ligas le es invisible.**

- Ninguna vista de jugador (`/clasificacion`, `/calendario`, `/rondas`,
  `/mis-partidas`, `/bracket`, `/mi-perfil`) ofrece selector de liga ni menciona
  otra liga.
- Toda consulta de esas vistas se filtra por la liga de su `Player`, no por
  "la última liga creada".
- Un jugador que intente alcanzar datos de otra liga (manipulando una URL, si la
  liga acaba siendo parte de la ruta) recibe el mismo trato que un no
  autorizado. Ver §5.
- El **cambio de liga es exclusivo del admin**.

### 2.3. Contexto de liga en el admin — decisión

**La liga va en la URL: `/admin/[leagueId]/…`. No hay "liga activa" en cookie ni
en sesión.**

- `/admin` deja de ser un panel de la liga única y pasa a ser el **índice de
  ligas**: lista todas y desde ahí se entra a una. Ya lista ligas hoy
  (`prisma.league.findMany({ take: 5 })`, `src/app/admin/page.tsx:22`), pero los
  accesos rápidos apuntan a rutas sin liga.
- Las cinco pantallas de admin se mueven bajo el segmento de liga:
  `/admin/liga` → `/admin/[leagueId]/liga`, y lo mismo para `jugadores`,
  `emparejamientos`, `rondas` y `playoffs`.
- Ninguna pantalla de admin resuelve ya la liga con `findFirst`: el `leagueId`
  sale del parámetro de ruta y se valida contra la base de datos.
- Consecuencia buscada: una pestaña vieja no puede actuar sobre otra liga, y un
  enlace a una pantalla de admin apunta siempre a la misma liga.

### 2.4. El admin como jugador — decisión

**El admin entra con `ADMIN_PASSCODE`, elige liga en `/admin`, y actúa como
jugador dentro del contexto de esa liga.**

- La sesión de admin **deja de llevar un `playerId` fijo**. `login-admin` ya no
  hace `player.findFirst({ role: "ADMIN" })`.
- El "jugador actual" del admin se **deriva por liga** en cada acción y cada
  vista: el `Player` con `role = ADMIN` de la liga del contexto.
- Con esto, `Result.reportedById` y `AuditLog.actorId` apuntan siempre a un
  `Player` de la misma liga que la partida (§2.1.1).
- El admin no necesita passcode de jugador: sigue teniendo uno solo,
  `ADMIN_PASSCODE`.

### 2.5. Mapa de rutas — decisión

**Todas las vistas de liga viven bajo un único segmento de liga. Un solo juego de
páginas, sin espejos.**

| Hoy | Después |
|---|---|
| `/clasificacion` | `/liga/[id]/clasificacion` |
| `/calendario` | `/liga/[id]/calendario` |
| `/rondas` | `/liga/[id]/rondas` |
| `/bracket` | `/liga/[id]/bracket` |
| `/mis-partidas` | `/liga/[id]/mis-partidas` |
| `/bases` | `/liga/[id]/bases` (pública, §2.11) |
| `/admin/liga` | `/admin/[id]/liga` |
| — | `/admin/[id]/bases` (editor de la prosa, nuevo) |
| `/admin/jugadores` | `/admin/[id]/jugadores` |
| `/admin/emparejamientos` | `/admin/[id]/emparejamientos` |
| `/admin/rondas` | `/admin/[id]/rondas` |
| `/admin/playoffs` | `/admin/[id]/playoffs` |

- Las rutas sin liga (`/clasificacion`, …) **siguen existiendo como
  redirecciones**: un jugador que entra por ahí (o por un enlace viejo) acaba en
  la suya. Ver §5 para qué pasa cuando quien entra es el admin.
- `prisma.league.findFirst` desaparece de las 10 páginas: la liga sale siempre
  del segmento de ruta.
- `/mi-perfil` no lleva liga: es del jugador, no de la liga. (El admin edita su
  facción por liga desde la pantalla de jugadores de esa liga.)

### 2.6. Identificador de liga en la URL — decisión

**El segmento es un slug legible, no el cuid**: `/liga/primavera-2026/clasificacion`.

- Campo nuevo `League.slug`, `String @unique`, en kebab-case.
- Se genera a partir de `name` y `season`, y **se regenera cada vez que el admin
  cambia el nombre o la temporada** (`updateLeague`,
  `src/server/league-actions.ts:92`). El slug siempre refleja el nombre actual.
- No se guarda historial de slugs: **un enlace compartido antes de un renombrado
  deja de resolver**. Mitigación en §5 (pantalla de "liga no encontrada" que
  ofrece las ligas accesibles, en lugar de un 404 seco). Riesgo asumido en §9.
- Las ligas existentes reciben un slug en la migración (§6).

### 2.7. Nombres de jugador — decisión

**`displayName` es único en toda la app, no solo dentro de una liga.**

- El alta y la edición de jugador rechazan un nombre que ya exista en
  **cualquier** liga. Hoy la comprobación es intra-liga:
  `player.findFirst({ where: { leagueId, displayName: d.displayName } })`
  (`src/server/league-actions.ts:213`); pasa a ser global.
- **Excepción, la misma de §2.1:** el admin tiene una fila `Player` por liga con
  el mismo `displayName`. La unicidad se exige entre filas con `role = PLAYER`,
  no sobre la tabla entera, así que se valida en la capa de aplicación y no con
  un `@@unique` de Prisma (que no sabe expresar "excepto los ADMIN" de forma
  portable SQLite↔Postgres).
- `verifyPlayerPasscode` (`src/lib/auth.ts:56`) añade `role: "PLAYER"` al filtro:
  el admin nunca entra por el login de jugador (§2.4), así que sus filas
  homónimas no pueden colisionar con nadie.
- Con esto el login de jugador **no cambia de forma**: sigue siendo nombre +
  passcode, sin selector de liga, y ningún jugador se entera de que hay otra.
- La unicidad se exige **solo entre ligas no archivadas** (§2.8): si no, la
  temporada siguiente no podría reusar los nombres de la anterior.

### 2.8. Archivado de ligas — decisión

**Una liga se archiva. Las ligas archivadas conservan sus datos pero salen de
circulación.**

- Campo nuevo `League.archivedAt DateTime?`, nulo mientras la liga está en
  circulación. Es **ortogonal a `status`** (igual que `Round.closedAt`): una
  liga puede estar `FINISHED` y seguir sin archivar mientras el grupo comenta el
  resultado.
- Archivar es una **acción explícita del admin**, no un efecto automático de
  llegar a `FINISHED`.
- Efectos del archivado:
  - Sus jugadores dejan de contar para la unicidad global de `displayName`
    (§2.7), así que la temporada siguiente puede reusar los mismos nombres.
  - Sus jugadores dejan de poder iniciar sesión: `verifyPlayerPasscode` filtra
    por liga no archivada, de modo que "Javi 2026" y "Javi 2027" nunca compiten
    por el mismo login.
  - La liga queda en **solo lectura**: ninguna acción de escritura (apuntar
    resultado, agendar, cerrar ronda, generar emparejamientos, alta/baja de
    jugador) opera sobre una liga archivada.
- Desarchivar es posible, y **falla si al hacerlo se produjera una colisión de
  nombres** con una liga en circulación (§5).
- **El histórico es del admin.** Las ligas archivadas solo son accesibles desde
  el panel de admin, en modo lectura. Un jugador no puede consultar la
  temporada pasada: al archivarse su liga, su login deja de funcionar.

### 2.9. Crear ligas — decisión

**Dos caminos: crear en blanco y duplicar una existente.**

- `/admin/nueva` — formulario vacío. Es la ruta de creación que hoy comparte
  pantalla con la edición (`src/app/admin/liga/page.tsx:24`); al pasar la liga a
  la URL, `/admin/[slug]/liga` queda solo para editar.
- **Duplicar** — acción sobre una liga existente que crea una liga nueva en
  `SETUP`. **Qué copia depende de si el origen está archivado**, porque los
  nombres son únicos entre ligas en circulación (§2.7):
  - origen **archivado** → configuración **y** roster;
  - origen **en circulación** → solo configuración; la liga nace sin jugadores.

  Copia:
  - la configuración: `pointsWin/Draw/Loss`, `bonus*`, `playoffSize`,
    `matchesPerRound`, `tiebreakers`;
  - el roster: una fila `Player` por jugador **activo** del origen, con su
    `displayName`, su `faction` y su `role`.
  - **No** copia: partidas, resultados, rondas, bracket, audit log,
    `startMonth`, ni los jugadores dados de baja (`active: false`).
- El destino de la duplicación no lleva `startMonth`: la liga nace en `SETUP` y
  el admin fija el mes de inicio como en cualquier liga nueva.
- **Passcodes: se genera uno nuevo por jugador copiado.** No se copia el
  `passcodeHash` del origen. Como el plano solo existe en el momento de crearlo
  (`generateHashedPasscode`, `src/lib/passcode.ts:52`), la duplicación termina en
  una pantalla que lista, **una sola vez**, los pares `displayName` + passcode de
  todos los jugadores creados, con opción de copiarlos en bloque. Si el admin la
  cierra sin copiarla, la vía de recuperación es `resetPlayerPasscode`
  (`src/server/league-actions.ts:433`), jugador a jugador.

### 2.10. Borrar una liga — decisión

**Se puede borrar, pero solo mientras no tenga partidas.**

- Condición: `status = SETUP` **y** cero `Match` asociados. Cubre el caso "he
  creado esta liga por error" y nada más.
- El borrado arrastra los `Player` de esa liga (y sus `AuditLog`, como ya hace
  `deletePlayer`, `src/server/league-actions.ts:480`).
- En cuanto una liga tiene partidas, la única salida es **archivar** (§2.8). No
  hay borrado con confirmación por nombre ni equivalente.

### 2.11. Bases por liga — decisión

**Cada liga tiene sus propias bases, y siguen siendo públicas sin login.**

Hoy `/bases` es una página JSX hard-codeada de 259 líneas
(`src/app/bases/page.tsx`) y **la única ruta sin guarda de la app**. Su contenido
es de liga, no de producto: puntuación 3/1/0, desempates, "2 partidas por ronda",
incomparecencia con 80-0, edición 11ª.

**Modelo híbrido: lo que ya es configuración se genera, lo demás es prosa.**

- **Generado desde `League`**, nunca tecleado: puntuación (`pointsWin`,
  `pointsDraw`, `pointsLoss`), bonus (`bonusEnabled`, `bonusMarginThreshold`,
  `bonusMinVP`), orden de desempates (`tiebreakers`), partidas por ronda
  (`matchesPerRound`) y tamaño de playoffs (`playoffSize`). Se renderiza como un
  bloque propio dentro de la página de bases.
- **Prosa por liga**: campo nuevo `League.rulesMarkdown String`, en markdown, que
  el admin edita en `/admin/[slug]/bases`. Cubre formato, ejércitos,
  incidencias, convivencia y lo que el grupo quiera añadir.
- **Invariante buscada: las bases no pueden mentir.** Cambiar la puntuación en la
  configuración cambia las bases en el mismo momento, sin que nadie tenga que
  acordarse de editar un texto.
- Una liga nueva nace con `rulesMarkdown` relleno con la **plantilla por
  defecto**, que es el texto actual de `/bases` menos lo que pasa a generarse.
  Duplicar una liga copia la prosa del origen.

**Acceso:**

- `/liga/[slug]/bases` se lee **sin sesión**, como hoy. Sirve para enseñar las
  reglas a alguien antes de darle de alta.
- Es la única grieta consciente en §2.2: quien reciba el slug de otra liga puede
  leer sus bases. No expone jugadores, partidas ni resultados.
- `/bases` a secas **no** lista ligas nunca. Resuelve así:
  - con sesión de jugador → las bases de su liga;
  - con sesión de admin → `/admin`;
  - **sin sesión y con una sola liga en circulación** → las bases de esa liga.
    Es el caso del día del deploy, y es lo que hace que un marcador público
    existente siga funcionando igual (§7, continuidad);
  - sin sesión y con dos o más ligas en circulación → página que explica que hay
    que usar el enlace concreto de la liga, **sin listar ninguna**.
- Un índice público de ligas filtraría la existencia de todas, y por eso no
  existe en ningún caso.

## 3. No-objetivos

- **Cuentas de usuario entre ligas.** No se introduce entidad `User`/`Account` ni
  tabla de inscripción. Una persona = una fila `Player` por liga, y solo el admin
  tiene más de una (§2.1).
- **Un jugador en dos ligas a la vez.** El producto lo prohíbe (§2.1); la app no
  ofrece ninguna vista ni flujo que lo contemple.
- **Que un jugador vea otra liga.** Ni en lectura, ni la archivada de la
  temporada anterior (§2.2, §2.8).
- **Selector de liga para jugadores.** No hay conmutador en ninguna vista de
  jugador.
- **Historial de slugs y redirecciones de slugs viejos.** Renombrar rompe los
  enlaces compartidos; se asume (§2.6, §9).
- **Cross-league: nada que cruce datos de dos ligas.** Ni clasificación global,
  ni histórico de un jugador entre temporadas, ni comparativas.
- **Rutas públicas nuevas.** La única ruta sin sesión sigue siendo la de bases,
  que ya lo era (§2.11). No se abre ninguna otra.
- **Editor enriquecido de bases.** La prosa se edita como markdown en un
  `textarea`, no con un editor WYSIWYG.
- **Versionado o histórico de las bases.** Se guarda el texto vigente y punto.
- **Partir `/guia` por liga.** La guía explica cómo se usa la app (apuntar
  resultado, declarar incomparecencia, cerrar ronda), no las reglas del grupo.
  El 80-0 de la incomparecencia que menciona (`src/app/guia/sections.ts:39`) es
  comportamiento implementado, no configuración de liga. `/guia` sigue siendo
  única y sin liga.
- **Varios admins o admin por liga.** Sigue habiendo un único `ADMIN_PASSCODE`
  global, y quien lo tiene administra todas las ligas.
- **Cambiar el dominio ya especificado.** Standings, emparejamientos, rondas,
  cierre de ronda y bracket no cambian de reglas: solo pasan a estar siempre
  acotados a una liga explícita. `plan/specs/rondas-con-fecha.md` sigue vigente
  tal cual.
- **Límite de ligas simultáneas.** No se impone ninguno; la feature se diseña
  para N, aunque el caso real sean dos.

## 4. Comportamiento esperado

### 4.1. Resolución de la liga

Ninguna página resuelve ya la liga con
`prisma.league.findFirst({ orderBy: { createdAt: "desc" } })`. La liga sale
siempre del segmento de ruta y se valida antes de consultar nada:

1. Se busca `League` por `slug`.
2. Si no existe → §5.1.
3. Se comprueba el acceso según el rol (§4.2).
4. Solo entonces se cargan jugadores, partidas, rondas o bracket, todos
   filtrados por `leagueId`.

### 4.2. Reglas de acceso

| Quién | Liga en circulación propia | Liga en circulación ajena | Liga archivada | Liga inexistente |
|---|---|---|---|---|
| Jugador | Acceso completo, como hoy | Redirección silenciosa a la misma página de su liga | Igual que ajena (no puede tener sesión, §4.4) | §5.1 |
| Admin | Acceso completo | Acceso completo | Acceso de **solo lectura** | §5.1 |

- La redirección del jugador es **silenciosa**: no distingue "no existe" de "no
  es tuya", para no revelar que hay otras ligas (§2.2).
- El admin en una liga archivada ve las mismas pantallas con las acciones de
  escritura deshabilitadas y un aviso de que la liga está archivada.

### 4.3. Entrada en la app

- **Jugador**: `/` → `/liga/<su-slug>/mis-partidas`. Las rutas antiguas sin liga
  (`/clasificacion`, `/calendario`, `/rondas`, `/bracket`, `/mis-partidas`)
  siguen respondiendo y redirigen a su equivalente dentro de su liga.
- **Admin**: `/` → `/admin`, que es el **índice de ligas** (§4.5). Las rutas
  antiguas sin liga también lo mandan a `/admin`, porque para él no hay una liga
  implícita que elegir.

**Cómo se resuelve el slug en esas redirecciones.** La cookie no lleva la liga
(§4.4), así que no basta con leer la sesión: hay que ir a base de datos.

```
cookie.playerId → Player.leagueId → League.slug → /liga/<slug>/<misma-página>
```

- Es **una consulta por petición**, y solo en las rutas antiguas: las rutas con
  slug no la necesitan, porque la liga ya viene dada.
- `role === "ADMIN"` corta antes: no se consulta nada, va a `/admin`.
- Sin sesión, a `/login`.
- Si el `playerId` de la cookie ya no corresponde a ninguna fila `Player` (su
  liga se borró, §5.2) o su liga está archivada (§5.3), no hay redirección: se
  cierra la sesión y se va a `/login`.

### 4.4. Sesión y autenticación

- `SessionPayload` no gana ningún campo: sigue siendo `{ playerId, role }`. La
  liga **nunca** viaja en la cookie (§2.3).
- **Jugador**: login por nombre + passcode, sin cambios de forma.
  `verifyPlayerPasscode` (`src/lib/auth.ts:56`) añade dos filtros: `role:
  "PLAYER"` y liga no archivada. Un jugador de liga archivada recibe el mismo
  error genérico que unas credenciales incorrectas.
- **Admin**: login por `ADMIN_PASSCODE`. `login-admin` **deja de resolver un
  `playerId`** (`src/app/api/auth/login-admin/route.ts:35`) y firma la sesión con
  `playerId: null`.
- El **jugador-admin de una liga** se resuelve en el punto de uso: dado el
  `leagueId` del contexto, el `Player` con `role = ADMIN` de esa liga. Ese es el
  id que se escribe en `Result.reportedById` y `AuditLog.actorId` cuando quien
  actúa es el admin.

### 4.5. Índice de ligas (`/admin`)

- Lista **todas** las ligas, separando en circulación y archivadas.
- Por liga: nombre, temporada, estado, número de jugadores activos y acceso a sus
  pantallas.
- Acciones por liga: entrar, duplicar (§2.9), archivar/desarchivar (§2.8) y
  borrar cuando proceda (§2.10).
- Acción global: crear liga (`/admin/nueva`).
- Los contadores son **por liga**. Hoy `/admin` cuenta jugadores activos de toda
  la base (`prisma.player.count({ where: { active: true } })`,
  `src/app/admin/page.tsx:29`), que con dos ligas es un número sin significado.

### 4.6. Slug

- Se deriva de `name` y `season`, normalizando a kebab-case ASCII (minúsculas,
  sin tildes, separadores por guion).
- Si el slug resultante ya está en uso por otra liga, se le añade un sufijo
  numérico (`-2`, `-3`, …) hasta que sea único.
- Se recalcula en cada `updateLeague` que cambie `name` o `season`.

### 4.7. Archivar y desarchivar

- Archivar fija `archivedAt = now()`. Desarchivar lo vuelve a `null`.
- Archivar **no** cambia `status`: una liga puede archivarse en cualquier estado.
- Efectos, ya enumerados en §2.8: fuera de la unicidad de nombres, sin login para
  sus jugadores, solo lectura y visible únicamente para el admin.

### 4.8. Duplicar

1. El admin elige la liga origen y da nombre y temporada a la nueva.
2. Se crea la liga destino en `SETUP`, con la configuración copiada (§2.9) y
   `startMonth` sin fijar.
3. **Solo si el origen está archivado**: se crea una fila `Player` por jugador
   **activo** del origen, con passcode nuevo, y se muestra una vez la lista de
   `displayName` + passcode generados. Si el origen está en circulación, la liga
   destino nace vacía y la pantalla lo dice antes de confirmar.

La duplicación es atómica: o se crean la liga y todos sus jugadores, o no se crea
nada.

### 4.9. El admin como jugador de cada liga

**Toda liga nace con una fila `Player` con `role = ADMIN` para el admin.** Se
crea en el mismo paso que la liga, tanto en `/admin/nueva` como al duplicar.

- El formulario de creación incluye el nombre de jugador del admin, precargado
  con el que use en la liga en circulación más reciente.
- Si en una liga concreta el admin no quiere jugar, se da de baja
  (`active: false`) sin dejar de ser el actor de las acciones de admin.
- Consecuencia: **siempre** existe actor para `AuditLog.actorId` y
  `Result.reportedById`; ninguno de los dos campos cambia de nulabilidad, y no
  hace falta migrar filas existentes por este motivo.
- `deletePlayer` (`src/server/league-actions.ts:460`) rechaza borrar el `Player`
  con `role = ADMIN` de una liga: dejaría la liga sin actor.

### 4.10. Navegación

- `AppHeader` (`src/components/AppHeader.tsx:27`) y `AdminMenu`
  (`src/components/AdminMenu.tsx:19`) construyen hoy rutas absolutas fijas. Pasan
  a construirlas con el slug de la liga del contexto.
- La cabecera **muestra en qué liga estás**. Para un jugador es informativo; para
  el admin, que salta entre ligas, es lo que evita actuar en la equivocada.
- `/guia` y `/bases` no llevan liga y siguen accesibles desde la cabecera tal
  cual.
- El menú de admin incluye una salida al índice de ligas (`/admin`).

### 4.11. Bases

`/liga/[slug]/bases` se compone de dos mitades:

1. **Bloque generado** — se renderiza desde los campos de `League` en el momento
   de la petición. Puntuación, bonus, desempates en su orden real, partidas por
   ronda y tamaño de playoffs. No hay forma de que se desincronice de la
   configuración porque no hay copia: se lee del mismo sitio que usan
   `computeStandings` y el cierre de ronda.
2. **Prosa** — `League.rulesMarkdown` renderizado, con la maqueta actual de la
   página (secciones con eyebrow numerado y viñetas con el marcador `✦`).

Edición: `/admin/[slug]/bases`, un `textarea` de markdown con vista previa y
guardado explícito. Solo el admin, solo sobre liga no archivada (§5.6).

## 5. Casos límite y errores

### 5.1. Slug que no resuelve

Cubre tanto un slug inexistente como uno viejo que dejó de valer tras un
renombrado (§2.6).

- **Jugador**: redirección silenciosa a la misma página de su liga (§4.2). No
  ve error.
- **Admin**: pantalla "esa liga no existe" que **lista las ligas disponibles**
  (en circulación y archivadas) para que entre a la que buscaba. No es un 404
  seco, precisamente porque renombrar invalida enlaces.

### 5.2. No hay ninguna liga

- **Admin**: `/admin` muestra el índice vacío con la llamada a crear la primera
  liga, como hoy hace `/admin` cuando `leagues.length === 0`
  (`src/app/admin/page.tsx`).
- **Jugador**: no puede darse el caso. Un jugador existe solo como fila `Player`
  de una liga; si esa liga desaparece (borrado, §2.10), su fila desaparece con
  ella y su sesión queda sin sujeto → se le cierra la sesión y vuelve a
  `/login`.

### 5.3. La liga de un jugador se archiva con su sesión abierta

La cookie de sesión dura 7 días (`SESSION_TTL_S`, `src/lib/session.ts`), así que
archivar no la invalida por sí solo. En la siguiente petición, la guarda detecta
que la liga del `Player` está archivada, **cierra la sesión** y lleva a `/login`.
Un intento posterior de iniciar sesión falla con el error genérico de
credenciales (§4.4).

### 5.4. Colisiones de `displayName`

Todas se resuelven con un error de la acción, nunca creando el duplicado. El
mensaje siempre lo lee el admin, así que puede nombrar la liga en conflicto sin
filtrar nada a los jugadores.

| Situación | Qué pasa |
|---|---|
| Alta o edición de jugador con nombre ya usado en otra liga en circulación | Error en el campo `displayName`, indicando en qué liga está en uso |
| Desarchivar una liga cuyos nombres chocan con una liga en circulación | La acción falla y lista **todos** los nombres en conflicto; no desarchiva a medias |
| Duplicar una liga archivada cuyos jugadores chocan con una liga en circulación | La acción falla antes de crear nada y lista los nombres en conflicto |
| Dos jugadores con el mismo nombre dentro de la misma liga | Sigue prohibido, como hoy (`league-actions.ts:213`) |

### 5.5. Slug duplicado

Dos ligas con el mismo `name` y `season` producen el mismo slug base. La segunda
recibe sufijo numérico (§4.6). Renombrar una liga hasta chocar con otra aplica la
misma regla: nunca falla por slug, siempre desambigua.

### 5.6. Escrituras sobre liga archivada

Toda acción de escritura acotada a liga —`updateLeague`, `createPlayer`,
`updatePlayer`, `setPlayerActive`, `resetPlayerPasscode`, `deletePlayer`,
`generateLeagueMatches`, `addMissingLeagueMatches`, `setMatchSchedule`,
`updateRoundDeadline`, `closeRound`, `redistributePending`, `startPlayoffs`,
`advancePlayoffWinner`, `reportResult`/`confirmResult`, `resetLeague`— comprueba
que la liga no está archivada y falla con un error explícito si lo está. La UI
las presenta deshabilitadas, pero la comprobación vive en la acción: es la
guarda real.

### 5.7. Borrado de liga

- Con partidas o fuera de `SETUP`: la acción se niega y sugiere archivar (§2.10).
- Sin partidas: borra liga y jugadores en una transacción. Si el admin tenía
  sesión en esa liga, vuelve al índice.

### 5.8. `/mi-perfil` con sesión de admin

El admin ya no tiene `playerId` en la sesión (§4.4) y tiene una facción por liga,
así que `/mi-perfil` no puede resolver "su" perfil. Con sesión de admin,
`/mi-perfil` redirige a `/admin`; su facción de cada liga se edita desde
`/admin/[slug]/jugadores`.

### 5.8.1. Bases: slug que no resuelve, sin sesión

`/liga/[slug]/bases` es pública, así que un slug inexistente no puede redirigir
"a la liga del visitante": no hay visitante identificado. Muestra una página de
liga no encontrada con enlace a `/login`, sin listar ninguna liga.

### 5.8.2. Bases de una liga archivada

Se siguen leyendo (`/liga/[slug]/bases` de una liga archivada responde): el
enlace que circuló sigue funcionando y las reglas de la temporada pasada quedan
consultables. Lo que se bloquea es **editarlas** (§5.6).

### 5.8.3. Bases vacías

`rulesMarkdown` puede quedar vacío si el admin lo borra. La página sigue
respondiendo y muestra solo el bloque generado desde la configuración: las
reglas mínimas (puntuación, desempates, cupo) nunca desaparecen.

### 5.9. Concurrencia entre ligas

Dos pestañas del admin trabajando en ligas distintas no interfieren: no hay
estado de "liga actual" compartido, cada petición lleva su liga en la ruta
(§2.3). Es el motivo de la decisión.

### 5.10. Rutas antiguas

`/clasificacion`, `/calendario`, `/rondas`, `/bracket` y `/mis-partidas` siguen
existiendo como redirecciones (§4.3) para no romper los enlaces y accesos
directos que el grupo ya tenga guardados.

## 6. Superficie afectada

### 6.1. Esquema y migración

`prisma/schema.prisma`, modelo `League`:

```prisma
model League {
  // …
  slug          String    @unique // nuevo — kebab-case, derivado de name + season
  archivedAt    DateTime?         // nuevo — null = en circulación
  rulesMarkdown String    @default("") // nuevo — prosa de las bases (§2.11)
}
```

- Migración **no destructiva**: añade tres columnas y rellena `slug` para las
  ligas existentes con la misma regla de §4.6 (incluido el sufijo numérico si
  dos ligas colisionan). `archivedAt` queda a `null`: nada se archiva solo.
  `rulesMarkdown` se rellena con la plantilla por defecto, de modo que la liga
  actual conserve unas bases equivalentes a las que tiene hoy.
- **No** cambian: `Player`, `Match`, `Result`, `Round`, `Bracket`,
  `BracketSlot`, `AuditLog`. En particular `AuditLog.actorId` sigue siendo FK
  obligatoria (§4.9).
- La unicidad global de `displayName` entre ligas en circulación **no** se
  expresa con un índice: es una comprobación de aplicación (§2.7).
- Vale tanto para SQLite como para Postgres/Turso; no usa nada específico del
  motor (ADR-002).

### 6.2. Rutas

- **Nuevas**: `/liga/[slug]/{clasificacion,calendario,rondas,bracket,mis-partidas,bases}`,
  `/admin/[slug]/{liga,jugadores,emparejamientos,rondas,playoffs,bases}`,
  `/admin/nueva`.
- **Cambian de papel**: `/admin` pasa de panel de la liga única a índice de
  ligas.
- **Se convierten en redirecciones**: `/clasificacion`, `/calendario`, `/rondas`,
  `/bracket`, `/mis-partidas` y `/bases` (§4.3, §5.10, §2.11).
- **Sin cambios**: `/login`, `/guia`, `/unauthorized`, `/mi-perfil` (salvo la
  redirección de §5.8).

### 6.3. Ficheros que se tocan

| Fichero | Qué cambia |
|---|---|
| `prisma/schema.prisma` + migración nueva | `slug`, `archivedAt`, `rulesMarkdown` |
| `src/app/bases/page.tsx` | De 259 líneas de JSX fijo a página por liga: bloque generado desde `League` + prosa en markdown (§2.11, §4.11). El texto actual se extrae como plantilla por defecto |
| `prisma/seed.ts` | Deja de asumir una liga; siembra dos para poder probar el caso real |
| `src/lib/auth.ts:56` | `verifyPlayerPasscode` filtra `role: "PLAYER"` y liga no archivada |
| `src/app/api/auth/login-admin/route.ts:35` | Deja de resolver `playerId`; firma con `null` |
| `src/lib/guards.ts` | Guardas nuevas de contexto de liga: resolver slug, comprobar acceso (§4.2), bloquear escritura en archivada |
| `src/lib/schemas.ts` | Esquemas Zod de crear liga (con slug y nombre del admin), duplicar y archivar |
| `src/server/league-actions.ts` | `createLeague` crea slug + `Player` ADMIN; `updateLeague` recalcula slug; `createPlayer`/`updatePlayer` validan nombre global; `deletePlayer` protege al ADMIN; nuevas `archiveLeague`, `unarchiveLeague`, `duplicateLeague`, `deleteLeague`, `updateLeagueRules` |
| `src/server/match-actions.ts`, `round-actions.ts`, `playoff-actions.ts`, `result-actions.ts` | Guarda de liga archivada; el actor admin se deriva por liga en lugar de salir de la sesión |
| Las 10 páginas con `findFirst` (§1) | Reciben el slug por parámetro de ruta |
| `src/components/AppHeader.tsx:27`, `src/components/AdminMenu.tsx:19` | `NAV_LINKS` y `ADMIN_LINKS` son rutas absolutas fijas; pasan a construirse con el slug de la liga del contexto |
| `src/components/AppHeaderUser.tsx` | Debe funcionar con `playerId: null` en sesión de admin |
| `src/app/admin/page.tsx:29` | El contador de jugadores activos deja de ser global |
| `tests/e2e/*`, `tests/e2e/seed-e2e.ts` | Las rutas del recorrido cambian; el seed e2e siembra dos ligas |

### 6.4. Compatibilidad

- **Compatible hacia atrás**: los datos existentes siguen siendo válidos; la
  migración solo añade columnas. Los enlaces antiguos sin liga redirigen.
- **Rompe**: cualquier enlace a una ruta de admin (`/admin/liga`, …), que pasa a
  requerir liga. Y los enlaces con slug tras renombrar la liga (§2.6).

## 7. Restricciones

- **Portabilidad SQLite↔Postgres** (ADR-002): nada de SQL específico del motor,
  ni índices parciales, ni tipos nativos. La unicidad condicional de
  `displayName` vive en la aplicación por este motivo.
- **Un solo `ADMIN_PASSCODE`** (ADR-004). No se añaden variables de entorno ni
  se toca el modelo de autenticación más allá de lo descrito en §4.4.
- **La liga nunca viaja en la cookie.** Si aparece la tentación de cachear la
  "liga actual", es señal de que algo no está tomando el slug de la ruta.
- **Mobile-first y dark hard-coded** (ADR-006): el índice de ligas y las
  pantallas nuevas siguen las mismas reglas de UI que el resto.
- **El dominio no se toca.** `src/server/standings.ts`, `pairings.ts`,
  `rounds.ts`, `bracket.ts` y `result-logic.ts` son funciones puras que ya
  reciben los datos de una liga; esta feature no cambia sus firmas ni su
  comportamiento.
- **Idioma**: código y comentarios en inglés, UI y mensajes en español.

### 7.1. Continuidad en producción

**Restricción dura: un usuario de producción no debe notar este cambio más allá
de que le cambie la URL.** Nada de volver a iniciar sesión, nada de perder un
marcador, nada de que el contenido diga algo distinto. Es un criterio de
aceptación por sí mismo (43-47) y manda sobre cualquier decisión de diseño
anterior que lo contradiga.

Qué lo garantiza, punto por punto:

| Superficie | Cómo se preserva |
|---|---|
| Sesiones abiertas en el deploy | `SessionPayload` no cambia (§4.4): las cookies firmadas siguen siendo válidas y nadie tiene que volver a entrar |
| Login | Nombre + passcode, sin selector de liga ni paso nuevo (§2.7) |
| Marcadores de vistas de jugador | Las rutas antiguas siguen respondiendo y redirigen (§4.3, §5.10) |
| Marcador público de `/bases` | Con una sola liga en circulación, `/bases` lleva a sus bases sin pedir login (§2.11) |
| Contenido de las bases | La migración rellena `rulesMarkdown` con la plantilla por defecto, que reproduce el texto actual menos lo que pasa a generarse; el bloque generado imprime los mismos valores que la liga ya tiene configurados |
| Datos | Migración aditiva: tres columnas, cero borrados, cero reescrituras (§6.1) |
| Navegación | Las mismas entradas en la cabecera, apuntando a la ruta con slug |

**Lo único que sí cambia para un jugador, aparte de la URL**: la cabecera pasa a
mostrar en qué liga está (§4.10). Es aditivo y no quita nada de sitio; si al
revisar se decide que sobra para jugadores, se deja solo para el admin.

## 8. Criterios de aceptación

Numerados y verificables. Salvo mención expresa, "liga A" y "liga B" son dos
ligas en circulación con rosters disjuntos y el admin presente en ambas.

**Aislamiento**

1. Con dos ligas en la base de datos, `grep -rn "league.findFirst" src/app` no
   devuelve ninguna línea: ninguna página resuelve la liga implícitamente.
2. Un jugador de A que abre `/liga/<slug-A>/clasificacion` ve exactamente a los
   jugadores de A, y ninguno de B.
3. Crear la liga B no altera lo que ve un jugador de A en ninguna de sus cinco
   vistas.
4. La clasificación de A calculada con dos ligas en la base coincide, fila a
   fila, con la calculada con A como única liga.

**Acceso**

5. Un jugador de A que pide `/liga/<slug-B>/clasificacion` acaba en
   `/liga/<slug-A>/clasificacion`, sin mensaje de error y sin ver dato alguno
   de B.
6. Un jugador de A que pide `/liga/<slug-inexistente>/rondas` acaba en
   `/liga/<slug-A>/rondas`, indistinguible del caso anterior.
7. Un jugador que abre `/clasificacion` acaba en `/liga/<su-slug>/clasificacion`.
8. El admin que abre `/clasificacion` acaba en `/admin`.
9. El admin accede a `/liga/<slug-A>/…` y a `/liga/<slug-B>/…` en la misma
   sesión, sin cerrar ni reabrir nada.

**Identidad y actor**

10. Tras el login de admin, la sesión lleva `playerId: null`.
11. Un resultado apuntado por el admin en la liga B tiene `Result.reportedById`
    apuntando a un `Player` cuyo `leagueId` es el de B.
12. La entrada de `AuditLog` de esa misma acción tiene `actorId` apuntando a ese
    mismo `Player` de B.
13. Toda liga recién creada —en blanco o duplicada— contiene exactamente un
    `Player` con `role = ADMIN`.
14. Intentar borrar el `Player` con `role = ADMIN` de una liga falla y deja la
    fila intacta.

**Nombres**

15. Dar de alta en B un `displayName` que ya existe en A (en circulación) falla
    con error en el campo, y no crea fila.
16. Ese mismo alta sí funciona si la liga que tenía el nombre está archivada.
17. Con "Javi" en la liga archivada de 2026 y "Javi" en la liga de 2027 en
    circulación, el login de "Javi" entra siempre en la de 2027.
18. Un jugador de una liga archivada no puede iniciar sesión: recibe el mismo
    error genérico que unas credenciales incorrectas.

**Slug**

19. Crear una liga "Liga de los Martes" / "Primavera 2026" produce el slug
    `liga-de-los-martes-primavera-2026` (kebab-case ASCII, sin tildes).
20. Crear una segunda liga con el mismo nombre y temporada produce un slug
    distinto, con sufijo numérico, y ambas siguen resolviendo.
21. Renombrar una liga cambia su slug, y el slug anterior deja de resolver: el
    admin ve la pantalla de §5.1 con la lista de ligas, no un 404 seco.

**Archivado**

22. Archivar una liga la saca del índice de ligas en circulación y la deja
    visible en el bloque de archivadas.
23. Toda acción de escritura sobre una liga archivada falla con error explícito,
    incluso invocada directamente (no basta con deshabilitar el botón).
24. Un jugador con sesión abierta cuya liga se archiva es devuelto a `/login` en
    su siguiente petición.
25. Desarchivar una liga cuyos nombres chocan con una en circulación falla,
    lista los nombres en conflicto y no modifica `archivedAt`.

**Crear y duplicar**

26. Duplicar una liga **archivada** crea una liga en `SETUP` con la misma
    configuración de puntuación, cupo y playoffs, y una fila `Player` por cada
    jugador activo del origen.
27. Esa duplicación no copia partidas, resultados, rondas ni bracket: la liga
    destino tiene cero `Match`.
28. Los passcodes de los jugadores duplicados son nuevos: el hash de cada
    jugador destino es distinto del de su origen, y la pantalla final los lista
    una vez.
29. Duplicar una liga **en circulación** crea la liga con la configuración
    copiada y **sin** jugadores (más allá del `Player` ADMIN del criterio 13).
30. Si la duplicación falla a mitad, no queda ni liga ni jugador creados.

**Borrado**

31. Borrar una liga en `SETUP` y sin partidas la elimina junto a sus jugadores.
32. Borrar una liga con al menos una partida falla y la liga sigue existiendo
    con sus datos.

**Bases**

33. `/liga/<slug-A>/bases` y `/liga/<slug-B>/bases` devuelven textos distintos,
    y ninguno menciona datos de la otra liga.
34. Ambas responden **sin sesión** (200, no redirección a `/login`).
35. Cambiar `pointsWin` de 3 a 2 en `/admin/<slug>/liga` cambia lo que dice el
    bloque de puntuación de `/liga/<slug>/bases`, sin editar ningún texto.
36. Lo mismo con `matchesPerRound`, `playoffSize`, `bonusEnabled` y el orden de
    `tiebreakers`: la página refleja el valor vigente.
37. Editar la prosa en `/admin/<slug>/bases` cambia `/liga/<slug>/bases` de esa
    liga y **no** la de la otra.
38. Borrar toda la prosa deja la página en pie, mostrando solo el bloque
    generado.
39. `/liga/<slug>/bases` de una liga archivada sigue respondiendo; intentar
    guardar sus bases falla.
40. `/bases` a secas no lista ligas en ningún caso: redirige según la sesión
    (jugador → las suyas, admin → `/admin`, sin sesión → `/login`).

**Migración**

41. Aplicada la migración sobre la base actual, la liga existente tiene un
    `slug` no vacío, `archivedAt` a `null` y `rulesMarkdown` con la plantilla
    por defecto, y todas sus partidas, resultados, rondas y bracket siguen
    intactos.
42. La suite existente (`npm run test`) pasa entera, con los tests de rutas
    actualizados.

**Continuidad en producción (§7.1)**

43. Una cookie de sesión firmada **antes** del deploy sigue siendo válida
    después: el jugador no vuelve a ver la pantalla de login.
44. Con una sola liga en circulación, `/bases` **sin sesión** devuelve las bases
    de esa liga (200), no una redirección a `/login`.
45. La página de bases renderizada tras la migración dice lo mismo que
    `src/app/bases/page.tsx` dice hoy: mismas secciones y mismos valores de
    puntuación, desempates y partidas por ronda.
46. Con sesión previa al deploy, abrir cualquiera de las cinco rutas antiguas
    lleva a la misma página dentro de su liga, sin pasos intermedios.
47. Ninguna acción de la migración borra o reescribe filas existentes: solo
    añade columnas y las rellena.

## 9. Riesgos y preguntas abiertas

### Riesgos

- **Renombrar rompe enlaces** (§2.6). El slug se regenera con el nombre y no hay
  historial, así que un renombrado a mitad de temporada invalida en silencio los
  enlaces que ya circulan por el grupo. Mitigación acordada: la pantalla de §5.1
  en vez de un 404. Mitigación adicional posible, no incluida: avisar en el
  formulario de edición de que el enlace va a cambiar.
- **La unicidad de nombres es de aplicación, no de base de datos** (§2.7). Una
  ruta de escritura que se olvide de comprobarla puede crear el duplicado que
  rompe el login. Conviene concentrar la comprobación en un único punto que usen
  tanto `createPlayer` como `updatePlayer` como la duplicación.
- **Superficie amplia de refactor.** Diez páginas, seis módulos de acciones y dos
  componentes de navegación. El riesgo no es conceptual sino de olvido: una
  consulta sin `leagueId` mezclaría datos de las dos ligas sin dar error.
- **El histórico se pierde para el jugador** (§2.8). Al archivar, el jugador deja
  de poder entrar y su temporada anterior solo la ve el admin. Es lo decidido,
  pero es la primera vez que un jugador pierde acceso a algo que tenía.
- **`ADMIN_PASSCODE` único** administra ahora dos grupos de amigos distintos. El
  radio de una filtración crece: quien lo tenga puede alterar las dos ligas.

### Preguntas abiertas

Ninguna bloquea la implementación. Quedan como decisiones menores de
implementación:

- Etiqueta exacta y sitio del indicador de liga en la cabecera cuando el admin
  navega entre ligas (que la cabecera lo muestre está decidido; el diseño
  concreto, no).
- Formato exacto de la pantalla que lista los passcodes tras duplicar (tabla
  copiable, descarga, ambas).

## 10. Bitácora

- `v1` — primer borrador: esqueleto y estado actual del código verificado en el repo.
- `v2` — interrogatorio completo. Decisiones: rosters disjuntos con el admin como
  única excepción; el jugador solo ve su liga; liga en la URL para admin y para
  jugador; slug legible regenerado al renombrar; `displayName` único entre ligas
  en circulación; archivado con `archivedAt`; crear en blanco y duplicar
  (roster solo desde archivada, passcodes nuevos); borrado únicamente sin
  partidas; admin siempre dado de alta como `Player` de cada liga. Secciones
  1-9 escritas y 34 criterios de aceptación. Estado a `REVIEW`.
- `v3` — **bases por liga** (§2.11, §4.11): modelo híbrido, con puntuación,
  bonus, desempates, cupo y playoffs generados desde `League`, y el resto como
  prosa markdown en `League.rulesMarkdown`, editable en `/admin/[slug]/bases`.
  Las bases siguen siendo públicas sin login, ahora en `/liga/[slug]/bases`.
  Corregido un error de v2: §3 afirmaba que toda la app estaba tras el login,
  y `/bases` ya era pública. Casos límite nuevos (§5.8.1-5.8.3), 8 criterios
  más (33-40, con renumeración de los de migración). Vuelta a `DRAFT`.
- `v4` — sin cambios de contenido. Cerrado el interrogatorio de las bases sin
  preguntas abiertas que bloqueen; estado a `REVIEW` a la espera de aprobación
  explícita para el hand-off a `/feature`.
- `v5` — §4.3 explicita cómo se resuelve el slug en las redirecciones de las
  rutas antiguas (`cookie.playerId → Player.leagueId → League.slug`), que la
  cookie no lleva la liga y que el caso admin corta antes sin consultar nada.
  Sigue en `REVIEW`.
- `v6` — **continuidad en producción** como restricción dura (§7.1) con su tabla
  de garantías y 5 criterios nuevos (43-47). Corregido el único punto que la
  incumplía: `/bases` sin sesión ya no manda a `/login` — con una sola liga en
  circulación sirve las bases de esa liga, y solo a partir de la segunda pide el
  enlace concreto, sin listar ligas (§2.11). Sigue en `REVIEW`.
- `v7` — sin cambios de contenido. Aprobada por el usuario el 2026-09-11; estado
  a `APPROVED` y hand-off a `/feature` con este documento como input principal.
