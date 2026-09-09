/**
 * E2E — /rondas access control (SPEC §4.6, criterio 13).
 * Hito 6 (ui-cupo-y-rondas, plan/rondas-con-fecha/PLAN.md).
 *
 * /rondas is protected with requireAuth, same as /clasificacion,
 * /calendario and /bracket — not public like /bases. Separate from
 * full-journey.spec.ts on purpose (that file's rewrite for the rondas flow
 * is Hito 10's job, per PLAN.md; this hito only adds what criterio 13
 * actually needs).
 */

import { test, expect } from "@playwright/test";

const ADMIN_PASSCODE = "admin-e2e-passcode-secret";
const PLAYER_PASSCODE = "player-e2e-123";
const PLAYER1_NAME = "Jugador Alfa";

test.describe("AC-13: /rondas — requireAuth", () => {
  test("sin sesión, /rondas redirige a /login", async ({ page }) => {
    await page.goto("/rondas");
    await expect(page).toHaveURL(/\/login$/);
  });

  test("con sesión de jugador, /rondas es accesible", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Tu nombre").fill(PLAYER1_NAME);
    await page.getByLabel("Código de acceso").fill(PLAYER_PASSCODE);
    await page.getByRole("button", { name: "Entrar" }).click();
    await expect(page).toHaveURL(/\/mis-partidas$/);

    await page.goto("/rondas");
    await expect(page).toHaveURL(/\/rondas$/);
    await expect(page.locator("body")).toContainText(/Rondas|Calendario de la liga/i);
  });

  test("con sesión de admin, /rondas es accesible", async ({ page }) => {
    await page.goto("/login");
    await page.getByRole("tab", { name: "Admin" }).click();
    await page.getByLabel("Clave de administrador").fill(ADMIN_PASSCODE);
    await page.getByRole("button", { name: "Entrar" }).click();
    await expect(page).toHaveURL(/\/admin$/);

    await page.goto("/rondas");
    await expect(page).toHaveURL(/\/rondas$/);
  });
});
