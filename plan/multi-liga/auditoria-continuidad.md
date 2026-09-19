# Auditoría de continuidad — Z2 (`auditoria-de-continuidad`)

Spec: `plan/specs/multi-liga.md` §7.1 y criterios 43-47. Objetivo del hito:
**demostrar** la restricción dura de continuidad en producción, no darla por
buena porque el código lo diga en un comentario. El patrón que esta feature
ya pagó tres veces —`round-actions.ts` con `playerId: null`, los cuatro
componentes de acción huérfanos del índice de admin, la carrera de redirects
del layout de `/liga/[slug]`— tiene una causa común: **el test verificaba la
función, no el camino**. Esta auditoría solo cuenta como prueba lo que
recorre el camino real: sesión firmada de verdad, navegador o petición HTTP
real contra el servidor real, migración aplicada de verdad sobre una base
poblada de verdad. Donde eso no era posible sin poner en riesgo el resto de
la suite, lo digo explícitamente en vez de simularlo.

## Qué se añadió

| Fichero | Qué prueba | Cómo |
|---|---|---|
| `tests/e2e/auditoria-continuidad.spec.ts` | Criterios 43 y 46 | Playwright, servidor real (`webServer` de `playwright.config.ts`), cookie de sesión firmada a mano con `signSession` (el mecanismo real de `src/lib/session.ts`) sin pasar por `/login` ni por ningún mock de `@/lib/session`/`@/lib/guards`. Navegador real para comprobar que no aparece el login; petición HTTP cruda con `maxRedirects: 0` para comprobar que cada ruta antigua resuelve en un único salto directo. |
| `tests/auditoria-continuidad-bases.test.ts` | Criterio 44 (parcial — ver tabla) | Encadena, en un solo test, los dos saltos de `/bases` sin sesión con una sola liga en circulación: toma el slug al que `/bases` redirige de verdad y lo pasa, sin fijarlo a mano, a `/liga/[slug]/bases`, comprobando que esa página responde (no otro redirect) con el contenido de esa liga. |
| `tests/auditoria-migracion-no-destructiva.test.ts` | Criterio 47 | Aplica los ficheros `migration.sql` reales (los mismos que usaría `prisma migrate deploy`) con el binario `sqlite3`, sobre una base SQLite nueva poblada con una fila en cada tabla del dominio (League, Player, Round, Match, Result, Bracket, BracketSlot, AuditLog), y compara un volcado completo de antes y después. |

Los tres ficheros son nuevos; no se ha tocado nada en `src/**`. Suite
completa: `npm run test` pasa con 744 tests (737 previos + 7 nuevos:
6 de la migración, 1 de `/bases`). `npm run e2e --project=chromium` pasa con
51 tests (11 nuevos + 40 previos, sin ninguno roto por el nuevo fichero).
`npm run build` y `npm run lint` en verde; `next-env.d.ts` revertido tras el
build.

## Repaso de la tabla de §7.1, punto por punto

| Superficie (spec §7.1) | Qué lo sostiene en el código | Cómo se comprobó | Veredicto |
|---|---|---|---|
| **Sesiones abiertas en el deploy** — `SessionPayload` no cambia, las cookies firmadas siguen siendo válidas | `SessionPayload` (`src/lib/session.ts:19`) sigue siendo exactamente `{ playerId, role }`. `grep -rn "SessionPayload" src/` confirma un único punto de definición y ningún consumidor que exija un campo más. | `tests/e2e/auditoria-continuidad.spec.ts`: se firma una cookie de PLAYER con `signSession` sin pasar por `/api/auth/login-player` ni por ningún mock, se instala en un contexto de navegador limpio y se navega a `/mis-partidas` contra el servidor real. Aterriza en `/liga/<slug>/mis-partidas` sin ver el formulario de login. | **Demostrado.** Nota honesta: como `SessionPayload` no ganó ningún campo con esta feature, la cookie "de antes" y "de después" tienen el mismo shape byte a byte — lo que el test demuestra no es una migración de formato (no la hay) sino que una cookie construida sin que el código nuevo intervenga en absoluto sigue siendo aceptada por las rutas nuevas. |
| **Login** — nombre + passcode, sin selector de liga ni paso nuevo | `verifyPlayerPasscode` (`src/lib/auth.ts:56`) añade dos filtros (`role: "PLAYER"`, liga no archivada) a la misma consulta por `displayName`; la forma del login (`POST /api/auth/login-player`, formulario con "Tu nombre" + "Código de acceso") no cambia. | Leído el código; cubierto indirectamente por `tests/e2e/full-journey.spec.ts` (login real de jugador, sin selector de liga) y por `tests/nombres-unicos-y-login.test.ts` (hito C4, no de este hito). No se ha escrito un test nuevo aquí porque no hay comportamiento nuevo que demostrar: es un `AND` en un `WHERE` que ya existía, ya cubierto por la suite de C4. | **Verificado por lectura + suite existente**, sin test nuevo de Z2 — no hacía falta uno: la superficie de riesgo (el formulario, el flujo) es idéntica a la de antes, y el único cambio de fondo (el filtro por liga archivada) ya tiene su propio hito y su propia cobertura. |
| **Marcadores de vistas de jugador** — las rutas antiguas siguen respondiendo y redirigen | `src/app/{clasificacion,calendario,rondas,bracket,mis-partidas}/page.tsx`, los cinco delegan en `redirectToOwnLeaguePage` (`src/app/_lib/legacy-route-redirect.ts`). | `tests/e2e/auditoria-continuidad.spec.ts`: con la misma cookie firmada a mano (sin re-login), las cinco rutas se piden dos veces cada una — una vez con navegador real (confirma destino final y ausencia de login) y otra con petición HTTP cruda sin seguir redirects (confirma que el `Location` apunta directo a `/liga/<slug>/<página>`, un único salto, no dos encadenados). | **Demostrado**, las cinco, con servidor real. |
| **Marcador público de `/bases`** — con una sola liga en circulación, `/bases` lleva a sus bases sin pedir login | `src/app/bases/page.tsx`: sin sesión, si `prisma.league.findMany({ archivedAt: null })` devuelve exactamente una liga, redirige a `/liga/<slug>/bases`; con dos o más, a la pantalla de "usa el enlace concreto" (nunca lista). | `tests/auditoria-continuidad-bases.test.ts` encadena los dos saltos con `test.db`: `/bases` sin sesión y una sola liga en circulación → confirma el `redirect()` a `/liga/<slug>/bases` → sigue ese slug (no uno fijado a mano) hasta `/liga/[slug]/bases` → confirma que esa página responde con el contenido real de esa liga, no otro redirect. **No** se pudo comprobar con una petición HTTP real de extremo a extremo (código 200 de verdad): la base de e2e (`e2e.db`) siembra siempre dos ligas en circulación a la vez (spec §8, y lo consumen ya `full-journey.spec.ts` y `multi-liga.spec.ts`, secuenciales sobre la misma base), así que forzar "una sola liga en circulación" ahí exigiría archivar una liga compartida por el resto de la suite e2e — un riesgo de dejar estado a medias entre ficheros que no compensaba el beneficio, dado que Vitest ya permite fijar ese recuento con garantías y sin tocar nada compartido. | **Demostrado a nivel de los dos saltos de Next.js (`redirect()` → render), no con un código de estado HTTP real.** Diferencia honesta frente a los criterios 43/46, que sí tienen esa prueba con servidor real. |
| **Contenido de las bases** — la migración rellena `rulesMarkdown` con la plantilla por defecto que reproduce el texto actual menos lo que pasa a generarse; el bloque generado imprime los valores reales | `prisma/migrations/20260911140227_.../migration.sql` inserta el literal `RULES_MARKDOWN_TEMPLATE_BEGIN/END`, mantenido idéntico a `DEFAULT_RULES_MARKDOWN` (`src/server/league/default-rules.ts`) por `tests/default-rules-migration-parity.test.ts` (hito E3, ya existente). El bloque generado lee `pointsWin/pointsDraw/pointsLoss/bonus*/tiebreakers/matchesPerRound/playoffSize` directamente de `League` en cada petición (`src/app/liga/[slug]/bases/rules-content.tsx`). | `tests/auditoria-migracion-no-destructiva.test.ts` (nuevo) comprueba que `rulesMarkdown` queda, byte a byte, igual a `DEFAULT_RULES_MARKDOWN` tras aplicar la migración real sobre una fila poblada. La correspondencia entre esa plantilla y "lo que decía `src/app/bases/page.tsx` antes de esta feature" la cubre `tests/bases-por-liga.test.ts` (hito E1), no este hito. | **Demostrado el backfill; heredada una divergencia ya documentada y no arreglada, propiedad de E1, no de Z2**: el bloque de desempates de la página vieja no incluía `LOSSES` y ordenaba `HEAD_TO_HEAD` primero en vez de cuarto — un error que ya tenía la página anterior a esta feature, no algo que rompa esta feature. La página migrada usa el orden real de `League.tiebreakers` (correcto según `SPEC.md` §7.3 y `src/server/standings.ts`) en lugar de reproducir el error, así que el contenido para el/la única liga hoy en producción **sí cambia** en ese punto concreto, en el sentido estricto de "que el contenido diga algo distinto" que exige la restricción de §7.1. Ya está señalado en el propio código (comentario de `tests/bases-por-liga.test.ts:24-36`) como algo para que decida el arquitecto/reviewer, no una decisión tomada en silencio; lo repito aquí porque es precisamente el tipo de cosa que esta auditoría existe para no dejar pasar sin nombrar. |
| **Datos** — migración aditiva: tres columnas, cero borrados, cero reescrituras | `prisma/migrations/20260911140227_.../migration.sql`: `RedefineTables` de SQLite con `SELECT` explícito columna a columna desde la tabla vieja, sin `DELETE` ni `UPDATE` de una columna preexistente. | `tests/auditoria-migracion-no-destructiva.test.ts` (nuevo): aplica las 5 migraciones previas + la migración bajo prueba, con el binario `sqlite3`, sobre una base poblada con una fila en cada una de las 8 tablas del dominio. Compara el volcado completo de `Player`, `Round`, `Match`, `Result`, `Bracket`, `BracketSlot` y `AuditLog` antes/después (deben ser bit a bit idénticos) y, para `League`, que cada columna preexistente conserva su valor exacto. Además: el slug de backfill en SQL puro se contrasta contra `slugify()` real para un nombre con tildes y "ñ" (para pillar una posible divergencia entre la aproximación SQL y la función TypeScript), y `PRAGMA foreign_key_check` confirma cero violaciones de integridad referencial tras la migración. | **Demostrado**, aplicando el `.sql` real, no una descripción de lo que hace. |
| **Navegación** — las mismas entradas en la cabecera, apuntando a la ruta con slug | `src/components/AppHeader.tsx` (`NAV_SECTIONS`, `buildNavHref`) y `AdminMenu.tsx` construyen cada href con el slug del contexto cuando lo hay, y caen a la ruta antigua (que redirige) cuando no. | Leído el código; cubierto por la suite existente de B1 (`tests/indice-de-ligas-y-pantallas-con-slug.test.ts` y afines) y por `tests/e2e/full-journey.spec.ts` / `multi-liga.spec.ts` (navegación real, dos ligas). No se ha añadido test nuevo: no hay comportamiento de continuidad específico que demostrar aquí más allá de lo que ya cubre B1. | **Verificado por lectura + suite existente.** |

## Lo único que sí cambia (spec §7.1, párrafo final)

> "La cabecera pasa a mostrar en qué liga está. Es aditivo y no quita nada de
> sitio."

Confirmado por lectura de `src/components/LeagueIndicator.tsx` (montado desde
`src/app/liga/[slug]/layout.tsx`): añade un bloque con nombre y temporada de
la liga, no sustituye ni oculta nada. No se ha añadido test nuevo — es
comportamiento aditivo por construcción, no una superficie donde algo pueda
haberse roto en silencio.

## Resumen para quien decida el veredicto final

- **43 (continuidad de sesión):** demostrado con servidor real y cookie
  firmada a mano.
- **46 (las cinco rutas antiguas, sin pasos intermedios):** demostrado con
  servidor real, navegador y petición HTTP cruda sin seguir redirects.
- **44 (`/bases` sin sesión, una sola liga):** demostrado a nivel de los dos
  saltos de Next.js encadenados en un solo test; **no** con un código de
  estado HTTP real de extremo a extremo — motivo explicado arriba (estado
  compartido de `e2e.db` con el resto de la suite e2e).
- **47 (migración no destructiva):** demostrado aplicando la migración real
  sobre una base poblada, con diff completo antes/después.
- **Hallazgo a decidir, no un bloqueante de este hito:** el bloque de
  desempates de `/liga/[slug]/bases` para la liga real de producción dirá
  algo distinto de lo que decía `/bases` antes de esta feature (corrige un
  orden de desempates que ya estaba mal antes de multi-liga). Es una mejora
  de correctud, pero es también, en sentido literal, "que el contenido diga
  algo distinto" — la excepción exacta que la restricción de §7.1 dice que
  no debería pasar. Ya estaba señalado por el hito E1 antes de esta
  auditoría; lo elevo aquí porque es el punto donde la restricción dura y el
  código en producción hoy no coinciden del todo, y la decisión (aceptar la
  corrección silenciosa, o avisar del cambio en el propio texto de las
  bases) no es mía.
