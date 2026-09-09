# Review — H10 `docs-e2e-y-cobertura`

**Commit revisado:** `a5a40dc`. Último hito de la feature `rondas-con-fecha`.

## Veredicto: APPROVED

Es el hito de cierre y se nota: la ficción de confirmación/disputas está
muerta de verdad, verificado con `grep` propio sin fiarme del informe;
`SPEC.md` se lee de corrido sin contradicciones; D4 está corregido en todos
los sitios donde importa, sin ninguna promesa falsa de `Δ+1` para el voraz
simple; el e2e pasa de 42/2 a 54/54 sin skips, con los tres huecos que se le
encargaron (etiquetas en pantalla, `startPlayoffs` real, overflow de
`/rondas` a escala real) genuinamente cubiertos, estable en tres corridas;
y `trazabilidad.md` cubre los 43 criterios sin huecos, con una muestra al
azar de 8 mapeos que apuntan a tests que existen de verdad. La ampliación de
alcance para corregir la ficción de documentación me parece la decisión
correcta, y lo explico en el punto 0. Sin bloqueantes.

## 0. La ampliación de alcance — de acuerdo con la decisión

Verifiqué las dos mitades de la premisa, no solo la conclusión. Primero, que
`1ed9faa` (hito 15, `resultados-directos`, 4 de junio de 2026) de verdad no
tocó documentación: su `--stat` completo son 20 ficheros, todos bajo `src/`
y `tests/` — cero en `SPEC.md`, `docs/` o `README.md`. Segundo, que la
contaminación era real y extensa, no un par de frases sueltas: el `SPEC.md`
anterior a H10 tenía **catorce** referencias vivas a `CONFIRMED`/`DISPUTED`
como flujo activo (no legado), y `docs/guia-de-uso.md:182` mandaba
literalmente a `/admin/disputas` con un guion de cuatro pasos completo para
"resolver una disputa (admin)" sobre una ruta que el propio hito 15 había
borrado tres meses antes.

Dado esto, no me parece una desviación de alcance sino la única vía sensata:
H10 reescribe exactamente `§7.4` y `§7.5`, que son las secciones
contaminadas — escribirlas de nuevo alrededor de la ficción vieja habría
producido, sí o sí, un documento que se contradice a sí mismo (frases del
mundo `REPORTED`/sin confirmación conviviendo con frases del mundo
`CONFIRMED`/con disputa en la misma página). El cambio es exclusivamente de
documentación (confirmado: `git show a5a40dc --stat -- src/` solo lista
`src/app/bases/page.tsx`), está registrado explícitamente como deuda
preexistente y no como una desviación `D` de esta spec, y el propio
mecanismo de verificación que se me pidió usar en este informe (leer
`SPEC.md` de corrido buscando contradicciones) habría fallado sin esta
corrección. De acuerdo con la llamada.

## 1. La ficción, muerta de verdad — y sin el problema inverso

`grep -n "admin/disputas\|DISPUTED\|CONFIRMED\|confirmar el rival\|disputa" -i`
sobre `SPEC.md`, `docs/*.md` y `README.md` da **quince** coincidencias, y leí
las quince: todas son o bien menciones **negadas** explícitamente ("no hay
paso de confirmación del rival ni de disputa", "`CONFIRMED` y `DISPUTED` son
legado... no los produce ningún flujo actual") o referencias legítimas al
propio enum de la base de datos (que sigue existiendo por compatibilidad con
datos antiguos, algo que **sí** es cierto en el código — `isConfirmedForStandings`
sigue aceptando `CONFIRMED` como legado, verificado en revisiones
anteriores). `grep -rn "admin/disputas"` en todo el árbol (`src/`, `tests/`,
`docs/`, `SPEC.md`) solo encuentra el test de regresión que confirma que la
ruta sigue sin existir — ninguna mención documental activa.

Sobre el problema inverso (documentación que ahora describe algo que el
código tampoco hace): no lo encontré. Contrasté las afirmaciones nuevas más
concretas de `SPEC.md` (§7.2 sobre Misra-Gries, §7.4 sobre la guarda de
`startPlayoffs`, §7.5 sobre los tres desenlaces y la restricción de D5) y
`README.md` contra el comportamiento real que verifiqué en las nueve
revisiones anteriores de esta misma ronda — coinciden en cada punto que
comprobé, incluida la restricción de D5 (que un participante no pueda
declarar incomparecencia sobre una partida ya jugada, solo el admin), que es
la decisión de producto más reciente y más fácil de olvidar documentar.

## 2. `SPEC.md` leído de corrido — sin frases de los dos mundos

Leí completas las secciones reescritas (§4.3, §7.2-§7.5, §8, ADR-007/008) y
otras que no debían tocarse (§1-§3, §5, §6, §9-§10) buscando exactamente lo
que motivó ampliar el alcance: una frase que diga "cuenta al confirmar el
rival" conviviendo con otra que diga "cuenta en cuanto se apunta". No
encontré ninguna. El vocabulario es consistente en todo el documento:
`REPORTED` cuenta de inmediato, sin paso de confirmación, en las tres
secciones que lo mencionan (§7.3, §7.4, §7.5, y también en §9 "Riesgos").

## 3. D4 — verificado en los tres sitios donde podría reaparecer

`grep -n "voraz\|Vizing\|Δ+1\|Misra\|Kempe"` sobre `SPEC.md` y `docs/` da
seis coincidencias, todas correctas: cada una de las que menciona un voraz
por grado descendente lo hace para **negar** que alcance `Δ+1` ("no la
alcanza un coloreado voraz simple", "un voraz por grado descendente solo
garantiza `2Δ-1`"), y atribuye la cota real a **Misra & Gries con reparación
por cadenas de Kempe** en los dos sitios donde aparece (ADR-008 y §7.2). No
encontré la afirmación falsa en ningún punto — ni en `SPEC.md`, ni en el ADR,
ni en ningún comentario de los ficheros tocados por este commit. El ejemplo
concreto que cita ADR-008 (`K_12` menos una arista, `Δ=11`, 15 colores con
el voraz simple frente al límite de 12) coincide exactamente con el que
verificó la revisión de H2.

## 4. ADR-008 y ADR-007 — tabla idéntica a §6.1, cuerpo histórico conservado

Comparé la tabla de ADR-008 en `SPEC.md` contra `plan/specs/rondas-con-fecha.md`
§6.1 fila por fila: las cuatro consecuencias de ADR-007 (entidad `Round`,
circle method, sin byes de liga, calendario por fecha) están marcadas
exactamente igual (❌ derogada las dos primeras, ✅ se mantiene las otras
dos). Confirmé con `git diff` que ADR-007 **no se borra**: la única línea
eliminada de esa sección es la anotación antigua "Eliminada por ADR-007" en
§4.3 (que dejó de ser cierta porque `Round` vuelve) — el cuerpo completo de
ADR-007 sigue presente, con una nota de derogación parcial arriba y cada una
de sus cuatro consecuencias marcada inline (❌/✅/"sin cambios"), preservado
como registro histórico tal como pedía el encargo.

## 5. El e2e — 54/54, tres corridas, los tres hallazgos cubiertos de verdad

Ejecuté la suite **tres veces seguidas**: **54/54 pasan, 0 skipped** en las
tres, sin intermitencia. Conté los tests del fichero (`grep -c '  test('`):
24 en `full-journey.spec.ts` + 3 en `rondas.spec.ts` = 27 por proyecto × 2
proyectos (chromium, mobile-chrome) = 54, coincide exactamente.

Verifiqué los tres hallazgos encargados leyendo el código del test, no solo
el resumen:

- **Etiquetas en pantalla**: el test 9 declara una incomparecencia de verdad
  a través de la UI (`WalkoverForm`), el test 10 cierra la Ronda 1 de
  verdad, y el test 11 visita `/calendario` y comprueba **en el DOM**
  `toContainText(/Incomparecencia/i)` y `toContainText(/Saldada sin
  jugar/i)` — las dos etiquetas de H6 — y en `/clasificacion`
  `toContainText(/\(\d+ saldadas?\)/)` — el contador de H7. Es la primera
  vez en toda la feature que estas tres cosas se ejercitan de punta a punta,
  no solo en tests unitarios.
- **`startPlayoffs` real**: leí el test 14 completo — no hay ningún
  `test.skip()` en ninguna parte del fichero (confirmado con `grep`). El
  test 12 cierra las seis rondas antes, así que la guarda de H9 queda
  satisfecha de verdad y el botón de iniciar aparece.
- **Overflow de `/rondas` a escala real**: el test 3 da de alta 5 jugadores
  nuevos vía la UI real de `/admin/jugadores` (no manipulación directa de
  base de datos), sobre los 6 del seed + el admin, para un total de 12 —
  dentro del rango 12-20 que exige §7.2. El nuevo test de overflow visita
  `/rondas` explícitamente (`await page.goto("/rondas")`) **después** de esa
  alta, a 390px de ancho — el hueco exacto que señalé en la review de H6.

## 6. El bug de locator autocorregido — mi juicio: no es el mismo problema, con un matiz

Leí el mecanismo completo, no solo el diagnóstico del commit. El fix hace
una **búsqueda por contenido una sola vez** (recorre las tarjetas con un
bucle comprobando cuál tiene visible el botón "Apuntar resultado" y guarda
su posición en `targetIndex`) y **actúa por posición** después
(`cards.nth(targetIndex)`) para la secuencia de tres clics seguidos
(Incomparecencia → Gana X → Declarar). Esto es distinto, en un punto
importante, del bug de H6: aquel filtraba por contenido en **cada**
interacción (`.filter({has})` reevaluado de forma perezosa en cada acción),
así que el propio clic cambiaba lo que el filtro veía a mitad de secuencia.
Aquí la posición se fija **antes** de la primera acción y el orden de las
tarjetas hermanas no cambia durante la secuencia (cada `MatchCard` alterna
su propio estado local — `showWalkover` — sin reordenar la lista, que sigue
siendo el mismo `.map()` sobre el mismo array). No es el mismo problema
resucitado.

El matiz: la solución sigue siendo frágil **si algo entre el escaneo y el
clic reordenara la lista** (una recarga de página, un cambio de ronda que
mueva tarjetas). Eso no ocurre aquí —no hay navegación entre el escaneo y la
interacción—, pero el comentario del test explica el porqué del cambio sin
dejar constancia explícita de esa precondición (que la secuencia sea
ininterrumpida y sin recarga). No es bloqueante, pero lo señalo como algo a
vigilar si alguien toca este test más adelante.

## 7. `trazabilidad.md` — 43 criterios, sin huecos, muestra verificada

Extraje los identificadores de criterio de la tabla principal
(`grep -oE "^\| [0-9]+ \|"`) y los comparé contra el conjunto `{1..43}`:
**cero** huecos, **cero** duplicados. Verifiqué al azar 8 mapeos repartidos
por toda la tabla (criterios 3, 8, 10, 14, 21, 25, 33 y 37) contra el código
real de los ficheros de test citados — los ocho `describe(...)` existen con
el texto exacto que la tabla afirma. La sección del criterio 42 (fallo
antes del cambio) reproduce con precisión la honestidad de H7 sobre sus 3
tests que son guarda de regresión, no fallo-antes-del-cambio literal —
verificado contra mi propio informe de esa revisión, coincide palabra por
palabra en el hecho (6 de 9 fallan, los 3 de AC-28 no). El criterio 43 está
verificado contra `coverage-final.json` con las cifras exactas
(`rounds.ts` 259/259 statements, 86/86 branches) que yo mismo confirmé en la
revisión de H8.

## 8. `/bases` — español llano, sin jerga, con los cuatro puntos exigidos

Leí el diff completo: rondas mensuales con cupo (`2 partidas por ronda`,
explicado como "te toca jugar un número fijo de partidas"), fecha límite
("no es un día de quedada obligatorio: es la fecha a partir de la cual el
organizador puede dar la ronda por cerrada"), incomparecencia 80-0 **sin
bonus** con la explicación del incentivo perverso en lenguaje llano ("saldría
más a cuenta no presentarse que jugar una partida reñida"), 0-0 sin acuerdo,
y que adelantar no exime ("eso no os libra de las partidas de vuestra ronda
en curso"). Cero jerga técnica (nada de `Result`, `resolution`,
`matchesPerRound` en el texto visible), hereda el resto de la página
(mobile-first, dark mode) sin tocarlo.

## 9. Alcance — confirmado, solo `bases/page.tsx` en `src/`

`git show a5a40dc --stat -- src/` solo lista `src/app/bases/page.tsx`.
Ningún fichero de `src/server/` se toca en este commit — coherente con que
H10 es exclusivamente documentación, UI pública estática y e2e.

## 10. Visto en conjunto — un hallazgo transversal, no bloqueante

Con la feature completa delante, una observación que no encaja en ningún
hito individual: los tres riesgos admin-contra-admin aceptados a lo largo de
la ronda (la colisión de índice de `Round` entre dos `redistributePending`
concurrentes y la no-atomicidad de `addMissingLeagueMatches`, ambos de H8;
la clasificación obsoleta de `startPlayoffs` frente a un override en ronda
cerrada, de H9) están cada uno bien documentado **en el código**, en el
sitio donde ocurre — pero ninguno aparece en `SPEC.md §9` ("Riesgos y
mitigaciones"), que es donde alguien auditando el perfil de riesgo completo
de la feature miraría primero. La sección ya lista riesgos de naturaleza
similar ("Admin como único responsable del cierre"). No es un defecto de
H10 en particular —ninguno de los tres riesgos se originó en este hito, y
todos están correctamente señalados donde el código los produce— pero
consolidarlos en `SPEC.md §9` cerraría el círculo de la documentación de
forma más completa que dejarlos solo como comentarios dispersos en tres
ficheros distintos.

## Regresión

- `npm run lint` → **0 errores, 0 warnings**.
- `npm run test` → `Test Files 17 passed (17)` / `Tests 496 passed (496)`.
- `npx tsc --noEmit` → limpio, sin salida.
- `npm run build` → compila; **19 rutas** contadas directamente del árbol
  impreso (incluye `/`, `/_not-found` y `/unauthorized`), coincide con lo
  que documenta `trazabilidad.md`.
- `npm run e2e` → ejecutado **tres veces**: **54 pasan, 0 skipped** en las
  tres corridas, sin intermitencia.

## Bloqueantes

Ninguno.

## Sugerencias (no bloqueantes)

1. **(Punto 10)** Añadir una entrada breve en `SPEC.md §9` que consolide los
   tres riesgos admin-contra-admin aceptados durante esta ronda (colisión de
   `redistributePending`, no-atomicidad de `addMissingLeagueMatches`,
   clasificación obsoleta en `startPlayoffs`), con referencia a dónde vive
   cada comentario en el código — para que quien audite el riesgo de la
   feature desde `SPEC.md` no tenga que encontrarlos por casualidad leyendo
   `round-actions.ts`/`playoff-actions.ts`.
2. **(Punto 6)** Dejar constancia explícita en el comentario del test de
   incomparecencia de que la localización por posición (`nth`) depende de
   que no haya navegación ni reordenación entre el escaneo y la secuencia de
   clics — hoy se explica el porqué del cambio, pero no la precondición que
   lo mantiene seguro, y es justo el tipo de matiz que un futuro cambio al
   test podría romper sin darse cuenta.
