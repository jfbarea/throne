# SPEC — throne

> Fuente de verdad del proyecto. Especificación funcional y técnica.
> Documentación en español; el código y los comentarios irán en inglés.

## 1. Objetivo

**throne** es una aplicación web responsive para gestionar una liga privada de
**Warhammer 40.000** entre un grupo de amigos (10-20 jugadores). El formato es
**fase de liga (round-robin, todos contra todos) seguida de playoffs
(eliminatoria simple)**. Cualquier jugador puede apuntar el resultado de sus
propias partidas desde el móvil; un administrador configura y gobierna la liga.

El nombre _throne_ evoca el Trono Dorado: una sola fuente de autoridad sobre la
liga, alrededor de la cual giran los contendientes.

## 2. Alcance

### 2.1. Dentro del MVP

- Una sola edición/temporada de liga activa, creada y configurada por el admin.
- Alta de jugadores por parte del admin, con facción/ejército opcional.
- Configuración del sistema de puntuación de liga (puntos por victoria, empate,
  derrota y bonus opcionales).
- Generación automática de los **emparejamientos** round-robin (todos los pares
  únicos: cada jugador juega contra cada otro exactamente una vez). No hay
  jornadas ni rondas rígidas, y por tanto **no hay byes en la fase de liga**.
- **Agendado por fecha libre**: cualquiera de los dos participantes (o el admin)
  fija directamente la fecha (y opcionalmente el lugar) de cada partida, sin
  flujo de aceptación por el rival. El calendario emerge de esas fechas.
- Flujo de **apuntar resultado** por un jugador + **confirmación del rival**
  (o validación del admin) para evitar disputas.
- Cálculo de **standings** (clasificación) con desempates deterministas.
- **Transición a playoffs**: los N mejores clasificados (configurable) entran en
  un bracket de eliminatoria simple; avance ronda a ronda.
- Vistas responsive mobile-first: clasificación, calendario, mis partidas,
  bracket, panel de admin.

### 2.2. No-goals (fuera del MVP, sin cerrar puertas)

- Despliegue cloud / CI-CD (queda como decisión futura; el diseño debe permitir
  desplegar a Vercel o un VPS sin reescribir).
- Múltiples ligas/temporadas simultáneas o histórico multi-temporada navegable.
- Doble eliminación, suizo, grupos múltiples u otros formatos de torneo.
- Detalle táctico de la partida (misión, despliegue, secundarias por turno,
  listas de ejército completas con puntos por unidad).
- Notificaciones push / email, chat, comentarios.
- Flujo de proponer/aceptar fecha entre jugadores (negociación con confirmación):
  en el MVP la fecha la fija directamente uno de los participantes o el admin.
- Registro público / federación de cuentas externas (OAuth providers).
- Apps nativas iOS/Android.
- Internacionalización: la UI va solo en español por ahora.

## 3. Stack tecnológico y decisiones (ADR breves)

### ADR-001 — Framework: Next.js (App Router) + TypeScript

Decidido por el usuario. Full-stack en un solo repo: UI (React Server/Client
Components), API y lógica de dominio conviven. App Router con Route Handlers
para la API y Server Actions para mutaciones sencillas de formularios.
**Estado: aceptado.**

### ADR-002 — Base de datos: SQLite en dev, Postgres-ready

Para uso local con 10-20 usuarios, **SQLite** es el arranque más simple: cero
infraestructura, fichero único, backup trivial (copiar el `.db`). La capa de
acceso se diseña agnóstica para poder mover a **Postgres** al desplegar
(Vercel Postgres / Neon / VPS) cambiando solo el `datasource` y la URL.
**Estado: aceptado.** Consecuencia: evitar features SQL específicas de un motor;
toda la lógica de standings y desempates se calcula en la capa de aplicación,
no en SQL propietario.

### ADR-003 — ORM: Prisma

Prisma da un esquema declarativo único, migraciones versionadas, tipos
generados end-to-end y soporta SQLite y Postgres con el mismo `schema.prisma`.
Encaja con el objetivo de simplicidad de arranque + portabilidad de DB.
**Estado: aceptado.**

### ADR-004 — Autenticación proporcional al grupo

Ver sección 6. **Estado: aceptado.** Mecanismo: sesión por cookie firmada con
un identificador ligero por jugador (PIN/passcode emitido por el admin), sin
proveedores externos. Suficiente para que nadie falsifique resultados de otro
sin sobredimensionar para 10-20 amigos.

### ADR-005 — Validación de datos: Zod

Esquemas Zod compartidos entre cliente y servidor para validar formularios y
payloads de API, derivando tipos TypeScript. **Estado: aceptado.**

### ADR-006 — Estilos: Tailwind CSS, mobile-first, dark mode

Tailwind para iterar rápido en responsive. Mobile-first porque los resultados
se apuntan desde el móvil en la mesa de juego. Dark mode por defecto (acorde a
preferencias del usuario). **Estado: aceptado.**

### ADR-007 — Calendario por fecha libre, no por jornadas

Decidido por el usuario. La fase de liga genera solo el **conjunto de
emparejamientos** (todos los pares únicos), no un calendario organizado en
jornadas/rondas. Cada partida tiene una **fecha acordada libremente**: cualquiera
de los dos participantes —o el admin— la fija directamente, sin que el rival
tenga que aceptarla. **Estado: aceptado.** Consecuencias:

- Desaparece la entidad `Round` y todo el _circle method_ de la fase de liga.
- No hay byes en la fase de liga (un número impar de jugadores produce
  simplemente `C(n,2)` partidas; nadie descansa por ronda porque no hay rondas).
- El "calendario" deja de ser una rejilla de jornadas y pasa a ser una **vista
  ordenable por fecha** de las partidas agendadas y las pendientes de agendar.
- Los byes **siguen existiendo en playoffs** si `playoffSize` no es potencia de
  2 (ver 7.4); esto no cambia.

### Resumen del stack

| Capa            | Elección                                  |
| --------------- | ----------------------------------------- |
| Framework       | Next.js (App Router) + TypeScript         |
| UI              | React + Tailwind CSS (mobile-first, dark) |
| API             | Route Handlers + Server Actions           |
| Validación      | Zod                                       |
| ORM             | Prisma                                    |
| DB (dev)        | SQLite                                    |
| DB (futuro)     | Postgres                                  |
| Auth            | Cookie de sesión firmada + passcode       |
| Tests           | Vitest (unit/dominio) + Playwright (e2e)  |
| Lint/format     | ESLint + Prettier                         |

## 4. Modelo de datos

Entidades principales. Los nombres de campo del esquema irán en inglés; aquí se
documentan en español. PK implícita `id` (cuid/uuid) en todas.

### 4.1. League (Liga)

Configuración global de la edición activa. En el MVP existe una sola liga activa.

- `name` — nombre de la liga.
- `season` — etiqueta de temporada/edición (texto, p.ej. "2026 Primavera").
- `status` — `SETUP` | `LEAGUE` | `PLAYOFFS` | `FINISHED`.
- `pointsWin`, `pointsDraw`, `pointsLoss` — puntos de liga por resultado
  (defaults 3 / 1 / 0, editables por admin).
- `bonusEnabled` — si hay bonus, y campos de configuración de bonus
  (ver sección 7.1).
- `playoffSize` — cuántos jugadores clasifican a playoffs (p.ej. 4 u 8).
- `tiebreakers` — orden de criterios de desempate (ver 7.3), almacenado como
  lista ordenada.

### 4.2. Player (Jugador)

- `displayName` — nombre visible.
- `faction` — facción/ejército de W40k (opcional, texto o enum laxo).
- `role` — `ADMIN` | `PLAYER`.
- `passcodeHash` — hash del passcode/PIN de acceso (ver auth).
- `active` — si participa en la liga (permite dar de baja sin borrar histórico).

### 4.3. (Eliminada) Round (Ronda)

> **Eliminada por ADR-007.** La fase de liga ya no se organiza en jornadas, así
> que no existe entidad `Round`. Las partidas de liga cuelgan directamente de la
> liga y se ordenan por su `scheduledAt`. No hay byes de liga asociados a
> rondas. (Los playoffs sí mantienen su noción de ronda dentro del bracket vía
> `BracketSlot.roundIndex`; ver 4.6.)

### 4.4. Match (Partida / Emparejamiento)

Unidad central. Cubre tanto fase de liga como playoffs. Tiene **dos dimensiones
independientes**: el **agendado** (¿tiene fecha?) y el **estado del resultado**
(`status`). Una partida puede tener fecha sin estar reportada, o estar reportada
sin que se llegara a fijar fecha; ver 7.5.

- `leagueId` — FK a League.
- `phase` — `LEAGUE` | `PLAYOFF`.
- `playerHomeId`, `playerAwayId` — FKs a Player. En byes de playoff,
  `playerAwayId` es null.
- `scheduledAt` — fecha (y hora opcional) acordada para la partida. **Nullable**:
  mientras es `null`, la partida está "sin fecha"; cuando tiene valor, está
  "agendada". No se introduce un enum aparte; el estado de agendado se **deriva**
  de `scheduledAt == null`.
- `location` — lugar de juego (texto libre, **opcional/nullable**).
- `isBye` — true solo en byes de **playoff** (el seed avanza sin jugar). En la
  fase de liga siempre es false (no hay byes de liga).
- `status` — `SCHEDULED` | `REPORTED` | `CONFIRMED` | `DISPUTED`. Aquí
  `SCHEDULED` significa "emparejamiento generado, pendiente de resultado"
  (tenga o no fecha); **no** implica que haya fecha acordada.
- `bracketSlotId` — FK a BracketSlot (nullable; sólo en playoffs).

> Nota de nomenclatura: el valor de `status` `SCHEDULED` se refiere al ciclo de
> vida del **resultado** (heredado del flujo anti-disputa), no a tener fecha. El
> hecho de "estar agendada" (tener `scheduledAt`) es ortogonal. Ver 7.5.

### 4.5. Result (Resultado)

Separado de Match para registrar quién reporta y permitir confirmación.

- `matchId` — FK a Match (1:1 con el resultado vigente).
- `homeVictoryPoints`, `awayVictoryPoints` — VP de cada jugador.
- `outcome` — `HOME_WIN` | `AWAY_WIN` | `DRAW` (derivable de VP, pero se
  almacena explícito porque W40k permite empates por reglas de misión).
- `reportedById` — FK a Player que apuntó el resultado.
- `confirmedById` — FK a Player que lo confirmó (rival o admin), nullable.
- `reportedAt`, `confirmedAt` — timestamps.
- `bonusHome`, `bonusAway` — puntos de liga de bonus aplicados (ver 7.1).

> Nota de integridad: un Match no entra en standings hasta que su Result está
> `CONFIRMED`. Mientras esté `REPORTED` cuenta como provisional/pendiente.

### 4.6. Bracket y BracketSlot (Eliminatoria)

Estructura del cuadro de playoffs (eliminatoria simple).

- **Bracket**: `leagueId`, `size` (= `playoffSize`, potencia de 2 efectiva tras
  byes de seeding).
- **BracketSlot**: nodo del árbol. `bracketId`, `roundIndex` (1=primera ronda…,
  hasta la final), `position` dentro de la ronda, `playerId` (nullable hasta
  resolverse), `matchId` (la partida que decide quién avanza a este slot),
  `feedsIntoSlotId` (FK al slot de la siguiente ronda).

### 4.7. AuditLog (opcional, recomendado)

Registro append-only de acciones sensibles (reportar, confirmar, editar config,
resolver disputa). `actorId`, `action`, `entityType`, `entityId`, `payload`,
`createdAt`. Útil para resolver disputas y dar transparencia al grupo.

### 4.8. Relaciones (resumen)

```
League 1───* Match *───1 Result
League 1───* Player
League 1───1 Bracket 1───* BracketSlot 1───0..1 Match
Player 1───* Match (como home / como away)
Player 1───* Result (como reporter / confirmer)
```

> Ya no existe `League 1───* Round 1───* Match`: los Match de liga cuelgan
> directamente de League y se ordenan por `scheduledAt`. Los Match de playoff se
> asocian a un `BracketSlot`.

## 5. Roles y permisos

| Acción                                   | Admin | Jugador          |
| ---------------------------------------- | :---: | :--------------: |
| Crear/editar liga y configuración        |  Sí   | No               |
| Alta/baja de jugadores                   |  Sí   | No               |
| Editar su propia facción/nombre          |  Sí   | Sí (su perfil)   |
| Generar emparejamientos round-robin      |  Sí   | No               |
| Fijar/editar la fecha de una partida     |  Sí   | Sí (sus partidas)|
| Apuntar resultado de partida propia      |  Sí   | Sí (sus partidas)|
| Confirmar resultado apuntado por el rival|  Sí   | Sí (su partida)  |
| Editar/forzar cualquier resultado        |  Sí   | No               |
| Resolver disputa                         |  Sí   | No               |
| Cerrar fase de liga e iniciar playoffs   |  Sí   | No               |
| Ver standings, calendario y bracket      |  Sí   | Sí               |

El admin es también un Player con `role = ADMIN` (puede jugar la liga).

> Sobre fijar fecha: **cualquiera de los dos participantes** puede fijar o editar
> la `scheduledAt` de su partida sin que el otro la acepte; el admin puede hacerlo
> en cualquier partida. No hay flujo de propuesta/aceptación.

## 6. Autenticación (ADR-004 en detalle)

Diseño proporcional a un grupo cerrado de 10-20 amigos. Objetivo: que un jugador
no pueda falsificar resultados haciéndose pasar por otro, sin montar OAuth ni
gestión de cuentas pesada.

**Mecanismo:**

1. El admin se autentica con una **clave de administrador** (variable de
   entorno `ADMIN_PASSCODE`, comparada con hash en el servidor).
2. Cada jugador recibe del admin un **passcode/PIN** corto e individual
   (generado por la app, mostrado al admin para repartirlo). Se guarda hasheado
   (`passcodeHash`, bcrypt/argon2).
3. Login del jugador: selecciona su nombre + introduce su passcode → el servidor
   verifica el hash y emite una **cookie de sesión firmada** (HttpOnly, SameSite
   Lax, `Secure` en producción). Sesión sin estado en DB o con tabla `Session`
   ligera; se prioriza JWT/cookie firmada con secreto (`SESSION_SECRET`).
4. La identidad de la sesión determina de qué partidas eres home/away; el
   servidor **nunca** confía en un `playerId` enviado por el cliente para
   autorizar acciones.

**Por qué no más:** con 10-20 personas de confianza, passcode + sesión firmada +
confirmación cruzada del rival es suficiente disuasión. El `AuditLog` y la
confirmación del rival cubren el caso de mala fe. Email/OAuth se posponen.

**Variables de entorno:** `ADMIN_PASSCODE`, `SESSION_SECRET`, `DATABASE_URL`.

## 7. Reglas de dominio

### 7.1. Sistema de puntuación de liga (configurable)

Por defecto: **victoria 3, empate 1, derrota 0**. Editable por el admin en la
config de la liga (`pointsWin/Draw/Loss`).

**Bonus opcionales** (activables con `bonusEnabled`), pensados para W40k:

- **Bonus de masacre / margen amplio**: punto extra si el ganador supera al
  rival por un umbral de VP configurable.
- **Bonus por VP mínimos**: punto extra si el jugador alcanza X VP aunque pierda
  (premia jugar agresivo).

Los bonus se almacenan resueltos en `Result.bonusHome/bonusAway` para que la
clasificación sea reproducible aunque cambie la config después.

> Ya no existe "puntos de bye" en la fase de liga: sin rondas no hay byes de
> liga. Los byes de **playoff** simplemente hacen avanzar al seed, sin puntos de
> liga implicados (ver 7.4).

### 7.2. Generación de emparejamientos (round-robin de pares únicos)

La app genera el **conjunto completo de emparejamientos**, no un calendario por
jornadas:

- Función pura `generatePairings(players)`: produce todos los **pares únicos**
  de jugadores activos. Para `n` jugadores son exactamente `C(n,2) = n·(n-1)/2`
  partidas. Cada jugador se enfrenta a cada otro **una sola vez**; nadie se
  empareja consigo mismo; el par `{A,B}` aparece una única vez.
- **No** se usa circle method, **no** hay rondas/jornadas y **no** hay byes:
  un número impar de jugadores produce igualmente `C(n,2)` partidas sin que
  nadie descanse.
- Local/visitante (home/away) se asigna al crear cada par (orden estable, en
  W40k importa poco mecánicamente, pero se registra para orden y futuras
  misiones). No se busca equilibrar home/away por ronda porque no hay rondas.
- El admin puede regenerar los emparejamientos sólo mientras `status = SETUP` o
  `LEAGUE` sin resultados confirmados (para no invalidar partidas ya jugadas).
  Regenerar descarta las fechas (`scheduledAt`) previas.

**Agendado por fecha libre:** los emparejamientos nacen **sin fecha**
(`scheduledAt = null`). Después, cualquiera de los dos participantes —o el
admin— **fija directamente** la fecha (y opcionalmente `location`) de la partida,
sin que el rival deba aceptarla. La fecha puede **editarse** o limpiarse
posteriormente por los mismos actores. El **calendario emerge** de estas fechas
(ver 8): es la vista ordenada por `scheduledAt` de las partidas agendadas, más
las pendientes de agendar.

### 7.3. Standings (clasificación) y desempates

Se calcula en la capa de aplicación a partir de Results `CONFIRMED`.

Por jugador: partidas jugadas, ganadas, empatadas, perdidas, **puntos de liga**,
VP a favor, VP en contra, **diferencia de VP**.

**Orden por defecto** (cadena de desempates, configurable vía `tiebreakers`):

1. Puntos de liga (desc).
2. Diferencia de VP (`VP a favor - VP en contra`, desc).
3. VP a favor (desc).
4. Resultado del enfrentamiento directo (head-to-head) entre los empatados.
5. Menor número de partidas jugadas con derrota (criterio final estable).
6. Desempate final determinista por `id`/orden de alta (para evitar empates no
   resolubles en la UI).

El cálculo debe ser **puro y testeable** (función `computeStandings(matches,
config)`), sin depender de SQL propietario.

### 7.4. Transición liga → playoffs

- El admin cierra la fase de liga cuando todas las partidas relevantes están
  `CONFIRMED` (o decide cerrarla; partidas sin confirmar quedan registradas).
- Se toman los **`playoffSize` mejores** de los standings como _seeds_.
- Se construye un **bracket de eliminatoria simple** con seeding estándar
  (1 vs N, 2 vs N-1, …). Si `playoffSize` no es potencia de 2, los mejores seeds
  reciben **bye en primera ronda** hasta cuadrar el árbol. (Estos byes de
  playoff son los únicos byes del sistema; la fase de liga no tiene byes.)
- Cada `Match` de playoff genera el avance del ganador al `feedsIntoSlot`
  correspondiente al confirmarse su Result. La final corona al campeón.
- En playoffs, los empates no son válidos: si la misión termina empatada, se
  requiere desempate (regla acordada por el grupo); el sistema fuerza un
  `outcome` ganador al confirmar.

### 7.5. Agendado de fecha y flujo de resultado (dos dimensiones independientes)

Una partida tiene **dos dimensiones que no se deben confundir**:

- **Agendar la partida** = fijar su `scheduledAt` (y opcionalmente `location`).
  Lo hace directamente cualquiera de los dos participantes o el admin, sin
  aceptación del rival. Es editable. No altera el `status` del resultado.
- **Reportar/confirmar el resultado** = el ciclo `status` anti-disputa de abajo.

Pueden ocurrir en **cualquier orden**: una partida puede tener fecha y aún no
estar reportada, o reportarse sin que nunca se fijara fecha.

**Flujo de resultado (anti-disputa):**

1. Un jugador de la partida abre su Match `SCHEDULED` y **reporta** VP de ambos
   y el `outcome` → Match pasa a `REPORTED`, Result con `reportedById`.
2. El **rival recibe la partida pendiente de confirmar**. Puede:
   - **Confirmar** → Match `CONFIRMED`, entra en standings.
   - **Disputar** → Match `DISPUTED`, requiere intervención del admin.
3. El **admin** puede confirmar, editar o resolver cualquier partida en
   cualquier estado (override), dejando rastro en `AuditLog`.
4. Regla de auto-confirmación opcional (futuro): si el rival no actúa en X días,
   el admin puede confirmar en bloque. (No en MVP, pero el modelo lo soporta.)

> `SCHEDULED` como `status` describe "emparejamiento generado, pendiente de
> resultado", **independientemente** de si tiene `scheduledAt`. No confundir con
> "agendada".

## 8. Vistas / UI (mobile-first, dark)

- **Login**: selector de jugador + passcode; acceso admin aparte.
- **Standings**: tabla de clasificación responsive (en móvil, tarjetas o tabla
  con scroll horizontal mínimo). Resalta zona de clasificación a playoffs.
- **Calendario**: **lista de partidas ordenable por fecha** (`scheduledAt`), no
  una rejilla de jornadas. Muestra primero/aparte las partidas **sin fecha**
  (pendientes de agendar) y luego las agendadas en orden cronológico. Cada fila
  muestra los dos jugadores, fecha y lugar (si los hay) y estado del resultado.
  Incluye **acción de fijar/editar fecha** (y lugar) en las partidas propias
  (cualquier participante) y en todas para el admin. Filtros básicos sugeridos:
  "sin fecha", "próximas", "jugadas".
- **Mis partidas**: las del jugador logueado, con acción rápida de **fijar fecha**
  y de **reportar / confirmar** resultado (optimizado para pulgar en la mesa de
  juego).
- **Bracket de playoffs**: árbol de eliminatoria.
- **Panel de admin**: config de liga, jugadores + passcodes, generar
  emparejamientos, resolver disputas, cerrar liga / iniciar playoffs.

## 9. Riesgos y mitigaciones

- **Cambios de config a mitad de liga** alterando standings retroactivamente →
  bonus y outcome se almacenan resueltos en Result; cambiar pesos recalcula solo
  agregados, no reescribe historia de VP.
- **Disputas de resultado** → confirmación cruzada + estado `DISPUTED` + admin +
  `AuditLog`.
- **Portabilidad de DB** → toda la lógica de negocio en la app, no en SQL
  específico; Prisma abstrae SQLite↔Postgres.
- **Regenerar emparejamientos** tras empezar a jugar → restringido por `status`
  y existencia de resultados confirmados; regenerar descarta fechas previas.
- **Confusión fecha vs resultado** → el modelo separa explícitamente
  `scheduledAt` (agendado) del `status` (ciclo del resultado); la UI las muestra
  como acciones distintas (ver 7.5 y 8).

## 10. Estructura de repositorio (prevista)

```
throne/
  SPEC.md
  plan/
    PLAN.md
    _state.json
  .claude/settings.json
  prisma/schema.prisma
  src/
    app/            # rutas Next.js (App Router)
    server/         # lógica de dominio pura (standings, pairings, bracket)
    lib/            # db client, auth, zod schemas
    components/     # UI
  tests/            # vitest + playwright
```
