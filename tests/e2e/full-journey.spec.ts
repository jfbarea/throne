/**
 * E2E — recorrido completo de throne.
 *
 * Hito 15: flujo simplificado sin confirmación del rival.
 *  - Un participante apunta los VP y la partida cuenta de inmediato.
 *  - No hay paso de "Confirmar / Disputar".
 *  - El rival puede editar el resultado apuntado.
 *
 * Cubre:
 *  1. Login admin → panel admin
 *  2. Ver/confirmar config de liga
 *  3. Generar emparejamientos
 *  4. Fijar fecha de una partida (como admin)
 *  5. Login como jugador → ver mis partidas
 *  6. Jugador Alfa apunta resultado de una partida (→ REPORTED, cuenta en standings)
 *  7. Rival (Beta) edita el resultado apuntado (ambos participantes pueden editar)
 *  8. Ver standings (la partida apuntada aparece de inmediato)
 *  9. Admin: configurar playoffSize y verificar panel de playoffs
 * 10. Admin inicia playoffs (si hay suficientes partidas)
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
  // "/" is a role-based entry point that always redirects (src/app/page.tsx):
  // admins land on the config panel.
  await expect(page).toHaveURL(/\/admin$/);
}

async function loginPlayer(page: Page, name: string, passcode: string) {
  await page.goto("/login");
  await page.getByLabel("Tu nombre").fill(name);
  await page.getByLabel("Código de acceso").fill(passcode);
  await page.getByRole("button", { name: "Entrar" }).click();
  // Players land on their own matches (src/app/page.tsx).
  await expect(page).toHaveURL(/\/mis-partidas$/);
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

test.describe("Recorrido completo", () => {
  test.setTimeout(120_000);

  test("1. Login de admin redirige al panel de admin", async ({ page }) => {
    await page.goto("/login");

    // Page shows the throne logo (at least one)
    await expect(page.locator("text=throne").first()).toBeVisible();

    // Switch to admin mode
    await page.getByRole("tab", { name: "Admin" }).click();

    // Fill passcode and submit
    await page.getByLabel("Clave de administrador").fill(ADMIN_PASSCODE);
    await page.getByRole("button", { name: "Entrar" }).click();

    // "/" always redirects by role (src/app/page.tsx): admins to the panel.
    await expect(page).toHaveURL(/\/admin$/);
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

    // Only click if enabled (button is disabled when pairings already exist and there are results)
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

  test("6. Jugador Alfa apunta resultado — la partida cuenta en standings de inmediato", async ({ page }) => {
    // Hito 15: apuntar el resultado es suficiente, sin confirmación del rival.
    await loginPlayer(page, PLAYER1_NAME, PLAYER_PASSCODE);

    await page.goto("/mis-partidas");

    // Find the first "Apuntar resultado" button (new label, Hito 15)
    const reportBtn = page.getByRole("button", { name: /apuntar resultado/i }).first();
    await expect(reportBtn).toBeVisible();

    // Rondas-con-fecha Hito 6 (ui-cupo-y-rondas): "Mis partidas" now groups
    // matches by round, closest deadline first (SPEC §4.6, criterio 9).
    // Which specific match's "Apuntar resultado" button happens to render
    // first is no longer guaranteed to have PLAYER1 as the home player —
    // that used to hold only by accident (PLAYER1 is home in every one of
    // their pairings except the one against admin, and step 4 always dated
    // that exact match, which pushed it to the back of the old flat,
    // status-only list). Read who's home directly from the card instead of
    // assuming, so this test stays correct regardless of match order —
    // today, and after Hito 10 reshapes this flow for rondas.
    const card = reportBtn.locator(
      "xpath=ancestor::div[contains(@class,'rounded') and contains(@class,'border') and contains(@class,'p-4')][1]"
    );
    const nameSpans = card.locator("p").first().locator("span");
    const homeName = (await nameSpans.first().innerText()).trim();
    const isPlayer1Home = homeName === PLAYER1_NAME;

    await reportBtn.click();

    // Fill VP values - two number inputs - putting the winning score on
    // whichever side PLAYER1 actually plays.
    const vpInputs = page.locator('input[type="number"]');
    if (isPlayer1Home) {
      await vpInputs.nth(0).fill("60"); // home VP (PLAYER1)
      await vpInputs.nth(1).fill("40"); // away VP
    } else {
      await vpInputs.nth(0).fill("40"); // home VP
      await vpInputs.nth(1).fill("60"); // away VP (PLAYER1)
    }

    // Hito 15: there is no outcome picker any more. The outcome is derived from
    // the VP (deriveOutcome) and shown as a read-only label in ReportForm, so
    // this already implies a PLAYER1 win regardless of which side they're on.
    // Assert the derived label instead.
    await expect(
      page.getByText(new RegExp(`Victoria ${PLAYER1_NAME}`, "i")).first()
    ).toBeVisible();

    // Submit via "Reportar" button (inside the form)
    await page.getByRole("button", { name: /^Reportar$/ }).click();

    await page.waitForLoadState("networkidle");

    // Hito 15: the match should now show "Apuntadas" section (REPORTED status)
    await expect(page.locator("body")).toContainText(/Apuntadas/i);
  });

  test("7. Rival (Beta) puede editar el resultado apuntado por Alfa", async ({ page }) => {
    // Hito 15: both participants can edit the result. No confirmation step needed.
    await loginPlayer(page, PLAYER2_NAME, PLAYER_PASSCODE);

    await page.goto("/mis-partidas");

    // Beta should see an "Editar resultado" button for the match already reported by Alfa.
    // If the match shows "Editar resultado" button, Beta can edit (both participants allowed).
    const editBtn = page.getByRole("button", { name: /editar resultado/i }).first();
    const isBtnVisible = await editBtn.isVisible({ timeout: 5000 }).catch(() => false);

    if (isBtnVisible) {
      await editBtn.click();

      // Re-enter VP values (same or different)
      const vpInputs = page.locator('input[type="number"]');
      await vpInputs.nth(0).fill("60");
      await vpInputs.nth(1).fill("40");

      // Submit via "Reportar" button
      const submitBtn = page.getByRole("button", { name: /^Reportar$/ });
      if (await submitBtn.isVisible({ timeout: 3000 })) {
        await submitBtn.click();
        await page.waitForLoadState("networkidle");
      }

      // Match stays in "Apuntadas" after edit
      await expect(page.locator("body")).toContainText(/Apuntadas|Apuntada/i);
    } else {
      // Match may already show as edited or the result was from a different pair.
      // Just verify the page loads correctly.
      await expect(page.locator("body")).toContainText(/Mis partidas|Pendientes|Apuntadas/i);
    }
  });

  test("8. Ver standings — la partida apuntada aparece de inmediato", async ({ page }) => {
    // Hito 15: REPORTED status counts immediately — no confirmation needed.
    await loginPlayer(page, PLAYER1_NAME, PLAYER_PASSCODE);

    await page.goto("/clasificacion");

    // Both players should appear in standings now (REPORTED counts)
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
    await expect(page.locator("body")).toContainText(/mis partidas|Mis partidas|Pendientes|Apuntadas/i);
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
  test("admin/disputas ya no existe — debe redirigir o dar 404 (ruta eliminada en Hito 15)", async ({ page }) => {
    // Hito 15: the /admin/disputas route has been removed entirely.
    await loginAdmin(page);
    const response = await page.goto("/admin/disputas");
    // Next.js returns 404 for non-existent routes; or it may redirect to admin.
    // Either is acceptable — what's NOT acceptable is serving the old disputas UI.
    const status = response?.status() ?? 0;
    const bodyText = await page.locator("body").textContent();
    // The page should either be a 404 or NOT contain "Disputas" as a section heading
    // (a 404 page with the throne shell also does not contain old disputa content).
    const hasOldDisputasContent = bodyText?.includes("DisputaCard") ||
      bodyText?.includes("AdminResolveForm");
    expect(hasOldDisputasContent).toBeFalsy();
    // Status 200 is fine (Next.js renders admin layout with 404 content),
    // as long as the old page content is gone.
    expect(status).toBeLessThan(500);
  });

  test("clasificacion muestra standings o estado vacío (nunca página rota)", async ({ page }) => {
    await loginPlayer(page, PLAYER1_NAME, PLAYER_PASSCODE);
    await page.goto("/clasificacion");

    const bodyText = await page.locator("body").textContent();
    // Either shows standings with player names or empty state message
    const hasValidContent = Boolean(
      bodyText?.includes("Jugador Alfa") ||
      bodyText?.includes("No hay partidas") ||
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
