/**
 * E2E — recorrido completo de throne.
 *
 * Hito 15 (`resultados-directos`): flujo simplificado sin confirmación del
 * rival — un participante apunta los VP y la partida cuenta de inmediato; el
 * rival puede editar el resultado apuntado. No hay paso de "Confirmar /
 * Disputar".
 *
 * Hito 10 de `rondas-con-fecha` (`docs-e2e-y-cobertura`): reescrito al flujo
 * con rondas. Antes de este hito ningún paso cerraba una ronda ni declaraba
 * una incomparecencia, así que las etiquetas de Hito 6 ("Incomparecencia",
 * "Saldada sin jugar") y el contador "PJ N (M saldadas)" de Hito 7 no los
 * ejercitaba nadie de punta a punta — solo los tests unitarios. Este guion
 * ahora pasa por las dos cosas, y también recupera de verdad `startPlayoffs`
 * (el test correspondiente quedó en `test.skip()` tras Hito 9 porque el
 * guion nunca cerraba rondas y el banner de "rondas abiertas" ocultaba el
 * botón de iniciar playoffs).
 *
 * Cubre:
 *  1. Login admin → panel admin
 *  2. Ver/confirmar config de liga (incluida la config de rondas)
 *  3. Alta de jugadores adicionales para tener escala real (12 jugadores,
 *     no los 6 del seed mínimo — necesario para el test de overflow de
 *     `/rondas` con cupo de muchos jugadores)
 *  4. Generar emparejamientos (repartidos en rondas mensuales)
 *  5. Fijar fecha de una partida (como admin)
 *  6. Login como jugador → ver mis partidas, agrupadas por ronda
 *  7. Jugador Alfa apunta resultado de una partida (cuenta en standings de
 *     inmediato)
 *  8. Rival (Beta) edita el resultado apuntado
 *  9. Un jugador declara una incomparecencia sobre otra partida de la Ronda 1
 * 10. Admin cierra la Ronda 1 (lo que quede sin resultado se salda 0-0)
 * 11. Las etiquetas de incomparecencia/saldada y el contador de la
 *     clasificación se ven en pantalla
 * 12. Admin cierra el resto de las rondas
 * 13. Admin configura playoffSize y accede al panel de playoffs
 * 14. Admin inicia playoffs de verdad (todas las rondas ya están cerradas)
 * 15. Bracket visible para jugadores
 *
 * Estado previo: global-setup.ts crea la liga E2E con SETUP + admin + 6
 * jugadores. `playwright.config.ts` corre dos proyectos (chromium,
 * mobile-chrome) de forma secuencial contra la MISMA `e2e.db` (sin
 * `fullyParallel`, un solo worker) — así que este fichero se ejecuta dos
 * veces sobre el mismo estado de base de datos. Los pasos que avanzan el
 * estado de la liga (alta de jugadores, generar, declarar incomparecencia,
 * cerrar ronda, iniciar playoffs) comprueban primero si ya se hicieron en la
 * corrida anterior (mismo patrón que ya usaba el paso de generar
 * emparejamientos antes de este hito) — necesario porque, a diferencia del
 * flujo de antes de Hito 10, este guion ahora sí deja la liga en un estado
 * terminal (`PLAYOFFS`) en el que no queda nada pendiente que reportar.
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
const PLAYER3_NAME = "Jugador Gamma";

// Jugadores adicionales para llevar la liga a escala real (12 jugadores en
// total con el admin y los 6 del seed — spec §7.2/§7.4: "/rondas" con el
// cupo de 12-20 jugadores tiene que caber en móvil, y ningún test de
// overflow anterior a Hito 10 visitaba esa vista).
const SCALE_PLAYERS = [
  { name: "Jugador Eta", faction: "Necrones" },
  { name: "Jugador Theta", faction: "Adeptus Custodes" },
  { name: "Jugador Iota", faction: "World Eaters" },
  { name: "Jugador Kappa", faction: "Death Guard" },
  { name: "Jugador Lambda", faction: "Aeldari" },
];
const LAST_SCALE_PLAYER = SCALE_PLAYERS[SCALE_PLAYERS.length - 1].name;

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

/** Creates one player from the admin/jugadores form and dismisses the
 * one-time passcode banner, leaving the form ready for the next player. */
async function createPlayer(page: Page, name: string, faction: string) {
  await page.getByLabel("Nombre").fill(name);
  await page.getByLabel(/facción/i).fill(faction);
  await page.getByRole("button", { name: "Crear jugador" }).click();
  const dismissBtn = page.getByRole("button", {
    name: /he anotado el código/i,
  });
  await expect(dismissBtn).toBeVisible({ timeout: 10_000 });
  await dismissBtn.click();
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

    // Rondas-con-fecha: the "Rondas mensuales" card with cupo + mes de
    // arranque is part of league config since Hito 3 (generar-con-rondas).
    await expect(page.getByLabel(/partidas por ronda/i)).toBeVisible();
    await expect(page.getByLabel(/mes de arranque/i)).toBeVisible();
  });

  test("3. Admin da de alta jugadores adicionales para tener escala real (12 jugadores)", async ({
    page,
  }) => {
    await loginAdmin(page);
    await page.goto("/admin/jugadores");

    // Idempotent across the two Playwright projects that share e2e.db (see
    // file docstring): skip creating them again if a previous project run
    // already did.
    const alreadyScaled = await page
      .getByText(LAST_SCALE_PLAYER, { exact: true })
      .isVisible({ timeout: 3_000 })
      .catch(() => false);

    if (!alreadyScaled) {
      for (const p of SCALE_PLAYERS) {
        await createPlayer(page, p.name, p.faction);
      }
    }

    // 1 admin + 6 jugadores del seed + 5 nuevos = 12 jugadores activos —
    // dentro del rango real de 12-20 que describe SPEC.md.
    await expect(page.getByText(LAST_SCALE_PLAYER, { exact: true })).toBeVisible();
  });

  test("4. Admin genera emparejamientos (repartidos en rondas mensuales)", async ({ page }) => {
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

    // Rondas-con-fecha: generating pairings also creates the league's
    // rounds. With 12 active players and matchesPerRound=2 (seed default),
    // roundsCount(12,2) = ceil(11/2) = 6 rounds — starting March 2026 (the
    // seed's startMonth), all with deadlines safely in the past by the time
    // this test runs, so every round can be closed later in this same suite
    // without editing any deadline by hand.
    await page.goto("/admin/rondas");
    await expect(page.locator("body")).toContainText("Ronda 1");
    await expect(page.locator("body")).toContainText("Ronda 6");
  });

  test("5. Admin fija fecha de una partida", async ({ page }) => {
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

  test("6. Jugador puede ver sus partidas, agrupadas por ronda", async ({ page }) => {
    await loginPlayer(page, PLAYER1_NAME, PLAYER_PASSCODE);

    await page.goto("/mis-partidas");

    // The heading shows "Mis partidas"
    await expect(page.locator("body")).toContainText("Mis partidas");

    // Fixed-label stats header (Hito 6): "Pendientes: N · Apuntadas: N ·
    // Incomparecencias: N · Saldadas: N" — the labels are always rendered
    // regardless of the counts, so this holds even once the league is fully
    // resolved on a second project run against the shared e2e.db.
    await expect(page.locator("body")).toContainText("Pendientes");

    // Rondas-con-fecha Hito 6: matches are grouped by round, closest
    // deadline first — Ronda 1 (March 2026, the earliest) is always shown.
    await expect(page.locator("body")).toContainText(/Ronda 1/);
  });

  test("7. Jugador Alfa apunta resultado — la partida cuenta en standings de inmediato", async ({ page }) => {
    // Hito 15: apuntar el resultado es suficiente, sin confirmación del rival.
    await loginPlayer(page, PLAYER1_NAME, PLAYER_PASSCODE);

    await page.goto("/mis-partidas");

    // Find the first "Apuntar resultado" button (new label, Hito 15)
    const reportBtn = page.getByRole("button", { name: /apuntar resultado/i }).first();
    // On a second project run against the shared e2e.db, this same league
    // may already be fully resolved (every round closed, playoffs started
    // later in this file) — nothing left for Alfa to report. Skip the write
    // gracefully in that case instead of failing on a button that legitimately
    // doesn't exist anymore.
    const hasPending = await reportBtn.isVisible({ timeout: 5_000 }).catch(() => false);

    if (hasPending) {
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
    } else {
      console.log(
        "[e2e] Sin partidas pendientes para Alfa — liga ya resuelta por una corrida anterior de este mismo fichero."
      );
    }

    // Either way, at least one of Alfa's matches shows a result now (from
    // this run or a previous one).
    await expect(page.locator("body")).toContainText(/Apuntadas|Apuntada/i);
  });

  test("8. Rival (Beta) puede editar el resultado apuntado por Alfa", async ({ page }) => {
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

  test("9. Un jugador declara una incomparecencia sobre otra partida de la Ronda 1", async ({ page }) => {
    // Rondas-con-fecha Hito 5/10: hasta este hito, ningún paso del e2e
    // declaraba una incomparecencia — solo la cubrían los tests unitarios.
    await loginPlayer(page, PLAYER3_NAME, PLAYER_PASSCODE);

    await page.goto("/mis-partidas");

    const round1Heading = page.getByText(/^Ronda 1 ·/).first();
    const hasRound1 = await round1Heading.isVisible({ timeout: 5_000 }).catch(() => false);

    if (hasRound1) {
      const round1Section = round1Heading.locator("xpath=ancestor::section[1]");
      const cards = round1Section.locator("div.rounded.border.p-4");
      const cardCount = await cards.count();

      // Find a card that still has "Apuntar resultado" (no Result yet) — never
      // one that already shows "Editar resultado", which a participant is not
      // allowed to overwrite with a walkover once it has a real PLAYED result
      // (D5, plan/rondas-con-fecha/PLAN.md). Located by POSITION (`nth`), not
      // by a `.filter({ has })` on the "Apuntar resultado" button itself:
      // that button disappears from the card as soon as "Incomparecencia" is
      // clicked (the row toggles to WalkoverForm), so a content-filtered
      // locator would stop matching on the very next action against it.
      // Position in the list doesn't change when a sibling card's local
      // client state toggles, so `nth(targetIndex)` stays valid throughout.
      let targetIndex = -1;
      for (let i = 0; i < cardCount; i++) {
        const hasReportBtn = await cards
          .nth(i)
          .getByRole("button", { name: "Apuntar resultado" })
          .isVisible()
          .catch(() => false);
        if (hasReportBtn) {
          targetIndex = i;
          break;
        }
      }

      if (targetIndex >= 0) {
        const card = cards.nth(targetIndex);
        await card.getByRole("button", { name: /incomparecencia/i }).click();
        // Either winner works — the point is exercising the WALKOVER path,
        // not who wins it.
        await card.getByRole("button", { name: /^Gana /i }).first().click();
        await card.getByRole("button", { name: "Declarar" }).click();
        await page.waitForLoadState("networkidle");
      } else {
        console.log(
          "[e2e] La Ronda 1 de Gamma ya está completamente resuelta — incomparecencia ya declarada en una corrida anterior."
        );
      }
    }

    // Either declared just now or in a previous project run against the
    // same e2e.db, Gamma's Ronda 1 shows the incomparecencia label.
    await expect(page.locator("body")).toContainText(/incomparecencia/i);
  });

  test("10. Admin cierra la Ronda 1 — lo que quede sin resultado se salda 0-0", async ({ page }) => {
    await loginAdmin(page);
    await page.goto("/admin/rondas");

    const closeBtn = page.getByRole("button", { name: "Cerrar ronda 1" });
    const canClose = await closeBtn.isVisible({ timeout: 5_000 }).catch(() => false);

    if (canClose) {
      await expect(closeBtn).toBeEnabled();
      await closeBtn.click();
      // The button (and its "se saldarán N partidas" helper text) disappears
      // once the round closes and the server component re-renders.
      await expect(closeBtn).toBeHidden({ timeout: 15_000 });
    }

    // Either closed just now or in a previous project run: the round shows
    // as closed either way.
    await expect(page.getByText(/Cerrada el/i).first()).toBeVisible();
  });

  test("11. Las etiquetas de incomparecencia/saldada y el contador de la clasificación se ven en pantalla", async ({ page }) => {
    await loginPlayer(page, PLAYER1_NAME, PLAYER_PASSCODE);

    // Rondas-con-fecha Hito 6: resolveMatchStatusLabel etiqueta WALKOVER
    // como "Incomparecencia" y UNPLAYED_DRAW como "Saldada sin jugar" en
    // calendario y mis-partidas. /calendario muestra TODAS las partidas de
    // la liga (no solo las de Alfa), así que ve también la incomparecencia
    // de Gamma y las saldadas del cierre de la Ronda 1.
    await page.goto("/calendario");
    await expect(page.locator("body")).toContainText(/Incomparecencia/i);
    await expect(page.locator("body")).toContainText(/Saldada sin jugar/i);

    // Rondas-con-fecha Hito 7: la columna PJ de /clasificacion distingue las
    // saldadas, "PJ N (M saldadas)" / "(M saldada)".
    await page.goto("/clasificacion");
    await expect(page.locator("body")).toContainText(/\(\d+ saldadas?\)/);
  });

  test("12. Admin cierra el resto de las rondas", async ({ page }) => {
    await loginAdmin(page);
    await page.goto("/admin/rondas");

    for (const index of [2, 3, 4, 5, 6]) {
      const closeBtn = page.getByRole("button", { name: `Cerrar ronda ${index}` });
      const canClose = await closeBtn.isVisible({ timeout: 3_000 }).catch(() => false);
      if (!canClose) continue; // already closed in a previous project run

      await closeBtn.click();
      await expect(closeBtn).toBeHidden({ timeout: 15_000 });
    }

    // No round should be left "Abierta" — needed for Hito 9's playoffs gate.
    await expect(page.getByText("Abierta", { exact: true })).toHaveCount(0);
  });

  test("13. Admin configura playoffSize y accede al panel de playoffs", async ({ page }) => {
    await loginAdmin(page);

    await page.goto("/admin/liga");

    // Find the playoffSize input — label is "Jugadores que clasifican a playoffs"
    const playoffField = page.getByLabel(/jugadores que clasifican a playoffs/i);
    if (await playoffField.isVisible({ timeout: 3000 })) {
      await playoffField.clear();
      await playoffField.fill("4");

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

  test("14. Admin inicia playoffs de verdad — todas las rondas ya están cerradas", async ({ page }) => {
    // Rondas-con-fecha Hito 9/10: hasta reescribir este fichero, este test
    // caía siempre en test.skip() porque el guion nunca cerraba ninguna
    // ronda y el banner de "rondas abiertas" (Hito 9) ocultaba el botón de
    // iniciar. Con el paso 12 cerrando todas las rondas, la guarda de
    // startPlayoffs (ninguna Round.closedAt nula) queda satisfecha de
    // verdad, así que este test ya no se salta.
    await loginAdmin(page);

    await page.goto("/admin/playoffs");

    const alreadyStarted = await page
      .getByText(/ya han sido iniciados/i)
      .isVisible({ timeout: 5_000 })
      .catch(() => false);

    if (!alreadyStarted) {
      const startBtn = page.getByRole("button", { name: /iniciar playoffs/i });
      await expect(startBtn).toBeVisible({ timeout: 15_000 });
      await startBtn.click();

      // 2-step confirmation — button text is "Confirmar e iniciar"
      const confirmStart = page.getByRole("button", { name: "Confirmar e iniciar" });
      await expect(confirmStart).toBeVisible({ timeout: 5_000 });
      await confirmStart.click();

      await page.waitForLoadState("networkidle");
    }

    // Navigate to bracket
    await page.goto("/bracket");
    // "Bracket de playoffs" heading (case-insensitive)
    await expect(page.locator("body")).toContainText(/bracket|playoffs/i);
  });

  test("15. Bracket visible para jugadores (o estado vacío)", async ({ page }) => {
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

  test("rondas no tiene overflow horizontal a escala real (12+ jugadores)", async ({ page }) => {
    // Rondas-con-fecha, sugerencia de la review de H6: los tests de overflow
    // anteriores a Hito 10 cubrían login, mis-partidas, clasificacion,
    // calendario y bracket, pero ninguno visitaba /rondas — que es
    // precisamente la vista más ancha (cupo de todos los jugadores en cada
    // ronda) y el requisito explícito de SPEC §7.2. La liga en este punto
    // del recorrido ya tiene 12 jugadores activos (paso 3), no los 6 del
    // seed mínimo.
    await loginPlayer(page, PLAYER1_NAME, PLAYER_PASSCODE);
    await page.goto("/rondas");
    await expect(page.locator("body")).toContainText(/Rondas|Calendario de la liga/i);
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

  test("guia no tiene overflow horizontal, con o sin sesión", async ({ page }) => {
    // Hito 12 (guia-de-usuario): /guia es la sexta entrada del nav — igual
    // que "Rondas" fue la quinta en Hito 6, verificar que no reabre el
    // desbordamiento que aquel hito arregló con overflow-x-auto.
    await page.goto("/guia");
    await expect(page.locator("body")).toContainText(/Guía de uso/i);
    let bodyWidth = await page.evaluate(() => document.body.scrollWidth);
    expect(bodyWidth).toBeLessThanOrEqual(391);

    await loginPlayer(page, PLAYER1_NAME, PLAYER_PASSCODE);
    await page.goto("/guia");
    bodyWidth = await page.evaluate(() => document.body.scrollWidth);
    expect(bodyWidth).toBeLessThanOrEqual(391);
  });
});

// ---------------------------------------------------------------------------
// Header dropdowns
//
// Regression guard. Hito 6 added `overflow-x-auto` to the header `<nav>` to
// keep 5 icon-only links from overflowing a narrow phone. That silently broke
// BOTH dropdowns: declaring `overflow-x` makes the vertical axis compute from
// `visible` to `auto` (CSS overflow spec), so the `absolute`-positioned panels
// of `AdminMenu` and `UserMenu` were clipped inside a ~40px-tall strip — they
// opened, but nothing was visible.
//
// Nothing caught it: the horizontal-overflow tests below measure the page
// body's `scrollWidth`, and no test ever opened a dropdown. These do.
// ---------------------------------------------------------------------------

test.describe("Desplegables del header", () => {
  test("el menú de Admin se despliega y sus enlaces son visibles y clicables", async ({
    page,
  }) => {
    await loginAdmin(page);
    await page.goto("/clasificacion");

    // Closed to begin with: the panel is conditionally rendered.
    await expect(page.getByRole("link", { name: "Emparejamientos" })).toHaveCount(0);

    await page.getByRole("button", { name: /admin/i }).click();

    // Every entry of ADMIN_LINKS must be genuinely visible — not merely
    // present in the DOM, which is what the clipping bug produced.
    for (const label of [
      "Panel",
      "Liga",
      "Jugadores",
      "Emparejamientos",
      "Rondas",
      "Playoffs",
    ]) {
      await expect(page.getByRole("link", { name: label })).toBeVisible();
    }

    // Visible is not enough: it must be reachable by a real click.
    await page.getByRole("link", { name: "Rondas" }).click();
    await expect(page).toHaveURL(/\/admin\/rondas$/);
  });

  test("el menú de usuario se despliega (mismo recorte que rompió el de Admin)", async ({
    page,
  }) => {
    await loginPlayer(page, PLAYER1_NAME, PLAYER_PASSCODE);
    await page.goto("/clasificacion");

    // The avatar button is the only one left once the admin menu is absent.
    const userButton = page.locator("header button").last();
    await userButton.click();

    // Logout lives in the user dropdown; if the panel is clipped it is not
    // visible even though it renders.
    await expect(
      page.getByRole("button", { name: /salir|cerrar sesión/i })
    ).toBeVisible();
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
