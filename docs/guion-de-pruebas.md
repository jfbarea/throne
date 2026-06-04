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

> Como alternativa al recorrido manual, existe el test e2e automatizado: `npm run e2e`. Cubre el mismo flujo en Playwright con una base de datos aislada. El guión manual es útil para probar la interfaz real y detectar problemas de UX.

---

## Paso 1 — Login como admin

**Acción:**
1. Abre [http://localhost:3000/login](http://localhost:3000/login).
2. En el formulario de login, introduce el valor de `ADMIN_PASSCODE` de tu `.env`.
3. Pulsa **Entrar como admin**.

**Resultado esperado:**
- Eres redirigido al panel de admin (`/admin`).
- En la barra superior (o menú) aparecen las opciones: Liga, Jugadores, Emparejamientos, Disputas, Playoffs.
- No hay error de credenciales.

---

## Paso 2 — Revisar la configuración de la liga

**Acción:**
1. Ve a `/admin/liga`.

**Resultado esperado:**
- Ves el formulario con los datos de la liga del seed: nombre "Liga Warhammer 40K — Capítulo Hierro", temporada "2026 Primavera".
- Puntos: victoria 3, empate 1, derrota 0.
- Bonus habilitado con umbral 20 VP y mínimo 40 VP.
- `playoffSize` = 4.
- Estado de la liga: `SETUP`.

**Acción adicional (opcional):**
Cambia el nombre de la liga a "Liga de Prueba" y guarda. Comprueba que el cambio persiste al recargar la página. Revierte si quieres mantener el seed original.

---

## Paso 3 — Revisar la lista de jugadores

**Acción:**
1. Ve a `/admin/jugadores`.

**Resultado esperado:**
- Aparecen los 12 jugadores del seed: `Comisario Valdris` (ADMIN), `Inquisidor Marak`, `Capitán Torvayne`, `Magos Drekh`, `Señor Fantasma Aelyr`, `Patriarca Vex`, `Señora de la Guerra Kovash`, `Archon Nyss`, `Shas'O Vior'la`, `Gran Tirano Skrell`, `Señor del Caos Rhan`, `Overlord Zahndrekh`.
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

## Paso 5 — Generar los emparejamientos

**Acción:**
1. Ve a `/admin/emparejamientos`.
2. Pulsa **Generar emparejamientos**.

**Resultado esperado:**
- La app genera `C(n,2)` partidas, donde `n` es el número de jugadores activos. Con 13 jugadores (12 del seed + 1 de prueba) serían 78 partidas.
- La liga pasa de estado `SETUP` a `LEAGUE`.
- Aparece un mensaje de confirmación con el número de partidas creadas.
- Todas las partidas nacen sin fecha y en estado `SCHEDULED`.

> Para un recorrido más rápido, puedes desactivar el jugador de prueba antes de generar (dejando 12 jugadores = 66 partidas). Lo importante es que el número sea `C(n,2)`.

---

## Paso 6 — Verificar el calendario (vista admin)

**Acción:**
1. Ve a `/calendario`.

**Resultado esperado:**
- Aparece una sección "Sin fecha" con todas las partidas (aún sin `scheduledAt`).
- Cada fila muestra los dos jugadores y el estado "Sin resultado".
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
- El estado del resultado sigue siendo "Sin resultado" (`SCHEDULED`). La fecha y el resultado son independientes.

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
- Solo ves las partidas en las que participa `Inquisidor Marak` (como local o visitante).
- No ves partidas de otros jugadores.
- La partida contra `Capitán Torvayne` aparece con la fecha que fijaste en el paso 7.
- Aparece el botón **Reportar resultado** en las partidas sin resultado.

---

## Paso 10 — Fijar la fecha de una partida (como jugador)

**Acción:**
1. En `/mis-partidas`, localiza una partida diferente (p.ej. `Inquisidor Marak` vs `Magos Drekk`).
2. Pulsa el botón de fijar fecha.
3. Introduce una fecha y lugar.
4. Guarda.

**Resultado esperado:**
- La partida queda agendada con la fecha indicada.
- No has necesitado confirmación del rival (`Magos Drekk`).

---

## Paso 11 — Reportar un resultado

**Acción:**
1. En `/mis-partidas`, localiza la partida `Inquisidor Marak` vs `Capitán Torvayne`.
2. Pulsa **Reportar resultado**.
3. Introduce: VP local = 85, VP visitante = 45, outcome = Victoria local.
4. Confirma.

**Resultado esperado:**
- La partida pasa a estado `REPORTED` (pendiente de confirmar).
- Aparece un mensaje indicando que el rival debe confirmar.
- El resultado está visible pero no entra en la clasificación todavía.

---

## Paso 12 — Confirmar el resultado (como el rival)

**Acción:**
1. Cierra la sesión de `Inquisidor Marak`.
2. Entra como `Capitán Torvayne` (passcode: `1234`).
3. Ve a `/mis-partidas`.
4. Localiza la partida contra `Inquisidor Marak` en estado "Pendiente de confirmar".
5. Pulsa **Confirmar**.

**Resultado esperado:**
- La partida pasa a estado `CONFIRMED`.
- El resultado entra en los standings.
- No hay opción de que `Capitán Torvayne` "confirme" su propio resultado (porque él no fue quien lo reportó; aquí es el rival quien confirma).

---

## Paso 13 — Verificar los standings

**Acción:**
1. Ve a `/clasificacion`.

**Resultado esperado:**
- `Inquisidor Marak` aparece en la tabla con 1 victoria, 3 puntos, 85 VP+, 45 VP-.
- `Capitán Torvayne` aparece con 1 derrota, 0 puntos, 45 VP+, 85 VP-.
- El resto de jugadores aparecen con 0 partidas jugadas (todos los resultados están en `SCHEDULED`).
- Si el bonus está habilitado: comprueba si la diferencia de 40 VP (85-45) supera el umbral de 20 → sí, `Inquisidor Marak` tiene bonus de masacre; `Capitán Torvayne` tiene 45 VP, que supera el mínimo de 40 → también tiene bonus por VP mínimos.

---

## Paso 14 — Probar una disputa

**Acción:**
1. Entra como `Magos Drekk` (passcode: `1234`).
2. Ve a `/mis-partidas`.
3. Localiza la partida contra otro jugador (p.ej. `Señor Fantasma Aelyr`).
4. Reporta un resultado: VP local = 60, VP visitante = 70, outcome = Victoria visitante.
5. Cierra sesión. Entra como `Señor Fantasma Aelyr` (passcode: `1234`).
6. Ve a `/mis-partidas`. Localiza la partida pendiente de confirmar.
7. Pulsa **Disputar**.

**Resultado esperado:**
- La partida pasa a estado `DISPUTED`.
- No entra en los standings.

**Resolución (como admin):**
1. Entra como admin.
2. Ve a `/admin/disputas`.
3. Localiza la disputa `Magos Drekk` vs `Señor Fantasma Aelyr`.
4. Introduce el resultado definitivo (p.ej. los VP reales acordados).
5. Pulsa **Resolver**.

**Resultado esperado:**
- La partida pasa a `CONFIRMED`.
- Queda rastro en el AuditLog (acción `ADMIN_RESOLVE`).
- El resultado entra en los standings.

---

## Paso 15 — Confirmar más partidas para standings completos

Para probar los playoffs necesitas al menos `playoffSize` (= 4) jugadores con resultados confirmados. Repite los pasos 11-12 para al menos 3 partidas más entre jugadores distintos, de modo que 4 jugadores tengan al menos un resultado confirmado.

---

## Paso 16 — Iniciar los playoffs (admin)

**Acción:**
1. Entra como admin.
2. Ve a `/admin/playoffs`.

**Resultado esperado:**
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

## Paso 17 — Ver el bracket

**Acción:**
1. Ve a `/bracket`.

**Resultado esperado:**
- Se muestra el árbol del bracket con los 4 jugadores classificados.
- Las etiquetas de ronda se muestran correctamente (semifinales, final con 4 jugadores).
- Los byes, si los hay, aparecen con el seed avanzando automáticamente.

---

## Paso 18 — Jugar y confirmar una partida de playoff

**Acción:**
1. Entra como el jugador seed 1 o seed 4 (según el emparejamiento del bracket).
2. Ve a `/mis-partidas`.
3. Reporta el resultado de la partida de playoff (el outcome debe ser `HOME_WIN` o `AWAY_WIN`; el empate no está permitido en playoffs).
4. El rival confirma el resultado.

**Resultado esperado:**
- La partida pasa a `CONFIRMED`.
- El ganador avanza automáticamente al siguiente slot del bracket.
- En `/bracket` puedes ver al ganador en la siguiente ronda.
- Si se intenta reportar un empate en un match de playoff, la app lo rechaza.

---

## Paso 19 — Completar el bracket hasta el campeón

Repite el paso 18 para todas las partidas restantes del bracket (semifinales, final).

**Resultado esperado al confirmar la final:**
- La liga pasa a estado `FINISHED`.
- En `/bracket` aparece un banner con el nombre del campeón.
- No es posible seguir reportando resultados de playoff.

---

## Resumen del recorrido

| Paso | Acción | Estado resultante |
|------|--------|------------------|
| 1 | Login admin | Sesión admin activa |
| 2-3 | Revisar config y jugadores | Liga en `SETUP`, 12 jugadores |
| 4 | Crear jugador nuevo | 13 jugadores |
| 5 | Generar emparejamientos | Liga en `LEAGUE`, 78 partidas en `SCHEDULED` |
| 6-7 | Ver calendario y fijar fecha | 1 partida agendada |
| 8-10 | Login jugador, mis partidas, fijar fecha | 2 partidas agendadas |
| 11 | Reportar resultado | 1 partida en `REPORTED` |
| 12 | Confirmar resultado | 1 partida en `CONFIRMED` |
| 13 | Ver standings | Standings actualizados |
| 14 | Disputar y resolver | 1 partida `CONFIRMED` via admin |
| 15 | Más resultados confirmados | 4+ jugadores con puntos |
| 16 | Iniciar playoffs | Liga en `PLAYOFFS` |
| 17 | Ver bracket | Bracket visualizado |
| 18 | Jugar playoff | 1 ganador avanzado |
| 19 | Completar bracket | Liga en `FINISHED`, campeón coronado |

---

## Tests automatizados (referencia)

Como alternativa o complemento al recorrido manual, el test e2e de Playwright cubre el mismo flujo de forma automatizada:

```bash
npm run e2e
```

Usa una base de datos dedicada (`e2e.db`) que se recrea en cada ejecución. Las credenciales están embebidas en `playwright.config.ts`. El `.env` real no se toca.

Para ver el test en modo visual (útil para depurar):

```bash
npm run e2e:ui
```
