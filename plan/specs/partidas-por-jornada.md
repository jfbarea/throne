---
slug: partidas-por-jornada
status: APPROVED
version: 2
---

# Partidas por jornada

## 1. Problema

`/mis-partidas` (`src/app/mis-partidas/page.tsx`) tiene hoy dos carencias:

- **El admin no puede ver solo sus partidas.** Si `session.role === "ADMIN"`,
  la página enseña todas las partidas de la liga («Gestión de partidas»), aunque
  el admin también juega: es un `Player` con `playerId`. Para encontrar las
  suyas tiene que recorrer la lista entera.
- **La lista es un muro.** Cada ronda es un bloque siempre desplegado, en el
  orden de `sortRoundBlocks`, y no hay forma de buscar una partida concreta.
  Con la vista de admin (todas las partidas de todas las rondas) esto se
  convierte en un scroll largo.

**Por qué ahora:** en el móvil cuesta encontrar una partida concreta. Allí
se usa la app de verdad («thumb-on-table», SPEC §8), y la pantalla solo
muestra un par de tarjetas cada vez. Para llegar a una partida hay que hacer
scroll por bloques enteros de rondas que no interesan.

## 2. Alcance

- **Solo admin:** dos pestañas en `/mis-partidas`: «Mis partidas» (las que
  juega el propio admin) y «Toda la liga» (las de toda la liga, lo que ve hoy).
- **Para todos (admin y jugador):**
  - Un buscador de partidas por nombre.
  - Cada jornada (ronda) en un bloque plegable. Todas plegadas salvo la
    jornada actual.
  - Un filtro por estado (jugadas / no jugadas), que por defecto muestra solo
    las no jugadas.

El detalle de cada punto está en §4: la jornada actual en §4.1, los bloques
que no son jornada en §4.1b, el buscador en §4.2-4.3, las pestañas en §4.4 y
la cabecera en §4.5.

## 3. No-objetivos

- **Otros filtros.** Nada de filtrar por ronda o por fecha. Solo el buscador
  por nombre y el filtro de estado de §4.6.
- **Pestañas o vista «Toda la liga» para un jugador.** Un jugador ve lo mismo que
  hoy, más el buscador y los plegables.
- **Recordar el plegado entre recargas** (`localStorage` o similar). Cada
  carga vuelve a §4.1.
- **Búsqueda en servidor o paginación.** Con 10-20 jugadores, la lista
  completa de una liga cabe en una página. Se filtra en cliente.
- **Partidas de playoff.** La página sigue mostrando solo `phase: "LEAGUE"`,
  como hoy.
- **Cambios en `MatchCard`, `ReportForm`, `WalkoverForm`** o en lo que se
  puede hacer desde una tarjeta.
- **Cambiar el orden de las jornadas.** Sigue siendo `sortRoundBlocks`.
- **Cambios de comportamiento en `/calendario`.** Solo pasa a importar el
  helper de búsqueda extraído, con el mismo criterio.
- **Multi-liga.** Es cosa de PR #1 (§9).

## 4. Comportamiento esperado

### 4.1 Jornada actual

«Jornada» es lo que la app llama **Ronda** (`Round`). La jornada actual es la
única que sale desplegada al cargar la página. Se decide así, sobre las rondas
de la liga (no sobre las que aparecen en la lista):

1. Entre las rondas **abiertas** (`closedAt === null`) cuyo `deadline` es
   igual o posterior al momento actual, la de `deadline` más cercano.
2. Si no hay ninguna (todas las abiertas han vencido y el admin aún no las ha
   cerrado), la ronda abierta con el `deadline` más reciente, es decir, la
   última en vencer.
3. Si no hay rondas abiertas, ninguna sale desplegada.

Es una función pura en `src/server/` que recibe las rondas y `now`, y
devuelve el `id` de la ronda o `null`.

Una ronda caducada y sin cerrar no le quita el sitio a la que se está
jugando. La regla deliberadamente **no** es «la primera de
`sortRoundBlocks`».

La jornada actual es una propiedad de la liga, no de la lista. Si la lista
que se está viendo (una pestaña, un jugador) no tiene ningún bloque para esa
ronda, **todo sale plegado**. No se busca otra ronda que desplegar ni se
pinta un bloque vacío.

### 4.1b Bloques que no son jornada

Los bloques «Sin ronda asignada» (partidas con `roundId = null`) e
«Historial» (`CONFIRMED`/`DISPUTED` del flujo antiguo) se conservan, en el
mismo sitio (al final, en ese orden). Usan el mismo componente plegable que
una jornada y **siempre salen plegados al cargar**. El buscador filtra
también dentro de ellos, con las mismas reglas de §4.3.

### 4.2 Buscador

Una partida casa con la búsqueda si el texto escrito aparece como subcadena
en el `displayName` de cualquiera de los dos jugadores (`playerHome` o
`playerAway`). Se compara sin distinguir mayúsculas ni acentos: `martin`
encuentra `Martín`. Con el campo vacío (o solo espacios), casa todo.

Es exactamente el criterio del selector del calendario
(`src/app/calendario/DaySchedulePicker.tsx:95-109`, `fold` +
`matchesQuery`). Ese criterio se extrae a un helper puro en `src/server/` y
lo usan tanto el calendario como esta página, en vez de copiarlo por
tercera vez. (`FactionSelect.tsx:38` tiene su propia copia de `fold`; si
se unifica o no es cosa de §6.)

### 4.3 Buscador y plegado juntos

- **Con el buscador vacío**, cada bloque está plegado o desplegado según
  §4.1 al cargar, y el usuario puede abrirlo o cerrarlo a mano.
- **Con texto en el buscador:**
  - Solo se pintan los bloques con al menos una partida que case, y dentro
    de cada uno solo esas partidas.
  - Todos los bloques pintados salen desplegados.
  - La cabecera del bloque muestra cuántas partidas casan, en formato
    «2 de 4 partidas» (§4.5).
  - Se mantiene el orden de bloques de `sortRoundBlocks`.
- **Al vaciar el buscador**, cada bloque vuelve a como lo tenía el usuario
  justo antes de empezar a escribir, incluidos los que había abierto o
  cerrado a mano. No se reaplica §4.1.
- Si ningún bloque tiene coincidencias, se ve un mensaje de «sin resultados»
  en lugar de la lista (§5).
- **El texto del buscador es estado de cliente.** Se filtra en el navegador al
  teclear, sin viajes al servidor y sin tocar la URL. Se conserva al cambiar
  de pestaña (§4.4) y tras la revalidación de una acción (apuntar resultado,
  poner fecha…). Recargar la página lo vacía.
- **El plegado a mano se conserva tras una revalidación**, pero no al cambiar
  de pestaña. Apuntar un resultado no debe cerrar el bloque en el que se
  estaba. Al cambiar de pestaña, la lista es otra y se reaplica §4.1 (o
  §4.3, si hay texto en el buscador).

### 4.4 Pestañas (solo admin)

El admin ve dos pestañas bajo la cabecera, y la seleccionada vive en la URL:

| URL | Pestaña | Partidas |
|---|---|---|
| `/mis-partidas` | «Mis partidas» (por defecto) | las de liga donde `playerHomeId` o `playerAwayId` es el `playerId` del admin, con el mismo filtro que hoy usa un jugador |
| `/mis-partidas?vista=todas` | «Toda la liga» | todas las de liga, lo que el admin ve hoy |

- El filtro se hace en servidor. Recargar, ir atrás o compartir el enlace
  conserva la pestaña. Las revalidaciones tras una acción
  (`revalidatePath("/mis-partidas")`) refrescan la pestaña en la que se está.
- Cualquier otro valor de `vista`, o su ausencia, abre «Mis partidas».
- **Un jugador nunca ve pestañas.** Si pone `?vista=todas`, se ignora y ve
  sus partidas, como hoy.
- **Cabecera por pestaña.** En «Mis partidas», el título es «Mis partidas» y
  el subtítulo de cada ronda muestra el cupo del propio admin
  (`roundQuota`/`quotaLabel`), igual que para un jugador. En «Toda la liga» se
  queda el título actual, «Gestión de partidas», con el agregado «N de M
  jugadas». La línea de recuentos (pendientes, apuntadas…) se calcula sobre
  las partidas de la pestaña activa.
- Los poderes de admin en las tarjetas (`isAdmin` en `MatchCard`) se
  mantienen en las dos pestañas. La pestaña filtra qué se ve, no qué se
  puede hacer.

### 4.5 Cabecera del bloque y disposición

- La cabecera de cada bloque es su subtítulo actual, más el número de
  partidas y un chevron que indica si está plegado o desplegado:
  - Jornada: `Ronda 3 · cierra 30 nov 2026 · falta 1 de 2 · 4 partidas`
    (cupo del jugador) o `… · 4 de 10 jugadas · 10 partidas` (pestaña
    «Toda la liga»).
  - «Sin ronda asignada» e «Historial»: su título y el número de partidas.
  - Si el buscador o el filtro de estado dejan fuera alguna partida, el
    número pasa a `2 de 4 partidas` (§4.6).
- La cabecera muestra lo mismo plegada que desplegada. Toda la cabecera es
  el control para plegar o desplegar, no solo el chevron.
- Orden vertical de la página: cabecera (eyebrow, título, línea de
  recuentos) → pestañas (solo admin) → fila de buscador y filtro de estado
  (§4.6) → bloques.
- **Solo la fila de buscador y filtro va pegada (sticky)** al hacer scroll,
  justo debajo del `AppHeader`, que ya es `sticky top-0 z-10`
  (`src/components/AppHeader.tsx:42`). No lo tapa ni queda detrás de él. Es
  **una sola fila**: el buscador ocupa el espacio flexible a la izquierda y
  el segmentado va a la derecha. Las pestañas del admin **no** son sticky:
  se van con el scroll. Así la franja fija bajo el header se queda en una
  fila (~44 px), y no en tres, en un móvil donde cada fila cuenta.
- El campo es `type="search"` y **sin autofocus**: al entrar no se abre el
  teclado del móvil.

### 4.6 Filtro por estado

- **No jugada = sin resultado** (`Match.status === "SCHEDULED"`, sin
  `Result`): lo que aún hay que jugar o apuntar.
- **Jugada = con resultado**, venga de donde venga: `PLAYED`, `WALKOVER`
  (incomparecencia) o `UNPLAYED_DRAW` (saldada 0-0 al cerrar la ronda).
  También las `CONFIRMED`/`DISPUTED` del «Historial».
- **Por defecto solo se ven las no jugadas.**
- **Control:** un segmentado de tres opciones, siempre con una activa:
  `Pendientes` (no jugadas, por defecto) · `Jugadas` · `Todas`. Va en la
  misma fila sticky que el buscador (§4.5). Si la fila no cabe entera (por
  debajo de ~400 px de ancho), las etiquetas se abrevian a
  `Pend.` · `Jug.` · `Todas`, con el nombre completo en `aria-label`. La pestaña del admin se llama «Toda la
  liga» (no «Todas») para no repetir etiqueta con este filtro: la pestaña
  dice de quién son las partidas; el filtro, en qué estado.

- **Una partida resuelta mientras la miras no desaparece.** Con el filtro en
  `Pendientes`, las partidas que estaban pendientes al entrar en ese filtro
  siguen visibles aunque durante la visita pasen a tener resultado: la
  apuntas tú, la apunta el rival o el admin cierra la ronda. Muestran su
  marcador y su badge, y se pueden editar como cualquier jugada. Salen de
  la lista al cambiar de filtro, al cambiar de pestaña o al recargar. Es
  estado de cliente: el conjunto de ids pendientes se fija al entrar en
  `Pendientes`. Sin esto, apuntar un resultado haría desaparecer la
  tarjeta en la revalidación, sin ver el marcador ni poder corregir una
  errata.

- **El filtro es estado de cliente, como el buscador.** Se aplica en el
  navegador, no toca la URL, se conserva al cambiar de pestaña y tras una
  revalidación, y al recargar vuelve a `Pendientes`. Filtro y buscador se
  combinan con un Y: se ve lo que cumple los dos.

- **Bloques y plegado con el filtro.** Un bloque sin ninguna partida que
  cumpla el filtro no se pinta. El resto conserva el plegado de §4.1 y el que
  haya hecho el usuario a mano: el filtro **no** despliega nada, al
  contrario que el buscador (§4.3). Como `Pendientes` es el estado por
  defecto, desplegar al filtrar dejaría la página siempre abierta. Si el
  filtro oculta el bloque de la jornada actual (ya no te queda nada
  pendiente en ella), se aplica la regla de §4.1: todo sale plegado.
- **Cabecera del bloque** (§4.5). Si el filtro, el buscador o ambos dejan
  fuera alguna partida del bloque, el número pasa a `2 de 4 partidas`
  (visibles de total). Si no dejan fuera ninguna, sigue siendo `4 partidas`.
- **Línea de recuentos.** No cambia con el filtro, igual que con el
  buscador: cuenta la pestaña, y ya desglosa pendientes y apuntadas.

## 5. Casos límite y errores

| Caso | Qué se hace |
|---|---|
| No hay liga | Igual que hoy: «No hay ninguna liga configurada todavía». Sin pestañas ni buscador. |
| Liga sin partidas | Igual que hoy: el aviso de vacío (con el enlace a emparejamientos para el admin). Sin buscador. El admin sí ve las pestañas. |
| Admin en «Mis partidas» sin ninguna partida propia (no juega) | Aviso «No tienes partidas asignadas» y un enlace «Ver todas las partidas →» a `?vista=todas`. |
| Búsqueda sin resultados | En lugar de los bloques: «Ninguna partida casa con «texto»», con un botón para vaciar el buscador. La línea de recuentos no cambia (cuenta la pestaña, no la búsqueda). |
| Filtro `Pendientes` sin nada pendiente (y buscador vacío) | En lugar de los bloques: «No te queda ninguna partida pendiente» (o «No queda ninguna partida pendiente en la liga», en «Toda la liga»), con un botón «Ver jugadas» que cambia el filtro a `Jugadas`. |
| Filtro `Jugadas` sin nada jugado | «Todavía no hay partidas jugadas», con un botón que vuelve a `Pendientes`. |
| Filtro más buscador sin coincidencias | El aviso de búsqueda sin resultados de arriba; su botón vacía el buscador, pero no toca el filtro. |
| Texto solo con espacios | Se recorta; equivale a buscador vacío. |
| Partida con `playerAway = null` | Casa solo por el nombre del local. |
| Dos rondas abiertas con el mismo `deadline` candidatas a jornada actual | Gana la de menor `index`. |
| `deadline` igual al instante actual | Cuenta como no vencida (≥). |
| La revalidación trae un bloque que antes no estaba | Ese bloque nuevo sale según §4.1; los demás conservan su plegado. |
| Se escribe en el buscador con un formulario abierto en una tarjeta que deja de casar | La tarjeta se desmonta y el formulario se pierde sin guardar. Se acepta: no es un flujo real, y protegerlo complicaría el filtro. |
| `?vista=` con valor desconocido, o `?vista=todas` para un jugador | Se ignora (§4.4). |

## 6. Superficie afectada

**Código.**

- `src/app/mis-partidas/page.tsx`:
  - Lee `searchParams.vista` y elige el filtro de la pestaña.
  - Carga las rondas de la liga, necesarias para §4.1 aunque la pestaña no tenga partidas en todas.
  - Calcula en servidor el `id` de la jornada actual.
  - Arma los bloques y se los pasa a un componente de cliente.
  - Se queda delgado; ver la restricción de §7 sobre PR #1.
- Componente de cliente nuevo en `src/app/mis-partidas/`: buscador, filtro de estado, bloques plegables, estado de plegado y el conjunto de «recién resueltas» (§4.6). Monta los `MatchCard` sin cambiarlos.
- Pestañas: enlaces (`next/link`) a `/mis-partidas` y `/mis-partidas?vista=todas`, solo si `isAdmin`.
- `src/server/round-ui.ts`: función pura nueva que elige la jornada actual (§4.1). No toca `rounds.ts`.
- `src/server/`, módulo nuevo: el helper de búsqueda (`fold` y la comparación por nombre de jugador).
  - `src/app/calendario/DaySchedulePicker.tsx` pasa a importarlo, sin cambio de comportamiento.
  - `src/components/FactionSelect.tsx` importa solo `fold` y deja su copia.
- `src/app/guia/sections.ts`: el texto de «Mis partidas» pasa a mencionar las jornadas plegadas y el buscador.

**Tests.**

- Unit (Vitest):
  - La jornada actual, todas las ramas de §4.1 más los empates de §5.
  - El helper de búsqueda.
  - El componente: plegado, búsqueda, restauración, pestañas, filtro de estado y recién resueltas.
- e2e `tests/e2e/full-journey.spec.ts`:
  - Los pasos 7-9 pulsan el primer «Apuntar resultado» de la página y trabajan sobre partidas de la Ronda 1. Con esta feature, la Ronda 1 puede salir plegada, así que hay que desplegarla (o buscar) antes.
  - Se añade un paso para las pestañas del admin.
  - El paso 8 (Beta edita el resultado que apuntó Alfa) busca una partida ya jugada. Con `Pendientes` por defecto no aparece: hay que pasar el filtro a `Jugadas` antes.
  - El paso 6 afirma que se ve «Ronda 1». En una segunda ejecución sobre el mismo `e2e.db`, la Ronda 1 del jugador puede estar ya resuelta y el filtro la oculta. La aserción tiene que ir con `Todas` o no depender de esa ronda.

**Datos, contratos, configuración.** Sin migraciones ni cambios de esquema. Tampoco cambian las server actions ni las rutas de `revalidatePath`.

**Compatibilidad.** Cambia lo que ve el admin al entrar en `/mis-partidas`: antes todas las partidas, ahora las suyas. «Toda la liga» sigue a un clic y es enlazable. Para el jugador, las URLs y las acciones no cambian.

## 7. Restricciones

- **`page.tsx` delgado.** PR #1 tiene que llevar esta página a
  `src/app/liga/[slug]/mis-partidas/`. La lógica va a `src/server/` (pura,
  con tests) y a componentes, y la página solo consulta y monta.
- **El «ahora» de §4.1 se calcula en servidor** y llega como prop. Calcularlo
  en cliente daría desajustes de hidratación y dependería del reloj del móvil.
- **Plegado accesible:** `<details>`/`<summary>` nativos, como ya hace
  `src/app/clasificacion/page.tsx:612`, con `open` controlado por React. El
  contenido de un bloque plegado no es visible ni se puede pulsar.
- **Target ES2017:** el helper de búsqueda usa el rango
  `[\u0300-\u036f]` tras `normalize("NFD")`, no `\p{Diacritic}` (mismo
  motivo que en `DaySchedulePicker.tsx:93`).
- **Mobile-first y dark:** tokens CSS existentes (`var(--bg)`,
  `var(--fg-muted)`, `var(--accent)`…), sin overflow horizontal a 12+
  jugadores (lo vigila el test e2e «mis-partidas no tiene overflow
  horizontal»).
- **Sin dependencias nuevas.**

## 8. Criterios de aceptación

1. Un admin que abre `/mis-partidas` ve dos pestañas, «Mis partidas» (activa) y «Toda la liga», y solo las partidas de liga en las que juega como local o visitante.
2. Un admin en `/mis-partidas?vista=todas` ve todas las partidas de liga, con la pestaña «Toda la liga» activa y el título «Gestión de partidas».
3. Recargar la página conserva la pestaña activa.
4. En «Mis partidas», el subtítulo de cada ronda del admin muestra su cupo (`falta 1 de 2`), no el agregado «N de M jugadas».
5. La línea de recuentos se calcula sobre las partidas de la pestaña activa.
6. Un jugador no ve pestañas, ni con `?vista=todas` en la URL; ve solo sus partidas.
7. La función de jornada actual cubre sus tres ramas:
   - Con rondas abiertas no vencidas, devuelve la de `deadline` más cercano ≥ `now`.
   - Si todas las abiertas han vencido, devuelve la abierta con `deadline` más reciente.
   - Sin rondas abiertas, devuelve `null`.
   - En empate de `deadline`, gana la de menor `index`.
8. Al cargar la página, solo está desplegado el bloque de la jornada actual. Si la lista no tiene bloque para ella, todos están plegados. «Sin ronda asignada» e «Historial» salen plegados.
9. Pulsar la cabecera de un bloque lo pliega o despliega. Un bloque plegado no muestra ni deja pulsar sus tarjetas.
10. Tras una acción que revalida la página (apuntar un resultado), los bloques conservan el plegado que tenían.
11. Escribir `martin` en el buscador deja solo las partidas en las que juega un «Martín» (sin distinguir mayúsculas ni acentos). Se ven solo los bloques con coincidencias, todos desplegados, con «N de M partidas» en la cabecera.
12. Al vaciar el buscador, cada bloque vuelve al estado de plegado que tenía antes de empezar a escribir.
13. Una búsqueda sin coincidencias muestra el aviso de «sin resultados» con un botón que vacía el buscador.
14. El texto del buscador se conserva al cambiar de pestaña y tras una revalidación.
15. Al cargar la página, el filtro de estado está en `Pendientes`: solo se ven partidas sin resultado, y no se pintan los bloques sin ninguna pendiente. Los bloques que quedan siguen la regla de plegado de §4.1; el filtro no despliega ninguno.
16. Con `Jugadas`, solo se ven partidas con resultado (`PLAYED`, `WALKOVER`, `UNPLAYED_DRAW`, e Historial). Con `Todas`, se ven todas. El filtro se combina con el buscador (Y), se conserva al cambiar de pestaña y vuelve a `Pendientes` al recargar.
17. Con `Pendientes`, tras apuntar el resultado de una partida, su tarjeta sigue visible con el marcador y se puede editar. Desaparece al cambiar de filtro, de pestaña o al recargar.
18. Con `Pendientes` y nada pendiente, se ve el aviso con el botón «Ver jugadas», que cambia el filtro a `Jugadas`.
19. Las pestañas del admin se llaman «Mis partidas» y «Toda la liga». La palabra «Todas» solo aparece como opción del filtro de estado.
20. Un admin sin partidas propias ve, en «Mis partidas», el aviso y el enlace a «Toda la liga».
21. `DaySchedulePicker` y esta página usan el mismo helper de búsqueda de `src/server/`, y los tests del selector del calendario (`tests/agendar.test.tsx`) siguen en verde sin cambiarlos.
22. En un viewport móvil (390 px de ancho), tras hacer scroll hasta el último bloque, el buscador y el filtro de estado siguen visibles, en una sola fila, bajo el `AppHeader` y sin solaparse con él. Las pestañas del admin ya no están visibles (se fueron con el scroll). No hay overflow horizontal. Al cargar la página, el foco no está en el buscador.
23. `npm run test`, `npm run lint` y el e2e `full-journey` pasan. El e2e cubre desplegar una ronda plegada, las pestañas del admin y pasar el filtro a `Jugadas` (paso 8).

## 9. Riesgos y preguntas abiertas

- **Conflicto con PR #1 (`feat/multi-liga`), asumido.** Esa PR mueve la página a
  `src/app/liga/[slug]/mis-partidas/page.tsx` y deja `src/app/mis-partidas/page.tsx`
  como redirección. Esta feature se construye **sobre `main`, ya**, en
  `src/app/mis-partidas/`. Al rebasar, PR #1 carga con el conflicto: tiene que
  llevar los cambios de esta página a la ruta nueva. Para abaratar ese rebase,
  la lógica debería ir a `src/server/` y a componentes, de modo que `page.tsx`
  solo los monte (ver §7).
- **El admin cambia de landing.** Al entrar en `/mis-partidas` ya no ve toda
  la liga, sino sus partidas. Es lo pedido, pero quien gestione desde el
  móvil tendrá un clic más. Se mitiga porque `?vista=todas` es enlazable.
- **Regla 2 de §4.1 con rondas sin cerrar.** Si el admin tarda en cerrar
  rondas, la jornada desplegada es la última en vencer, no la más antigua
  con partidas pendientes. Es deliberado (§4.1) y ya ocurre en la base del
  e2e: en los pasos 7-9, las rondas de marzo a agosto de 2026 han vencido
  y ninguna está cerrada todavía (se cierran en los pasos 10 y 12).
- **Altura del sticky.** El offset bajo el `AppHeader` depende de su altura
  real. Si se fija como número mágico, se desalinea el día que el header
  cambie. Se verifica con el criterio 22.

- **El filtro por defecto oculta lo resuelto.** Quien busque un resultado
  antiguo verá «Pendientes» y tendrá que cambiar a `Jugadas`. Es lo pedido;
  el aviso de §5 con «Ver jugadas» cubre el caso de no tener nada pendiente.

No queda ninguna pregunta abierta que bloquee la implementación.

## 10. Bitácora

- v1 — primer borrador, construido en el interrogatorio: base sobre `main`,
  jornada actual, buscador compartido con el calendario, pestañas en la URL,
  bloques no-jornada plegables, cabecera y sticky en móvil.
- v2 — feedback de la revisión: filtro de estado `Pendientes · Jugadas ·
  Todas` (§4.6), `Pendientes` por defecto, sale de los no-objetivos.
  «No jugada» = sin resultado. Las partidas resueltas durante la visita no
  desaparecen. Filtro en cliente, combinado con el buscador (Y), oculta
  bloques vacíos sin desplegar nada. La pestaña «Todas» del admin pasa a
  «Toda la liga». La franja sticky se reduce a una fila (buscador y
  filtro) y las pestañas ya no son sticky. Criterios 15-19 nuevos (23 en
  total).
- v2 — aprobada (APPROVED).
