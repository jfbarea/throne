# Review — ola 2 — `partidas-por-jornada`

Veredicto de ola: **CHANGES_REQUESTED**

Relanzar: **t01** (fix puntual en `PartidasBrowser.tsx`). t02, t03 y t04 se aprueban tal cual.

## Costuras

La costura principal (contrato t00, montaje de t02 sobre t01, keys `round-N`,
`aria-current`, `TEST_IDS`/`LABELS` del contrato) está limpia. Concretamente:

- **`page.tsx` monta `<PartidasBrowser>` sin `key` dependiente de `vista`**
  (`src/app/mis-partidas/page.tsx:200-207`), tal como exige el plan. El reseteo
  de plegado/recién-resueltas al cambiar `vista` (t01,
  `PartidasBrowser.tsx:101-125`) y la persistencia de buscador/filtro están
  bien encajados: los tests de t01 (`tests/partidas-browser.test.tsx:282-384`,
  CA-14/CA-16) verifican el mecanismo vía `rerender` con las mismas props que
  produciría una navegación de pestaña real, y el razonamiento de la costura
  (Next preserva la identidad del client component en la misma posición del
  árbol) es correcto para este caso (misma ruta, solo cambia `searchParams`).
  Dicho esto, **no hay ningún e2e que ejercite esto en un navegador real**
  (ver Riesgos).
- **`currentBlockKey` (t02) y el plegado inicial (t01) casan exactamente.**
  `buildBrowserBlocks` (`src/server/partidas-blocks.ts:221-224`) devuelve
  `null` cuando la ronda actual no tiene bloque en la lista activa, y
  `isOpenByDefault`/`computeInitialOpenMap`
  (`src/app/mis-partidas/PartidasBrowser.tsx:31-44`) colapsan todo en ese
  caso. Cubierto por `tests/partidas-browser.test.tsx:119-126` (CA-8) y
  `tests/partidas-pagina.test.tsx:216-226` (la mitad de servidor).
- **Bug real de costura — el subtítulo vacío de t02 rompe el render de t01.**
  `buildBrowserBlocks` deja `subtitle: ""` para `UNASSIGNED`/`LEGACY`
  (`src/server/partidas-blocks.ts:206`, `:216`), tal como pide el contrato
  (t00: "título es p. ej. Ronda 3; subtitle es el texto sin el número de
  partidas") y como afirma su propio test
  (`tests/partidas-pagina.test.tsx:194-197`, `subtitle` === `""`). Pero
  `PartidasBrowser` concatena título, subtítulo y contador sin condicionar el
  separador central (`src/app/mis-partidas/PartidasBrowser.tsx:235-238`):
  ```
  {block.title} · {block.subtitle} ·{" "}
  {countLabel(block.matches.length, visible.length)}
  ```
  Con `subtitle=""` esto renderiza `"Sin ronda asignada ·  · 4 partidas"`
  (doble punto medio, comprobado con un render real:
  `"Sin ronda asignada ·  · 1 partida"`). Ninguno de los dos suites de test
  atrapa esto: t01 solo usa `subtitle: "subtítulo"` (nunca vacío) en su
  helper `makeBlock`, y t02 no renderiza `PartidasBrowser`, solo comprueba el
  valor de `subtitle`. Viola literalmente §4.5: *"«Sin ronda asignada» e
  «Historial»: su título y el número de partidas"* (sin segmento intermedio).
  **Bloqueante, atribuido a t01** (la responsabilidad de omitir el segmento
  vacío es del renderer, no de quien produce el dato): condicionar el join en
  `src/app/mis-partidas/PartidasBrowser.tsx:235-238` a que `block.subtitle`
  no esté vacío, y añadir un caso a `tests/partidas-browser.test.tsx` que
  monte un bloque `UNASSIGNED`/`LEGACY` con `subtitle: ""` y compruebe el
  texto exacto de la cabecera.
- **Desborde de partición: ninguno.** Los ficheros tocados coinciden
  exactamente con la tabla de PLAN.md más el ajuste declarado del
  orquestador en `tests/montaje.test.tsx` (fuera de partición, con el OK del
  usuario). Sin solapes entre tareas.
- **t03 no cambia comportamiento.** `DaySchedulePicker.tsx` borra su
  `fold`/`matchesQuery` e importa `matchesPlayerQuery`
  (`src/app/calendario/DaySchedulePicker.tsx:53,156`), mismo criterio;
  `tests/agendar.test.tsx` sigue en verde sin tocarlo (confirmado, 785/785 →
  ejecutado localmente aparte, sigue verde). `FactionSelect.tsx` reordena
  `foldText` + `replace(/['’]/g, "")` (`src/components/FactionSelect.tsx:39-40`),
  equivalente al fold + quitado de apóstrofos anterior (el orden relativo no
  afecta: apóstrofos son insensibles a mayúsculas).
- **t04 contra el contrato, no contra la implementación**, y así se
  verifica: usa `TEST_IDS`/`statusFilterOptionTestId` de
  `browser-contract.ts`, y `openRound1Block` localiza por el texto del
  `<summary>` (`^Ronda 1(\s|·)`) en vez de asumir la `key` que genera
  `partidas-blocks.ts`, exactamente como su propio comentario explica.

## Por tarea

### t01 — navegador — **CHANGES_REQUESTED**

Bloqueante:
- `src/app/mis-partidas/PartidasBrowser.tsx:235-238` — la cabecera de un
  bloque con `subtitle` vacío (`UNASSIGNED`/`LEGACY`, producidos siempre así
  por t02) renderiza un separador doble (`"Sin ronda asignada ·  · 4
  partidas"`) en vez de `"Sin ronda asignada · 4 partidas"`. Viola §4.5.

Sugerencias (no bloqueantes):
- Ningún test de `tests/partidas-browser.test.tsx` cubre un bloque
  `UNASSIGNED`/`LEGACY` con `subtitle: ""` — el `makeBlock` de test siempre
  usa un subtítulo no vacío por defecto. Añadir ese caso habría atrapado el
  bloqueante anterior sin depender de un review manual.
- El colapso manual de un bloque (clic en la cabecera) desmonta por completo
  su contenido (`{isOpen && <div>...}</div>}` en
  `PartidasBrowser.tsx:249-260`), no solo lo oculta con CSS. Si había un
  `ReportForm`/`WalkoverForm` abierto dentro, se pierde igual que al filtrar
  por búsqueda — la spec solo contempla explícitamente ese caso para el
  buscador (§5, última fila). No es una violación clara pero conviene que
  quede documentado como comportamiento asumido, igual que el de búsqueda.

### t02 — pagina-y-pestanas — **APPROVED**

Sin bloqueantes. `buildBrowserBlocks` reproduce fielmente la lógica movida
desde `page.tsx` (orden, cupo en `MIAS` vs. agregado en `TODAS`, `counts`,
`currentBlockKey`), y `page.tsx` queda delgado según §7. `VistaTabs` usa
`aria-current` correctamente y no es sticky, en el orden vertical correcto
(cabecera → pestañas → fila sticky de t01 → bloques).

Sugerencia: la responsabilidad de "no dejar `subtitle` vacío roto" es de
t01, pero si se prefiere resolver por el lado de t02 en lugar de t01, una
alternativa sería que `buildBrowserBlocks` no emita `subtitle: ""` sino
`undefined`/omita el campo — pero el contrato de `browser-contract.ts` fija
`subtitle: string` (no opcional), así que el fix correcto sigue siendo en el
renderer.

### t03 — buscador-compartido — **APPROVED**

Sin bloqueantes. Cambio mínimo y fiel al criterio compartido; sin cambio de
comportamiento en `/calendario` ni en `FactionSelect`. El bullet de
`src/app/guia/sections.ts:50` no está afirmado literalmente por ningún test
(comprobado con `grep`).

### t04 — e2e — **APPROVED**

Sin bloqueantes. Cubre exactamente lo que pedía el plan: pestañas del admin
(paso 4b, CA-1 a CA-3), desplegar Ronda 1 antes de los pasos 7-9
(`openRound1Block`), el filtro a `Jugadas` en el paso 8, `Todas` donde el
paso 6 y el de incomparecencia dependían de que "Ronda 1" apareciera bajo el
filtro por defecto, y el nuevo test de viewport móvil (criterio 22: fila
sticky bajo el header, pestañas fuera de vista, sin overflow, foco fuera del
buscador). Localiza por texto de `<summary>`, no por la `key` que genera
`partidas-blocks.ts`, evitando acoplarse a la implementación de t02.

## Contra la spec

Criterios de §8, verificados sobre el árbol completo de la ola:

| CA | Estado | Dónde |
|----|--------|-------|
| 1 | Cubierto | `page.tsx:73-83` (where MIAS), e2e paso 4b |
| 2 | Cubierto | `page.tsx:137` (título "Gestión de partidas"), e2e paso 4b |
| 3 | Cubierto | e2e paso 4b (`page.reload()`) |
| 4 | Cubierto | `partidas-blocks.ts:177-183` (roundQuota en MIAS), `tests/partidas-pagina.test.tsx:130` |
| 5 | Cubierto | `partidas-blocks.ts:114-124` (`counts` sobre `matches` ya filtrados por vista) |
| 6 | Cubierto | `resolveVista` (t00, ya committed) ignora el param si no es ADMIN; `isAdmin && <VistaTabs>` |
| 7 | Cubierto | `pickCurrentRoundId` y `tests/partidas-dominio.test.ts` (t00, ya committed) |
| 8 | Cubierto | `computeInitialOpenMap`/`isOpenByDefault`, `tests/partidas-browser.test.tsx:101-127` |
| 9 | Cubierto | `tests/partidas-browser.test.tsx:129-155` |
| 10 | Cubierto | `withDefaultsForNewBlocks`, `tests/partidas-browser.test.tsx:157-215` |
| 11 | **Cubierto con defecto** | filtra y despliega bien (`tests/partidas-browser.test.tsx:217-239`), pero el texto de cabecera para bloques con subtítulo vacío queda roto (ver bloqueante) — no afecta a bloques `ROUND`, que siempre llevan subtítulo |
| 12 | Cubierto | `tests/partidas-browser.test.tsx:241-258` |
| 13 | Cubierto | `tests/partidas-browser.test.tsx:260-280` |
| 14 | Cubierto | `tests/partidas-browser.test.tsx:282-344` (simulación de navegación vía `rerender`); sin verificación e2e de la navegación real (ver Riesgos) |
| 15 | Cubierto | `tests/partidas-browser.test.tsx:386-417` |
| 16 | Cubierto | `tests/partidas-browser.test.tsx:420-467` |
| 17 | Cubierto | `tests/partidas-browser.test.tsx:469-502` |
| 18 | Cubierto | `tests/partidas-browser.test.tsx:504-532` |
| 19 | Cubierto | pestañas "Mis partidas"/"Toda la liga" (`browser-contract.ts` LABELS), filtro con "Todas" separado — `tests/partidas-browser.test.tsx:535-542`, `tests/partidas-pagina.test.tsx:306-329` |
| 20 | Cubierto | `page.tsx:179-198`, `TEST_IDS.adminNoOwnMatches`/`adminNoOwnMatchesSeeTodas` |
| 21 | Cubierto | `DaySchedulePicker.tsx` importa `matchesPlayerQuery`; `tests/agendar.test.tsx` verde sin tocar |
| 22 | Cubierto | fila sticky con offset real vía `--app-header-height` (`PartidasBrowser.tsx:373-396`), `type="search"` sin `autoFocus`, e2e de viewport móvil (`tests/e2e/full-journey.spec.ts:828-891`) |
| 23 | Cubierto | gate del orquestador: `npm run test` 785/785, lint limpio, build OK, e2e 58/58 |

No-objetivos de §3: sin violaciones detectadas (nada de `localStorage`, sin
filtros nuevos, sin tocar `MatchCard`/`ReportForm`/`WalkoverForm`, sin tocar
`sortRoundBlocks`, `/calendario` sin cambio de comportamiento, sin
paginación ni búsqueda en servidor).

Restricciones de §7: `page.tsx` queda delgado (la lógica vive en
`partidas-blocks.ts`); "ahora" se calcula en servidor y llega como prop
(`pickCurrentRoundId(rounds, new Date())` en `page.tsx:71`); `<details>`
nativo con `open` controlado; sin dependencias nuevas; offset sticky tomado
de la altura real del header, no un número mágico.

## Riesgos

- **CA-14/CA-16 (persistencia de estado de cliente al cambiar de pestaña)
  solo está verificado por simulación (`rerender` en Vitest), no por un e2e
  que haga clic real en la pestaña «Toda la liga» con texto ya escrito en el
  buscador.** El razonamiento (misma ruta, mismo árbol, sin `key`) es
  correcto y coincide con el comportamiento documentado del App Router de
  Next para navegaciones que solo cambian `searchParams`, pero es la única
  pieza de la ola que depende de un comportamiento de framework no cubierto
  por ningún test de extremo a extremo. Si algo en el árbol de la página
  (por ejemplo, un `key` implícito por posición cambiante) rompiera esa
  identidad, ningún test lo detectaría hasta producción.
- El colapso manual de un bloque desmonta sus tarjetas (no solo las oculta),
  perdiendo cualquier formulario abierto dentro — igual que el caso de
  búsqueda que sí contempla la spec (§5), pero no explícitamente el de
  colapso manual. Comportamiento razonable, sin caso de test que lo cubra
  como "aceptado".

---

## Segunda vuelta

Veredicto de ola: **APPROVED**

### t01 — navegador — **APPROVED**

El bloqueante queda resuelto. `blockHeaderText`
(`src/app/mis-partidas/PartidasBrowser.tsx:70-76`) sustituye la concatenación
directa por un `[block.title, block.subtitle, count].filter((part) => part
!== "").join(" · ")`, con un comentario que documenta el hecho no local (t02
produce `subtitle: ""` para `UNASSIGNED`/`LEGACY`, `src/server/partidas-blocks.ts`)
que justifica el filtro. El call site en el `<summary>`
(`PartidasBrowser.tsx:255-258`) pasa a usar el helper.

Verificado:

- **Costura con t02 intacta.** El `subtitle` por defecto de `makeBlock` en
  `tests/partidas-browser.test.tsx:70` sigue siendo `"subtítulo"` (no vacío),
  así que todos los tests preexistentes de bloques `ROUND` —incluidos los que
  no se tocaron en este fix— siguen ejerciendo el formato de tres partes
  `título · subtítulo · N partidas` sin cambio de comportamiento. Ningún test
  de `ROUND` se ha modificado.
- **Los dos tests nuevos** (`tests/partidas-browser.test.tsx:129-166`) cubren
  exactamente los dos casos que la review anterior pedía: `UNASSIGNED` sin
  búsqueda (`"Sin ronda asignada · 1 partida"`) y `LEGACY` con búsqueda activa
  (`"Historial · 1 de 2 partidas"`), pasando `subtitle: ""` explícito al
  quinto argumento de `makeBlock`. Ambos leen `textContent` completo del
  `<summary>`, así que un separador doble volvería a fallarlos.
- **Partición respetada.** `git diff --stat` muestra únicamente cambios en
  `PartidasBrowser.tsx` y (fuera del diff por ser nuevo) `partidas-browser.test.tsx`
  frente al estado ya aprobado de t02/t03/t04; ningún otro fichero de la ola
  se ha tocado en esta vuelta.
- Sin bloqueantes nuevos. Las dos sugerencias no bloqueantes de la primera
  vuelta (colapso manual que desmonta el contenido; ausencia de e2e real para
  CA-14/CA-16) siguen abiertas como sugerencias, no como bloqueantes.

### t02, t03, t04

Sin cambios respecto a la primera vuelta. Se mantienen **APPROVED**.

### Gate del conjunto

`npm run test` 787/787 (+2 sobre los 785 de la primera vuelta, exactamente los
dos tests nuevos de §4.5), lint limpio, build OK, e2e `full-journey` 58/58.
Consistente con el fix puntual sin regresiones.

### Contra la spec (actualización)

CA-11 (§4.5) pasa de "cubierto con defecto" a **cubierto sin reservas**: el
texto de cabecera para bloques con subtítulo vacío ya no lleva separador
doble, verificado por test.

### Riesgos

Se mantienen los dos riesgos ya señalados en la primera vuelta (ausencia de
e2e real para la persistencia de estado entre pestañas vía `rerender`
simulado; el colapso manual desmonta el contenido del bloque en vez de solo
ocultarlo). Ninguno es nuevo ni bloqueante.
