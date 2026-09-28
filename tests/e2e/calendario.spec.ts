/**
 * E2E — la rejilla de `/calendario` a 390px (criterio 38 de
 * plan/specs/calendario-de-verdad.md §8, §7 "mobile-first de verdad").
 *
 * **Por qué este fichero existe.** Hasta t05 el criterio 38 estaba comprobado
 * *estructuralmente* en jsdom: ni anchos fijos declarados, ni `overflow-x`, ni
 * celdas sin `min-w-0`. Eso es una heurística sobre las causas habituales del
 * desbordamiento, no el criterio — jsdom no calcula layout, así que allí
 * `scrollWidth` siempre vale 0 y "cabe en 390px" no se puede afirmar. Aquí sí:
 * un navegador de verdad, un viewport de 390px, y la medida que el criterio
 * pide — que el **documento** no scrollee en horizontal.
 *
 * Se mide en tres estados, porque son tres layouts distintos:
 *   1. la rejilla sola;
 *   2. la rejilla con un día desplegado (§4.3, el detalle debajo);
 *   3. el detalle con el selector del día abierto (§4.5), que es lo más ancho
 *      que esta pantalla llega a pintar.
 *
 * Y además de la medida del documento, la de §7 al pie de la letra: ni la
 * rejilla ni el detalle scrollean por su cuenta — "el que scrollea es el
 * documento".
 *
 * Estado previo: el mismo `e2e.db` que comparte toda la carpeta. Playwright
 * recorre los ficheros por orden alfabético, así que **este corre antes que
 * full-journey.spec.ts** y no puede dar por hecho que la liga tenga partidas:
 * recién sembrada está en SETUP, y sin ninguna partida ningún día de la rejilla
 * acepta interacción (§4.5: un día al que no se puede llevar nada no reacciona),
 * con lo que no habría detalle ni selector que medir. `ensurePairings` lo
 * resuelve generando los emparejamientos si no los hay — idempotente, y sin
 * consecuencia para full-journey, que vuelve a generarlos tras dar de alta sus
 * cinco jugadores de escala.
 */

import { test, expect, type Page } from "@playwright/test";

const ADMIN_PASSCODE = "admin-e2e-passcode-secret";

/** El ancho que la spec nombra (§7): el móvil más estrecho que hay que servir. */
const NARROW = { width: 390, height: 844 };

async function loginAdmin(page: Page) {
  await page.goto("/login");
  await page.getByRole("tab", { name: "Admin" }).click();
  await page.getByLabel("Clave de administrador").fill(ADMIN_PASSCODE);
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page).toHaveURL(/\/admin$/);
}

/**
 * Deja la liga con partidas generadas si todavía no las tiene. No toca nada si
 * ya existen (el botón pasa a decir "Regenerar", y se deshabilita en cuanto hay
 * resultados apuntados).
 */
async function ensurePairings(page: Page) {
  await page.goto("/calendario");
  const empty = await page
    .getByText("Todavía no hay partidas generadas")
    .isVisible({ timeout: 3_000 })
    .catch(() => false);
  if (!empty) return;

  await page.goto("/admin/emparejamientos");
  const generate = page.getByRole("button", {
    name: /^Generar emparejamientos$/,
  });
  if (await generate.isEnabled().catch(() => false)) {
    await generate.click();
    await page.waitForLoadState("networkidle");
  }
}

/**
 * Cuánto se sale el documento del viewport, en px. 0 o negativo = no hay scroll
 * horizontal. Se compara `documentElement.scrollWidth` contra `clientWidth`, no
 * contra la constante 390: así la aserción sigue siendo cierta si el viewport
 * efectivo cambia (barra de scroll vertical incluida).
 */
async function documentOverflow(page: Page): Promise<number> {
  return page.evaluate(() => {
    const doc = document.documentElement;
    return Math.max(
      doc.scrollWidth - doc.clientWidth,
      document.body.scrollWidth - doc.clientWidth
    );
  });
}

/** Cuánto se sale un elemento de su propia caja: >0 significa scroll propio. */
async function selfOverflow(page: Page, testId: string): Promise<number> {
  return page.evaluate((id) => {
    const el = document.querySelector(`[data-testid='${id}']`);
    if (el === null) return -1;
    return el.scrollWidth - el.clientWidth;
  }, testId);
}

test.describe("AC-38: la rejilla y el detalle caben en 390px sin scroll horizontal", () => {
  test.use({ viewport: NARROW });

  test.beforeEach(async ({ page }) => {
    await page.context().clearCookies();
    await loginAdmin(page);
    await ensurePairings(page);
  });

  test("la rejilla sola no desborda el documento", async ({ page }) => {
    await page.goto("/calendario");
    await expect(page.getByTestId("month-grid")).toBeVisible();
    await expect(page.getByTestId("grid-cells")).toBeVisible();

    expect(await documentOverflow(page)).toBeLessThanOrEqual(1);
    // §7: la rejilla no tiene scroll propio; el que scrollea es el documento.
    expect(await selfOverflow(page, "grid-cells")).toBeLessThanOrEqual(1);
    expect(await selfOverflow(page, "month-grid")).toBeLessThanOrEqual(1);
  });

  test("las 7 columnas caben enteras y la celda sigue siendo tocable", async ({
    page,
  }) => {
    await page.goto("/calendario");
    const grid = page.getByTestId("grid-cells");
    await expect(grid).toBeVisible();

    const gridBox = (await grid.boundingBox())!;
    expect(gridBox.width).toBeLessThanOrEqual(NARROW.width);

    // Una semana entera: siete celdas, ninguna fuera del viewport por la
    // derecha, y ninguna tan estrecha que deje de ser un objetivo táctil (§7:
    // "la celda es el objetivo táctil").
    const cells = page.locator("[data-in-month]");
    const count = await cells.count();
    expect(count).toBeGreaterThanOrEqual(28);

    for (let i = 0; i < 7; i++) {
      const box = (await cells.nth(i).boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(NARROW.width + 1);
      expect(box.width).toBeGreaterThanOrEqual(36);
      // Las celdas son cuadradas (`aspect-square`), así que el alto acompaña.
      expect(box.height).toBeGreaterThanOrEqual(36);
    }
  });

  test("con un día desplegado, el detalle tampoco desborda", async ({ page }) => {
    await page.goto("/calendario");
    await expect(page.getByTestId("month-grid")).toBeVisible();

    const day = page.locator('[data-in-month="true"]:not([disabled])').first();
    await expect(day).toBeVisible();
    await day.click();

    const detail = page.getByTestId("day-detail");
    await expect(detail).toBeVisible();

    expect(await documentOverflow(page)).toBeLessThanOrEqual(1);
    // §5.3: el detalle lista todas las partidas del día, sin scroll propio.
    expect(await selfOverflow(page, "day-detail")).toBeLessThanOrEqual(1);

    const box = (await detail.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(NARROW.width + 1);
  });

  test("con el selector del día abierto —lo más ancho de la pantalla— sigue cabiendo", async ({
    page,
  }) => {
    await page.goto("/calendario");
    await expect(page.getByTestId("month-grid")).toBeVisible();

    const day = page.locator('[data-in-month="true"]:not([disabled])').first();
    await day.click();

    const picker = page.getByTestId("day-schedule-picker");
    await expect(picker).toBeVisible();
    await picker.getByRole("button", { name: /^Agendar aquí ·/ }).click();

    // La lista de candidatas, que es donde vive el texto más largo de la vista
    // ("Ahora: Sábado 14 de noviembre · 20:00 — se mueve aquí").
    await expect(picker.getByRole("list")).toBeVisible();

    expect(await documentOverflow(page)).toBeLessThanOrEqual(1);
    expect(await selfOverflow(page, "day-schedule-picker")).toBeLessThanOrEqual(
      1
    );

    const box = (await picker.boundingBox())!;
    expect(box.x + box.width).toBeLessThanOrEqual(NARROW.width + 1);
  });
});
