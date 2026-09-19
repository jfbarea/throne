/**
 * E2E — /rondas access control (SPEC §4.6, criterio 13).
 * Hito 6 (ui-cupo-y-rondas, plan/rondas-con-fecha/PLAN.md).
 *
 * /rondas is protected with requireAuth, same as /clasificacion,
 * /calendario and /bracket — not public like /bases. Separate from
 * full-journey.spec.ts on purpose (that file's rewrite for the rondas flow
 * is Hito 10's job, per PLAN.md; this hito only adds what criterio 13
 * actually needs).
 *
 * Multi-liga Z1 (seed-y-e2e-con-dos-ligas): `/rondas` is now the legacy,
 * unslugged route — it still responds (spec §5.10), but redirects
 * (`redirectToOwnLeaguePage`, src/app/_lib/legacy-route-redirect.ts, spec
 * §4.3) instead of rendering directly. A PLAYER session lands on
 * `/liga/<su-slug>/rondas`; an ADMIN session is sent to `/admin` — there is
 * no "their league" to fall back to for an admin (spec §2.3) — which is a
 * behaviour change from before multi-liga (the admin used to stay on
 * `/rondas` directly, back when it was the one and only league's page).
 */

import { test, expect } from "@playwright/test";
import {
  E2E_ADMIN_PASSCODE as ADMIN_PASSCODE,
  E2E_PLAYER_PASSCODE as PLAYER_PASSCODE,
  LEAGUE_A_SLUG,
} from "./seed-data";

const PLAYER1_NAME = "Jugador Alfa";

test.describe("AC-13: /rondas — requireAuth", () => {
  test("sin sesión, /rondas redirige a /login", async ({ page }) => {
    await page.goto("/rondas");
    await expect(page).toHaveURL(/\/login$/);
  });

  test("con sesión de jugador, /rondas redirige a /liga/<su-slug>/rondas", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Tu nombre").fill(PLAYER1_NAME);
    await page.getByLabel("Código de acceso").fill(PLAYER_PASSCODE);
    await page.getByRole("button", { name: "Entrar" }).click();
    await expect(page).toHaveURL(
      new RegExp(`/liga/${LEAGUE_A_SLUG}/mis-partidas$`)
    );

    await page.goto("/rondas");
    await expect(page).toHaveURL(new RegExp(`/liga/${LEAGUE_A_SLUG}/rondas$`));
    await expect(page.locator("body")).toContainText(/Rondas|Calendario de la liga/i);
  });

  test("con sesión de admin, /rondas redirige a /admin (no hay liga implícita)", async ({ page }) => {
    await page.goto("/login");
    await page.getByRole("tab", { name: "Admin" }).click();
    await page.getByLabel("Clave de administrador").fill(ADMIN_PASSCODE);
    await page.getByRole("button", { name: "Entrar" }).click();
    await expect(page).toHaveURL(/\/admin$/);

    // Multi-liga spec §2.3, §4.3, criterio 8: an ADMIN session has no
    // implicit "current league" to resolve `/rondas` against — unlike a
    // player, who always has exactly one — so it goes to the league index
    // instead, same as every other legacy route for this role.
    await page.goto("/rondas");
    await expect(page).toHaveURL(/\/admin$/);
  });
});
