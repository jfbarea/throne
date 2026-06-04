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
7. [Reportar y confirmar un resultado](#7-reportar-y-confirmar-un-resultado)
8. [Resolver una disputa (admin)](#8-resolver-una-disputa-admin)
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
| **Emparejamientos** | El conjunto completo de partidas round-robin: `C(n,2) = n·(n-1)/2` pares. Sin jornadas ni rondas, sin byes en la fase de liga. |
| **scheduledAt** | La fecha (y hora opcional) de una partida. Puede ser `null` (sin fecha) o tener un valor (agendada). |
| **status del resultado** | El ciclo anti-disputa: `SCHEDULED → REPORTED → CONFIRMED / DISPUTED`. |
| **Standings** | La clasificación calculada solo con resultados `CONFIRMED`. |
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
| **Bonus habilitado** (`bonusEnabled`) | Activa los bonus opcionales | false |
| **Umbral de masacre** (`bonusMarginThreshold`) | Diferencia de VP para bonus de margen amplio | 20 |
| **VP mínimos para bonus** (`bonusMinVP`) | VP mínimos para bonus por jugar agresivo | 40 |
| **Tamaño de playoffs** (`playoffSize`) | Cuántos jugadores clasifican | 4 |
| **Tiebreakers** | Orden de los criterios de desempate (reordenables con flechas) | puntos → dif. VP → VP+ → head-to-head → derrotas → id |

La liga comienza en estado `SETUP`. Puedes editar la configuración en cualquier momento antes de iniciar los playoffs.

### Bonus (detalle)

- **Bonus de masacre**: punto extra si el ganador supera al rival por `bonusMarginThreshold` VP o más. No aplica en empates.
- **Bonus por VP mínimos**: punto extra si el jugador alcanza `bonusMinVP` VP, aunque pierda. Premia jugar agresivo.

Los bonus se calculan y almacenan fijos al reportar cada resultado (`Result.bonusHome/bonusAway`), de modo que cambiar la config después no altera partidas ya registradas.

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

### Resetear el passcode de un jugador

En la lista de jugadores, pulsa **Resetear passcode** en la fila del jugador. Se generará un passcode nuevo que se muestra de la misma forma (una vez, con banner y botón Copiar).

### Editar nombre o facción

En la lista, pulsa **Editar** en la fila del jugador, modifica los campos y guarda.

### Desactivar / reactivar un jugador

Usa el botón **Desactivar** / **Activar** en la lista. Los jugadores desactivados no aparecen en los emparejamientos ni en los standings. Sus datos históricos se conservan (no se borran).

---

## 5. Rol admin — generar los emparejamientos

Ruta: `/admin/emparejamientos`

Una vez configurada la liga y dados de alta todos los jugadores activos, pulsa **Generar emparejamientos**.

La app crea `C(n,2)` partidas: cada jugador activo se enfrenta a cada otro exactamente una vez. Todas nacen sin fecha (`scheduledAt = null`) y en estado `SCHEDULED`.

**Guardia de regeneración:** si ya hay resultados `CONFIRMED`, el botón de regenerar estará bloqueado para proteger las partidas ya jugadas. Solo es posible regenerar mientras no existan resultados confirmados.

Tras generar, la liga pasa de estado `SETUP` a `LEAGUE`. A partir de este punto los jugadores pueden fijar fechas y reportar resultados.

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

> Agendar una partida y reportar su resultado son **dimensiones independientes**. Ver sección 12.

---

## 7. Reportar y confirmar un resultado

Ruta: `/mis-partidas`

### Reportar (el jugador que lo introduce primero)

1. Entra como jugador en `/mis-partidas`.
2. Localiza la partida en estado **Sin resultado**.
3. Pulsa **Reportar resultado**.
4. Introduce los VP de ambos jugadores y el outcome (Victoria local / Victoria visitante / Empate).
5. Confirma.

La partida pasa a estado `REPORTED`. El resultado es provisional hasta que el rival lo confirme.

### Confirmar o disputar (el rival)

El jugador contrario entra en `/mis-partidas` y verá la partida en estado **Pendiente de confirmar**.

- **Confirmar**: acepta el resultado tal como lo apuntó el rival. La partida pasa a `CONFIRMED` y entra en los standings.
- **Disputar**: marca el resultado como incorrecto. La partida pasa a `DISPUTED` y requiere intervención del admin.

> El jugador que reportó el resultado **no puede confirmarlo él mismo**. Solo puede hacerlo el rival o el admin.

### Solo los resultados CONFIRMED cuentan

Un resultado `REPORTED` o `DISPUTED` **no entra en la clasificación** hasta que no sea `CONFIRMED` (por el rival o por el admin). Esto garantiza que los standings reflejan resultados acordados.

---

## 8. Resolver una disputa (admin)

Ruta: `/admin/disputas`

Cuando una partida está en estado `DISPUTED`, aparece en la lista de disputas del panel de admin.

1. Entra como admin en `/admin/disputas`.
2. Revisa los detalles de la disputa (VP reportados, jugadores implicados).
3. Usa el formulario **Resolver** para introducir los VP definitivos y el outcome correcto.
4. Confirma.

La partida pasa a `CONFIRMED` con los datos que fijó el admin, y queda rastro en el `AuditLog` (acción `ADMIN_RESOLVE`). El `AuditLog` registra el estado anterior y el actor para dar transparencia al grupo.

---

## 9. Consultar la clasificación

Ruta: `/clasificacion`

La tabla de clasificación muestra, para cada jugador:

| Columna | Significado |
|---------|-------------|
| **PJ** | Partidas jugadas (con resultado CONFIRMED) |
| **V** | Victorias |
| **E** | Empates |
| **D** | Derrotas |
| **Pts** | Puntos de liga (incluyendo bonus) |
| **VP+** | Victory Points a favor |
| **VP-** | Victory Points en contra |
| **Dif** | Diferencia de VP (VP+ − VP−) |

Los jugadores que clasifican a playoffs aparecen resaltados en la zona superior (borde verde, etiqueta playoffs).

Al pie hay un panel desplegable con el orden de criterios de desempate activos. Solo los resultados `CONFIRMED` de la fase de liga cuentan.

---

## 10. Iniciar los playoffs (admin)

Ruta: `/admin/playoffs`

Cuando la fase de liga ha concluido (todas las partidas relevantes confirmadas, o por decisión del admin), inicia los playoffs:

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

El bracket muestra el árbol de eliminatoria. Las etiquetas de ronda se calculan automáticamente (cuartos de final, semifinales, final) según el tamaño del bracket.

**Avance del ganador:**

Cuando se confirma el resultado de una partida de playoff, el ganador avanza automáticamente al siguiente slot del bracket. No es posible el empate en playoffs: el sistema exige un outcome ganador (`HOME_WIN` o `AWAY_WIN`).

Cuando se juega y confirma la final, la app:
- Marca al ganador como campeón.
- Muestra un banner con el nombre del campeón.
- Pone la liga en estado `FINISHED`.

El flujo de reportar y confirmar resultados de playoff es idéntico al de la fase de liga (ver sección 7), con la única diferencia de que el empate no está permitido.

---

## 12. Dimensiones independientes: fecha y resultado

Este es el punto que más confusión puede generar. La app distingue explícitamente dos dimensiones en cada partida:

| Dimensión | Campo | Quién lo cambia | Efecto |
|-----------|-------|-----------------|--------|
| **Agendado** | `scheduledAt` | Cualquier participante o admin | Mueve la partida en el calendario |
| **Estado del resultado** | `status` | El flujo reportar/confirmar | Entra o no en standings |

Estas dos dimensiones son **completamente independientes**:

- Una partida puede tener fecha (`scheduledAt` con valor) y aún estar en estado `SCHEDULED` (sin resultado).
- Una partida puede estar `CONFIRMED` (resultado acordado) sin que nunca se fijara fecha.
- Fijar, editar o limpiar la fecha **no altera** el estado del resultado.
- Reportar un resultado **no altera** la fecha.

El valor `SCHEDULED` en el campo `status` significa "emparejamiento generado, pendiente de resultado", no "tiene fecha acordada".
