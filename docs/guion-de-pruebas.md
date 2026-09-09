# Guión de pruebas manual — throne

Walkthrough paso a paso para probar la aplicación de extremo a extremo con la app corriendo en local.

Cada paso incluye el **resultado esperado**. Puedes seguirlo desde cero o apoyarte en los datos del seed de ejemplo.

---

## Prerequisitos

Antes de empezar, asegúrate de que:

1. Has completado la instalación según `docs/configuracion.md`.
2. El fichero `.env` tiene `ADMIN_PASSCODE`, `SESSION_SECRET` y `DATABASE_URL` configurados.
3. La base de datos está migrada y el seed cargado:

```bash
npx prisma migrate dev
npm run seed
npm run dev
```

La app debe estar corriendo en [http://localhost:3000](http://localhost:3000).

**Credenciales del seed:**
- Admin: `ADMIN_PASSCODE` (el valor que pusiste en `.env`)
- Todos los jugadores del seed usan passcode: `1234`
- Jugador admin del seed: `Comisario Valdris`
- Otros jugadores de ejemplo: `Inquisidor Marak`, `Capitán Torvayne`, `Magos Drekk`, etc.
- La liga del seed ya trae **cupo de 2 partidas por ronda** y **mes de arranque marzo de 2026**.

> Como alternativa al recorrido manual, existe el test e2e automatizado: `npm run e2e`. Cubre el mismo flujo (y también el cierre de rondas y la incomparecencia) en Playwright con una base de datos aislada. El guión manual es útil para probar la interfaz real y detectar problemas de UX.

---

## Paso 1 — Login como admin

**Acción:**
1. Abre [http://localhost:3000/login](http://localhost:3000/login).
2. En el formulario de login, introduce el valor de `ADMIN_PASSCODE` de tu `.env`.
3. Pulsa **Entrar como admin**.

**Resultado esperado:**
- Eres redirigido al panel de admin (`/admin`).
- En el menú de admin aparecen las opciones: Panel, Liga, Jugadores, Emparejamientos, Rondas, Playoffs.
- No hay error de credenciales.

---

## Paso 2 — Revisar la configuración de la liga

**Acción:**
1. Ve a `/admin/liga`.

**Resultado esperado:**
- Ves el formulario con los datos de la liga del seed: nombre "Liga Warhammer 40K — Capítulo Hierro", temporada "2026 Primavera".
- Puntos: victoria 3, empate 1, derrota 0.
- Tarjeta "Rondas mensuales": partidas por ronda (`matchesPerRound`) = 2, mes de arranque = marzo de 2026.
- Bonus habilitado con umbral 20 VP y mínimo 40 VP.
- `playoffSize` = 4.
- Estado de la liga: `SETUP`.

**Acción adicional (opcional):**
Cambia el nombre de la liga a "Liga de Prueba" y guarda. Comprueba que el cambio persiste al recargar la página. Revierte si quieres mantener el seed original.

> Si el mes de arranque estuviera vacío, no podrías generar emparejamientos en el paso 5 — la app se niega mientras no haya mes de arranque, porque de él se derivan las fechas de cierre de todas las rondas.

---

## Paso 3 — Revisar la lista de jugadores

**Acción:**
1. Ve a `/admin/jugadores`.

**Resultado esperado:**
- Aparecen los 12 jugadores del seed: `Comisario Valdris` (ADMIN), `Inquisidor Marak`, `Capitán Torvayne`, `Magos Drekk`, `Señor Fantasma Aelyr`, `Patriarca Vex`, `Señora de la Guerra Kovash`, `Archon Nyss`, `Shas'O Vior'la`, `Gran Tirano Skrell`, `Señor del Caos Rhan`, `Overlord Zahndrekh`.
- Todos están activos.

---

## Paso 4 — Crear un jugador nuevo

**Acción:**
1. En `/admin/jugadores`, pulsa **Nuevo jugador**.
2. Rellena: nombre "Jugador Test", facción "Space Marines".
3. Pulsa **Crear**.

**Resultado esperado:**
- Aparece un banner amarillo con el passcode generado (8 caracteres, p.ej. `HK7BM2WR`).
- El banner tiene un botón **Copiar** y un botón **He anotado el código — cerrar**.
- El jugador aparece en la lista con estado activo.

**Verificación:**
Cierra el banner. Recarga la página. Comprueba que el passcode ya no se muestra (solo se muestra una vez).

---

## Paso 5 — Generar los emparejamientos (y las rondas)

**Acción:**
1. Ve a `/admin/emparejamientos`.
2. Pulsa **Generar emparejamientos**.

**Resultado esperado:**
- La app genera `C(n,2)` partidas, donde `n` es el número de jugadores activos. Con 13 jugadores (12 del seed + 1 de prueba) serían 78 partidas.
- Las partidas quedan repartidas entre **rondas mensuales** (cupo 2 por jugador y ronda): con 13 jugadores y cupo 2, salen 6 rondas.
- La liga pasa de estado `SETUP` a `LEAGUE`.
- Todas las partidas nacen sin fecha y sin resultado.

> Para un recorrido más rápido, puedes desactivar el jugador de prueba antes de generar (dejando 12 jugadores = 66 partidas, también 6 rondas). Lo importante es que el número de partidas sea `C(n,2)`.

**Verificación:**
Ve a `/admin/rondas`. Deberías ver 6 rondas numeradas, cada una con su fecha de cierre (el último día de marzo, abril, mayo, junio, julio y agosto de 2026, en ese orden) y el estado "Abierta".

---

## Paso 6 — Verificar el calendario (vista admin)

**Acción:**
1. Ve a `/calendario`.

**Resultado esperado:**
- Aparece una sección "Sin fecha" con todas las partidas (aún sin `scheduledAt`).
- Cada fila muestra los dos jugadores, la ronda a la que pertenece esa partida y el estado "Sin resultado".
- La sección "Agendadas" está vacía.

---

## Paso 7 — Fijar la fecha de una partida (como admin)

**Acción:**
1. En `/calendario`, localiza la partida `Inquisidor Marak` vs `Capitán Torvayne`.
2. Pulsa el botón de fijar fecha en esa fila.
3. Introduce una fecha futura (p.ej. mañana a las 19:00) y un lugar (p.ej. "Casa de Marak").
4. Guarda.

**Resultado esperado:**
- La partida desaparece de "Sin fecha" y aparece en "Agendadas" con la fecha y lugar indicados.
- El estado del resultado sigue siendo "Sin resultado". La fecha, el resultado y la ronda son independientes: fijar la fecha no cambia la ronda de la partida ni al revés.

---

## Paso 8 — Login como jugador

**Acción:**
1. Cierra la sesión de admin (botón de cerrar sesión).
2. Ve a `/login`.
3. Selecciona `Inquisidor Marak` en el desplegable de jugadores.
4. Introduce el passcode: `1234`.
5. Pulsa **Entrar**.

**Resultado esperado:**
- Eres redirigido a la página principal o a `/mis-partidas`.
- No ves las opciones del panel de admin.
- Si intentas acceder a `/admin`, eres redirigido a `/unauthorized`.

---

## Paso 9 — Ver "Mis partidas" como jugador

**Acción:**
1. Ve a `/mis-partidas`.

**Resultado esperado:**
- Solo ves las partidas en las que participa `Inquisidor Marak` (como local o visitante), **agrupadas por ronda**: la ronda con el cierre más próximo aparece primero.
- Cada bloque de ronda muestra su fecha de cierre y cuántas partidas te faltan para completar el cupo (p.ej. "falta 2 de 2").
- La partida contra `Capitán Torvayne` aparece con la fecha que fijaste en el paso 7, dentro de su ronda.
- Aparece el botón **Apuntar resultado** en las partidas sin resultado, y **Incomparecencia** junto a él.

---

## Paso 10 — Fijar la fecha de una partida (como jugador)

**Acción:**
1. En `/mis-partidas`, localiza una partida diferente (p.ej. `Inquisidor Marak` vs `Magos Drekk`).
2. Pulsa el botón de fijar fecha.
3. Introduce una fecha y lugar.
4. Guarda.

**Resultado esperado:**
- La partida queda agendada con la fecha indicada.
- No has necesitado ninguna aceptación del rival (`Magos Drekk`).

---

## Paso 11 — Apuntar un resultado

**Acción:**
1. En `/mis-partidas`, localiza la partida `Inquisidor Marak` vs `Capitán Torvayne`.
2. Pulsa **Apuntar resultado**.
3. Introduce: VP local = 85, VP visitante = 45.
4. Comprueba que la app muestra "Victoria de Inquisidor Marak" (se deriva de los VP, no se elige aparte).
5. Pulsa **Reportar**.

**Resultado esperado:**
- La partida pasa a mostrar el resultado 85-45 y queda etiquetada como "Apuntada" (o "Jugada", según la vista).
- **Cuenta en la clasificación de inmediato** — no hay paso de confirmación del rival ni de disputa.
- Si te equivocaste, cualquiera de los dos participantes (`Inquisidor Marak` o `Capitán Torvayne`) puede pulsar **Editar resultado** y corregirlo.

---

## Paso 12 — Declarar una incomparecencia

**Acción:**
1. Sigue como `Inquisidor Marak` en `/mis-partidas`.
2. Localiza otra partida sin resultado (p.ej. contra `Señor Fantasma Aelyr`) y pulsa **Incomparecencia**.
3. Elige quién gana (p.ej. `Inquisidor Marak`).
4. Pulsa **Declarar**.

**Resultado esperado:**
- La partida queda con un resultado **80-0** a favor del jugador elegido.
- Se etiqueta como **"Incomparecencia"** en `/mis-partidas` y en `/calendario`.
- Aunque la liga tenga los bonus activados (umbral 20, mínimo 40 — que un 80-0 real dispararía), esta partida **no lleva ningún punto de bonus**: es la regla que evita que no presentarse rente más que jugar.

**Verificación (opcional, como admin):** en `/admin/jugadores`, entra como `Comisario Valdris` (`ADMIN_PASSCODE`) e intenta declarar otra incomparecencia sobre la partida `Inquisidor Marak` vs `Capitán Torvayne` del paso 11 (que ya tiene un resultado real). Como admin sí puedes sustituirla; si lo intentaras como uno de los dos jugadores, la app lo rechazaría porque esa partida ya se jugó de verdad.

---

## Paso 13 — Cerrar una ronda (admin)

**Acción:**
1. Cierra la sesión de jugador. Entra como admin.
2. Ve a `/admin/rondas`.
3. Localiza la **Ronda 1** (la que contiene las partidas de los pasos 11 y 12). Si su fecha de cierre todavía no ha llegado, pulsa **Editar fecha**, pon una fecha de ayer y guarda — así el botón de cerrar se habilita sin tener que esperar al calendario real.
4. Pulsa **Cerrar ronda 1**.

**Resultado esperado:**
- Antes de pulsar, el texto junto al botón indica cuántas partidas de la ronda se van a saldar sin jugar.
- Tras pulsar, aparece un mensaje de confirmación ("Ronda cerrada. N partidas saldadas 0-0").
- La Ronda 1 pasa a "Cerrada".
- Las partidas de la Ronda 1 que **ya tenían** resultado (la del paso 11, jugada; la del paso 12, incomparecencia) quedan **intactas**.
- El resto de partidas de la Ronda 1, las que seguían sin resultado, reciben ahora un **0-0** real y aparecen etiquetadas como **"Saldada sin jugar"**.

---

## Paso 14 — Verificar las etiquetas y el contador de saldadas

**Acción:**
1. Ve a `/calendario` o `/mis-partidas` y localiza alguna partida de la Ronda 1.
2. Ve a `/clasificacion`.

**Resultado esperado:**
- En `/calendario` y `/mis-partidas` conviven las tres etiquetas: la partida jugada del paso 11 (sin etiqueta especial, "Jugada"/"Apuntada"), la de incomparecencia del paso 12 ("Incomparecencia") y las saldadas al cerrar la ronda ("Saldada sin jugar").
- En `/clasificacion`, la columna **PJ** de los jugadores con alguna partida saldada muestra el desglose entre paréntesis, p.ej. `1 (1 saldada)` o `2 (1 saldada)`.
- Los puntos y VP de las partidas saldadas cuentan exactamente igual que los de una jugada de verdad con esos mismos números.

---

## Paso 15 — Apuntar más resultados para tener standings completos

Repite el paso 11 (apuntar resultado) para al menos 3 partidas más entre jugadores distintos, de modo que 4 jugadores tengan al menos un resultado apuntado — necesario para que `/admin/playoffs` tenga con qué construir la previsualización de seeds.

---

## Paso 16 — Cerrar el resto de rondas (admin)

Los playoffs solo se pueden iniciar cuando **todas** las rondas están cerradas.

**Acción:**
Repite el paso 13 (editar la fecha a una fecha pasada si hace falta, y pulsar "Cerrar ronda N") para cada una de las rondas que queden abiertas (rondas 2 a 6, salvo que hayas generado menos).

**Resultado esperado:**
- Todas las rondas de `/admin/rondas` muestran "Cerrada".
- Cada ronda que cierres sin tener todas sus partidas resueltas salda las que falten como 0-0, igual que en el paso 13.

---

## Paso 17 — Iniciar los playoffs (admin)

**Acción:**
1. Entra como admin.
2. Ve a `/admin/playoffs`.

**Resultado esperado (con alguna ronda todavía abierta):**
- Aparece un aviso "No se pueden iniciar los playoffs todavía", con la lista de rondas abiertas y su fecha de cierre. El botón de iniciar no aparece.

**Resultado esperado (con todas las rondas cerradas, tras el paso 16):**
- Ves los standings actuales y la previsualización de los 4 mejores seeds (el `playoffSize` es 4).
- Se muestra quiénes formarían cada enfrentamiento de primera ronda.

**Acción:**
3. Pulsa **Iniciar playoffs**.
4. Confirma la acción.

**Resultado esperado:**
- La liga pasa a estado `PLAYOFFS`.
- Se crean las partidas de primera ronda del bracket.
- Si el número de seeds no es potencia de 2, los mejores reciben bye automático (en este caso `playoffSize=4`, que es potencia de 2, así que no hay byes).

---

## Paso 18 — Ver el bracket

**Acción:**
1. Ve a `/bracket`.

**Resultado esperado:**
- Se muestra el árbol del bracket con los 4 jugadores clasificados.
- Las etiquetas de ronda se muestran correctamente (semifinales, final con 4 jugadores). Estas son las rondas del bracket de playoffs, sin relación con las rondas mensuales de la fase de liga.
- Los byes, si los hay, aparecen con el seed avanzando automáticamente.

---

## Paso 19 — Jugar y apuntar una partida de playoff

**Acción:**
1. Entra como el jugador seed 1 o seed 4 (según el emparejamiento del bracket).
2. Ve a `/mis-partidas`.
3. Apunta el resultado de la partida de playoff (el outcome debe ser victoria local o visitante; el empate no está permitido en playoffs).

**Resultado esperado:**
- El resultado cuenta de inmediato, sin paso de confirmación.
- El ganador avanza automáticamente al siguiente slot del bracket.
- En `/bracket` puedes ver al ganador en la siguiente ronda.
- Si se intenta apuntar un empate en una partida de playoff, la app lo rechaza.

---

## Paso 20 — Completar el bracket hasta el campeón

Repite el paso 19 para todas las partidas restantes del bracket (semifinales, final).

**Resultado esperado al apuntar la final:**
- La liga pasa a estado `FINISHED`.
- En `/bracket` aparece un banner con el nombre del campeón.
- No es posible seguir apuntando resultados de playoff.

---

## Resumen del recorrido

| Paso | Acción | Estado resultante |
|------|--------|------------------|
| 1 | Login admin | Sesión admin activa |
| 2-3 | Revisar config y jugadores | Liga en `SETUP`, 12 jugadores, cupo 2, arranque marzo 2026 |
| 4 | Crear jugador nuevo | 13 jugadores |
| 5 | Generar emparejamientos | Liga en `LEAGUE`, 78 partidas repartidas en 6 rondas |
| 6-7 | Ver calendario y fijar fecha | 1 partida agendada |
| 8-10 | Login jugador, mis partidas, fijar fecha | 2 partidas agendadas |
| 11 | Apuntar resultado | 1 partida jugada, cuenta de inmediato |
| 12 | Declarar incomparecencia | 1 partida 80-0, sin bonus |
| 13 | Cerrar Ronda 1 | Ronda 1 cerrada, el resto de sus partidas saldadas 0-0 |
| 14 | Verificar etiquetas y saldadas | Etiquetas correctas, `PJ N (M saldadas)` en clasificación |
| 15 | Más resultados apuntados | 4+ jugadores con puntos |
| 16 | Cerrar el resto de rondas | Todas las rondas cerradas |
| 17 | Iniciar playoffs | Liga en `PLAYOFFS` |
| 18 | Ver bracket | Bracket visualizado |
| 19 | Jugar playoff | 1 ganador avanzado |
| 20 | Completar bracket | Liga en `FINISHED`, campeón coronado |

---

## Tests automatizados (referencia)

Como alternativa o complemento al recorrido manual, el test e2e de Playwright cubre el mismo flujo de forma automatizada — incluido el cierre de rondas, la incomparecencia y el arranque de playoffs:

```bash
npm run e2e
```

Usa una base de datos dedicada (`e2e.db`) que se recrea en cada ejecución. Las credenciales están embebidas en `playwright.config.ts`. El `.env` real no se toca.

Para ver el test en modo visual (útil para depurar):

```bash
npm run e2e:ui
```
