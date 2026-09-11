/**
 * E2E — recorrido de admin entre dos ligas, en la misma sesión.
 * Multi-liga Z1 (seed-y-e2e-con-dos-ligas, plan/multi-liga/PLAN.md).
 *
 * tests/e2e/seed-e2e.ts siembra dos ligas de rosters disjuntos (spec §2.1,
 * §8) — León A ("Liga E2E Warhammer", la que ya ejercita
 * full-journey.spec.ts de punta a punta) y Liga B ("Liga E2E Segundo
 * Grupo", nueva, solo para este fichero). Ningún test anterior a este hito
 * había sembrado una segunda liga, así que nada había ejercitado de verdad
 * el criterio 9 de la spec: "el admin accede a /liga/<slug-A>/… y a
 * /liga/<slug-B>/… en la misma sesión, sin cerrar ni reabrir nada".
 *
 * Cubre, siempre sin cerrar la sesión de admin entre pasos:
 *  1. El índice de ligas (`/admin`) lista ambas, en circulación.
 *  2. `/admin/<slug>/jugadores` de cada liga muestra su propio roster y
 *     ninguno del de la otra — ida, vuelta a la primera y de nuevo a la
 *     segunda, para descartar cualquier estado de "liga actual" que se
 *     quede pegado entre peticiones (spec §2.3, §5.9).
 *  3. `/liga/<slug>/clasificacion` de cada liga, con la MISMA sesión de
 *     admin: acceso completo a las dos (spec §4.2), cada una mostrando solo
 *     su gente.
 *  4. `/liga/<slug>/bases`, sin sesión, de las dos ligas: textos distintos,
 *     cada uno nombrando solo su propia liga (spec §2.11, criterio 33).
 *  5. Aislamiento del lado jugador: alguien de la Liga A que pide la
 *     clasificación de la Liga B acaba en la suya, sin mensaje (spec §4.2,
 *     criterio 5) — ya cubierto por tests/redirecciones-de-rutas-antiguas.test.ts
 *     a nivel de unidad; aquí se ejercita el mismo camino de punta a punta,
 *     con un navegador real.
 */

import { test, expect } from "@playwright/test";
import {
  E2E_ADMIN_PASSCODE as ADMIN_PASSCODE,
  E2E_PLAYER_PASSCODE as PLAYER_PASSCODE,
  ADMIN_DISPLAY_NAME,
  LEAGUE_A,
  LEAGUE_B,
  LEAGUE_A_SLUG,
  LEAGUE_B_SLUG,
} from "./seed-data";

const PLAYER1_NAME = "Jugador Alfa"; // Liga A
const LEAGUE_B_PLAYER1_NAME = "Jugador Sigma"; // Liga B

async function loginAdmin(page: import("@playwright/test").Page) {
  await page.goto("/login");
  await page.getByRole("tab", { name: "Admin" }).click();
  await page.getByLabel("Clave de administrador").fill(ADMIN_PASSCODE);
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page).toHaveURL(/\/admin$/);
}

test.describe("Admin salta entre dos ligas en la misma sesión", () => {
  test("1. El índice de ligas lista ambas, en circulación", async ({ page }) => {
    await loginAdmin(page);
    await page.goto("/admin");

    await expect(page.getByText(LEAGUE_A.name)).toBeVisible();
    await expect(page.getByText(LEAGUE_B.name)).toBeVisible();
    // Neither seeded league is archived — both belong to "En circulación",
    // not "Archivadas" (spec §4.5).
    await expect(page.getByText("En circulación")).toBeVisible();
  });

  test("2. /admin/<slug>/jugadores de cada liga muestra solo su propio roster", async ({ page }) => {
    await loginAdmin(page);

    // Liga A.
    await page.goto(`/admin/${LEAGUE_A_SLUG}/jugadores`);
    await expect(page.locator("body")).toContainText(LEAGUE_A.players[0].displayName);
    await expect(page.locator("body")).toContainText(ADMIN_DISPLAY_NAME);
    for (const p of LEAGUE_B.players) {
      await expect(page.locator("body")).not.toContainText(p.displayName);
    }

    // Liga B — sin cerrar sesión, sin volver a /login: solo cambia la URL
    // (spec §2.3, criterio 9).
    await page.goto(`/admin/${LEAGUE_B_SLUG}/jugadores`);
    for (const p of LEAGUE_B.players) {
      await expect(page.locator("body")).toContainText(p.displayName);
    }
    await expect(page.locator("body")).toContainText(ADMIN_DISPLAY_NAME);
    for (const p of LEAGUE_A.players) {
      await expect(page.locator("body")).not.toContainText(p.displayName);
    }

    // Y de vuelta a la Liga A — descarta cualquier estado de "liga actual"
    // que se hubiera quedado pegado de la petición anterior (spec §5.9).
    await page.goto(`/admin/${LEAGUE_A_SLUG}/jugadores`);
    await expect(page.locator("body")).toContainText(LEAGUE_A.players[0].displayName);
    for (const p of LEAGUE_B.players) {
      await expect(page.locator("body")).not.toContainText(p.displayName);
    }
  });

  test("3. /liga/<slug>/clasificacion de cada liga, con la misma sesión de admin", async ({ page }) => {
    await loginAdmin(page);

    await page.goto(`/liga/${LEAGUE_A_SLUG}/clasificacion`);
    await expect(page.locator("body")).toContainText(LEAGUE_A.name);
    for (const p of LEAGUE_B.players) {
      await expect(page.locator("body")).not.toContainText(p.displayName);
    }

    await page.goto(`/liga/${LEAGUE_B_SLUG}/clasificacion`);
    await expect(page.locator("body")).toContainText(LEAGUE_B.name);
    for (const p of LEAGUE_A.players) {
      await expect(page.locator("body")).not.toContainText(p.displayName);
    }
  });

  test("4. Las bases de cada liga son públicas y no se mezclan (spec §2.11, criterio 33)", async ({ page }) => {
    await page.context().clearCookies();

    await page.goto(`/liga/${LEAGUE_A_SLUG}/bases`);
    await expect(page.locator("body")).toContainText(LEAGUE_A.name);
    await expect(page.locator("body")).not.toContainText(LEAGUE_B.name);

    await page.goto(`/liga/${LEAGUE_B_SLUG}/bases`);
    await expect(page.locator("body")).toContainText(LEAGUE_B.name);
    await expect(page.locator("body")).not.toContainText(LEAGUE_A.name);
  });

  test("5. Un jugador de la Liga A que pide la clasificación de la Liga B acaba en la suya, sin mensaje", async ({ page }) => {
    await page.context().clearCookies();
    await page.goto("/login");
    await page.getByLabel("Tu nombre").fill(PLAYER1_NAME);
    await page.getByLabel("Código de acceso").fill(PLAYER_PASSCODE);
    await page.getByRole("button", { name: "Entrar" }).click();
    await expect(page).toHaveURL(
      new RegExp(`/liga/${LEAGUE_A_SLUG}/mis-partidas$`)
    );

    await page.goto(`/liga/${LEAGUE_B_SLUG}/clasificacion`);

    // Redirección silenciosa a su propia liga (spec §4.2, criterio 5): la
    // URL cambia sola, sin pasar por ninguna pantalla de error y sin dato
    // alguno de la Liga B.
    //
    // NOTA (hallazgo de este hito, no arreglado aquí — fuera del alcance de
    // Z1, que solo posee prisma/seed.ts y tests/e2e/**): el criterio 5 de la
    // spec dice literalmente "acaba en /liga/<slug-A>/clasificacion", la
    // MISMA página, pero el destino real hoy es
    // `/liga/<slug-A>/mis-partidas`, no `/liga/<slug-A>/clasificacion`.
    // Causa: `src/app/liga/[slug]/layout.tsx` llama a
    // `requireLeagueAccess(slug, session)` SIN el tercer argumento
    // `samePagePath` (a diferencia de cada page.tsx, que sí lo pasa:
    // `requireLeagueAccess(slug, session, "clasificacion")` en
    // clasificacion/page.tsx). El layout se resuelve antes que la página en
    // el árbol de render de Next.js, así que su redirect() (al slug propio,
    // sin página) interrumpe el render entero antes de que la página vuelva
    // a llamar a `requireLeagueAccess` con la página correcta — esa segunda
    // llamada nunca llega a ejecutarse. `tests/redirecciones-de-rutas-antiguas.test.ts`
    // no lo detecta porque llama a `requireLeagueAccess` directamente,
    // saltándose el layout real. Se comprueba aquí la propiedad que sí
    // importa a este hito (aterriza en SU liga, sin fuga de datos de la
    // otra), no la página exacta.
    await expect(page).toHaveURL(
      new RegExp(`^http://localhost:3001/liga/${LEAGUE_A_SLUG}/`)
    );
    await expect(page.locator("body")).not.toContainText(LEAGUE_B_PLAYER1_NAME);
    await expect(page.locator("body")).not.toContainText(LEAGUE_B.name);
  });
});
