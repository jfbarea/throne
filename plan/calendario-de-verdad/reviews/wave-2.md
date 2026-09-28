# Review de integración — ola 2 · `calendario-de-verdad`

**Veredicto de ola: `CHANGES_REQUESTED`** · relanzar **t04** (una línea + su test).
Todo lo demás se commitea.

Informe del agente `integrator` sobre las cuatro tareas de la ola 2, más el
trabajo de gate del orquestador. Solo lectura: no modificó código ni estado.

**Estado del gate al revisar:** `npm run test` 700/700 (dos pasadas, y en ambos
órdenes de fichero), `npm run lint` limpio, `npm run build` limpio.

---

## Veredicto por tarea

| Tarea | Veredicto | Motivo |
|---|---|---|
| t01 `guardas-de-escritura` | **APPROVED** | Sin bloqueantes. «Lo mejor de la ola». |
| t02 `rejilla` | **APPROVED** | Sin bloqueantes en su partición; cuatro observaciones para t05. |
| t03 `agendar` | **APPROVED** | Correcto, pero deja el criterio 22 sin cerrar por una costura que no cabía en su partición. |
| t04 `periferia` | **CHANGES_REQUESTED** | Un bloqueante de una línea: criterio 29 muerto en `/mis-partidas`. |

---

## Las costuras

Lo que la ola paralela tenía que cazar: fallos que no están *dentro* de ninguna
tarea —las cuatro quedaron verdes por separado— sino **entre dos**.

### C1 · Criterio 22 probado pero no vivo → t05

`ScheduleForm` acepta `leagueStartMonth` y `roundDeadline` y los convierte con
`scheduleBounds` para poner `min`/`max` en el `datetime-local`. **Ningún call
site de `src/` se los pasa**: ni `MatchRow` (t02) ni `MatchCard` (t04). Son
siempre `undefined`. El test del criterio 22 (`tests/agendar.test.tsx`) **le
pasa las props a mano**: es, literalmente, «un test que prueba una función que
nadie llama».

**Alcance:** degradación de UX, no agujero de corrección. §5.5 define esos
atributos como «la red, no el camino habitual», y la red — la guarda de
servidor de t01 — está viva y probada. Nadie puede escribir una fecha fuera de
rango; se entera por un error en vez de por el selector nativo.

**No lo arregla ninguna tarea sola: exige ampliar el contrato de t00.**
`CalendarMatch` necesita `roundDeadline` **por partida** — no vale reenviar el
de la ronda del mes visible, que sería el techo equivocado para las partidas de
§5.2 (`roundId = null`) y para las de playoff (sin techo) — y `page.tsx` y
`mis-partidas/page.tsx` tienen que bajar `League.startMonth`.

El `PLAN.md` asignó el criterio 22 a t03 en solitario. **Esa asignación estaba
mal**: el criterio cruza cuatro particiones.

### C2 · Criterio 29 muerto en `/mis-partidas` → t04, antes de commitear

`ScheduleForm` decide con `canClear = Boolean(currentScheduledAt) && resolution
!== "PLAYED"`. `MatchCard` no pasa `resolution`, y `undefined !== "PLAYED"` es
`true`: **una partida `PLAYED` con fecha sigue pintando «Limpiar fecha»**. El
servidor lo rechaza, así que no hay corrupción, pero el criterio 29 no califica
ruta.

`MatchRow` (t02) sí lo cablea. Dos consumidores del mismo contrato, uno
conectado y el otro no: costura de manual. El dato ya está en las props de
`MatchCard`; el arreglo es una línea.

### C3 · La cadena de montaje está viva, y probada por el camino — **OK**

`page.tsx → MonthGrid → DayDetail → DaySchedulePicker`, con montaje
incondicional del selector. Y lo que importa: `tests/rejilla.test.tsx` renderiza
`CalendarioPage` de verdad, con sesión `PLAYER` real, clica la celda y busca el
selector dentro del detalle. **Eso es el camino, no la función** — lo que faltó
tres veces en la PR #1.

Dos matices para t05: ese test todavía acepta un selector `stub-` como
alternativa (pasaría contra un stub), y ya no queda ningún guardián negativo de
`STUB_MARKER` en el árbol.

### C4 · «Adelantar sí, retrasar no»: coherente en los tres sitios — **OK**

Selector (t03), consulta de candidatas (t02) y guarda de servidor (t01) pasan
todos por `eligibleForDay` / `canScheduleAt`; ninguno reimplementa la regla.
Ronda cerrada: **el mismo predicado** (`canReportGivenRoundClosed`) en los dos
sitios. La UI no puede ofrecer nada que el servidor rechace.

### C5 · El huso: nadie mezcló las dos semánticas — **OK**

Las tres decisiones de §4.12 en `Europe/Madrid`; los mensajes de §5.5 con
`timeZone: LEAGUE_TZ` explícito; el selector construye el instante con
`instantOnDay`. Y el `datetime-local` está bien: `toInputValue` usa hora local
del navegador **y se aplica a los tres** (`value`, `min`, `max`), así que el
navegador compara representaciones locales de instantes correctos. Formatear las
cotas en Madrid es lo que habría roto.

Resto preexistente, fuera de los 39 criterios: `MatchCard` sigue formateando
fechas sin zona, con riesgo de mismatch de hidratación. No bloquea.

### C6 · §9.5 respetado en los tres sitios — **OK**

`endOfDay(dayKeyOf(roundDeadline))` en `calendar.ts`, consumido sin variantes
por la guarda de servidor y por el input, y la rejilla marca el día de cierre
con `dayKeyOf`, no con el instante. Probado por el camino: «acepta el propio día
del cierre a las 20:00 hora española».

### C7 · Desborde de partición

`next-env.d.ts` — artefacto regenerado por `next build`, de nadie. **Fuera de la
ola** (revertido).

### C8 · Duplicación

`nextCreatedAt` existe dos veces: en `tests/helpers/calendario.ts` y copiada a
mano en `tests/rejilla.test.tsx`. Exportarla del helper. → t05.

---

## El trabajo de gate del orquestador

Revisado con el mismo rasero. **Los cinco cambios son correctos.**

- **Borrado de `T0-AC7`** (`tests/calendar.test.ts`): no pierde ninguna
  garantía. Lo que afirmaba sobre el montaje está ahora cubierto **mejor**, por
  el camino real. Lo único sin dueño hoy es el guardián negativo de
  `STUB_MARKER`, que es justo el encargo de t05. Deuda con vencimiento, no
  agujero.
- **`tests/reportar-confirmar.test.ts`** — el cambio que más merecía discusión.
  Es lo que la spec quiere: §4.8 invirtió esa invariante y §6.3 lo llama «rompe
  hacia atrás, a propósito». La aserción que sobrevive es la que la spec **sí**
  conserva. El rechazo real está probado contra la acción real. No queda hueco.
- **`tests/recalculo-alta-baja-y-cupo.test.ts`** — precondición, no aserción.
- **Order-dependence** — diagnóstico exacto y arreglo correcto **para quien use
  el helper**. Aviso para t05: `rejilla` corre con `vi.setSystemTime`, así que
  sus ligas quedan estampadas por delante del reloj real; `montaje.test.tsx`
  **debe** sembrar con `seedCalendarLeague()` o renderizará la liga de
  `rejilla`.
- **`package.json` / lock** — correcto y necesario; sin esto `npm ci` habría
  reventado. Las tres son `devDependencies` de test, que §6.3 no prohíbe.

---

## Cobertura real de la spec

**Cerrados:** 1-21, 23-28, 30-37, y las dos mitades de 34 por separado.
El 32 incluye su TOCTOU; el 25 se verifica contando filas de `Result` y
`AuditLog`.

**Abiertos:**

| Criterio | Estado | Va a |
|---|---|---|
| 22 | probado, no vivo (C1) | t05, con ampliación del contrato de t00 |
| 29 (UI) | vivo en `/calendario`, muerto en `/mis-partidas` (C2) | **t04, antes de commitear** |
| 34 punta a punta | las dos mitades cerradas por separado | t05 |
| 38 | comprobado estructuralmente; jsdom no hace layout | t05, en Playwright a 390px |
| 39 | gate verde | t05 |

**No-objetivos:** los doce comprobados, ninguno violado. Sin migración Prisma.
Sin dependencias de runtime nuevas.

---

## Lo que un gate verde no cubre

1. **Los dos criterios muertos (22 y 29-UI).** Tienen test verde porque el test
   pasa a mano las props que producción nunca pasa. Solo lo ve un test que
   recorra el camino.
2. **390px.** jsdom no calcula layout; hoy el criterio 38 es una heurística
   («no hay anchos fijos declarados»), no el criterio.
3. **`npm ci` desde cero.** El lock ya es correcto, pero nadie lo ha ejercitado
   en limpio.
4. **La hidratación de `/mis-partidas`.**
5. **El orden de ficheros a futuro**: el arreglo protege a los usuarios del
   helper, no a los demás.

---

## Observaciones de t02 para t05

1. **Partidas de playoff sin fecha invisibles en el caso común**: un mes de
   playoff solo es navegable si ya hay alguna partida de playoff **fechada**,
   así que con todas sin fechar no se listan en ninguna parte. El selector sí
   las ofrece, luego no hay callejón sin salida. Ningún criterio lo exige.
2. **Desviación de §4.11 documentada en vez de escalada**: el sufijo
   «· Playoffs» solo se pinta si el mes tiene contenido, para no titular así el
   mes vacío de §5.1. El razonamiento es bueno, pero el `PLAN.md` dice que una
   contradicción con la spec se escala, y decidirlo en un comentario es el
   hábito que el modelo paralelo intenta evitar.
3. **La consulta se ensancha más de lo que dice §4.1** (todas las sin fecha de
   la liga, y todas las del jugador). Justificado por el criterio 14 y acotado;
   anotado por si crece.
4. **Criterio 17 solo parcialmente vivo desde la página**: el selector de un
   admin no puede mover la partida *ya fechada* de otro jugador desde otro mes.
   Las sin fecha de cualquier ronda sí se le ofrecen, que es la lectura literal
   del criterio.

---

## Acciones

**Antes de commitear la ola:**
- t04 → cablear `resolution` en el `<ScheduleForm>` de `MatchCard`, con su test.
- `next-env.d.ts` fuera de la ola. ✔ hecho

**A t05:** C1 (criterio 22, con ampliación del contrato t00), endurecer el
selector `stub-` de `rejilla.test.tsx`, el guardián de `STUB_MARKER`, sembrar
`montaje.test.tsx` con `seedCalendarLeague()`, exportar `nextCreatedAt`, el
criterio 38 en Playwright, y decidir o escalar el hueco de los playoffs sin
fecha.

**Sin dueño, fuera de esta feature:** unificar el formateo de fechas de
`MatchCard` con `dayLabel`/`timeLabel`; quitar o cablear `onScheduled` en
`DayDetail`.
