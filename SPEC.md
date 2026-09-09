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
- La fase de liga se organiza en **rondas mensuales**: el round-robin completo
  (todos los pares únicos, cada jugador contra cada otro exactamente una vez)
  se reparte entre rondas, cada una con un cupo fijo de partidas por jugador
  (configurable, **2** por defecto) y una fecha de cierre. El número de
  rondas se **deriva** de los jugadores y el cupo; no se configura
  directamente. **No hay byes en la fase de liga**: un número impar de
  jugadores no deja a nadie sin partida (ver 4.3, ADR-008).
- **Agendado por fecha libre**: cualquiera de los dos participantes (o el admin)
  fija directamente la fecha (y opcionalmente el lugar) de cada partida, sin
  flujo de aceptación por el rival. El calendario emerge de esas fechas. La
  fecha de cierre de la ronda es un **límite**, no un día de quedada.
- Flujo de **apuntar resultado**: cualquiera de los dos participantes (o el
  admin) introduce los VP y la partida cuenta de inmediato en la
  clasificación; cualquiera de los dos puede editarlo después. No hay paso de
  confirmación del rival ni de disputa (ver 7.5).
- Al cerrar una ronda, las partidas que sigan sin resultado se **saldan sin
  jugar**: con vencedor pactado (incomparecencia, 80-0) o sin acuerdo (0-0) —
  ver 7.5.
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

> **Parcialmente derogado por ADR-008** (2026-09-09, `rondas-con-fecha`): dos
> de las cuatro consecuencias de abajo se derogan (❌), dos se mantienen (✅).
> El cuerpo de este ADR se conserva como registro histórico de la decisión
> original; no se reescribe con retroactividad.

Decidido por el usuario. La fase de liga genera solo el **conjunto de
emparejamientos** (todos los pares únicos), no un calendario organizado en
jornadas/rondas. Cada partida tiene una **fecha acordada libremente**: cualquiera
de los dos participantes —o el admin— la fija directamente, sin que el rival
tenga que aceptarla. **Estado: aceptado; parcialmente derogado por ADR-008.**
Consecuencias:

- ❌ **Derogada** (ADR-008): Desaparece la entidad `Round` y todo el _circle
  method_ de la fase de liga.
- ✅ **Se mantiene**, con matiz (ADR-008): No hay byes en la fase de liga (un
  número impar de jugadores produce simplemente `C(n,2)` partidas). La razón
  original —"nadie descansa por ronda porque no hay rondas"— ya no aplica tal
  cual: ahora vuelve a haber rondas, y quien descansa en la jornada impar del
  reparto simplemente juega una partida menos en la ronda de ese descanso, sin
  que se cree ninguna partida de bye (ver 4.3).
- ✅ **Se mantiene** (ADR-008): El "calendario" sigue siendo una **vista
  ordenable por fecha** de las partidas agendadas y las pendientes de agendar,
  no una rejilla de jornadas. La ronda de cada partida se muestra como
  etiqueta, nunca como agrupador rígido de "jornada" (ver 7.2, 8).
- Sin cambios: Los byes **siguen existiendo en playoffs** si `playoffSize` no
  es potencia de 2 (ver 7.4); esta derogación nunca los tocó.

### ADR-008 — Rondas mensuales de cupo (deroga parcialmente ADR-007)

Decidido por el usuario (`plan/specs/rondas-con-fecha.md`, `APPROVED`, v6,
2026-09-08). La fase de liga necesitaba estructura temporal: sin ella, una
partida podía quedar sin fecha indefinidamente y la clasificación nunca tenía
por qué avanzar, y nada le decía al grupo cuántas partidas debería llevar
jugadas cada uno a estas alturas. La solución reintroduce la entidad `Round`,
pero **no** la rejilla de jornadas rígidas que ADR-007 había eliminado: una
ronda es un **mes con cupo**, no un turno fijo de partidas concretas.

**Qué deroga de ADR-007 y qué mantiene** (spec §6.1 de `rondas-con-fecha`):

| Consecuencia de ADR-007 | Estado con esta feature |
| --- | --- |
| Desaparece la entidad `Round` | **Derogada.** `Round` vuelve como entidad: índice, fecha de cierre editable, marca de cerrada (ver 4.3). |
| Desaparece el _circle method_ de la fase de liga | **Derogada.** El circle method vuelve como base del reparto entre rondas (ver 7.2). |
| No hay byes en la fase de liga | **Se mantiene.** Un número impar de jugadores no crea ninguna partida de bye; quien descansa en la jornada impar del circle method tiene una partida menos en la ronda de ese descanso, no una partida de bye. |
| El calendario es una vista ordenable por fecha, no una rejilla de jornadas | **Se mantiene.** El agendado sigue siendo libre por pareja (7.5); la ronda es una etiqueta y una fecha límite, no una jornada de partidas fijas. La **jornada** del circle method ni se persiste como entidad ni se muestra: es un detalle interno del reparto (ver 4.3). |

**Estado: aceptado.** Consecuencias:

- Cada partida de liga pertenece a una ronda, fijada por el reparto al
  generar. Nadie la elige después — ni el jugador ni el admin tienen, en
  ninguna pantalla, forma de moverla (ver 4.3).
- Cada ronda tiene una fecha de cierre derivada del mes de arranque de la
  liga, editable por el admin sin reasignar partidas. Al cerrarla, lo que
  sigue sin resultado se salda sin jugar: 0-0 si no hubo acuerdo, o el 80-0
  de una incomparecencia si hubo vencedor pactado antes del cierre (ver 7.5).
- `startPlayoffs` gana una precondición que no existía bajo ADR-007: ninguna
  ronda puede quedar sin cerrar (ver 7.4).
- El reparto sobre el grafo completo sigue siendo el circle method, óptimo.
  El reparto sobre un **subgrafo** arbitrario —recalcular lo pendiente tras
  un alta a mitad de liga o un cambio de cupo (ver 5.1/5.5 de la spec de la
  feature)— es un problema de coloreado de aristas aparte: la cota de Vizing
  (`Δ+1` colores, con `Δ` el máximo de partidas pendientes de un jugador)
  existe, pero **no la alcanza un coloreado voraz simple** — un voraz por
  grado descendente solo garantiza `2Δ-1` colores. Verificado contra el
  código de esta feature: un `K_12` al que solo le faltaba **una** arista
  (`Δ=11`, la forma típica de las pendientes tras un alta a mitad de liga)
  llegó a gastar **15** colores con el límite en 12. La cota de Vizing solo se
  alcanza con un algoritmo **constructivo**: el que usa esta feature es
  **Misra & Gries**, que colorea reparando con **cadenas de Kempe** y sí llega
  a `Δ+1`. Cualquier reimplementación futura de este reparto debe partir de
  Misra & Gries, no de un voraz simple — ver `src/server/rounds.ts`.

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

### 4.3. Round (Ronda)

> **Restaurada por ADR-008**, que deroga parcialmente ADR-007 (ver 3, Stack
> tecnológico). La fase de liga vuelve a organizarse en rondas — pero rondas
> **mensuales de cupo**, no las jornadas rígidas que ADR-007 había eliminado.

Una ronda es un **mes de la fase de liga** con una fecha de cierre y un cupo
de partidas por jugador.

- `leagueId` — FK a League.
- `index` — 1-based, orden de la ronda dentro de la liga.
- `deadline` — fecha límite de la ronda. Se deriva del mes de arranque de la
  liga (`League.startMonth`) al generar los emparejamientos, como el último
  día de ese mes; el admin puede editarla después sin que eso reasigne
  ninguna partida.
- `closedAt` — `null` mientras la ronda está abierta; se fija al cerrarla
  (ver 7.5).

Todas las rondas de una liga están **abiertas desde el principio**: no hay
"ronda en curso" ni progresión bloqueante. Cualquier participante puede
agendar y apuntar cualquier partida en cualquier momento, sea de la ronda que
sea — **adelantar está permitido y no exime** del cupo de la ronda a la que
pertenece cada partida.

Las partidas de liga (`phase = LEAGUE`) pertenecen exactamente a una `Round`
(`Match.roundId`); las de playoff nunca pertenecen a ninguna. **La ronda de
cada partida la asigna el reparto al generar y es fija**: ni el jugador ni el
admin tienen, en ninguna pantalla, forma de moverla.

La **jornada** del circle method (ver 7.2) que arma el reparto es un detalle
interno del algoritmo: no se persiste como entidad ni se muestra al jugador.
Solo la ronda es visible.

### 4.4. Match (Partida / Emparejamiento)

Unidad central. Cubre tanto fase de liga como playoffs. Tiene **dos dimensiones
independientes**: el **agendado** (¿tiene fecha?) y el **estado del resultado**
(`status`). Una partida puede tener fecha sin estar reportada, o estar reportada
sin que se llegara a fijar fecha; ver 7.5.

- `leagueId` — FK a League.
- `phase` — `LEAGUE` | `PLAYOFF`.
- `roundId` — FK a Round (nullable). En la práctica obligatoria para
  `phase = LEAGUE` (toda partida de liga generada pertenece a una ronda);
  siempre `null` en `phase = PLAYOFF` (ver 4.3).
- `playerHomeId`, `playerAwayId` — FKs a Player. En byes de playoff,
  `playerAwayId` es null.
- `scheduledAt` — fecha (y hora opcional) acordada para la partida. **Nullable**:
  mientras es `null`, la partida está "sin fecha"; cuando tiene valor, está
  "agendada". No se introduce un enum aparte; el estado de agendado se **deriva**
  de `scheduledAt == null`.
- `location` — lugar de juego (texto libre, **opcional/nullable**).
- `isBye` — true solo en byes de **playoff** (el seed avanza sin jugar). En la
  fase de liga siempre es false (no hay byes de liga).
- `status` — `SCHEDULED` | `REPORTED` | `CONFIRMED` | `DISPUTED`. En vivo solo
  se producen `SCHEDULED` (emparejamiento generado, sin resultado, tenga o no
  fecha) y `REPORTED` (tiene un `Result` y cuenta en la clasificación de
  inmediato — ver 7.5). `CONFIRMED` y `DISPUTED` son **legado**: el hito
  `resultados-directos` retiró el flujo de confirmación del rival y de
  disputas (un participante o el admin apunta el resultado y cuenta al
  instante), pero los valores del enum se conservan por si quedan partidas
  antiguas con esos estados; ningún flujo actual los produce.
- `bracketSlotId` — FK a BracketSlot (nullable; sólo en playoffs).

> Nota de nomenclatura: el valor de `status` `SCHEDULED` se refiere al ciclo de
> vida del **resultado**, no a tener fecha. El hecho de "estar agendada" (tener
> `scheduledAt`) es ortogonal. Ver 7.5.

### 4.5. Result (Resultado)

Separado de Match para registrar quién apunta el resultado y cómo se llegó a
él (jugado, incomparecencia o saldado sin acuerdo — ver 7.5).

- `matchId` — FK a Match (1:1 con el resultado vigente).
- `homeVictoryPoints`, `awayVictoryPoints` — VP de cada jugador.
- `outcome` — `HOME_WIN` | `AWAY_WIN` | `DRAW` (derivable de VP, pero se
  almacena explícito porque W40k permite empates por reglas de misión).
- `reportedById` — FK a Player que apuntó el resultado.
- `confirmedById`, `confirmedAt` — **legado** del flujo de confirmación
  retirado en el hito `resultados-directos` (ver nota de 4.4); siempre `null`
  en resultados nuevos.
- `reportedAt` — cuándo se apuntó el resultado.
- `bonusHome`, `bonusAway` — puntos de liga de bonus aplicados (ver 7.1). En
  una incomparecencia (`resolution = WALKOVER`) son siempre 0, sin pasar por
  el cálculo de bonus (ver 7.5).
- `resolution` — `PLAYED` | `WALKOVER` | `UNPLAYED_DRAW`, por defecto
  `PLAYED`. Distingue una partida jugada de verdad de una saldada al cerrar
  su ronda; ver 7.5.

> Nota de integridad: un Match cuenta en la clasificación en cuanto tiene un
> `Result` (`status = REPORTED`, o `CONFIRMED` en datos legados — ver 4.4). No
> hay estado "provisional": lo que se apunta cuenta de inmediato.

### 4.6. Bracket y BracketSlot (Eliminatoria)

Estructura del cuadro de playoffs (eliminatoria simple).

- **Bracket**: `leagueId`, `size` (= `playoffSize`, potencia de 2 efectiva tras
  byes de seeding).
- **BracketSlot**: nodo del árbol. `bracketId`, `roundIndex` (1=primera ronda…,
  hasta la final), `position` dentro de la ronda, `playerId` (nullable hasta
  resolverse), `matchId` (la partida que decide quién avanza a este slot),
  `feedsIntoSlotId` (FK al slot de la siguiente ronda).

### 4.7. AuditLog (opcional, recomendado)

Registro append-only de acciones sensibles (apuntar/editar resultado, editar
config, declarar incomparecencia, cerrar ronda, dar de baja a un jugador,
iniciar playoffs). `actorId`, `action`, `entityType`, `entityId`, `payload`,
`createdAt`. Da transparencia al grupo sobre quién hizo qué y cuándo.

### 4.8. Relaciones (resumen)

```
League 1───* Round 1───* Match *───1 Result
League 1───* Match (playoff, sin Round) *───1 Result
League 1───* Player
League 1───1 Bracket 1───* BracketSlot 1───0..1 Match
Player 1───* Match (como home / como away)
Player 1───* Result (como reporter)
```

> Las partidas de liga cuelgan de una `Round`; las de playoff, de un
> `BracketSlot` (nunca de una `Round`). `Result.confirmedById` es legado (ver
> 4.5) y no representa una relación viva.

## 5. Roles y permisos

| Acción                                          | Admin | Jugador           |
| ------------------------------------------------ | :---: | :---------------: |
| Crear/editar liga y config (cupo, mes de arranque)|  Sí   | No                |
| Alta/baja de jugadores                            |  Sí   | No                |
| Editar su propia facción/nombre                   |  Sí   | Sí (su perfil)    |
| Generar emparejamientos round-robin (con rondas)  |  Sí   | No                |
| Editar la fecha de cierre de una ronda            |  Sí   | No                |
| Fijar/editar la fecha de una partida              |  Sí   | Sí (sus partidas) |
| Apuntar/editar resultado de partida propia        |  Sí   | Sí (sus partidas) |
| Declarar incomparecencia de partida propia        |  Sí   | Sí (sus partidas) |
| Editar/forzar cualquier resultado                 |  Sí   | No                |
| Cerrar una ronda                                  |  Sí   | No                |
| Cerrar fase de liga e iniciar playoffs            |  Sí   | No                |
| Ver standings, calendario, rondas y bracket       |  Sí   | Sí                |

El admin es también un Player con `role = ADMIN` (puede jugar la liga).

> Sobre fijar fecha: **cualquiera de los dos participantes** puede fijar o editar
> la `scheduledAt` de su partida sin que el otro la acepte; el admin puede hacerlo
> en cualquier partida. No hay flujo de propuesta/aceptación.

> Sobre apuntar resultado: **cualquiera de los dos participantes** apunta los
> VP y cuenta de inmediato, sin que el rival tenga que confirmarlo; el otro
> participante puede editarlo después, y el admin puede hacerlo siempre. No
> hay confirmación cruzada ni disputas — el flujo se retiró en el hito
> `resultados-directos` (ver 4.4, 7.5).

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

**Por qué no más:** con 10-20 personas de confianza, passcode + sesión firmada
es suficiente disuasión. El `AuditLog` (quién apuntó o editó cada resultado) y
la posibilidad de que cualquiera de los dos participantes corrija lo apuntado
cubren el caso de mala fe (ver 7.5) — no hace falta un paso de confirmación
cruzada para eso. Email/OAuth se posponen.

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

### 7.2. Generación de emparejamientos y reparto en rondas

La app genera el **conjunto completo de emparejamientos** del round-robin y lo
**reparte entre rondas mensuales** (ADR-008):

- Función pura `generatePairings(players)`: produce todos los **pares únicos**
  de jugadores activos. Para `n` jugadores son exactamente `C(n,2) = n·(n-1)/2`
  partidas. Cada jugador se enfrenta a cada otro **una sola vez**; nadie se
  empareja consigo mismo; el par `{A,B}` aparece una única vez.
- Función pura de reparto (`src/server/rounds.ts`): genera el calendario
  clásico de round-robin por el **circle method** — `n-1` jornadas en las que
  cada jugador juega exactamente una vez (`n` jornadas con un descanso por
  jugador si `n` es impar; ese descanso no crea partida de bye, sigue sin
  haber byes de liga) — y agrupa `matchesPerRound` jornadas consecutivas en
  cada ronda.
- `matchesPerRound` (por defecto **2**) es la constante configurable por liga:
  cuántas partidas debe jugar cada jugador por ronda. El **número de rondas se
  deriva**, no se configura directamente: `ceil((n-1) / matchesPerRound)` en
  el caso general, con el ajuste que exige la paridad cuando `n` y
  `matchesPerRound` son ambos impares (entonces un reparto exactamente
  uniforme no siempre es posible; el algoritmo añade la ronda mínima
  necesaria para que quepan todas las partidas sin que nadie supere el cupo).
- El caso general —repartir un **subconjunto** arbitrario de partidas
  pendientes, no el grafo completo (alta de jugador a mitad de liga, cambio
  de cupo)— se formula como un **coloreado de aristas**: cada jornada es un
  emparejamiento del grafo (ningún jugador repetido), y una ronda son
  `matchesPerRound` colores consecutivos. Sobre el grafo completo el circle
  method ya es óptimo. Sobre un subgrafo cualquiera, la cota de Vizing
  (`Δ+1` colores, con `Δ` el máximo de partidas pendientes de un jugador) **no
  la alcanza un coloreado voraz simple** —un voraz por grado descendente solo
  garantiza `2Δ-1`— así que el reparto usa el algoritmo constructivo de
  **Vizing con reparación por cadenas de Kempe (Misra & Gries)**, que sí
  alcanza `Δ+1` (ver ADR-008 para el porqué).
- **La ronda de cada partida la fija el reparto al generar y es inamovible**:
  ni el jugador ni el admin tienen, en ninguna pantalla, forma de mover una
  partida a otra ronda.
- La fecha de cierre de cada ronda se deriva del **mes de arranque** de la
  liga (`League.startMonth`) como el último día del mes correspondiente; el
  admin puede editarla después sin que eso reasigne ninguna partida.
- El admin puede regenerar los emparejamientos sólo mientras `status = SETUP` o
  `LEAGUE` sin resultados apuntados (para no invalidar partidas ya jugadas).
  Regenerar descarta las fechas (`scheduledAt`) previas y recrea las rondas
  desde cero.

**Agendado por fecha libre:** los emparejamientos nacen **sin fecha**
(`scheduledAt = null`). Después, cualquiera de los dos participantes —o el
admin— **fija directamente** la fecha (y opcionalmente `location`) de la partida,
sin que el rival deba aceptarla. La fecha puede **editarse** o limpiarse
posteriormente por los mismos actores. La fecha de cierre de la ronda es un
**límite**, no un día de quedada: la pareja sigue acordando libremente cuándo
juegan dentro del mes, o incluso fuera de orden, adelantando una partida de
una ronda posterior (eso no exime del cupo de su propia ronda, ver 7.5). El
**calendario emerge** de las fechas acordadas (ver 8): es la vista ordenada
por `scheduledAt` de las partidas agendadas, más las pendientes de agendar.

### 7.3. Standings (clasificación) y desempates

Se calcula en la capa de aplicación a partir de partidas con `Result`
(`status = REPORTED`, o `CONFIRMED` en datos legados — ver 4.4): cuentan en
cuanto se apuntan, sin paso de confirmación.

Por jugador: partidas jugadas, ganadas, empatadas, perdidas, **puntos de liga**,
VP a favor, VP en contra, **diferencia de VP**, y cuántas de las jugadas están
**saldadas sin jugar** (`resolution != PLAYED` — incomparecencia o cierre de
ronda sin acuerdo, ver 7.5): la columna de partidas jugadas se muestra como
`PJ 11 (2 saldadas)`. Los puntos, VP y desempates de una partida saldada se
calculan exactamente igual que los de una jugada de verdad — el `Result` es
real en los dos casos, sin ninguna rama especial.

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

- **`startPlayoffs` exige que todas las rondas de la liga estén cerradas**
  (`Round.closedAt` no nulo en ninguna, ADR-008). Falla con un mensaje que
  nombra las rondas que faltan y su fecha de cierre. Cerrar una ronda salda a
  0-0 todo lo que quede sin jugar (ver 7.5), así que la precondición garantiza
  que los playoffs arrancan con las `C(n,2)` partidas de liga resueltas y los
  seeds definitivos — ya no hay partidas "sin confirmar" que dejen el
  resultado a medias.
- Se toman los **`playoffSize` mejores** de los standings como _seeds_.
- Se construye un **bracket de eliminatoria simple** con seeding estándar
  (1 vs N, 2 vs N-1, …). Si `playoffSize` no es potencia de 2, los mejores seeds
  reciben **bye en primera ronda** hasta cuadrar el árbol. (Estos byes de
  playoff son los únicos byes del sistema; la fase de liga no tiene byes.)
- Cada `Match` de playoff genera el avance del ganador al `feedsIntoSlot`
  correspondiente en cuanto se apunta su resultado (sin paso de confirmación,
  igual que en liga — ver 7.5). La final corona al campeón.
- En playoffs, los empates no son válidos: si la misión termina empatada, se
  requiere desempate (regla acordada por el grupo); el sistema fuerza un
  `outcome` ganador al apuntar el resultado.

### 7.5. Agendado de fecha y desenlaces de una partida

Una partida tiene **dos dimensiones que no se deben confundir**:

- **Agendar la partida** = fijar su `scheduledAt` (y opcionalmente `location`).
  Lo hace directamente cualquiera de los dos participantes o el admin, sin
  aceptación del rival. Es editable. No altera el `status` del resultado ni la
  ronda a la que pertenece la partida.
- **Apuntar (o saldar) el resultado** = fijar el `Result`, descrito abajo.

Pueden ocurrir en **cualquier orden**: una partida puede tener fecha y aún no
tener resultado, o tener resultado sin que nunca se fijara fecha.

**Apuntar resultado — flujo directo, sin confirmación.** Desde el hito
`resultados-directos` no hay paso de confirmación del rival ni disputas:

1. Cualquiera de los dos participantes de la partida —o el admin— apunta los
   VP de ambos jugadores y el `outcome`. La partida pasa a `REPORTED` y
   **cuenta en la clasificación de inmediato**.
2. Cualquiera de los dos participantes puede **editar** el resultado después
   (por ejemplo, si se equivocaron al apuntarlo). El admin puede editar o
   forzar cualquier resultado en cualquier momento, con rastro en `AuditLog`
   (`REPORT_RESULT` la primera vez, `EDIT_RESULT` las siguientes).
3. No hay paso de "confirmar" ni de "disputar": lo que se apunta cuenta, y se
   corrige editando si hace falta, no pactando una confirmación aparte.

**Tres desenlaces posibles.** Una partida de liga se resuelve de una de estas
tres formas, distinguidas por `Result.resolution`:

| Desenlace | Quién lo produce | VP | Bonus | `resolution` |
| --- | --- | --- | --- | --- |
| **Jugada** | Un participante o el admin apunta el resultado real | los reales | `calculateBonus` | `PLAYED` |
| **Incomparecencia** | Un participante (o el admin) declara un vencedor pactado | **80-0** a su favor | **0 forzado** | `WALKOVER` |
| **Sin acuerdo** | El admin cierra la ronda con la partida sin resultado | **0-0** | 0 | `UNPLAYED_DRAW` |

- **Incomparecencia**: cualquiera de los dos participantes —o el admin—
  declara que la partida no se jugó y elige al vencedor pactado fuera de la
  app. Se registra un 80-0 a su favor, sin pasar por el cálculo de bonus (con
  bonus activado, un 80-0 real dispararía los dos bonus configurables y
  rentaría más que jugar; forzarlo a 0 evita ese incentivo perverso). Un
  participante **no** puede declarar una incomparecencia sobre una partida que
  ya tiene un resultado real (`resolution = PLAYED`) apuntado por el rival —
  eso solo puede hacerlo el admin, con su override — para que nadie pueda
  autoadjudicarse un 80-0 sobre una victoria ajena legítima.
- **Sin acuerdo (cierre de ronda)**: cada ronda tiene una fecha de cierre
  (derivada del mes de arranque de la liga, editable por el admin). Al llegar
  esa fecha, el admin puede pulsar «Cerrar ronda N»: cada partida de esa
  ronda que siga sin resultado recibe un 0-0 real y persistido, con rastro en
  `AuditLog`. La ronda pasa a cerrada y sus partidas dejan de ser apuntables
  por los participantes; el admin conserva su override y editar no reabre la
  ronda. Cerrar una ronda no tiene precondición de orden respecto a las
  demás.
- El **cupo** de una ronda se mide por partidas **resueltas** (con `Result`,
  cualquiera de los tres desenlaces), no por partidas agendadas: una partida
  con fecha futura y sin resultado sigue contando como pendiente.
- **Adelantar está permitido y no exime**: se puede apuntar una partida de una
  ronda posterior sin haber resuelto la ronda actual, pero eso no libra a esa
  ronda de su propio cupo cuando llegue su cierre.

`Result.resolution` (`PLAYED` | `WALKOVER` | `UNPLAYED_DRAW`, por defecto
`PLAYED`) es lo que permite distinguir los tres casos después del hecho: para
etiquetar la partida en la UI («incomparecencia», «saldada sin jugar»), para
contar las saldadas en la clasificación (7.3) y como justificación de por qué
ese `Result` no lleva bonus.

> El valor `SCHEDULED` en el campo `status` significa "emparejamiento
> generado, pendiente de resultado", no "tiene fecha acordada". `CONFIRMED` y
> `DISPUTED` son legado (ver 4.4) y no los produce ningún flujo actual.

## 8. Vistas / UI (mobile-first, dark)

- **Login**: selector de jugador + passcode; acceso admin aparte.
- **Standings** (`/clasificacion`): tabla de clasificación responsive (en
  móvil, tarjetas o tabla con scroll horizontal mínimo). Resalta zona de
  clasificación a playoffs. La columna de partidas jugadas distingue las
  saldadas sin jugar: `PJ 11 (2 saldadas)` (ver 7.3).
- **Calendario** (`/calendario`): **lista de partidas ordenable por fecha**
  (`scheduledAt`), no una rejilla de jornadas — la ronda aparece como
  **etiqueta** de cada partida, no como agrupador. Muestra primero/aparte las
  partidas **sin fecha** y luego las agendadas en orden cronológico. Cada fila
  muestra los dos jugadores, fecha y lugar (si los hay) y el desenlace (jugada
  / incomparecencia / saldada sin jugar, ver 7.5). Incluye **acción de
  fijar/editar fecha** (y lugar) en las partidas propias (cualquier
  participante) y en todas para el admin.
- **Mis partidas** (`/mis-partidas`): las del jugador logueado, **agrupadas
  por ronda** — ordenadas por fecha de cierre más próxima primero, con las
  rondas cerradas al final— y con el cupo de esa ronda (`falta 1 de 2`, ver
  4.3/7.2). Acción rápida de **fijar fecha**, **apuntar/editar resultado** y
  **declarar incomparecencia** (optimizado para pulgar en la mesa de juego).
- **Rondas** (`/rondas`, nueva): el calendario de la liga completo — todas las
  rondas, su fecha de cierre y el cupo de **todos** los jugadores en cada una
  (a quién hay que perseguir). Protegida con sesión (jugador o admin), como
  `/clasificacion`, `/calendario` y `/bracket` — no es pública como `/bases`.
- **Bracket de playoffs** (`/bracket`): árbol de eliminatoria.
- **Panel de admin**: config de liga (incluida la configuración de rondas:
  cupo `matchesPerRound` y mes de arranque), jugadores + passcodes, generar
  emparejamientos, **rondas** (fechas de cierre editables y «Cerrar ronda N»),
  cerrar liga / iniciar playoffs (bloqueado mientras quede una ronda sin
  cerrar).
- **Bases** (`/bases`, pública, sin sesión): reglas de la liga en lenguaje
  llano para jugadores — formato, cupo, cierre de ronda e incomparecencia.

## 9. Riesgos y mitigaciones

- **Cambios de config a mitad de liga** alterando standings retroactivamente →
  bonus y outcome se almacenan resueltos en Result; cambiar pesos recalcula solo
  agregados, no reescribe historia de VP.
- **Errores al apuntar un resultado** → cualquiera de los dos participantes
  puede editarlo después, y el admin puede forzarlo en cualquier momento; todo
  queda en `AuditLog`. No hay paso de confirmación ni de disputa que bloquee
  la clasificación mientras tanto (retirado en el hito `resultados-directos`,
  ver 4.4/7.5) — lo apuntado cuenta de inmediato, así que la corrección es la
  única red de seguridad.
- **Portabilidad de DB** → toda la lógica de negocio en la app, no en SQL
  específico; Prisma abstrae SQLite↔Postgres.
- **Regenerar emparejamientos** tras empezar a jugar → restringido por `status`
  y existencia de resultados apuntados; regenerar descarta fechas y rondas
  previas.
- **Rondas sin cerrar** → si el admin no cierra una ronda, queda abierta
  indefinidamente, la clasificación no refleja las partidas caducadas, y los
  playoffs no pueden arrancar (ver 7.4). Es el precio de no tener tareas
  programadas en el despliegue (sin cron).
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
