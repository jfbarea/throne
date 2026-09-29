// @vitest-environment jsdom
//
// t05 · `integración` — el guardián de montaje de la feature
// "calendario-de-verdad" (plan/calendario-de-verdad/PLAN.md §t05).
//
// **Por qué existe este fichero.** En la PR #1 de este repo cuatro componentes
// pasaron sus tests y nunca estuvieron montados: el punto de extensión devolvía
// `null` y la suite siguió en verde. Pasó tres veces, y siempre por la misma
// razón — *el test verificaba la función, no el camino*. Es el modo de fallo
// propio de trabajar en paralelo contra puntos de montaje, y aquí se cierra por
// los dos lados:
//
//  1. **Negativo**: ningún marcador de stub sobrevive en `src/`. Los tres
//     componentes nuevos (`MonthGrid`, `DayDetail`, `DaySchedulePicker`)
//     nacieron como stubs que declaraban `STUB_MARKER =
//     "__STUB_SIN_IMPLEMENTAR__"` precisamente para que su desaparición fuera
//     comprobable. Hoy no queda ninguno: este test nace verde, y es un
//     guardián, no un hallazgo.
//  2. **Positivo**: el camino real de punta a punta, sin doblar nada de lo que
//     está bajo prueba. Se monta `/calendario` (Server Component, con filas
//     reales en `file:./test.db`), se clica un día, se elige una partida en el
//     selector, se llama al `setMatchSchedule` **de verdad**, y la fecha se lee
//     de vuelta en la base de datos y en la rejilla recargada.
//
// Se doblan sólo las dos cosas que no tienen sentido fuera de una petición:
// `next/cache` (`revalidatePath`) y `@/lib/guards` (la sesión, que vive en una
// cookie firmada). `@/lib/db` y las acciones de servidor son las reales — la
// misma convención de tests/guardas-fecha.test.ts.
//
// **La siembra es `seedCalendarLeague()`, obligatoriamente.** Las páginas
// resuelven "la liga" con `findFirst({ orderBy: { createdAt: "desc" } })`, y
// `tests/rejilla.test.tsx` corre con `vi.setSystemTime`, así que sus ligas
// quedan estampadas por delante del reloj real. Sembrar a mano aquí
// renderizaría la liga de aquel fichero; el helper compartido calcula el
// `createdAt` leyendo el máximo de la base de datos (`nextCreatedAt`).

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// --- Dobles, declarados antes de los imports que afectan --------------------

const sessionRef = vi.hoisted(() => ({
  current: { sub: "test", role: "PLAYER", playerId: null } as {
    sub: string;
    role: "ADMIN" | "PLAYER";
    playerId: string | null;
  },
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/guards", () => ({
  requireAuth: async () => sessionRef.current,
  requireAdmin: async () => ({ ...sessionRef.current, role: "ADMIN" }),
}));
// La cabecera resuelve la sesión por `cookies()`, que no existe aquí. No es
// parte de ningún camino que este fichero recorra.
vi.mock("@/components/AppHeader", () => ({ AppHeader: () => null }));

import { prisma } from "@/lib/db";
import CalendarioPage from "@/app/calendario/page";
import ClasificacionPage from "@/app/clasificacion/page";
import MisPartidasPage from "@/app/mis-partidas/page";
import { instantOnDay, scheduleBounds } from "@/server/calendar";
import {
  FIXTURE_DEADLINES,
  FIXTURE_START_MONTH,
  seedCalendarLeague,
  type SeededCalendar,
} from "./helpers/calendario";

// ---------------------------------------------------------------------------
// 1. El guardián negativo: ningún stub vivo en src/
// ---------------------------------------------------------------------------

/** Los dos nombres con los que t00 marcó sus stubs (TRACKS.md §T0). */
const STUB_NEEDLES = ["STUB_MARKER", "__STUB_SIN_IMPLEMENTAR__"];

const SRC_DIR = path.resolve(process.cwd(), "src");
/** Cliente Prisma generado: no lo escribe nadie, y pesa megas. */
const SKIPPED_DIRS = new Set(["generated", "node_modules"]);
const SCANNED_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".css"]);

function sourceFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (SKIPPED_DIRS.has(entry)) continue;
      found.push(...sourceFiles(full));
      continue;
    }
    if (SCANNED_EXTENSIONS.has(path.extname(entry))) found.push(full);
  }
  return found;
}

describe("Montaje: ningún stub sobrevive en src/", () => {
  it("recorre src/ de verdad (si el barrido se rompiera, no encontraría nada que mirar)", () => {
    const files = sourceFiles(SRC_DIR).map((f) => path.relative(SRC_DIR, f));
    expect(files.length).toBeGreaterThan(30);
    // Los tres componentes que nacieron como stubs tienen que estar entre los
    // ficheros barridos, o este guardián no guarda nada.
    for (const expected of [
      "app/calendario/MonthGrid.tsx",
      "app/calendario/DayDetail.tsx",
      "app/calendario/DaySchedulePicker.tsx",
    ]) {
      expect(files).toContain(expected);
    }
  });

  it("no queda ningún STUB_MARKER ni __STUB_SIN_IMPLEMENTAR__", () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(SRC_DIR)) {
      const contents = readFileSync(file, "utf8");
      for (const needle of STUB_NEEDLES) {
        if (contents.includes(needle)) {
          offenders.push(`${path.relative(process.cwd(), file)} → ${needle}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 2. El camino real, de punta a punta
// ---------------------------------------------------------------------------

const NOVEMBER = "2026-11";
/** Un sábado de noviembre que la fixture deja vacío. */
const TARGET_DAY = "2026-11-21";

let seeded: SeededCalendar;

async function renderCalendario(mes: string) {
  return render(
    await CalendarioPage({ searchParams: Promise.resolve({ mes }) })
  );
}

function cell(dayKey: string): HTMLElement {
  return screen.getByTestId(`day-${dayKey}`);
}

beforeEach(async () => {
  seeded = await seedCalendarLeague();
  sessionRef.current = {
    sub: "alice",
    role: "PLAYER",
    playerId: seeded.players.alice,
  };
});

describe("Montaje: de /calendario a la fecha puesta, por el camino real", () => {
  it("clicar un día abre el selector, elegir una partida la agenda y la rejilla la enseña", async () => {
    const user = userEvent.setup();
    const view = await renderCalendario(NOVEMBER);

    // El día está vacío antes de nada.
    expect(cell(TARGET_DAY).getAttribute("data-matches")).toBe("0");

    // 1. Tocar el día despliega su detalle con el selector dentro
    //    (MonthGrid → DayDetail → DaySchedulePicker, §4.5, criterio 15).
    await user.click(cell(TARGET_DAY));
    const detail = screen.getByTestId("day-detail");
    expect(detail.getAttribute("data-day")).toBe(TARGET_DAY);
    const picker = within(detail).getByTestId("day-schedule-picker");

    // 2. Abrir el selector y elegir la partida de Alice sin fecha.
    await user.click(
      within(picker).getByRole("button", { name: /Agendar aquí/i })
    );

    // La lista llega agrupada por ronda también por el camino real (t07): las
    // cabeceras salen de los `roundIndex` que la página pasa al selector, no de
    // props puestas a mano en un test de componente.
    const headings = within(picker)
      .getAllByTestId("candidate-group")
      .map((h) => h.textContent ?? "");
    expect(headings.length).toBeGreaterThan(0);
    for (const heading of headings) {
      expect(heading).toMatch(/^(Ronda \d+|Sin ronda)$/);
    }

    const candidate = within(picker)
      .getAllByRole("button")
      .find((b) => (b.textContent ?? "").includes("Alice vs Carol"));
    expect(candidate, "el selector no ofrece la partida sin fecha de Alice").toBeDefined();
    await user.click(candidate!);

    // 3. Confirmar. Esto llama al `setMatchSchedule` REAL, que escribe en
    //    file:./test.db pasando por `canScheduleAt` como en producción.
    await user.click(
      within(picker).getByRole("button", { name: /^Agendar aquí$/ })
    );

    await waitFor(async () => {
      const row = await prisma.match.findUniqueOrThrow({
        where: { id: seeded.matches.openNoDate },
        select: { scheduledAt: true },
      });
      expect(row.scheduledAt?.toISOString()).toBe(
        instantOnDay(TARGET_DAY, "20:00").toISOString()
      );
    });

    // 4. Y la rejilla recargada la pinta en ese día, con su hora.
    view.unmount();
    await renderCalendario(NOVEMBER);
    const day = cell(TARGET_DAY);
    expect(day.getAttribute("data-matches")).toBe("1");
    expect(
      within(day).getByTestId("day-dot").getAttribute("data-match-id")
    ).toBe(seeded.matches.openNoDate);

    await user.click(day);
    const reloaded = screen.getByTestId("day-detail");
    expect(reloaded.textContent).toContain("Sábado 21 de noviembre");
    expect(reloaded.textContent).toContain("20:00");
  });

  it("un día del que la sesión no puede llevar nada no abre selector (criterio 16)", async () => {
    // Carol no participa en ninguna partida de la ronda 3 ni posterior, y la
    // ronda 1 está cerrada; en diciembre (ronda 3) no tiene nada que llevar.
    sessionRef.current = {
      sub: "carol",
      role: "PLAYER",
      playerId: seeded.players.carol,
    };
    const user = userEvent.setup();
    await renderCalendario("2026-12");

    await user.click(cell("2026-12-31"));
    const detail = screen.getByTestId("day-detail");
    expect(within(detail).queryByTestId("day-schedule-picker")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 3. Criterio 22, vivo desde la página (no con props puestas a mano)
// ---------------------------------------------------------------------------

/**
 * `datetime-local` no tiene zona: su `value`, su `min` y su `max` son reloj
 * local del navegador, y así los construye `ScheduleForm`. La aritmética se
 * repite aquí a propósito, para cazar un "arreglo" que formateara las cotas en
 * `Europe/Madrid` (bajo `TZ=UTC` daría otra cadena).
 */
function toLocalInputValue(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

describe("AC-22 (vivo, desde la página): el datetime-local sale con min y max", () => {
  it("/calendario: la fila de una partida de la ronda 2 trae las dos cotas", async () => {
    const user = userEvent.setup();
    await renderCalendario(NOVEMBER);

    const row = screen
      .getByTestId("unscheduled-block")
      .querySelector<HTMLElement>(
        `[data-match-id='${seeded.matches.openNoDate}']`
      );
    expect(row).not.toBeNull();

    await user.click(within(row!).getByRole("button", { name: /Fecha/i }));
    const input = within(row!).getByLabelText(
      "Fecha y hora"
    ) as HTMLInputElement;

    const bounds = scheduleBounds(FIXTURE_START_MONTH, FIXTURE_DEADLINES.r2);
    expect(input.getAttribute("min")).toBe(toLocalInputValue(bounds.min!));
    expect(input.getAttribute("max")).toBe(toLocalInputValue(bounds.max!));
  });

  it("/calendario: la partida de playoff trae suelo pero no techo (§4.11)", async () => {
    const user = userEvent.setup();
    await renderCalendario("2027-01");

    await user.click(cell("2027-01-10"));
    const row = within(screen.getByTestId("day-detail")).getByTestId(
      "match-row"
    );
    expect(row.getAttribute("data-match-id")).toBe(seeded.matches.playoff);

    await user.click(within(row).getByRole("button", { name: /Fecha/i }));
    const input = within(row).getByLabelText(
      "Fecha y hora"
    ) as HTMLInputElement;

    expect(input.getAttribute("max")).toBeNull();
    expect(input.getAttribute("min")).toBe(
      toLocalInputValue(scheduleBounds(FIXTURE_START_MONTH, null).min!)
    );
  });

  it("/mis-partidas: la tarjeta monta el mismo formulario con las mismas cotas", async () => {
    const user = userEvent.setup();
    render(await MisPartidasPage());

    // El bloque de la ronda 3, que para Alice tiene una sola partida (la del
    // 31 de diciembre). Se localiza por la ronda y no por los nombres porque
    // Alice juega contra Bob más de una vez.
    const round3 = screen
      .getByText(/^Ronda 3 ·/)
      .closest("details") as HTMLElement | null;
    expect(round3, "no hay bloque de la ronda 3 en /mis-partidas").not.toBeNull();

    // partidas-por-jornada §4.1: only the current round starts open, and in
    // this fixture that is not round 3.
    await user.click(round3!.querySelector("summary")!);
    await user.click(
      within(round3!).getByRole("button", { name: /Poner fecha|Cambiar fecha/ })
    );
    const input = within(round3!).getByLabelText(
      "Fecha y hora"
    ) as HTMLInputElement;

    // Las cotas son las de SU ronda, no las del mes visible de ninguna vista.
    const bounds = scheduleBounds(FIXTURE_START_MONTH, FIXTURE_DEADLINES.r3);
    expect(input.getAttribute("min")).toBe(toLocalInputValue(bounds.min!));
    expect(input.getAttribute("max")).toBe(toLocalInputValue(bounds.max!));
  });
});

// ---------------------------------------------------------------------------
// 4. Criterio 34, la mitad que ninguna tarea probó: la clasificación
// ---------------------------------------------------------------------------

/**
 * §5.9 promete tres cosas de un `Result` PLAYED sin fecha anterior a la spec, y
 * dos tenían dueño: se ve marcado «jugada, falta la fecha» (t02) y editarlo
 * obliga a fechar la partida primero (t01). La tercera — **«sigue contando en
 * la clasificación exactamente igual»** — no la afirmaba ningún test: se daba
 * por cierta porque `computeStandings` nunca ha mirado `scheduledAt`. Es una
 * buena razón, pero es un razonamiento, no una comprobación, y es justo el tipo
 * de cosa que una guarda nueva rompe en silencio.
 */
describe("AC-34 (clasificación): el PLAYED sin fecha sigue contando", () => {
  it("la partida legacy de Bob (70-55 fuera de casa) está en su fila de /clasificacion", async () => {
    sessionRef.current = { sub: "admin", role: "ADMIN", playerId: null };
    render(await ClasificacionPage());

    const row = screen
      .getAllByText("Bob")[0]
      .closest("tr") as HTMLElement | null;
    expect(row, "no hay fila de Bob en la clasificación").not.toBeNull();
    const cells = Array.from(row!.querySelectorAll("td")).map((td) =>
      (td.textContent ?? "").trim()
    );

    // Columnas de la tabla: #, jugador, PJ, V, E, D, Pts, VP+, VP-, Dif.
    // Bob tiene dos partidas resueltas en la fixture: la de la ronda 1
    // (60 a favor, 80 en contra, derrota) y la legacy **sin fecha** (70 a
    // favor, 55 en contra, victoria). Sin la segunda sería PJ 1, VP+ 60,
    // VP- 80 — y ninguna de estas tres cifras cuadraría.
    expect(cells[1]).toBe("Bob");
    expect(cells[2]).toBe("2"); // PJ
    expect(cells[7]).toBe("130"); // VP+ = 60 + 70
    expect(cells[8]).toBe("135"); // VP- = 80 + 55
  });
});
