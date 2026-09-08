---
slug: rondas-con-fecha
status: APPROVED
version: 6
---

# Rondas con fecha

## 1. Problema

Hoy la fase de liga es un saco plano de `C(n,2)` emparejamientos sin fecha
(ADR-007): cada pareja acuerda su día libremente y el "calendario" es solo la
lista ordenada por `scheduledAt`. Sin estructura temporal no hay forma de decir
"esto se juega este mes y esto el que viene", ni de cerrar un tramo de la liga,
ni de presionar a que las partidas se jueguen: una partida puede quedarse sin
fecha indefinidamente y la clasificación no avanza.

Falta además un ritmo: con 12 jugadores son 11 partidas por cabeza y nada le
dice a nadie cuántas debería llevar jugadas a estas alturas.

## 2. Alcance

- La fase de liga se divide en **rondas mensuales**. Una ronda = un mes.
- Cada ronda exige a cada jugador un **número fijo de partidas** (por defecto
  **2**), **configurable por liga**.
- El **número de rondas no es fijo**: se deriva de los jugadores y de las
  partidas por mes. La liga dura lo que haga falta.
- El round-robin completo se **reparte entre las rondas**: se mantienen las
  `C(n,2)` partidas y los `n-1` rivales de cada jugador. **Qué partida cae en
  qué ronda lo decide el algoritmo al generar, y es fijo.**
- Lo que sigue siendo libre es el **día** dentro del mes: la pareja lo acuerda
  como hoy.
- Al cerrar la ronda, las partidas no jugadas se **resuelven sin jugar**:
  1. Los dos jugadores se ponen de acuerdo y **declaran un vencedor** →
     incomparecencia **80-0**.
  2. Si no hay acuerdo → **0-0 empatada**.

## 3. No-objetivos

- **No hay ronda en curso ni progresión bloqueante.** Las rondas no se abren una
  tras otra; todas están abiertas desde el principio (§4.5).
- **La app no fija fechas de partida.** Sigue siendo la pareja quien acuerda el
  `scheduledAt`. No se generan horarios ni tandas (§4.4).
- **No se cierra ninguna ronda automáticamente.** No se añade cron, función
  programada ni tarea de fondo: el cierre lo pulsa el admin (§4.7).
- **No se avisa a nadie de nada.** No se añaden email, push ni notificaciones;
  el proyecto no los tiene y esta spec no los introduce (§5.1).
- **No se migran los datos de la liga actual.** La vía es reiniciar con el botón
  que ya existe (§5.4).
- **No se muestra la jornada.** La jornada del circle method es un detalle
  interno del reparto; el usuario solo ve rondas (§6.1).
- **No se toca el formato de playoffs.** El bracket, el seeding y los byes de
  playoff se quedan exactamente como están. Lo único que cambia es la
  precondición para arrancarlos (§4.11).
- **No se reintroducen las disputas ni la confirmación del rival.** El hito 15
  las eliminó y siguen fuera (§4.10).
- **No hay clasificación por ronda.** La clasificación sigue siendo una sola,
  acumulada, con los puntos y desempates de hoy (§4.6).
- **No se reparte por disponibilidad.** El reparto no tiene en cuenta quién
  puede qué mes; para eso están las fechas de cierre editables (§4.4).
- **Nadie elige la ronda de una partida.** Ni el jugador ni el admin pueden
  mover una partida de ronda; la asigna el reparto al generar (§4.3).
- **No se bloquea adelantar partidas.** No hay guarda que exija resolver tu
  ronda actual antes de apuntar una posterior (§4.5).

## 4. Comportamiento esperado

### 4.1. Formato de competición

Se conserva el **round-robin completo**: cada jugador se enfrenta a cada otro
exactamente una vez, igual que hoy. La novedad es que cada emparejamiento
pertenece a una ronda, y la ronda es un mes con fecha de cierre.

### 4.2. Cuántas rondas: derivadas, no configuradas

La constante de la liga es **`matchesPerRound`** (partidas que cada jugador debe
jugar por ronda; por defecto 2), no el número de rondas. El número de rondas se
calcula:

```
jornadas   = n - 1          (partidas que juega cada jugador en toda la liga)
rondas     = ceil((n - 1) / matchesPerRound)
partidas por ronda = n * matchesPerRound / 2   (la última puede ser menor)
```

Con `matchesPerRound = 2`:

| Jugadores | Partidas totales | Partidas/jugador | Rondas | Duración |
| --- | --- | --- | --- | --- |
| 10 | 45 | 9 | 5 | 5 meses |
| 12 | 66 | 11 | 6 | 6 meses |
| 16 | 120 | 15 | 8 | 8 meses |
| 20 | 190 | 19 | 10 | 10 meses |

La última ronda queda **incompleta** cuando `n-1` no es múltiplo de
`matchesPerRound`: con 12 jugadores y 2 por ronda, las rondas 1-5 piden 2
partidas y la ronda 6 pide 1.

### 4.3. Reparto de las partidas entre rondas

Se genera el calendario clásico de round-robin (**circle method**): `n-1`
jornadas en las que **cada jugador juega exactamente una vez**. Una ronda son
**`matchesPerRound` jornadas consecutivas**, así que el "2 partidas por jugador
y mes" sale **exacto por construcción**, sin heurísticos ni reparto aproximado.

Con 12 jugadores y `matchesPerRound = 2`:

```
11 jornadas de 6 partidas

Ronda 1 = jornadas 1-2    12 partidas → 2 por jugador
Ronda 2 = jornadas 3-4    12 partidas → 2 por jugador
Ronda 3 = jornadas 5-6    12 partidas → 2 por jugador
Ronda 4 = jornadas 7-8    12 partidas → 2 por jugador
Ronda 5 = jornadas 9-10   12 partidas → 2 por jugador
Ronda 6 = jornada 11       6 partidas → 1 por jugador
                          ── total 66
```

Esto **reintroduce el circle method que ADR-007 eliminó** (`SPEC.md:98-113`).
Con un número **impar** de jugadores el circle method produce `n` jornadas en
las que un jugador descansa; ese descanso **no crea partida de bye** (sigue sin
haber byes de liga), simplemente ese jugador tiene una partida menos en la ronda
donde cae su jornada de descanso.

**El algoritmo tiene que resolver el caso general, no solo el completo.** El
circle method solo sirve cuando hay que repartir el grafo completo `K_n` desde
cero. En cuanto hay que **recalcular el reparto de las partidas pendientes**
(§5.1, alta de jugador a mitad de liga), el conjunto a repartir es un subgrafo
arbitrario: unos pares ya jugados, otros no, y unos jugadores con más pendientes
que otros.

Formulado bien, es un **coloreado de aristas**: cada jornada es un conjunto de
partidas sin jugador repetido (un emparejamiento del grafo), y repartir es
asignar un color-jornada a cada arista sin que dos aristas del mismo color
compartan vértice. Una ronda son `matchesPerRound` colores consecutivos.

- Sobre `K_n` el número mínimo de colores es `n-1` (n par) o `n` (n impar), y el
  circle method es precisamente una solución óptima. El caso general se reduce
  a él.
- Sobre un subgrafo cualquiera, un coloreado voraz por grado descendente
  necesita como mucho `Δ+1` colores (Vizing), donde `Δ` es el máximo de
  partidas pendientes que tiene un jugador. Traducido: la liga se alarga como
  mucho una ronda más de lo estrictamente necesario.

La función de reparto es **pura y testeable** (sin SQL), como el resto de
`src/server/`. Su invariante verificable: ningún jugador tiene más de
`matchesPerRound` partidas en la misma ronda.

**La ronda de cada partida la asigna el algoritmo, y es fija.** Se decide al
generar los emparejamientos y **nadie la elige**: ni el jugador ni el admin
pueden mover una partida de ronda. La única vía por la que una partida cambia de
ronda es el **recálculo automático** de lo pendiente (§5.1, §5.5), y ni siquiera
ahí lo decide una persona.

Lo que sí es libre —y no hay que confundirlo con esto— es el **día concreto
dentro del mes**: la pareja queda el 12 o el 24, y eso la app no lo decide
(§4.4).

### 4.4. La fecha de la ronda es una fecha límite

La fecha de cierre de la ronda es un **límite**, no un día de quedada. Cada
pareja sigue fijando libremente el **día** de su partida (`scheduledAt`, mismo
flujo que hoy, SPEC §7.5). La app **no** fija días por su cuenta.

Lo libre es **el día, no el rival ni la ronda**: contra quién juegas y en qué
ronda lo decidió el reparto al generar (§4.3) y es inamovible. Al llegar el límite, las partidas de la ronda que sigan sin resultado
entran en el mecanismo de incomparecencia / 0-0.

**Cómo se calcula el límite (decidido).** La liga configura un **mes de
arranque**. La app deriva el cierre de cada ronda como el **último día del mes**
correspondiente, y el admin puede **editar la fecha de cualquier ronda** a mano.
Cada ronda es una fila persistida (necesita su estado de cerrada de todas
formas), así que la fecha vive ahí y no se recalcula sobre la marcha una vez
generada.

```
arranque = marzo 2026 · matchesPerRound = 2 · 12 jugadores

Ronda 1  cierra 31 mar 2026
Ronda 2  cierra 30 abr 2026
Ronda 3  cierra 31 may 2026
Ronda 4  cierra 30 jun 2026
Ronda 5  cierra 30 sep 2026   ← movida a mano: agosto de vacaciones
Ronda 6  cierra 31 oct 2026
```

Editar una fecha **no reordena ni reasigna partidas**: solo mueve el límite de
esa ronda. Que las fechas queden ordenadas es responsabilidad del admin.

### 4.5. Todas las rondas están abiertas

Las rondas existen **abiertas desde el principio**, cada una con su fecha
límite. No hay "ronda en curso" ni progresión bloqueante: cualquier participante
puede agendar y apuntar cualquier partida en cualquier momento, sea de la ronda
que sea. La ronda de una partida **solo determina la fecha en la que caduca**.

Consecuencia deliberada: un jugador puede tener toda su liga jugada en el primer
mes, y eso es válido. Lo que la ronda impone es un **suelo** (hay que llegar a
`matchesPerRound` antes de que cierre), no un techo.

**Adelantar está permitido y no exime.** En octubre puedes jugar la partida que
te toca en diciembre; nada te lo impide y no hace falta haber cumplido antes con
octubre. Pero adelantarse **no te libra de tu cupo de octubre**: el 31 tus 2
partidas de la ronda de octubre caducan igual y se saldan (§4.7), y la de
diciembre sigue jugada y válida en su ronda.

No hay guarda que bloquee apuntar una partida de una ronda posterior. Descartado
a propósito: bloquearlo produciría el caso absurdo de haber jugado la partida en
la mesa y que la app no te deje apuntarla. La presión la ejerce `/rondas`
mostrando quién va a 0/2, no un candado.

### 4.6. Qué ve el jugador: cupo y rondas

El cupo se mide por **pertenencia a la ronda**, no por mes jugado: una partida
cuenta para el cupo de *su* ronda con independencia de cuándo se juegue. Si un
jugador juega en marzo las 2 partidas de la ronda 1 y las 2 de la ronda 2, la
ronda 2 queda satisfecha y en abril no debe nada.

**Mis partidas** se reorganiza **por ronda** en lugar de por estado. Cada ronda
es un bloque con su fecha de cierre y su contador de cupo; ordenados por cierre
más próximo primero, y las rondas cerradas al final.

```
Mis partidas

── Ronda 3 · cierra 31 may · falta 1 de 2 ──
   vs Magos Drekk      12 may   45-38
   vs Archon Nyss      sin fecha   [Apuntar]

── Ronda 4 · cierra 30 jun · faltan 2 de 2 ──
   vs Patriarca Vex    sin fecha   [Apuntar]
   vs Shas'O Vior'la   sin fecha   [Apuntar]

── Ronda 2 · cerrada ──
   vs Inquisidor Marak   80-0   incomparecencia
```

El cupo cuenta **partidas resueltas** (con `Result`), no agendadas: una partida
con fecha para dentro de dos semanas sigue contando como que falta.

**Vista `/rondas`** (nueva): el calendario de la liga con todas las rondas, su
fecha de cierre, cuántas de sus partidas están ya resueltas y el **cupo de cada
jugador**. Sirve para saber a quién hay que perseguir. Protegida con
`requireAuth`, como `/clasificacion` (`src/app/clasificacion/page.tsx:23`),
`/calendario` y `/bracket` — no es pública como `/bases`.

```
/rondas

Ronda 3 · cierra 31 may · 7 de 12 jugadas
  Valdris   2/2 ✓     Drekk   1/2
  Marak     2/2 ✓     Aelyr   0/2  ⚠
  Torvayne  1/2       Vex     2/2 ✓
  …
```

**Calendario**: la ronda aparece como agrupador o etiqueta de cada partida; la
vista sigue siendo la lista por `scheduledAt` de hoy.

**Clasificación**: la columna de partidas jugadas distingue las **saldadas sin
jugar**: `PJ 11 (2 saldadas)`. Los puntos, VP y desempates no cambian de
cálculo — un 80-0 y un 0-0 son `Result` reales y `computeStandings` los procesa
como cualquier otro.

### 4.7. Cierre de ronda

El cierre es una **acción explícita del admin**, no un efecto del paso del
tiempo. No hay cron ni funciones programadas en el despliegue (`netlify.toml`
solo declara el plugin de Next), así que nada corre por su cuenta a medianoche,
y no se quiere que la clasificación se mueva sola.

- El panel de admin ofrece **«Cerrar ronda N»**, habilitado a partir de la fecha
  límite de esa ronda.
- Al pulsarlo, cada partida de la ronda **sin resultado** recibe un `Result`
  **real y persistido** de 0-0 `DRAW`, con rastro en `AuditLog`.
- La ronda pasa a **cerrada** y sus partidas dejan de ser apuntables por los
  participantes. El admin conserva su override habitual (SPEC §7.5).
- Consecuencia deliberada: pasada la fecha límite y hasta que el admin cierre,
  la partida sigue siendo apuntable. Eso da margen al grupo para pactar un
  vencedor con un día de retraso, y hace al admin el único responsable de que la
  ronda se cierre.

### 4.8. Desenlaces de una partida

| Desenlace | VP | `outcome` | Bonus | Puntos de liga |
| --- | --- | --- | --- | --- |
| **Jugada** | los reales | derivado de los VP | `calculateBonus` | según resultado |
| **Incomparecencia con vencedor pactado** | **80-0** al vencedor | `HOME_WIN` / `AWAY_WIN` | **0 forzado** | 3 / 0 |
| **Sin acuerdo** (la cierra el admin) | 0-0 | `DRAW` | 0 | 1 / 1 |

La incomparecencia se salda con un marcador fijo de **80-0** a favor del
vencedor pactado, al estilo del walkover: no es un 0-0 con ganador, el vencedor
se lleva también los VP. Consecuencias asumidas: el vencedor suma +80 a su
`VP_DIFF` y el ausente −80, sobre una partida que nadie jugó, y esos VP pesan en
los desempates 2 (`VP_DIFF`) y 3 (`VP_FOR`).

**El 80-0 no devenga bonus.** El `Result` de incomparecencia se persiste con
`bonusHome = bonusAway = 0` **sin pasar por `calculateBonus`**. Razón: con la
config del seed (`prisma/seed.ts:80-82` — `bonusEnabled: true`,
`bonusMarginThreshold: 20`, `bonusMinVP: 40`) un 80-0 dispararía los dos bonus
(margen 80 ≥ 20 y 80 ≥ 40), dando **5 puntos por incomparecencia** frente a los
**4** de una victoria reñida real de 45-40. Eso haría más rentable que el rival
no apareciera que jugar. Con el bonus forzado a 0, ganar por incomparecencia son
3 puntos secos y jugar siempre renta igual o más.

### 4.9. Cómo se resolvió: marcador en el `Result`

Sin marcador, un 80-0 pactado sería indistinguible de un 80-0 jugado de verdad
—marcador perfectamente posible en Warhammer 40.000— y la regla del bonus
forzado a 0 (§4.8) no sería re-derivable después.

`Result` gana un campo `resolution`:

| Valor | Significado | VP | Bonus |
| --- | --- | --- | --- |
| `PLAYED` | Se jugó | los reales | `calculateBonus` |
| `WALKOVER` | Incomparecencia con vencedor pactado | 80-0 | 0 forzado |
| `UNPLAYED_DRAW` | Sin acuerdo, saldada al cerrar la ronda | 0-0 | 0 |

Se usa para etiquetar la partida en la UI («incomparecencia»), para contar las
saldadas en la clasificación, y como justificación persistida de por qué ese
`Result` no lleva bonus. El `AuditLog` sigue registrando **quién** lo hizo y
**cuándo**; `resolution` registra **qué es**.

### 4.10. Quién declara la incomparecencia

El mismo modelo que el resto de resultados desde el hito 15
(`resultados-directos`): **cualquiera de los dos participantes** —o el admin—
declara la incomparecencia eligiendo al vencedor, sin que el rival tenga que
aceptar, y **cualquiera de los dos puede sobrescribirla** después (con el
resultado real si al final se juega, o cambiando el vencedor). Reutiliza
`canReport` / `canReportInStatus` tal cual.

- El pacto ocurre **fuera de la app**; la app solo registra su conclusión.
- No se previene la autoadjudicación, se **corrige**: si un jugador se declara
  vencedor sin pacto, el perjudicado entra y lo sobrescribe. Las dos acciones
  quedan en `AuditLog` y el admin arbitra con su override.
- El punto de no retorno es el **cierre de la ronda**: una vez cerrada, solo el
  admin puede tocar el resultado.

### 4.11. Puerta a los playoffs

Hoy `startPlayoffs` (`src/server/playoff-actions.ts:43-89`) **no comprueba que
la liga esté acabada**: solo exige `status === "LEAGUE"`, `playoffSize >= 2` y
suficientes jugadores activos, y calcula los standings con lo que haya.

**Decidido: `startPlayoffs` exige que todas las rondas estén cerradas.** Se
bloquea mientras quede una ronda sin `closedAt`, con un mensaje que diga cuáles
faltan y su fecha de cierre. Como cerrar una ronda salda a 0-0 todo lo que quede
sin jugar, la precondición garantiza que los playoffs arrancan con las `C(n,2)`
partidas resueltas y los seeds definitivos.

Es una guarda que hoy no existe y que esta spec añade.

## 5. Casos límite y errores

### 5.1. Alta de jugador a mitad de liga

Ya existe en producción (hito 12, `altas-mitad-liga`): `addMissingLeagueMatches`
crea solo los pares que faltan vía `missingPairings`. Con rondas, un jugador que
entra en el mes 3 trae `n` emparejamientos nuevos cuando solo quedan unas pocas
rondas abiertas.

**Decidido: se recalcula el reparto de lo pendiente.** Al añadir el jugador:

1. Las **rondas cerradas no se tocan**, ni las partidas que ya tienen `Result`.
2. Todas las partidas de liga **sin resultado** —las del nuevo y las de los
   demás— se **vuelven a repartir** entre las rondas **no cerradas**.
3. Si con las rondas abiertas no cabe el cupo, se **añaden rondas al final**
   (con su fecha derivada del mes siguiente al último cierre).

Consecuencias asumidas:

- Todos los jugadores mantienen el cupo de `matchesPerRound` por ronda.
- Una partida pendiente **puede cambiar de ronda**, y con ello su fecha límite.
  Su `scheduledAt` acordado **no** se toca: si la pareja ya había quedado para
  una fecha concreta, la fecha sigue en pie.
- La liga se alarga: con 12 jugadores, un alta en el mes 3 la lleva de ~6 a ~9
  meses.

**Comunicación al jugador cuya partida cambió de mes.** No hay nada que
construir: el proyecto no tiene email, push ni notificaciones de ningún tipo
(no aparecen en el stack de `CLAUDE.md` ni en el código). El cambio se ve en
**Mis partidas** y en `/rondas`, donde la partida aparece bajo otra ronda con
otra fecha de cierre. Aviso fuera de la app, si el admin quiere, por el canal
del grupo.

### 5.2. Última ronda incompleta

Cuando `n-1` no es múltiplo de `matchesPerRound`, la última ronda pide menos
partidas: con 12 jugadores y 2 por ronda, las rondas 1-5 piden 2 y la ronda 6
pide 1. El contador de cupo tiene que decir «falta 1 de 1», no «falta 1 de 2».

### 5.3. Número impar de jugadores

El circle method produce `n` jornadas con un jugador descansando en cada una.
Ese jugador tiene **una partida menos** en la ronda donde cae su descanso, y su
cupo de esa ronda es `matchesPerRound - 1`. No se crea `Match` de bye.

### 5.4. Datos existentes (migración)

**Decidido: no se migran datos, se reinicia la liga.** La migración se limita al
esquema —crear `Round`, añadir `roundId` nullable a `Match`, `matchesPerRound` y
el mes de arranque a `League`— y **no reparte nada**. El admin reinicia la liga
con el botón que ya existe (`src/app/admin/liga/ResetLeagueButton.tsx`) y
regenera los emparejamientos, esta vez con rondas.

- **Se pierden los resultados ya apuntados.** Aceptado: la liga está en
  desarrollo y no ha empezado en serio.
- Ventaja principal: **un solo camino de generación** que testear, sin código de
  migración de un solo uso ni cupos históricos inconsistentes (un jugador con 4
  partidas jugadas en una ronda de cupo 2).
- Los `Match` de liga que sobrevivieran a la migración sin reinicio quedarían
  con `roundId = null`. Ese estado es **inválido** para `phase = LEAGUE` y la UI
  tiene que tratarlo como liga sin generar, no reventar.

### 5.5. Cambio de `matchesPerRound` con la liga en marcha

**Se deriva de §5.1**: mismo tratamiento que un alta. Al guardar el valor nuevo
se recalcula el reparto de las partidas **sin resultado** entre las rondas **no
cerradas**, añadiendo o dejando de usar rondas al final según el cupo nuevo. Las
rondas cerradas y los resultados no se tocan.

- Subir el cupo (2 → 3) **acorta** la liga: caben más partidas por ronda y
  sobran rondas del final, que se eliminan si quedan vacías.
- Bajar el cupo (2 → 1) **alarga** la liga: se añaden rondas al final.
- El cupo de las rondas ya cerradas se queda como estaba cuando se cerraron: no
  se reescribe la historia.

### 5.6. Baja de jugador (`active = false`)

Hoy `setPlayerActive` (`src/server/league-actions.ts:241-247`) solo cambia la
bandera: las partidas ya creadas del jugador **siguen vivas**, y `active: true`
únicamente filtra al generar emparejamientos y al arrancar playoffs. Sin rondas
eso era invisible; con rondas esas partidas caducarían mes tras mes y repartirían
empates 0-0 gratis a media liga.

**Decidido: la baja salda sus pendientes como incomparecencia.** Al marcar
`active = false`:

1. Sus partidas de liga **sin resultado** en rondas **no cerradas** reciben un
   `Result` de **80-0 a favor del rival**, `bonusHome = bonusAway = 0`, con
   `AuditLog`.
2. Sus partidas ya jugadas quedan **intactas**.
3. Se recalcula el reparto de lo pendiente (§5.1), porque desaparecen partidas
   de las rondas abiertas.

Consecuencia asumida: los rivales que aún no le habían jugado reciben 3 puntos y
80 VP de regalo, y los que ya le jugaron no. La asimetría es deliberada — es
preferible a que el abandono reparta empates 0-0 durante meses—, pero pesa en
`VP_DIFF` y hay que asumirlo.

Reactivar al jugador (`active = true` de nuevo) **no revierte** esos resultados;
el admin tendría que editarlos uno a uno con su override.

### 5.7. Cierre de una ronda que no ha vencido

El botón «Cerrar ronda N» está **deshabilitado** hasta la fecha límite de esa
ronda. Si el admin quiere cerrar antes, la vía es **mover la fecha** de la ronda
(§4.4, las fechas son editables) y cerrar después. No hay un forzado aparte: una
sola forma de cerrar, y la fecha guardada siempre explica por qué se pudo.

### 5.8. Cerrar rondas fuera de orden

**Permitido.** Se deriva de §4.5: las rondas son independientes y todas están
abiertas, así que el cierre no tiene precondición de orden. Se puede cerrar la
ronda 4 antes que la 3 —caso normal si el admin movió fechas a mano y quedaron
desordenadas—. Cerrar una ronda no afecta a ninguna otra.

### 5.9. Ronda ya cerrada: apuntar resultado

Los participantes no pueden apuntar en una ronda cerrada. El admin conserva su
override (SPEC §7.5) y su edición queda en `AuditLog`. Editar un resultado de
ronda cerrada **no reabre** la ronda.

## 6. Superficie afectada

### 6.1. ADR derogado

Esta spec **deroga ADR-007** en dos de sus tres consecuencias
(`SPEC.md:98-113`):

| Consecuencia de ADR-007 | Estado |
| --- | --- |
| «Desaparece la entidad `Round`» | **Derogada**: vuelve como entidad. |
| «…y todo el circle method de la fase de liga» | **Derogada**: vuelve como base del reparto. |
| «No hay byes en la fase de liga» | **Se mantiene**: el descanso de jornada impar no crea `Match`. |
| «El calendario es una vista ordenable por fecha, no una rejilla de jornadas» | **Se mantiene**: el agendado sigue libre por pareja; la jornada es interna al reparto y no se muestra. |

Hay que reescribir `SPEC.md §4.3` («(Eliminada) Round») y añadir un ADR nuevo
que registre la reversión y su motivo.

Nota: la **jornada** del circle method es un detalle interno del algoritmo de
reparto. No se persiste ni se muestra al usuario; solo la **ronda** es visible.

### 6.2. Modelo de datos (`prisma/schema.prisma`)

Entidad nueva y dos campos de configuración. La ronda **tiene que** ser entidad:
necesita índice, fecha de cierre **editable** y marca de cerrada, y ninguno de
los tres es derivable en tiempo de consulta.

```prisma
model Round {
  id       String @id @default(cuid())
  leagueId String

  // 1-based. Order of the rounds within the league.
  index    Int
  // Deadline for every match in this round. Derived from the league's start
  // month on generation, editable by the admin afterwards.
  deadline DateTime
  // null while the round is open. Set when the admin closes it.
  closedAt DateTime?

  league  League  @relation(fields: [leagueId], references: [id])
  matches Match[]

  @@unique([leagueId, index])
}
```

`League` gana:

- `matchesPerRound Int @default(2)` — partidas que cada jugador debe jugar por
  ronda. Validación Zod: entero `>= 1`. No necesita tope: un valor mayor que
  `n-1` produce simplemente una sola ronda.
- `startMonth DateTime` — mes de arranque, guardado como el **primer día del
  mes** a medianoche. De él se derivan las fechas de cierre al generar.
- relación `rounds Round[]`.

`Result` gana:

- `resolution` — enum `PLAYED` | `WALKOVER` | `UNPLAYED_DRAW` (§4.9), con
  `@default(PLAYED)` para que los `Result` existentes sigan siendo válidos.

`Match` gana:

- `roundId String?` + relación a `Round`. **Nullable** porque las partidas de
  playoff (`phase = PLAYOFF`) no pertenecen a ninguna ronda.

Compatibilidad: los `Match` de liga existentes quedarían con `roundId = null`,
que es un estado inválido para `phase = LEAGUE`. Resuelto por reinicio de la
liga, no por migración de datos (§5.4).

### 6.3. Dominio (`src/server/`)

- `pairings.ts` — `generatePairings` produce hoy pares planos ordenados por ID
  (los `n-1` primeros son todos del jugador con el ID más bajo). Se añade el
  circle method y la agrupación de jornadas en rondas. `missingPairings`
  (hito 12) sigue calculando los pares que faltan; la asignación de ronda ya no
  es suya, la resuelve el reparto completo de lo pendiente (§5.1).
- Función nueva de reparto (coloreado de aristas, §4.3), pura, con dos entradas:
  el reparto inicial completo y el recálculo parcial sobre rondas abiertas.
- `match-actions.ts` — `generateLeagueMatches` crea las rondas y asigna
  `roundId`; `addMissingLeagueMatches` dispara el recálculo (§5.1). La guarda de
  regeneración sigue vigente.
- `result-actions.ts` — acción nueva de incomparecencia (80-0 con vencedor,
  `resolution = WALKOVER`, bonus forzado a 0) y guarda de ronda cerrada en
  `reportResult`.
- `league-actions.ts` — `setPlayerActive` salda las pendientes del jugador dado
  de baja (§5.6); `updateLeague` dispara el recálculo al cambiar
  `matchesPerRound` (§5.5).
- `playoff-actions.ts` — guarda nueva en `startPlayoffs`: ninguna ronda sin
  `closedAt` (§4.11).
- Módulo nuevo para el cierre de ronda: saldar las partidas sin resultado a 0-0
  `DRAW` con `resolution = UNPLAYED_DRAW` y sellar `closedAt`, en transacción y
  con `AuditLog`.
- `standings.ts` — el gate `isConfirmedForStandings` **no cambia**: los 80-0 y
  0-0 son `Result` reales y se procesan igual. Se añade el conteo de saldadas
  (`resolution != PLAYED`) para la columna «PJ 11 (2 saldadas)» de §4.6.

### 6.4. UI (`src/app/`)

- `mis-partidas/` — reagrupación por ronda con contador de cupo; hoy agrupa por
  estado (Apuntadas / Pendientes / Historial).
- `rondas/` — vista nueva con el cupo de todos los jugadores.
- `calendario/` — ronda como agrupador o etiqueta.
- `admin/liga/` — `matchesPerRound` y mes de arranque en `LeagueForm`.
- `admin/rondas/` — vista nueva: fechas de cierre editables y «Cerrar ronda N».
- `components/AppHeader.tsx` / `AdminMenu.tsx` — entradas de navegación nuevas.
- `bases/` — las bases públicas describen el formato y quedan desactualizadas.

### 6.5. Documentación

- `SPEC.md` — §4.3 (reescribir «(Eliminada) Round»), §7.2 (reparto), §7.4
  (puerta a playoffs), §7.5 (desenlaces), §8 (vistas) y ADR-007 (derogación
  parcial + ADR nuevo).
- `README.md` y el guion de pruebas manual del hito 11
  (`documentacion-y-guion-pruebas`) — pasos nuevos de cierre de ronda,
  incomparecencia y configuración de cupo. Es **documentación de uso**, no el
  mecanismo de verificación: eso son los tests automáticos (§7.3).

### 6.6. Tests

- `tests/emparejamientos.test.ts` — reparto por rondas y cupo.
- `tests/standings.test.ts` — 80-0 y 0-0 en la clasificación, conteo de
  saldadas.
- `tests/reportar-confirmar.test.ts` — bonus forzado a 0, guarda de ronda
  cerrada, adelantar permitido.
- `tests/playoffs-bracket.test.ts` — guarda de rondas cerradas en
  `startPlayoffs`.
- **Ficheros nuevos** para fechas de ronda, cierre, recálculo y baja de jugador.
- `tests/e2e/full-journey.spec.ts` — **cambia de forma**: hoy da por hecho el
  flujo sin rondas. `tests/e2e/global-setup.ts` y `seed-e2e.ts` necesitan crear
  rondas al sembrar.

## 7. Restricciones

### 7.1. Técnicas

- **Nada de SQL propietario.** Toda la lógica nueva (reparto, cupo, cierre) vive
  en `src/server/` como funciones **puras y testeables**, para mantener la
  portabilidad SQLite ↔ Postgres (ADR-002, `CLAUDE.md`).
- **Sin procesos de fondo.** El despliegue es serverless en Netlify con Turso
  (`netlify.toml` solo declara `@netlify/plugin-nextjs`). No hay cron ni
  funciones programadas, y esta spec no los añade.
- **Escrituras multi-fila en transacción.** El cierre de ronda, el recálculo del
  reparto y el saldo de la baja de jugador escriben muchas filas de golpe: van
  en `prisma.$transaction`, como ya hacen `addMissingLeagueMatches` y
  `startPlayoffs`.
- **Zod en el borde.** Toda entrada nueva (`matchesPerRound`, mes de arranque,
  fecha de cierre editada, vencedor de la incomparecencia) se valida con Zod en
  `src/lib/schemas.ts`, y el `leagueId` viene del server component, nunca del
  cliente.
- **Identidad desde la cookie.** `requireAdmin` / `requireAuth` en la primera
  instrucción de cada acción nueva, y `AuditLog` con el actor de la sesión.

### 7.2. Producto y compatibilidad

- **Mobile-first y dark mode hard-coded**, como el resto (ADR-006). `/rondas`
  con el cupo de 12-20 jugadores tiene que caber en móvil.
- **Código y comentarios en inglés; UI, docs y commits en español.**
- **Rompe hacia atrás**: `roundId` obligatorio en la práctica para
  `phase = LEAGUE` invalida las partidas de liga existentes. Asumido vía
  reinicio (§5.4).
- `Result.resolution` es **aditivo**: los `Result` existentes no lo tienen, así
  que el campo necesita valor por defecto (`PLAYED`) o la migración lo rellena.
- **`/bases` queda desactualizada**: describe el formato de la liga y hay que
  reescribirla con las rondas, el cupo y las reglas de incomparecencia.
- **`SPEC.md` queda desactualizado** en §4.3, §7.2, §7.4, §7.5, §8 y ADR-007.

### 7.3. Testing: todo automático, sin excepciones

**Ningún criterio de aceptación de §8 se valida a ojo.** Cada uno de los 39
tiene que quedar cubierto por al menos un test **automático** que se ejecute en
`npm run test` o en `npm run e2e`. Un criterio sin test automático es un
criterio incumplido, y el hito no se cierra.

Reglas:

- **Cada criterio, un test identificable.** El test nombra el criterio que
  cubre (p. ej. `describe("AC-15: adelantar no exime")`), para que se pueda
  auditar la cobertura criterio a criterio y no solo por líneas.
- **El test tiene que fallar sin el cambio.** Un test que pasa contra el código
  actual no está probando nada de esta spec.
- **Nada de verificación manual como sustituto.** El guion de pruebas manual del
  hito 11 se actualiza (§6.5), pero es documentación de uso, **no** el mecanismo
  de verificación de esta spec.
- **La regresión también es automática**: `npm run lint`, `npm run test`,
  `npm run e2e` y `npm run build` verdes.

Reparto por harness, con la infraestructura que ya existe:

| Qué | Harness | Dónde |
| --- | --- | --- |
| Reparto (coloreado de aristas, cupo, nº de rondas) | **Vitest**, función pura | `tests/emparejamientos.test.ts` o fichero nuevo |
| Derivación de fechas de cierre desde el mes de arranque | **Vitest**, función pura | fichero nuevo `tests/rondas.test.ts` |
| Cupo por jugador y ronda, conteo de saldadas | **Vitest**, función pura | `tests/rondas.test.ts` / `tests/standings.test.ts` |
| Bonus forzado a 0 en `WALKOVER` | **Vitest**, función pura | `tests/reportar-confirmar.test.ts` |
| Puntos y VP de 80-0 y 0-0 en clasificación | **Vitest**, función pura | `tests/standings.test.ts` |
| Guardas de acción (ronda cerrada, adelantar, `startPlayoffs`) | **Vitest** sobre los predicados puros | `tests/reportar-confirmar.test.ts`, `tests/playoffs-bracket.test.ts` |
| Cierre de ronda (escritura multi-fila, `AuditLog`) | **Vitest** con la DB de test (`file:./test.db`) | fichero nuevo |
| Recálculo por alta y por cambio de cupo | **Vitest** con la DB de test | fichero nuevo |
| Saldo de la baja de jugador | **Vitest** con la DB de test | fichero nuevo |
| Agrupación por ronda en Mis partidas, `/rondas`, botón de cierre, mensaje de `startPlayoffs` | **Playwright** | `tests/e2e/full-journey.spec.ts` ampliado, o spec nueva |
| `/rondas` redirige a `/login` sin sesión | **Playwright** | `tests/e2e/` |

Notas de implementación del propio testing:

- La lógica que hoy es UI-only tiene que **extraerse a funciones puras** para
  poder testearla en Vitest en lugar de solo en Playwright: el cupo de una
  ronda, el orden de los bloques de Mis partidas y el texto «falta 1 de 2» son
  cálculo, no presentación, y van a `src/server/`.
- El **N+1 de `/rondas`** (criterio 12) se verifica contando queries: hay que
  poder instrumentar el cliente Prisma en test (middleware/extensión de
  logging), no comprobarlo mirando la pantalla.
- Los tests de escritura usan la **DB de test** que `vitest.config.ts` ya
  inyecta (`DATABASE_URL: "file:./test.db"`), y los e2e la **`e2e.db`** que
  `tests/e2e/global-setup.ts` recrea en cada ejecución.
- El e2e existente **cambia de forma**: `full-journey.spec.ts` da por hecho el
  flujo sin rondas (paso 3 «generar emparejamientos», paso 4 «fijar fecha»).
  Actualizarlo es parte del trabajo, no un daño colateral.

### 7.4. Rendimiento

Nada crítico: 20 jugadores son 190 partidas y 10 rondas. El coloreado de aristas
sobre un grafo de 20 vértices es instantáneo. El único cuidado es no hacer N+1
queries al pintar `/rondas` (cupo de todos los jugadores en todas las rondas):
una sola query de partidas con su `roundId` y `Result`, y el cupo agregado en
memoria.

## 8. Criterios de aceptación

Numerados y verificables. **Todos se verifican con un test automático** —Vitest
para dominio y acciones, Playwright para flujos de UI— según el reparto por
harness de §7.3. Ninguno se da por bueno por observación manual.

**Reparto**

1. Con `n` jugadores y `matchesPerRound = k`, el reparto genera exactamente
   `C(n,2)` partidas y `ceil((n-1)/k)` rondas.
2. Ningún jugador tiene más de `k` partidas en la misma ronda. Verificado para
   `n` par e impar y para `k` ∈ {1, 2, 3}.
3. Con `n` par, cada jugador tiene exactamente `k` partidas en cada ronda salvo
   en la última, que puede tener menos.
4. Con `n` impar, ningún jugador queda con partida de bye: el número de `Match`
   creados sigue siendo `C(n,2)`.
5. El reparto es **determinista**: dos llamadas con la misma entrada dan la
   misma asignación de rondas.
6. Repartir un subgrafo arbitrario (partidas pendientes tras un alta) respeta
   el criterio 2 y no reasigna ninguna partida que ya tenga `Result`.

**Fechas de ronda**

7. Con mes de arranque marzo 2026 y 6 rondas, los cierres derivados son 31 mar,
   30 abr, 31 may, 30 jun, 31 jul y 31 ago de 2026 (último día de cada mes,
   febrero incluido en su año correspondiente).
8. El admin edita la fecha de cierre de una ronda y ninguna partida cambia de
   ronda ni de `scheduledAt`.

**Cupo y UI**

9. `Mis partidas` agrupa por ronda, ordenado por cierre más próximo primero, con
   las rondas cerradas al final.
10. El contador de cupo de una ronda con 2 exigidas y 1 resuelta dice «falta 1
    de 2»; en la última ronda con 1 exigida dice «falta 1 de 1».
11. Una partida con `scheduledAt` futuro y sin `Result` cuenta como pendiente en
    el cupo, no como cubierta.
12. `/rondas` muestra el cupo de todos los jugadores en todas las rondas y
    responde con una sola query de partidas (sin N+1).
13. `/rondas` es accesible con sesión de jugador y redirige a `/login` sin
    sesión.

**Ronda fija y adelantar**

14. La ronda de una partida no se puede cambiar desde ninguna superficie de UI:
    ni jugador ni admin tienen acción para moverla.
15. Un jugador con 0 de 2 en la ronda que cierra este mes puede apuntar sin
    error una partida de una ronda posterior.
16. Ese mismo jugador, al cerrarse su ronda actual, recibe igualmente el saldo
    de sus 2 partidas caducadas; la partida adelantada queda intacta en su
    propia ronda.

**Cierre de ronda**

17. «Cerrar ronda N» está deshabilitado antes de la fecha de cierre de esa
    ronda.
18. Al cerrar, **todas** las partidas de la ronda sin `Result` reciben uno con
    `homeVictoryPoints = 0`, `awayVictoryPoints = 0`, `outcome = DRAW`,
    `resolution = UNPLAYED_DRAW`, `bonusHome = bonusAway = 0`.
19. Al cerrar, las partidas que **ya tenían** `Result` quedan intactas.
20. El cierre escribe una entrada de `AuditLog` con el admin como actor.
21. Tras el cierre, un participante que intenta apuntar recibe error; el admin
    puede editar y la ronda **no** se reabre.
22. Se puede cerrar la ronda 4 con la 3 abierta.

**Incomparecencia**

23. Cualquiera de los dos participantes declara la incomparecencia eligiendo
    vencedor, y el `Result` queda 80-0 a su favor con
    `resolution = WALKOVER`.
24. Ese `Result` tiene `bonusHome = bonusAway = 0` **aunque** la liga tenga
    `bonusEnabled: true`, `bonusMarginThreshold: 20` y `bonusMinVP: 40` — donde
    `calculateBonus` daría 2.
25. El otro participante sobrescribe la incomparecencia con el resultado real y
    quedan dos entradas en `AuditLog` (`REPORT_RESULT` y `EDIT_RESULT`).
26. En la clasificación, el vencedor de una incomparecencia suma 3 puntos y 80
    VP a favor; el ausente 0 puntos y 80 VP en contra.

**Clasificación**

27. La clasificación distingue las saldadas: un jugador con 11 partidas de las
    que 2 son `WALKOVER`/`UNPLAYED_DRAW` muestra «PJ 11 (2 saldadas)».
28. Los puntos, VP y desempates de un 80-0 y de un 0-0 se calculan con
    `computeStandings` sin ninguna rama especial.

**Alta y baja de jugador**

29. Añadir un jugador con la ronda 1 y 2 cerradas: las rondas cerradas y sus
    resultados quedan idénticos, y todas las partidas sin resultado quedan
    repartidas respetando el criterio 2.
30. Ese recálculo añade rondas al final si no cabe el cupo, con fechas derivadas
    de los meses siguientes al último cierre.
31. Ese recálculo no modifica el `scheduledAt` de ninguna partida.
32. Dar de baja a un jugador (`active = false`) salda sus partidas pendientes de
    rondas abiertas como 80-0 al rival con `resolution = WALKOVER` y bonus 0, y
    deja intactas las que ya tenían resultado.
33. Volver a activarlo no revierte esos resultados.

**Configuración**

34. `matchesPerRound` se edita en el panel de admin y el recálculo mantiene el
    criterio 2 con el valor nuevo.
35. Subir `matchesPerRound` de 2 a 3 reduce el número de rondas; bajarlo de 2 a
    1 lo aumenta. Las rondas cerradas no cambian.

**Playoffs**

36. `startPlayoffs` falla con mensaje explícito mientras exista una ronda sin
    `closedAt`, nombrando las rondas que faltan.
37. Con todas las rondas cerradas, `startPlayoffs` funciona exactamente como
    hoy: mismo bracket, mismo seeding, mismos byes.

**Regresión**

38. `npm run lint`, `npm run test`, `npm run e2e` y `npm run build` pasan sin
    errores.
39. Los tests existentes de `standings`, `pairings` y `reportar-confirmar` siguen
    verdes o se actualizan con justificación escrita.
40. `tests/e2e/full-journey.spec.ts` está actualizado al flujo con rondas y pasa
    (hoy da por hecho el flujo sin ellas).

**Cobertura de la propia spec**

41. Cada uno de los criterios 1-40 tiene al menos un test automático que lo
    nombra explícitamente, y la correspondencia criterio → test está escrita en
    las notas del hito.
42. Ninguno de esos tests pasa contra el código previo a esta spec: cada uno
    falla antes del cambio y pasa después.
43. `npm run test:coverage` cubre al 100 % de líneas y ramas los módulos nuevos
    de dominio (reparto, fechas de ronda, cupo, cierre), que son funciones puras
    y no tienen excusa para no estarlo.

## 9. Riesgos y preguntas abiertas

### 9.1. Riesgos asumidos

- **Duración de la liga.** Con `matchesPerRound = 2`, 20 jugadores dan 10 meses
  de fase de liga antes de los playoffs. Asumido explícitamente: la liga se
  extiende en el tiempo según el número de jugadores.
- **Embudo de fin de mes.** Si el grupo deja las 2 partidas para la última
  semana, el cierre llega con muchas partidas sin jugar y la ronda se salda a
  base de 80-0 y 0-0. La spec no lo mitiga (no hay avisos, §3).
- **Admin como único responsable del cierre.** Si el admin no cierra, la ronda
  queda abierta indefinidamente, la clasificación no refleja las caducadas y los
  playoffs no pueden arrancar (§4.11). Es el precio de no tener cron.
- **Los 80 VP de la incomparecencia pesan en los desempates.** `VP_DIFF` es el
  desempate 2 y `VP_FOR` el 3: un ±80 sobre una partida que nadie jugó puede
  decidir un puesto de playoff. Mitigado en parte al quitarle el bonus (§4.8),
  no del todo.
- **La baja de jugador reparte regalos asimétricos** (§5.6): quien no le había
  jugado se lleva 3 puntos y 80 VP; quien sí le jugó, lo que sacara.
- **Recalcular el reparto mueve fechas límite de partidas ajenas** (§5.1). Un
  jugador puede ver su partida de mayo pasar a julio sin haber hecho nada, y sin
  que nadie se lo avise (§3).
- **Reinicio obligatorio al desplegar** (§5.4): se pierden los resultados
  apuntados hasta ahora.

### 9.2. Tensiones conocidas, resueltas a conciencia

- **Jugar por adelantado no exime.** Como el cupo se mide por pertenencia a la
  ronda (§4.6) y todas están abiertas (§4.5), un jugador puede haber jugado 4
  partidas en marzo —las 2 de la ronda 2 y las 2 de la ronda 3— y aun así
  comerse un 0-0 al cerrar la ronda 1, porque su partida de la ronda 1 sigue sin
  jugar. **Confirmado explícitamente** (v4): la ronda es un compromiso con unos
  rivales concretos, no una cuota de actividad. Y se descartó la guarda que lo
  bloquearía, porque produciría el caso absurdo de una partida jugada en la mesa
  que la app no deja apuntar.
- **`resolution` frente a `AuditLog`.** Hay dos registros de lo mismo por
  motivos distintos: `resolution` dice **qué es** el resultado y se consulta en
  cada render; `AuditLog` dice **quién y cuándo** y no se consulta nunca en
  caliente. No es duplicación.

### 9.3. Preguntas abiertas

Ninguna que bloquee la implementación.

## 10. Bitácora

- `v1 — primer borrador`: formato (round-robin completo repartido en 4 rondas),
  fecha límite en vez de día de quedada, rondas todas abiertas, cierre manual
  del admin, desenlaces 80-0 / 0-0 con bonus forzado a 0, declaración por
  cualquier participante.
- `v2 — rondas mensuales derivadas`: el número de rondas deja de ser 4 y pasa a
  derivarse de `ceil((n-1) / matchesPerRound)`; la constante configurable es
  `matchesPerRound` (por defecto 2) y la ronda es un mes. El reparto se resuelve
  con circle method agrupando `matchesPerRound` jornadas por ronda, que da el
  cupo exacto por construcción. Documento reestructurado en subsecciones.
- `v3 — spec completa, a REVIEW`: fechas de cierre derivadas del mes de arranque
  y editables por ronda; UI de cupo en Mis partidas más vista `/rondas`;
  `Result.resolution` para distinguir jugada / incomparecencia / saldada;
  `startPlayoffs` exige todas las rondas cerradas; reparto formulado como
  coloreado de aristas para cubrir el recálculo parcial; casos límite cerrados
  (alta a mitad recalcula lo pendiente, baja salda a 80-0, migración por
  reinicio, cambio de cupo, cierre fuera de orden); modelo de datos, no-objetivos,
  restricciones y 36 criterios de aceptación escritos.
- `v4 — desambiguación de "libre"`: sin cambios de decisión. Se explicita que la
  **ronda de cada partida la asigna el algoritmo y es fija** (nadie la elige) y
  que lo libre es solo el **día dentro del mes**; se explicita que **adelantar
  partidas está permitido y no exime** del cupo de la ronda en curso, con la
  guarda que lo bloquearía descartada a propósito. Dos no-objetivos y tres
  criterios de aceptación nuevos (14-16); total 39.
- `v5 — verificación 100 % automática`: se añade §7.3 «Testing: todo automático,
  sin excepciones» con el reparto por harness (Vitest para dominio y acciones,
  Playwright para flujos) apoyado en la infraestructura que ya existe
  (`vitest.config.ts` con `file:./test.db`, `playwright.config.ts` +
  `tests/e2e/global-setup.ts`). El preámbulo de §8 deja de admitir observación
  manual. §6.6 nueva con el mapa de ficheros de test. Criterios 40-43 nuevos:
  e2e actualizado, correspondencia criterio → test escrita, cada test falla
  antes del cambio, y 100 % de cobertura en los módulos puros nuevos; total 43.
- `v6 — APPROVED`: visto bueno explícito del usuario el 8 de septiembre de 2026.
  Sin cambios de contenido respecto a v5. Habilita el hand-off a `/feature`, que
  deriva los hitos de los 43 criterios de aceptación.
