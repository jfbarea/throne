# Guía de uso — throne

Manual de usuario para el admin de la liga y para los jugadores.
Cubre el flujo completo de la aplicación de principio a fin.

---

## Índice

1. [Conceptos clave](#1-conceptos-clave)
2. [Autenticación — cómo entrar](#2-autenticación--cómo-entrar)
3. [Rol admin — configurar la liga](#3-rol-admin--configurar-la-liga)
4. [Rol admin — gestionar jugadores y passcodes](#4-rol-admin--gestionar-jugadores-y-passcodes)
5. [Rol admin — generar los emparejamientos](#5-rol-admin--generar-los-emparejamientos)
6. [Fijar la fecha de una partida](#6-fijar-la-fecha-de-una-partida)
7. [Apuntar y editar un resultado](#7-apuntar-y-editar-un-resultado)
8. [Rondas: cupo, cierre e incomparecencia](#8-rondas-cupo-cierre-e-incomparecencia)
9. [Consultar la clasificación](#9-consultar-la-clasificación)
10. [Iniciar los playoffs (admin)](#10-iniciar-los-playoffs-admin)
11. [El bracket de playoffs](#11-el-bracket-de-playoffs)
12. [Dimensiones independientes: fecha y resultado](#12-dimensiones-independientes-fecha-y-resultado)

---

## 1. Conceptos clave

| Término | Significado |
|---------|-------------|
| **Liga** | La edición activa. En el MVP existe una sola liga. Pasa por los estados `SETUP → LEAGUE → PLAYOFFS → FINISHED`. |
| **Passcode** | Código alfanumérico de 8 caracteres que identifica a cada jugador. Lo genera la app y lo reparte el admin. Se guarda hasheado; **solo se muestra una vez**. |
| **Emparejamientos** | El conjunto completo de partidas round-robin: `C(n,2) = n·(n-1)/2` pares, uno por cada pareja posible de jugadores activos. |
| **Ronda** | Un mes de la fase de liga, con una fecha de cierre y un cupo de partidas por jugador (2 por defecto). El reparto asigna cada partida a una ronda al generar los emparejamientos; nadie puede moverla después. |
| **Cupo** | Cuántas de las partidas de una ronda tiene resueltas un jugador frente a las que le exige esa ronda (p. ej. "falta 1 de 2"). Cuenta partidas con resultado, no partidas con fecha. |
| **scheduledAt** | La fecha (y hora opcional) de una partida. Puede ser `null` (sin fecha) o tener un valor (agendada). Es independiente de la ronda y de si tiene resultado. |
| **status del resultado** | `SCHEDULED` (sin resultado) o `REPORTED` (ya tiene un resultado, cuenta en la clasificación de inmediato). No hay paso de confirmación del rival ni de disputa. |
| **Desenlace (`resolution`)** | Cómo se llegó al resultado de una partida: `PLAYED` (se jugó), `WALKOVER` (incomparecencia con vencedor pactado, 80-0) o `UNPLAYED_DRAW` (saldada 0-0 al cerrar la ronda sin acuerdo). |
| **Bye de playoff** | En playoffs, si `playoffSize` no es potencia de 2, los mejores seeds avanzan sin jugar en la primera ronda. No existen byes en la fase de liga. |
| **VP** | Victory Points (Puntos de Victoria). La moneda de resultado de una partida de W40k. |

---

## 2. Autenticación — cómo entrar

La app tiene dos tipos de acceso, ambos desde la misma página de login (`/login`).

### Acceso de admin

En el formulario de login, escribe el `ADMIN_PASSCODE` configurado en las variables de entorno. No se selecciona nombre de jugador: el administrador se autentifica directamente con esa clave.

### Acceso de jugador

1. Selecciona tu nombre en el desplegable (o escríbelo).
2. Introduce tu passcode de 8 caracteres (el que te dio el admin).
3. Pulsa **Entrar**.

La sesión se mantiene mediante una cookie segura firmada. Para salir, usa el botón de cierre de sesión.

> El servidor deriva tu identidad siempre de la cookie firmada, nunca de datos que envíe el cliente. Esto impide que un jugador reporte resultados en nombre de otro.

---

## 3. Rol admin — configurar la liga

Ruta: `/admin/liga`

Antes de generar emparejamientos, configura la liga. Los campos son:

| Campo | Descripción | Valor por defecto |
|-------|-------------|-------------------|
| **Nombre** | Nombre de la liga | — |
| **Temporada** | Etiqueta de la edición, p.ej. "2026 Primavera" | — |
| **Puntos por victoria** (`pointsWin`) | Puntos de liga al ganar | 3 |
| **Puntos por empate** (`pointsDraw`) | Puntos de liga al empatar | 1 |
| **Puntos por derrota** (`pointsLoss`) | Puntos de liga al perder | 0 |
| **Partidas por ronda** (`matchesPerRound`) | Cuántas partidas debe jugar cada jugador en cada ronda mensual | 2 |
| **Mes de arranque** (`startMonth`) | Mes en el que empieza la liga; de él se derivan las fechas de cierre de cada ronda | — (obligatorio para generar) |
| **Bonus habilitado** (`bonusEnabled`) | Activa los bonus opcionales | false |
| **Umbral de masacre** (`bonusMarginThreshold`) | Diferencia de VP para bonus de margen amplio | 20 |
| **VP mínimos para bonus** (`bonusMinVP`) | VP mínimos para bonus por jugar agresivo | 40 |
| **Tamaño de playoffs** (`playoffSize`) | Cuántos jugadores clasifican | 4 |
| **Tiebreakers** | Orden de los criterios de desempate (reordenables con flechas) | puntos → dif. VP → VP+ → head-to-head → derrotas → id |

La liga comienza en estado `SETUP`. Puedes editar la configuración en cualquier momento antes de iniciar los playoffs.

> **Mes de arranque.** Mientras no lo fijes, la liga puede seguir en `SETUP` con normalidad, pero **no podrás generar emparejamientos**: sin mes de arranque no hay forma de derivar la fecha de cierre de ninguna ronda. Puedes dejarlo vacío mientras decides y fijarlo más adelante.

> **Cambiar el cupo con la liga en marcha.** Si cambias `matchesPerRound` después de generar los emparejamientos, la app **recalcula el reparto** de las partidas que aún no tienen resultado entre las rondas todavía abiertas (las cerradas y sus resultados no se tocan). Subir el cupo acorta la liga (menos rondas); bajarlo la alarga (más rondas).

### Bonus (detalle)

- **Bonus de masacre**: punto extra si el ganador supera al rival por `bonusMarginThreshold` VP o más. No aplica en empates.
- **Bonus por VP mínimos**: punto extra si el jugador alcanza `bonusMinVP` VP, aunque pierda. Premia jugar agresivo.

Los bonus se calculan y almacenan fijos al apuntar cada resultado (`Result.bonusHome/bonusAway`), de modo que cambiar la config después no altera partidas ya registradas. Una **incomparecencia** (sección 8) nunca lleva bonus, esté como esté configurado.

---

## 4. Rol admin — gestionar jugadores y passcodes

Ruta: `/admin/jugadores`

### Dar de alta un jugador

1. Pulsa **Nuevo jugador**.
2. Rellena el nombre visible (`displayName`) y la facción/ejército (opcional).
3. Pulsa **Crear**.
4. Aparecerá un banner con el **passcode generado**. Es el único momento en que se muestra en claro. Cópialo con el botón **Copiar** y entrégaselo al jugador por el canal que prefieras (mensaje directo, en persona, etc.).
5. Pulsa **He anotado el código — cerrar** para descartar el banner. A partir de ahí el passcode no se puede recuperar: solo resetearlo.

> El passcode tiene 8 caracteres alfanuméricos sin caracteres ambiguos (sin I, O, l, 0, 1 para evitar confusiones). El hash se guarda en la base de datos; el plain text nunca.

> **Alta a mitad de liga.** Si das de alta a un jugador después de generar los emparejamientos, sus partidas no se crean solas: ve a `/admin/emparejamientos` y usa **Añadir los que faltan** (sección 5). La app reparte las partidas nuevas entre las rondas abiertas y, si no caben en el cupo, añade rondas al final.

### Resetear el passcode de un jugador

En la lista de jugadores, pulsa **Resetear passcode** en la fila del jugador. Se generará un passcode nuevo que se muestra de la misma forma (una vez, con banner y botón Copiar).

### Editar nombre o facción

En la lista, pulsa **Editar** en la fila del jugador, modifica los campos y guarda.

### Desactivar / reactivar un jugador

Usa el botón **Desactivar** / **Activar** en la lista.

- Al desactivar a un jugador, sus partidas de liga **pendientes** en rondas todavía abiertas se saldan automáticamente como una **incomparecencia a favor del rival** (80-0, sin bonus, con rastro en `AuditLog`). Sus partidas ya jugadas quedan intactas.
- Los jugadores desactivados no aparecen en los emparejamientos nuevos ni en los standings.
- **Reactivar no revierte** esos resultados: si hace falta corregirlos, el admin los edita uno a uno.

---

## 5. Rol admin — generar los emparejamientos

Ruta: `/admin/emparejamientos`

Una vez configurada la liga (con su **mes de arranque** fijado) y dados de alta todos los jugadores activos, pulsa **Generar emparejamientos**.

La app crea `C(n,2)` partidas: cada jugador activo se enfrenta a cada otro exactamente una vez, repartidas entre **rondas mensuales** según el cupo (`matchesPerRound`) configurado. Todas las partidas nacen sin fecha (`scheduledAt = null`) y sin resultado.

**Guardia de regeneración:** si ya hay resultados apuntados, el botón de regenerar estará bloqueado para proteger las partidas ya jugadas. Regenerar borra las rondas existentes y las vuelve a crear desde cero.

**Añadir los que faltan** (opción distinta, segura con la liga en marcha): añade solo las partidas que falten entre los jugadores activos actuales, sin borrar nada. Útil para un alta a mitad de temporada (ver sección 4); reparte las partidas nuevas entre las rondas abiertas y añade rondas al final si hace falta.

Tras generar por primera vez, la liga pasa de estado `SETUP` a `LEAGUE`. A partir de este punto los jugadores pueden fijar fechas y apuntar resultados.

---

## 6. Fijar la fecha de una partida

Rutas: `/calendario` (vista completa) y `/mis-partidas` (vista del jugador)

Cualquiera de los dos participantes de una partida —o el admin— puede fijar directamente la fecha (y opcionalmente el lugar) de esa partida. **No se requiere aceptación del rival.**

1. Localiza la partida en `/calendario` o en `/mis-partidas`.
2. Pulsa el botón de fijar/editar fecha en esa partida.
3. Introduce la fecha, hora (opcional) y lugar (opcional).
4. Guarda.

La partida se moverá de la sección "Sin fecha" a la sección "Agendadas" en el calendario, ordenada cronológicamente.

Para limpiar la fecha, edita la partida y elimina el valor.

> La fecha de la partida (`scheduledAt`) y la fecha de cierre de su **ronda** son cosas distintas: la primera la acuerda la pareja libremente; la segunda es el límite a partir del cual el admin puede cerrar la ronda (sección 8). Puedes jugar y apuntar una partida antes o después de su fecha acordada, e incluso adelantar una partida de una ronda futura sin haber resuelto la actual — ver sección 12.

---

## 7. Apuntar y editar un resultado

Ruta: `/mis-partidas`

1. Entra como jugador (o admin) en `/mis-partidas`.
2. Localiza la partida sin resultado y pulsa **Apuntar resultado**.
3. Introduce los VP de ambos jugadores. El `outcome` (Victoria local / Victoria visitante / Empate) se calcula solo a partir de los VP.
4. Pulsa **Reportar**.

La partida cuenta en la clasificación **de inmediato** — no hay paso de confirmación del rival ni de disputa. Si alguien se equivocó al apuntar:

- **Cualquiera de los dos participantes** puede pulsar **Editar resultado** y volver a introducir los VP.
- El **admin** puede editar o forzar cualquier resultado en cualquier momento.

Cada acción (apuntar por primera vez, editar después) queda registrada en el `AuditLog` con quién la hizo.

---

## 8. Rondas: cupo, cierre e incomparecencia

Ruta: `/rondas` (calendario de toda la liga) y `/mis-partidas` (tus rondas)

### Ver tu cupo

En `/mis-partidas`, tus partidas aparecen agrupadas **por ronda**: la ronda cuya fecha de cierre está más cerca aparece primero, y las rondas ya cerradas quedan al final. Cada bloque de ronda muestra cuántas partidas te faltan (`falta 1 de 2`, o `falta 1 de 1` en la última ronda si el cupo no encaja exacto).

El cupo cuenta **partidas con resultado**, no partidas con fecha: una partida agendada para dentro de dos semanas sigue contando como pendiente hasta que tenga un resultado.

En `/rondas` puedes ver el mismo cupo, pero de **todos** los jugadores en **todas** las rondas — útil para el admin (o cualquiera) que quiera ver a quién le falta jugar antes del cierre.

### Declarar una incomparecencia

Si dos jugadores acuerdan fuera de la app quién gana una partida que no van a jugar (o que ya no van a poder jugar), cualquiera de los dos —o el admin— puede declararlo:

1. En `/mis-partidas`, localiza la partida y pulsa **Incomparecencia**.
2. Elige quién gana.
3. Pulsa **Declarar**.

Se registra un **80-0** a favor del vencedor elegido. La partida queda etiquetada como **Incomparecencia** en `/mis-partidas` y en `/calendario`.

> **La incomparecencia nunca lleva bonus**, aunque la liga los tenga activados. Con un margen de 80 VP, un 80-0 real dispararía los dos bonus configurables (masacre y VP mínimos) y saldría más rentable no presentarse que jugar una partida reñida. Forzar el bonus a 0 en la incomparecencia evita ese incentivo perverso.

> **Un participante no puede declarar una incomparecencia sobre una partida que ya se jugó de verdad.** Si el resultado real ya está apuntado, solo el admin puede sustituirlo por una incomparecencia (con su override habitual) — así nadie puede autoadjudicarse un 80-0 sobre una victoria legítima del rival.

### Cerrar una ronda (solo admin)

Ruta: `/admin/rondas`

Cada ronda tiene una fecha de cierre (derivada del mes de arranque de la liga; el admin puede editarla en cualquier momento, sin que eso mueva ninguna partida de ronda). El botón **Cerrar ronda N** está deshabilitado hasta llegar a esa fecha.

Al pulsarlo, una vez habilitado:

- Cada partida de esa ronda que **siga sin resultado** recibe un **0-0** real y persistido (marcada como "saldada sin jugar" en la UI). Las que ya tenían resultado —jugado o por incomparecencia— quedan **intactas**.
- La ronda pasa a **cerrada** y sus partidas dejan de ser apuntables por los participantes (el admin conserva su override).
- Se puede cerrar cualquier ronda en cualquier orden: no hace falta que la ronda anterior esté cerrada.

No hay cierre automático: si el admin no cierra una ronda, se queda abierta indefinidamente y la clasificación no refleja las partidas caducadas.

---

## 9. Consultar la clasificación

Ruta: `/clasificacion`

La tabla de clasificación muestra, para cada jugador:

| Columna | Significado |
|---------|-------------|
| **PJ** | Partidas jugadas (con resultado apuntado). Si alguna está saldada sin jugar (incomparecencia o cierre de ronda), se indica aparte: `11 (2 saldadas)`. |
| **V** | Victorias |
| **E** | Empates |
| **D** | Derrotas |
| **Pts** | Puntos de liga (incluyendo bonus) |
| **VP+** | Victory Points a favor |
| **VP-** | Victory Points en contra |
| **Dif** | Diferencia de VP (VP+ − VP−) |

Los jugadores que clasifican a playoffs aparecen resaltados en la zona superior (borde verde, etiqueta playoffs).

Las partidas saldadas (incomparecencia o 0-0 de cierre de ronda) puntúan exactamente igual que una partida jugada de verdad con esos mismos números — no hay ninguna regla especial en el cálculo, solo se distinguen a efectos informativos en la columna PJ.

Al pie hay un panel desplegable con el orden de criterios de desempate activos.

---

## 10. Iniciar los playoffs (admin)

Ruta: `/admin/playoffs`

**Los playoffs solo pueden iniciarse cuando todas las rondas de la liga están cerradas.** Si queda alguna abierta, la página muestra un banner con la lista de rondas pendientes y su fecha de cierre, y el botón de iniciar no aparece — la vía es cerrarlas primero desde `/admin/rondas` (sección 8).

Con todas las rondas cerradas:

1. Entra en `/admin/playoffs`.
2. Verás los standings actuales y la previsualización de los `playoffSize` mejores seeds.
3. Pulsa **Iniciar playoffs** y confirma.

La app:
- Toma los `playoffSize` mejores clasificados como seeds.
- Construye el bracket con seeding estándar (seed 1 vs seed N, seed 2 vs seed N-1, etc.).
- Si `playoffSize` no es potencia de 2, los mejores seeds reciben un **bye** en primera ronda (avanzan sin jugar).
- La liga pasa al estado `PLAYOFFS`.

> Esta acción es irreversible: una vez iniciados los playoffs, la fase de liga queda cerrada.

---

## 11. El bracket de playoffs

Ruta: `/bracket`

El bracket muestra el árbol de eliminatoria. Las etiquetas de ronda se calculan automáticamente (cuartos de final, semifinales, final) según el tamaño del bracket. Estas rondas del bracket son un concepto propio de playoffs (`BracketSlot.roundIndex`) y no tienen relación con las rondas mensuales de la fase de liga (sección 8).

**Avance del ganador:**

En cuanto se apunta el resultado de una partida de playoff, el ganador avanza automáticamente al siguiente slot del bracket — igual que en liga, sin paso de confirmación. No es posible el empate en playoffs: el sistema exige un outcome ganador (`HOME_WIN` o `AWAY_WIN`).

Cuando se juega y se apunta la final, la app:
- Marca al ganador como campeón.
- Muestra un banner con el nombre del campeón.
- Pone la liga en estado `FINISHED`.

El flujo de apuntar resultados de playoff es idéntico al de la fase de liga (ver sección 7), con la única diferencia de que el empate no está permitido. Los playoffs no tienen rondas mensuales ni cupo, ni incomparecencia: es una eliminatoria directa.

---

## 12. Dimensiones independientes: fecha y resultado

Este es el punto que más confusión puede generar. La app distingue explícitamente dos dimensiones en cada partida:

| Dimensión | Campo | Quién lo cambia | Efecto |
|-----------|-------|-----------------|--------|
| **Agendado** | `scheduledAt` | Cualquier participante o admin | Mueve la partida en el calendario |
| **Resultado** | `status` + `Result` | Apuntar / editar (sección 7); saldar al cerrar la ronda (sección 8) | Entra en standings |

Estas dos dimensiones son **completamente independientes**:

- Una partida puede tener fecha (`scheduledAt` con valor) y aún estar en estado `SCHEDULED` (sin resultado).
- Una partida puede tener resultado apuntado sin que nunca se fijara fecha.
- Fijar, editar o limpiar la fecha **no altera** el resultado.
- Apuntar un resultado **no altera** la fecha.

Y una tercera cosa que tampoco depende de las anteriores: la **ronda** de una partida. La asigna el reparto al generar los emparejamientos y es fija — no la cambia ni fijar una fecha ni apuntar un resultado. Puedes **adelantar** una partida de una ronda futura (jugarla y apuntarla antes de que le toque) sin haber resuelto tu ronda actual; eso no te exime del cupo de la ronda actual cuando llegue su cierre (sección 8).

El valor `SCHEDULED` en el campo `status` significa "emparejamiento generado, pendiente de resultado", no "tiene fecha acordada".
