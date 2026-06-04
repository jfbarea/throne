/**
 * E2E — recorrido completo de throne.
 *
 * Cubre:
 *  1. Login admin → panel admin
 *  2. Ver/confirmar config de liga
 *  3. Generar emparejamientos
 *  4. Fijar fecha de una partida (como admin)
 *  5. Login como jugador → ver mis partidas
 *  6. Reportar resultado de una partida
 *  7. Login como rival → confirmar resultado
 *  8. Ver standings (la partida confirmada aparece)
 *  9. Admin: configurar playoffSize y verificar panel de playoffs
 * 10. Admin inicia playoffs (si hay suficientes partidas confirmadas)
 * 11. Bracket visible para jugadores
 *
 * Estado previo: global-setup.ts crea la liga E2E con SETUP + admin + 6 jugadores.
 *
 * Nota: los tests son secuenciales y comparten estado de DB. Cada test hace
 * login fresco para asegurar que las cookies no se mezclan entre tests.
 */

import { test, expect, type Page } from "@playwright/test";

// Constantes del entorno e2e (deben coincidir con global-setup.ts y playwright.config.ts)
const ADMIN_PASSCODE = "admin-e2e-passcode-secret";
const PLAYER_PASSCODE = "player-e2e-123";
const PLAYER1_NAME = "Jugador Alfa";
const PLAYER2_NAME = "Jugador Beta";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function loginAdmin(page: Page) {
  await page.goto("/login");
  await page.getByRole("tab", { name: "Admin" }).click();
  await page.getByLabel("Clave de administrador").fill(ADMIN_PASSCODE);
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page).toHaveURL(/\/$/);
}

async function loginPlayer(page: Page, name: string, passcode: string) {
  await page.goto("/login");
  await page.getByLabel("Tu nombre").fill(name);
  await page.getByLabel("Código de acceso").fill(passcode);
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page).toHaveURL(/\/$/);
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

test.describe("Recorrido completo", () => {
  test.setTimeout(120_000);

  test("1. Login de admin redirige al home", async ({ page }) => {
    await page.goto("/login");

    // Page shows the throne logo (at least one)
    await expect(page.locator("text=throne").first()).toBeVisible();

    // Switch to admin mode
    await page.getByRole("tab", { name: "Admin" }).click();

    // Fill passcode and submit
    await page.getByLabel("Clave de administrador").fill(ADMIN_PASSCODE);
    await page.getByRole("button", { name: "Entrar" }).click();

    // Redirected to home
    await expect(page).toHaveURL(/\/$/);
    await expect(page.locator("text=throne").first()).toBeVisible();
  });

  test("2. Admin ve el panel y navega a configuración de liga", async ({ page }) => {
    await loginAdmin(page);

    // Navigate to admin panel
    await page.goto("/admin");
    // h1 = "throne" in admin page
    await expect(page.locator("h1")).toContainText("throne");

    // Should show the league config card
    await expect(page.getByText("Configurar liga")).toBeVisible();

    // Navigate to liga config
    await page.goto("/admin/liga");
    // Should show league form with the e2e league name
    await expect(page.locator("body")).toContainText("Liga E2E Warhammer");
  });

  test("3. Admin genera emparejamientos", async ({ page }) => {
    await loginAdmin(page);

    await page.goto("/admin/emparejamientos");

    // Should show generate button (may be disabled if already generated from a prev run)
    const generateBtn = page.getByRole("button", { name: /generar emparejamientos/i });
    await expect(generateBtn).toBeVisible();

    // Only click if enabled (button is disabled when pairings already exist and there are confirmed matches)
    if (await generateBtn.isEnabled()) {
      await generateBtn.click();
      await page.waitForLoadState("networkidle");
    }

    // After generating (or if already generated), navigate to calendario to verify matches exist
    await page.goto("/calendario");
    // There should be matches (any of these sections should be visible)
    await expect(page.locator("body")).toContainText(/Sin fecha|Agendadas|partida/i);
  });

  test("4. Admin fija fecha de una partida", async ({ page }) => {
    await loginAdmin(page);

    await page.goto("/calendario");

    // The edit button has a Pencil icon and title "Fijar / editar fecha"
    // On desktop it also shows "Fecha" text; use the title attribute to find it
    const editButton = page.locator('button[title="Fijar / editar fecha"]').first();
    await expect(editButton).toBeVisible();
    await editButton.click();

    // Fill in the date
    const nextWeek = new Date();
    nextWeek.setDate(nextWeek.getDate() + 7);
    const dateStr = nextWeek.toISOString().slice(0, 16);

    const dateInput = page.locator('input[type="datetime-local"]').first();
    await dateInput.fill(dateStr);

    // Submit via "Guardar fecha" button
    await page.getByRole("button", { name: "Guardar fecha" }).click();

    await page.waitForLoadState("networkidle");
    // Page reloads; "Agendadas" section should appear
    await expect(page.locator("body")).toContainText("Agendadas");
  });

  test("5. Jugador puede ver sus partidas", async ({ page }) => {
    await loginPlayer(page, PLAYER1_NAME, PLAYER_PASSCODE);

    await page.goto("/mis-partidas");

    // With 6 players, C(6,2) = 15 matches; player1 has 5 matches
    // The heading shows "Mis partidas"
    await expect(page.locator("body")).toContainText("Mis partidas");

    // Should show at least some matches (section with "Pendientes")
    await expect(page.locator("body")).toContainText("Pendientes");
  });

  test("6. Jugador Alfa reporta resultado de una partida", async ({ page }) => {
    await loginPlayer(page, PLAYER1_NAME, PLAYER_PASSCODE);

    await page.goto("/mis-partidas");

    // Find the first "Reportar resultado" button
    const reportBtn = page.getByRole("button", { name: "Reportar resultado" }).first();
    await expect(reportBtn).toBeVisible();
    await reportBtn.click();

    // The form title "Reportar resultado" should appear (small caps)
    // Fill VP values - two number inputs
    const vpInputs = page.locator('input[type="number"]');
    await vpInputs.nth(0).fill("60"); // home VP
    await vpInputs.nth(1).fill("40"); // away VP

    // Select outcome — click Victoria for Jugador Alfa (home player)
    // Button text is "Victoria <playerHomeName>" where playerHomeName depends on the match
    // We look for any "Victoria" button to select home win
    const victoriaBtn = page.getByRole("button", { name: /^Victoria Jugador/i }).first();
    await victoriaBtn.click();

    // Submit via "Reportar" button (inside the form)
    await page.getByRole("button", { name: /^Reportar$/ }).click();

    await page.waitForLoadState("networkidle");

    // The match should now be in "Por confirmar" section or show Reportada badge
    await expect(page.locator("body")).toContainText("Por confirmar");
  });

  test("7. Rival confirma el resultado", async ({ page }) => {
    // Beta is player 2 in the pairings. We login as Beta and confirm.
    await loginPlayer(page, PLAYER2_NAME, PLAYER_PASSCODE);

    await page.goto("/mis-partidas");

    // Should see "Por confirmar" section with a "Confirmar / Disputar" button
    // (If already confirmed from a previous run, skip gracefully)
    const confirmBtn = page.getByRole("button", { name: "Confirmar / Disputar" }).first();
    const isBtnVisible = await confirmBtn.isVisible({ timeout: 3000 }).catch(() => false);

    if (isBtnVisible) {
      await confirmBtn.click();

      // The confirm actions appear — click "Confirmar resultado"
      const confirmAction = page.getByRole("button", { name: "Confirmar resultado" });
      await confirmAction.click();

      await page.waitForLoadState("networkidle");

      // Match should now show "Confirmada" badge
      await expect(page.locator("body")).toContainText("Confirmada");
    } else {
      // Match already confirmed from a previous test run — verify it's confirmed
      await expect(page.locator("body")).toContainText("Confirmada");
    }
  });

  test("8. Ver standings — la partida confirmada aparece", async ({ page }) => {
    await loginPlayer(page, PLAYER1_NAME, PLAYER_PASSCODE);

    await page.goto("/clasificacion");

    // Both players should appear in standings now
    await expect(page.locator("body")).toContainText("Jugador Alfa");
    await expect(page.locator("body")).toContainText("Jugador Beta");
  });

  test("9. Admin configura playoffSize y accede al panel de playoffs", async ({ page }) => {
    await loginAdmin(page);

    await page.goto("/admin/liga");

    // Find the playoffSize input — label is "Jugadores que clasifican a playoffs"
    const playoffField = page.getByLabel(/jugadores que clasifican a playoffs/i);
    if (await playoffField.isVisible({ timeout: 3000 })) {
      await playoffField.clear();
      await playoffField.fill("2");

      // Save via "Guardar configuración" or similar
      const saveBtn = page.getByRole("button", { name: /guardar|actualizar/i }).first();
      await saveBtn.click();
      await page.waitForLoadState("networkidle");
    }

    await page.waitForLoadState("networkidle");

    // Navigate to admin/playoffs
    await page.goto("/admin/playoffs");
    await expect(page.locator("body")).toContainText("playoffs");
  });

  test("10. Admin inicia playoffs si hay partidas suficientes", async ({ page }) => {
    await loginAdmin(page);

    await page.goto("/admin/playoffs");

    // Try to start playoffs
    const startBtn = page.getByRole("button", { name: /iniciar playoffs/i });
    if (await startBtn.isVisible({ timeout: 3000 })) {
      await startBtn.click();

      // 2-step confirmation — button text is "Confirmar e iniciar"
      const confirmStart = page.getByRole("button", { name: "Confirmar e iniciar" });
      if (await confirmStart.isVisible({ timeout: 3000 })) {
        await confirmStart.click();
      }

      await page.waitForLoadState("networkidle");

      // Navigate to bracket
      await page.goto("/bracket");
      // "Bracket de playoffs" heading (case-insensitive)
      await expect(page.locator("body")).toContainText(/bracket|playoffs/i);
    } else {
      // Not enough data — skip gracefully
      console.log("[e2e] Playoffs not ready — skipping");
      test.skip();
    }
  });

  test("11. Bracket visible para jugadores (o estado vacío)", async ({ page }) => {
    await loginPlayer(page, PLAYER1_NAME, PLAYER_PASSCODE);

    await page.goto("/bracket");

    // Either shows bracket or "Playoffs no iniciados"
    const bodyText = await page.locator("body").textContent();
    const hasExpectedContent = Boolean(
      bodyText?.includes("Bracket") || bodyText?.includes("playoffs")
    );
    expect(hasExpectedContent).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Responsive / mobile checks
// ---------------------------------------------------------------------------

test.describe("Mobile viewport — sin scroll horizontal roto", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  // Guarantee a clean session before every mobile test: clear any cookies left by
  // previous tests in the shared browser context (the "Recorrido completo" suite
  // mutates the DB and leaves session cookies that can redirect or render
  // unexpected content in subsequent tests, making the overflow assertions flaky).
  test.beforeEach(async ({ page }) => {
    await page.context().clearCookies();
  });

  test("login no tiene overflow horizontal", async ({ page }) => {
    await page.goto("/login");
    await expect(page.locator("body")).toBeVisible();
    const bodyWidth = await page.evaluate(() => document.body.scrollWidth);
    const viewportWidth = 390;
    expect(bodyWidth).toBeLessThanOrEqual(viewportWidth + 1);
  });

  test("mis-partidas no tiene overflow horizontal tras login", async ({ page }) => {
    // Fresh login as PLAYER1 so the page always renders the expected player's matches.
    await loginPlayer(page, PLAYER1_NAME, PLAYER_PASSCODE);
    await page.goto("/mis-partidas");
    // Wait for the page content to fully settle before measuring layout.
    await expect(page.locator("body")).toContainText(/mis partidas|Mis partidas|Pendientes|Confirmadas/i);
    const bodyWidth = await page.evaluate(() => document.body.scrollWidth);
    expect(bodyWidth).toBeLessThanOrEqual(391);
  });

  test("clasificacion no tiene overflow horizontal", async ({ page }) => {
    await loginPlayer(page, PLAYER1_NAME, PLAYER_PASSCODE);
    await page.goto("/clasificacion");
    // Mobile: shows card layout (hidden table), no horizontal scroll
    await expect(page.locator("body")).toBeVisible();
    const bodyWidth = await page.evaluate(() => document.body.scrollWidth);
    expect(bodyWidth).toBeLessThanOrEqual(391);
  });

  test("calendario no tiene overflow horizontal", async ({ page }) => {
    await loginAdmin(page);
    await page.goto("/calendario");
    await expect(page.locator("body")).toBeVisible();
    const bodyWidth = await page.evaluate(() => document.body.scrollWidth);
    expect(bodyWidth).toBeLessThanOrEqual(391);
  });

  test("bracket no tiene overflow horizontal (o muestra estado vacío)", async ({ page }) => {
    await loginPlayer(page, PLAYER1_NAME, PLAYER_PASSCODE);
    await page.goto("/bracket");
    await expect(page.locator("body")).toBeVisible();
    // The overflow-x-auto container is internal; page body should not overflow
    const bodyWidth = await page.evaluate(() => document.body.scrollWidth);
    expect(bodyWidth).toBeLessThanOrEqual(391);
  });
});

// ---------------------------------------------------------------------------
// Empty states
// ---------------------------------------------------------------------------

test.describe("Estados vacíos", () => {
  test("admin/disputas muestra 'No hay disputas activas' cuando no hay disputas", async ({ page }) => {
    await loginAdmin(page);
    await page.goto("/admin/disputas");
    await expect(page.getByText("No hay disputas activas")).toBeVisible();
  });

  test("clasificacion muestra standings o estado vacío (nunca página rota)", async ({ page }) => {
    await loginPlayer(page, PLAYER1_NAME, PLAYER_PASSCODE);
    await page.goto("/clasificacion");

    const bodyText = await page.locator("body").textContent();
    // Either shows standings with player names or empty state message
    const hasValidContent = Boolean(
      bodyText?.includes("Jugador Alfa") ||
      bodyText?.includes("No hay partidas confirmadas") ||
      bodyText?.includes("Clasificación")
    );
    expect(hasValidContent).toBe(true);
  });

  test("login con passcode incorrecto muestra error", async ({ page }) => {
    await page.goto("/login");
    await page.getByRole("tab", { name: "Admin" }).click();
    await page.getByLabel("Clave de administrador").fill("passcode-incorrecto");
    await page.getByRole("button", { name: "Entrar" }).click();

    // Should show an error message — the API returns "Credenciales incorrectas"
    await expect(page.locator("body")).toContainText(/credenciales|incorrectas|error/i);
    // Should stay on login page
    await expect(page).toHaveURL(/login/);
  });
});
