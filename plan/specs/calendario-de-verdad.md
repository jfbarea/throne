---
slug: calendario-de-verdad
status: APPROVED
version: 3
---

# Calendario de verdad

## 1. Problema

`/calendario` se llama calendario pero no lo es. Hoy
(`src/app/calendario/page.tsx`) son dos listas planas de `MatchRow`: «Sin
fecha (N)» y «Agendadas (N)», estas últimas ordenadas por `scheduledAt`. Con
78 partidas repartidas en ~6 rondas mensuales, la lista «Agendadas» es un
scroll largo del que no se saca la pregunta que uno se hace de verdad —
*¿qué se juega este finde?*, *¿qué días están libres para quedar?* — porque
no hay ninguna noción de día ni de mes en la pantalla.

Y hay un agujero al lado: la fecha y el resultado son dimensiones
independientes por diseño (SPEC §7.5, `Match.scheduledAt` nullable y
ortogonal a `status`), así que `reportResult`
(`src/server/result-actions.ts:129`) y `declareWalkover` (`:431`) apuntan un
resultado sin mirar `scheduledAt` en ningún momento. Se puede apuntar un
80-20 en una partida que nunca tuvo fecha, y se puede borrar la fecha de una
partida ya apuntada con el botón «Limpiar fecha» de `ScheduleForm`. El
resultado: partidas jugadas que en el calendario no aparecen en ningún día,
que es justo lo que rompe la vista nueva.

## 2. Alcance

- `/calendario` pasa a ser una **cuadrícula mensual** de 7 columnas, un mes
  por pantalla, con las partidas dibujadas en el día que tienen acordado.
- La cuadrícula es la **misma en cualquier ancho**. En móvil la celda del día
  muestra solo el número y un indicador de cuántas partidas hay; **tocar un
  día despliega el detalle** de ese día debajo de la rejilla.
- Las partidas **sin fecha** siguen teniendo su sitio: no caben en ninguna
  celda, así que conservan una zona propia fuera de la rejilla.
- **No se puede apuntar un resultado en una partida sin fecha.** La fecha
  pasa a ser precondición de `reportResult` — no de la incomparecencia ni del
  cierre de ronda, que resuelven partidas no jugadas — y deja de poder
  borrarse cuando ya hay un resultado `PLAYED`.
- La fecha gana además un **rango válido**: nunca más tarde que el cierre de
  la ronda de la partida (con salida de admin), nunca antes del arranque de
  la liga.

## 3. No-objetivos

- **No se conserva la vista de listas.** La rejilla **sustituye** a las
  secciones «Sin fecha» / «Agendadas» de `/calendario`; no hay conmutador
  lista↔calendario ni se guarda una preferencia por usuario (§4.1).
- **No se absorbe `/rondas`.** Los cupos por jugador y el cierre de ronda se
  quedan donde están; esta spec solo le cambia el título (§4.13).
- **No se toca el reparto de partidas en rondas.** Qué partida cae en qué
  ronda lo sigue decidiendo `roundRobinRounds` al generar, y nadie la mueve
  de ronda. Lo que esta spec permite es adelantar el **día**, no cambiar la
  **ronda** (§4.5, §4.6).
- **No se exige fecha a las resoluciones sin jugar.** La incomparecencia y el
  cierre de ronda siguen creando `Result` sin `scheduledAt` (§4.8).
- **No hay guarda de «fecha ya pasada» para apuntar** (§4.10).
- **No se avisa a nadie de nada.** Ni recordatorios de partida próxima, ni
  email, ni push: el proyecto no los tiene y esta spec no los introduce.
- **No se exporta a iCal ni se sincroniza con Google Calendar.**
- **No hay vista de semana ni de día completo.** La unidad de navegación es
  el mes (§4.1).
- **No se arrastran partidas.** Mover una partida de día se hace eligiéndola
  en el selector del día destino (§4.5), no con drag & drop.
- **No se modela la disponibilidad.** El calendario no sabe quién puede qué
  días; no hay «marcar día libre» ni sugerencia de hueco.
- **No se toca el modelo de datos.** `scheduledAt` sigue siendo nullable y
  ortogonal a `status`: la invariante de §4.8 se sostiene en las acciones de
  servidor, no en una columna nueva ni en una migración (§6).

## 4. Comportamiento esperado

### 4.1. Un mes por pantalla

`/calendario` muestra **un solo mes** a la vez, como rejilla de 7 columnas
empezando en lunes, con las semanas completas del mes (los días de relleno
del mes anterior/siguiente se pintan apagados y no aceptan interacción).

Cabecera del mes: **`Octubre 2026 · Ronda 3 · cierra el 31`**, con flechas
`←` `→` a los meses contiguos. Como `deriveDeadlines`
(`src/server/rounds.ts:800`) fija el cierre de la ronda N en el último día
del mes N contado desde `League.startMonth`, **mes y ronda son la misma
cosa**: la cabecera puede nombrar las dos sin ambigüedad.

**Navegación acotada.** Solo se puede navegar a meses que tienen ronda: en el
primer mes la flecha `←` está deshabilitada, y en el último la `→`. No hay
navegación infinita a meses vacíos.

**Mes de entrada.** Al abrir `/calendario` sin más contexto se muestra el mes
de hoy si cae dentro del rango de rondas de la liga. Si no cae (la liga no ha
empezado, o ya terminó), se muestra el mes de la **primera ronda abierta**
(`closedAt === null`, menor `index`). Si no hay ninguna abierta, el mes de la
última ronda.

**El mes visible vive en la URL**, como `?mes=AAAA-MM` (`/calendario?mes=2026-10`).
La página es un Server Component que carga **solo las partidas de ese mes**,
más las que su bloque «Sin fecha» necesita; las flechas `←` `→` son `<Link>`.
Así el mes es enlazable y compartible y el botón «atrás» del navegador hace
lo que se espera. Sin `?mes`, el mes de entrada es el de arriba. Un `?mes`
malformado o fuera del rango navegable cae al mes de entrada, sin error.

### 4.2. Qué se ve en la celda de un día

Cada día con partidas muestra un **punto por partida**, además del número del
día:

| Marca | Significado |
|---|---|
| `·` apagado | partida agendada ese día, todavía sin resultado |
| `●` en `--accent` | partida con resultado (`status` REPORTED o CONFIRMED) |
| anillo alrededor del punto | la juega el jugador de la sesión |
| `+N` | hay más de 4 partidas ese día; se muestran 4 puntos y el resto contados |

El día de **hoy** se distingue del resto, y el día del **cierre de la ronda**
(la `deadline` del mes visible) se marca en la rejilla.

### 4.3. El detalle del día

Tocar (o clicar) un día con partidas **despliega su detalle debajo de la
rejilla**, sin navegar a otra página: encabezado con el día y, por cada
partida, lo que hoy enseña `MatchRow` — jugadores, hora si la hay, lugar,
badge de estado (vía `resolveMatchStatusLabel`) y el botón de fecha para
quien pueda editarla. Solo hay un día desplegado a la vez; volver a tocarlo
lo cierra.

### 4.4. Las partidas sin fecha del mes visible

Debajo de la rejilla, un bloque **`Sin fecha · Ronda 3 (5)`** lista las
partidas **de la ronda de ese mes** que todavía no tienen día. Al navegar de
mes, el bloque cambia con él: son exactamente las que hay que agendar antes
de que esa ronda cierre.

Cada fila del bloque enseña lo mismo que una partida del detalle del día
(jugadores, badge, botón de fecha para quien pueda editarla) menos la hora y
el lugar, que no existen todavía. Si la ronda no tiene ninguna partida sin
fecha, el bloque no se pinta.

### 4.5. Agendar tocando un día

Tocar un día **abre un selector** con las partidas que el jugador de la
sesión puede llevar a ese día; al elegir una, se le fija ese día y se pide la
hora. El selector está disponible tanto en un día vacío como al pie del
detalle de un día que ya tiene partidas.

**Qué ofrece el selector: adelantar sí, retrasar no.** Para un día del mes
`M`, el selector ofrece las partidas del jugador (todas las de la liga si es
admin) cuya ronda sea la de `M` **o cualquiera posterior**. Nunca las de
rondas anteriores: una partida de la ronda 2 no puede acabar jugándose en el
mes de la ronda 4, pero una de la ronda 5 sí puede adelantarse al mes de la
3. Esto continúa el no-objetivo de la spec `rondas-con-fecha` («No se bloquea
adelantar partidas»).

**Incluye las ya agendadas.** Una partida del jugador que ya tiene día
también aparece en el selector, con su fecha actual visible, de modo que
elegirla la **mueve** a este día. El selector es por tanto la vía para
reagendar, además de para agendar.

Si para ese día no hay ninguna partida que el jugador pueda llevar allí, el
día no reacciona al tocarlo (más allá de desplegar su detalle, si lo tiene).

### 4.6. El tope de la ronda es regla de dominio

«Nunca más tarde que su ronda» **la valida el servidor**, no solo la rejilla.
`setMatchSchedule` (`src/server/match-actions.ts:349`) rechaza toda
`scheduledAt` posterior a la `deadline` de la ronda de la partida, **venga de
donde venga**: del selector del calendario o del `datetime-local` de
`ScheduleForm`, que hoy acepta cualquier fecha. El input lleva además el
atributo `max` con esa misma fecha, para que el rechazo sea la red y no el
camino habitual.

**Salida para el admin.** El admin **sí** puede fijar una fecha posterior a
la deadline de la ronda — la partida que el grupo acuerda arrastrar. El
jugador no. La validación es por tanto la misma predicado con una rama de
rol, al estilo de `canReportGivenRoundClosed`
(`src/server/result-logic.ts`), y el selector del calendario de un admin
ofrece en consecuencia partidas de cualquier ronda.

Las partidas de playoff (`phase = PLAYOFF`) no tienen `Round`
(`Match.roundId` null) y por tanto no tienen tope: esta validación no aplica
a ellas.

### 4.7. El rango válido de una fecha

Juntando los dos extremos, la `scheduledAt` de una partida de liga debe caer
en:

```
[ primer día de League.startMonth , deadline de la ronda de la partida ]
```

El suelo es el arranque de la liga: **se aceptan fechas pasadas** — son
imprescindibles, porque con §4.9 nadie puede apuntar un resultado sin fecha y
la pareja que jugó el sábado sin haber agendado tiene que poder ponerla hacia
atrás — pero no fechas anteriores a que la liga existiera, que solo pueden
ser un dedo torpe en el año del `datetime-local`.

El techo es §4.6, con la salida de admin. El suelo no tiene salida de admin:
una fecha anterior al arranque de la liga no es una decisión, es un error.

### 4.8. Sin fecha no hay resultado

`reportResult` (`src/server/result-actions.ts:129`) **rechaza la partida cuya
`scheduledAt` es `null`**. Es una guarda más en la cadena que ya tiene
(participante o admin → estado → ronda cerrada → empate en playoff), con su
mensaje en español: la partida necesita día antes de tener marcador.

La guarda **no distingue rol**: tampoco el admin apunta un resultado sin
fecha. Poner la fecha primero es un clic, y la excepción de admin aquí solo
serviría para reintroducir por la puerta de atrás justo lo que la
restricción viene a cerrar.

**Las otras dos vías de resultado quedan exentas**, porque resuelven partidas
que *no se jugaron* y no hay día que exigir:

| Vía | Resolution | ¿Exige fecha? |
|---|---|---|
| `reportResult` — apuntar/editar VP | `PLAYED` | **Sí** |
| `declareWalkover` — incomparecencia 80-0 | `WALKOVER` | No |
| `closeRound` — saldar 0-0 al cerrar | `UNPLAYED_DRAW` | No |

La invariante que queda, por tanto, es la precisa: **toda partida con
`resolution = PLAYED` tiene fecha**. No «todo resultado tiene fecha».

### 4.9. La fecha de una partida apuntada no se borra

La invariante de §4.8 se rompería igual por el otro lado: hoy `ScheduleForm`
tiene un botón **«Limpiar fecha»** que llama a `setMatchSchedule` con
`scheduledAt: null`, y nada impide usarlo sobre una partida ya apuntada.

Con `resolution = PLAYED`:

- **Borrar la fecha se rechaza.** `setMatchSchedule` devuelve error ante
  `scheduledAt: null`, y el botón «Limpiar fecha» no se pinta. Sin salida de
  admin, por la misma razón que §4.8.
- **Cambiarla sigue permitido** para participantes y admin, dentro del rango
  de §4.7: corregir «jugamos el 12, no el 11» es una corrección legítima y
  frecuente.

Una partida sin resultado, o con `WALKOVER` / `UNPLAYED_DRAW`, conserva el
botón de limpiar tal cual está hoy.

### 4.10. Apuntar una partida con fecha futura: se permite

No hay guarda sobre «la fecha ya ha pasado». La `scheduledAt` es un acuerdo
entre dos, no un reloj: quien apunta el resultado antes del día que tiene
puesto es que tiene la fecha mal, y lo arregla cambiándola (§4.9). Añadir la
guarda obligaría a decidir en qué zona horaria se compara el día — el
servidor corre en UTC y aquí se juega en UTC+1/+2 — a cambio de cerrar un
hueco que nadie tiene incentivo en usar.

### 4.11. Los playoffs también se ven

La rejilla **deja de filtrar por `phase = LEAGUE`**: las partidas de playoff
se pintan en su día como cualquier otra, con una marca visual que las
distingue de las de liga.

Los meses de playoff no tienen `Round` (`Match.roundId` es null por diseño),
así que en ellos:

- La cabecera dice **`Marzo 2027 · Playoffs`**, sin ronda ni fecha de cierre.
- No hay bloque «Sin fecha · Ronda N» (§4.4); si hay partidas de playoff sin
  fecha, se listan bajo **`Sin fecha · Playoffs`**.
- No hay tope de ronda (§4.6): una partida de playoff acepta cualquier fecha
  desde el arranque de la liga en adelante.
- El selector de §4.5 ofrece las partidas de playoff del jugador en cualquier
  mes navegable, sin la regla de rondas.

**Navegación (§4.1) ampliada:** el rango de meses navegable pasa a ser el que
cubre las rondas **y** los meses con partidas de playoff agendadas.

### 4.12. El día de una partida se decide en `Europe/Madrid`

`Match.scheduledAt` es un instante. A qué **día** de la rejilla pertenece se
resuelve siempre en la zona **`Europe/Madrid`**, fija, tanto en servidor como
en cliente. La liga se juega en España: el límite de día y de mes que importa
es el que vive la gente, no el de la máquina.

Esto arregla de paso una incoherencia que ya existe: `MatchRow` formatea con
`toLocaleDateString` (huso del navegador) mientras `deriveDeadlines`
(`src/server/rounds.ts:800`) calcula los cierres de ronda en UTC. Una partida
del 1 de noviembre a las 00:30 hora española es 31 de octubre en UTC — otro
día de la rejilla y otra ronda.

La zona fija aplica a **las tres** decisiones, que si no se contradicen entre
sí:

1. En qué celda se pinta una partida (§4.2).
2. Qué mes cubre cada ronda para el tope de §4.6 y el suelo de §4.7.
3. Qué día es «hoy» (§4.1, §4.2).

### 4.13. `/rondas` deja de llamarse «Calendario de la liga»

`/rondas` (`src/app/rondas/page.tsx:149`) se titula hoy «Calendario de la
liga» y enseña cupos y cierres. Con `/calendario` convertido en calendario de
verdad, dos entradas del menú dirían lo mismo. `/rondas` **se queda tal
cual** — misma ruta, mismo contenido, misma entrada de menú — y solo cambia
su `h1` y su bajada para nombrar lo que de verdad es: las rondas, sus cierres
y el cupo de cada jugador.

### 4.14. Ronda cerrada: la fecha se congela para el jugador

`setMatchSchedule` gana la misma guarda de ronda cerrada que ya tiene
`reportResult`, con **el mismo predicado**: `canReportGivenRoundClosed`
(`src/server/result-logic.ts:195`). Un participante no puede poner ni cambiar
la fecha de una partida cuya ronda tiene `closedAt`; el admin sí.

La razón es la de §4.8 al revés: una ronda cerrada ya saldó sus partidas
pendientes a `UNPLAYED_DRAW`, y dejar que un jugador les ponga fecha después
las deja a medias — con día pero con un resultado que dice que nunca se
jugaron.

Esto también acota el selector de §4.5: las partidas de rondas cerradas no se
ofrecen a un jugador (sí a un admin).

## 5. Casos límite y errores

### 5.1. No hay liga, ni rondas, ni partidas

- **Sin liga** (`league === null`): se mantiene la tarjeta actual «No hay
  ninguna liga configurada todavía». No se pinta rejilla.
- **Liga sin `startMonth`** (SETUP recién creada): no hay rondas ni partidas.
  Se pinta la rejilla **del mes de hoy**, vacía, con el mensaje «Todavía no
  hay partidas generadas» y, para el admin, el enlace a
  `/admin/emparejamientos` que ya existe hoy. Las flechas quedan
  deshabilitadas: no hay rango que navegar.
- **Mes sin ninguna partida** dentro de un rango que sí existe: rejilla
  pintada y vacía, sin bloque «Sin fecha» si esa ronda no tiene pendientes.
  No es un error.

### 5.2. Partida de liga sin ronda asignada (`roundId = null`)

Puede ocurrir: `addMissingPairings` (`src/server/match-actions.ts`) crea las
partidas antes de que `redistributePending` las reparta, y si el reparto
falla quedan sin ronda — `MatchRow` ya contempla ese estado («Sin ronda»).

Para la rejilla se tratan como pertenecientes a la **primera ronda abierta**:
aparecen en el bloque «Sin fecha» de ese mes, etiquetadas «Sin ronda», para
que sean visibles en vez de desaparecer por no tener mes. Al no tener
`deadline`, **no tienen tope** de §4.6; el suelo de §4.7 sí les aplica.

### 5.3. Un día con muchas partidas

La celda pinta como máximo 4 puntos y, si hay más, `+N` con el resto. El
detalle del día (§4.3) las lista **todas**, sin recorte y sin scroll propio:
el que scrollea es el documento.

### 5.4. Navegar con un día desplegado

Cambiar de mes **cierra** el detalle abierto. El estado «día desplegado» es
del mes visible y no sobrevive a la navegación.

### 5.5. Fecha fuera de rango

`setMatchSchedule` rechaza con un mensaje en español que dice **cuál** de los
dos extremos se ha violado:

- Posterior al tope de la ronda → «Esta partida es de la ronda N, que cierra
  el D de M. Elige una fecha anterior.» (no aplica al admin, §4.6).
- Anterior al arranque de la liga → «La liga empieza en M de AAAA. No puedes
  fechar una partida antes.»

El `datetime-local` lleva `min` y `max` coherentes con esos extremos, así que
el rechazo del servidor es la red, no el camino habitual.

### 5.6. Editar solo el lugar de una partida con fecha fuera de rango

`setMatchSchedule` solo valida los campos que recibe. Una partida que ya
tuviera una `scheduledAt` fuera del rango (datos anteriores a esta spec, o
una fecha puesta por el admin con su salida de §4.6) **no se revalida** al
cambiarle únicamente el `location`. La validación es de escritura de fecha,
no de lectura ni de coherencia retroactiva.

### 5.7. El admin mueve la `deadline` de una ronda después

`EditDeadlineForm` (`src/app/admin/rondas/EditDeadlineForm.tsx`) permite
cambiar la fecha de cierre de una ronda. Si se adelanta, puede dejar partidas
ya agendadas por detrás del nuevo tope. **No se reajustan ni se invalidan**:
la validación de §4.6 es del momento de escribir. Las partidas afectadas
siguen donde están y se pintan en su día; solo una edición posterior de su
fecha tendría que respetar el tope nuevo.

### 5.8. Dos jugadores agendan la misma partida a la vez

Última escritura gana, igual que hoy. No se añade bloqueo optimista ni
control de versión: `setMatchSchedule` es un `update` sobre una fila y ambos
son participantes autorizados.

### 5.9. Resultados ya apuntados sin fecha

Los `Result` con `resolution = PLAYED` y `scheduledAt = null` creados antes
de esta spec (en `dev.db`, 2 de 2) **no se migran**. La guarda de §4.8 solo
mira las escrituras nuevas:

- Siguen contando en la clasificación exactamente igual.
- Aparecen en el bloque «Sin fecha» de su ronda, marcados **«jugada, falta la
  fecha»**, para que se vean y alguien las feche.
- **Editar su resultado exigirá ponerla**, porque `reportResult` la exige
  antes de escribir. Es el camino por el que se arreglan solas.

No se inventa ningún día: ni `reportedAt` ni la `deadline` de la ronda son la
fecha en que se jugó.

### 5.10. Cambio de hora y meses de 28/30/31 días

La zona fija de §4.12 (`Europe/Madrid`) absorbe el cambio de hora: el salto
de una hora no mueve de día a ninguna partida salvo que ya estuviera a menos
de una hora de medianoche, en cuyo caso el día correcto sigue siendo el que
se ve en la rejilla, que es el que se calcula en esa misma zona. La longitud
del mes ya la resuelve `deriveDeadlines` con `Date.UTC(year, month + 1, 0)`,
que no se toca.

### 5.11. Sesión sin `playerId`

Una sesión de admin sin `Player` asociado no es participante de nada: el
selector de §4.5 le ofrece, por su rol, todas las partidas sin fecha. Nada
nuevo respecto de lo que ya hace `setMatchSchedule` con `isAdmin`.

## 6. Superficie afectada

Escrita **contra `main`**, no contra la PR #1 (§9).

### 6.1. Ficheros nuevos

| Fichero | Papel |
|---|---|
| `src/server/calendar.ts` | Lógica pura de fechas: a qué día/mes cae un instante en `Europe/Madrid`, el mes de una ronda, el rango de meses navegable, el reparto de partidas en celdas. Sin Prisma y sin SQL, testeable sola (como `src/server/rounds.ts`). |
| `src/app/calendario/MonthGrid.tsx` | Client component: la rejilla, los puntos, el día desplegado. |
| `src/app/calendario/DayDetail.tsx` | El detalle del día desplegado (§4.3). |
| `src/app/calendario/DaySchedulePicker.tsx` | El selector de §4.5 y su llamada a `setMatchSchedule`. |
| `tests/calendario-de-verdad.test.ts` | Unit de `src/server/calendar.ts` y de las guardas nuevas. |

### 6.2. Ficheros modificados

| Fichero | Cambio |
|---|---|
| `src/app/calendario/page.tsx` | Reescrita: lee `?mes`, resuelve el mes de entrada, carga las partidas del mes (ya **sin** el filtro `phase: "LEAGUE"`, §4.11) y las sin fecha de la ronda, y monta la rejilla. Desaparecen las secciones «Sin fecha» / «Agendadas». |
| `src/app/calendario/MatchRow.tsx` | Se conserva como fila del detalle del día y del bloque «Sin fecha»; gana la marca de playoff (§4.11) y la de «jugada, falta la fecha» (§5.9). |
| `src/components/ScheduleForm.tsx` | `min`/`max` en el `datetime-local` (§4.7, §5.5); el botón «Limpiar fecha» no se pinta con `resolution = PLAYED` (§4.9). |
| `src/server/match-actions.ts` | `setMatchSchedule`: validación de rango (§4.6, §4.7), guarda de ronda cerrada (§4.14), rechazo de `scheduledAt: null` sobre resultado `PLAYED` (§4.9), y `revalidatePath` de las vistas afectadas. |
| `src/server/result-actions.ts` | `reportResult`: guarda de «sin fecha no hay resultado» (§4.8), antes de abrir la transacción, con el mismo patrón que las guardas que ya tiene. |
| `src/server/result-logic.ts` | Predicados puros nuevos: `canScheduleAt(scheduledAt, round, league, isAdmin)` y `canReportGivenSchedule(scheduledAt)`. Reutiliza `canReportGivenRoundClosed` tal cual. |
| `src/app/rondas/page.tsx` | Solo el `h1` y la bajada (§4.13). |
| `src/app/mis-partidas/MatchCard.tsx` | Hereda el `ScheduleForm` con las reglas nuevas; el botón de resultado explica por qué está deshabilitado si no hay fecha. |
| `tests/e2e/full-journey.spec.ts` | El recorrido pasa por la rejilla en vez de por las listas, y agenda antes de apuntar. |

### 6.3. Datos, contratos y compatibilidad

- **Sin migración Prisma.** Ni columnas nuevas ni cambios de tipo:
  `Match.scheduledAt` sigue nullable y ortogonal a `status`. La invariante de
  §4.8 se sostiene en las acciones de servidor.
- **Sin dependencias nuevas.** La zona `Europe/Madrid` se resuelve con
  `Intl.DateTimeFormat` de la plataforma; no entra `date-fns-tz`, `luxon` ni
  equivalente.
- **Rompe hacia atrás, a propósito, en tres puntos**: apuntar resultado sin
  fecha, borrar la fecha de una partida jugada, y fechar fuera del rango. Son
  rechazos nuevos de acciones que antes pasaban.
- **No rompe datos existentes** (§5.9): nada de lo ya guardado se reescribe
  ni deja de contar.
- **Rutas:** `/calendario` conserva su ruta y su entrada de menú; solo gana
  el parámetro `?mes`.

## 7. Restricciones

- **Next.js 16 (App Router) + TypeScript**, React + Tailwind, dark mode
  hard-coded, como el resto del proyecto. La rejilla es cliente; la carga de
  datos, Server Component.
- **Mobile-first de verdad (SPEC §8).** La rejilla es la misma en todo ancho
  y tiene que caber y ser tocable en 390px: la celda es el objetivo táctil, y
  ni la rejilla ni el detalle scrollean en horizontal — el que scrollea es el
  documento.
- **Español en la UI, inglés en código y comentarios** (CLAUDE.md).
- **Portabilidad SQLite↔Postgres (ADR-002).** La lógica de fechas vive en
  `src/server/calendar.ts` como funciones puras; nada de funciones de fecha
  propias del motor en las consultas.
- **Una consulta por vista, sin N+1**, al estilo de `getRoundsOverview`
  (`src/server/round-overview.ts`), y acotada al mes visible.
- **Las guardas nuevas se escriben como predicados puros** en
  `src/server/result-logic.ts`, testeables sin DB, y se comprueban en la
  acción de servidor — nunca solo en el cliente.
- **Vitest para dominio, Playwright para el recorrido.** La zona horaria fija
  hace que los tests no dependan del `TZ` de la máquina.

## 8. Criterios de aceptación

**La rejilla**

1. `/calendario` renderiza una rejilla de 7 columnas empezando en lunes con
   las semanas completas del mes visible; los días de relleno de los meses
   contiguos se pintan apagados y no responden al toque.
2. La cabecera del mes de una ronda muestra mes, año, `Ronda N` y el día de
   cierre, tomado de `Round.deadline`.
3. Una partida con `scheduledAt` aparece como un punto en la celda de su día,
   calculado en `Europe/Madrid`; una partida del 1 de noviembre a las 00:30
   hora española cae en el 1 de noviembre, no en el 31 de octubre.
4. El punto de una partida con `status` REPORTED o CONFIRMED se pinta en
   `--accent`; el de una sin resultado, apagado.
5. El punto de una partida del jugador de la sesión se distingue del de las
   demás.
6. Un día con 6 partidas muestra 4 puntos y `+2`; su detalle lista las 6.
7. Tocar un día con partidas despliega su detalle debajo de la rejilla con
   jugadores, hora, lugar y badge de estado; volver a tocarlo lo cierra; solo
   hay un día desplegado a la vez.
8. `/calendario?mes=2026-10` renderiza octubre de 2026 en el servidor; las
   flechas son enlaces que cambian `?mes`; `?mes=patata` y un mes fuera del
   rango navegable caen al mes de entrada sin error.
9. Sin `?mes`, se muestra el mes de hoy si cae en el rango navegable; si no,
   el de la primera ronda abierta; si no hay ninguna abierta, el de la última
   ronda.
10. La flecha `←` está deshabilitada en el primer mes del rango y la `→` en
    el último.
11. El bloque «Sin fecha · Ronda N» lista exactamente las partidas de la
    ronda del mes visible con `scheduledAt = null`, y cambia al navegar de
    mes. Si no hay ninguna, no se pinta.
12. Las partidas de playoff se pintan en su día; en un mes sin ronda la
    cabecera dice «Playoffs», sin ronda ni cierre, y el bloque de pendientes
    se titula «Sin fecha · Playoffs».

**Agendar desde la rejilla**

13. Tocar un día ofrece al jugador sus partidas de la ronda de ese mes y de
    las posteriores, incluidas las que ya tienen fecha (con su fecha visible);
    nunca las de rondas anteriores.
14. Elegir en el selector una partida que ya tenía fecha la mueve a ese día.
15. El selector está disponible tanto en un día vacío como al pie del detalle
    de un día con partidas.
16. Un día para el que el jugador no tiene ninguna partida agendable no abre
    selector.
17. El selector de un admin ofrece partidas de cualquier ronda.

**El rango de fechas**

18. `setMatchSchedule` rechaza, para un participante, una `scheduledAt`
    posterior a la `deadline` de la ronda de la partida, con un mensaje que
    nombra la ronda y su fecha de cierre.
19. La misma llamada, hecha por un admin, se acepta.
20. `setMatchSchedule` rechaza, para cualquier rol, una `scheduledAt`
    anterior al día 1 del mes de `League.startMonth`.
21. Una fecha pasada dentro del rango se acepta para cualquier rol: la pareja
    que jugó ayer sin haber agendado puede fechar la partida en el día de
    ayer.
22. El `datetime-local` de `ScheduleForm` lleva `min` y `max` coherentes con
    los dos extremos.
23. Una partida de playoff (`roundId = null`) acepta cualquier fecha desde el
    suelo en adelante.
24. Cambiar solo el `location` de una partida cuya `scheduledAt` está fuera
    de rango no se rechaza.

**Sin fecha no hay resultado**

25. `reportResult` sobre una partida con `scheduledAt = null` se rechaza, con
    mensaje en español, **también para el admin**, y no crea `Result` ni
    escribe `AuditLog`.
26. `declareWalkover` sobre una partida sin fecha sigue funcionando y crea el
    `Result` con `resolution = WALKOVER`.
27. `closeRound` sigue saldando a `UNPLAYED_DRAW` las partidas sin fecha de la
    ronda que cierra.
28. `reportResult` sobre una partida cuya `scheduledAt` es futura se acepta.
29. `setMatchSchedule` con `scheduledAt: null` sobre una partida con
    `resolution = PLAYED` se rechaza para cualquier rol, y el botón «Limpiar
    fecha» no se pinta en ese caso.
30. La misma llamada sobre una partida sin `Result`, o con `WALKOVER` o
    `UNPLAYED_DRAW`, se acepta.
31. Cambiar la fecha (no borrarla) de una partida con `resolution = PLAYED`
    se acepta, dentro del rango.

**Ronda cerrada**

32. Un participante no puede poner ni cambiar la fecha de una partida cuya
    ronda tiene `closedAt`; el admin sí. El predicado es
    `canReportGivenRoundClosed`, el mismo que usa `reportResult`.
33. El selector de §4.5 no ofrece a un jugador partidas de rondas cerradas.

**Datos existentes y casos límite**

34. Un `Result` con `resolution = PLAYED` y `scheduledAt = null` anterior a
    esta spec sigue contando en la clasificación, aparece en el bloque «Sin
    fecha» de su ronda marcado «jugada, falta la fecha», y editarlo obliga a
    fechar la partida primero.
35. Una liga sin `startMonth` pinta la rejilla del mes de hoy, vacía, con el
    mensaje de «todavía no hay partidas» y las flechas deshabilitadas.
36. Una partida de liga con `roundId = null` aparece en el bloque «Sin fecha»
    de la primera ronda abierta, etiquetada «Sin ronda», y no tiene tope de
    ronda.
37. `/rondas` ya no se titula «Calendario de la liga» y su contenido (cupos,
    cierres, badge abierta/cerrada) es el mismo que hoy.
38. La rejilla y el detalle caben en 390px sin scroll horizontal del
    documento.
39. La suite existente (`npm run test`) sigue en verde, incluidas
    `reportar-confirmar`, `incomparecencia` y `cierre-de-ronda`, ajustadas
    donde la fecha pasa a ser precondición.

## 9. Riesgos y preguntas abiertas

### 9.1. Colisión frontal con la PR #1 (`feat/multi-liga`)

**Es el riesgo grande y está asumido.** La PR #1 (abierta, 122 ficheros,
+16020/−3439) mueve `src/app/calendario/*` a
`src/app/liga/[slug]/calendario/*` y toca `ScheduleForm.tsx`,
`match-actions.ts`, `result-actions.ts`, `mis-partidas/*` y
`schema.prisma`: exactamente la superficie de §6.

Decidido escribir **contra `main`**. Consecuencia: quien mergee primero deja
al otro rebasando. Si entra esta antes, #1 tiene que rebasar una rejilla
nueva; si entra #1 antes, esta spec necesita una vuelta que cambie §6 a las
rutas `/liga/[slug]/…` — el comportamiento de §4 y §5 no cambiaría, solo las
rutas y los ficheros.

**Mitigación posible**: mantener la lógica nueva en `src/server/calendar.ts`
y en los predicados de `result-logic.ts`, que #1 no mueve de sitio, y dejar
en las páginas lo mínimo. Reduce el conflicto a los componentes de UI.

### 9.2. Abierto: qué aspecto tiene exactamente el selector del día

§4.5 fija **qué** ofrece el selector y desde dónde, pero no su forma (hoja
inferior, lista inline bajo la celda, modal). Se cierra al implementar, con
la única restricción de §7: tocable y legible en 390px. No bloquea.

### 9.3. Riesgo: la rejilla en móvil con muchos puntos

Con 13 partidas al mes repartidas sobre todo en fines de semana, un sábado
puede juntar 4-5. En una celda de ~52px, 4 puntos más el número del día es
justo. Si al implementarlo no entra, la salida es bajar el máximo de puntos
a 3 y tirar antes de `+N`, no cambiar la forma de la vista (§4.2).

### 9.4. Riesgo: `Intl.DateTimeFormat` como única herramienta de zona

§7 prohíbe dependencias nuevas, así que el reparto por día en
`Europe/Madrid` se hace con `Intl`. Es suficiente, pero la aritmética de
«primer día del mes en esa zona» y «último día de la ronda en esa zona» hay
que escribirla a mano y es donde suelen vivir los off-by-one. Es la razón de
que `src/server/calendar.ts` sea puro y tenga su propio fichero de tests
(§6.1), con casos en los dos cambios de hora.

### 9.5. Riesgo: contradicción entre el tope de §4.6 y `deriveDeadlines`

`deriveDeadlines` calcula los cierres **en UTC** y §4.12 fija la zona de la
rejilla en `Europe/Madrid`. Para una `deadline` guardada como «31 de octubre
00:00 UTC», el último instante válido de la ronda en zona española no es
obvio. §4.6 debe compararse contra **el final del día de la `deadline` en
`Europe/Madrid`**, no contra el instante guardado, o el día del cierre queda
fuera de su propia ronda. Está anotado aquí porque es el punto exacto donde
esta spec puede romperse en silencio.

### 9.6. Abierto: el aviso de las partidas legacy sin fecha

§5.9 dice que se marcan «jugada, falta la fecha» en el bloque de su ronda.
Con la liga real arrancando, son 2 partidas y desaparecerán solas. No se ha
decidido si además se avisa en `/mis-partidas`; no bloquea.

## 10. Bitácora

- `v1` — primer borrador: esqueleto y el solape con la PR #1 anotado.
- `v2` — interrogatorio completo. Decidido: base `main`; rejilla mensual
  única en todo ancho con detalle del día al tocar; navegación por mes en la
  URL; celda con puntos por estado y las propias marcadas; bloque «Sin fecha»
  de la ronda del mes; agendar tocando un día con selector de «adelantar sí,
  retrasar no»; tope de ronda como regla de dominio con salida de admin;
  suelo en el arranque de la liga; fecha obligatoria solo en `reportResult`;
  prohibido borrar la fecha de una partida `PLAYED`; sin guarda de fecha
  futura; playoffs dentro de la rejilla; zona `Europe/Madrid` fija; `/rondas`
  solo cambia de título; fecha congelada en ronda cerrada salvo admin; datos
  antiguos sin migrar.
- `v3` — `APPROVED` por el usuario el 19 de septiembre de 2026, sin cambios de
  contenido. El plan de ejecución vive en
  `plan/calendario-de-verdad/TRACKS.md`: 6 tracks, 4 en paralelo.
