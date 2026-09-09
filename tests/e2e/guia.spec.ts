/**
 * E2E — /guia, la guía de uso pública para jugadores.
 * Hito 12 (`guia-de-usuario`, plan/rondas-con-fecha/PLAN.md), nacido del
 * feedback en HUMAN_REVIEW.
 *
 * /guia es pública, igual que /bases — lo contrario de /rondas
 * (tests/e2e/rondas.spec.ts), que exige requireAuth. Además de responder sin
 * sesión, tiene que ser encontrable desde los dos sitios donde vive el enlace:
 * el header (con sesión) y el formulario de login (sin ella) — si solo
 * viviera en el header, quien no tiene sesión nunca la encontraría.
 */

import { test, expect } from "@playwright/test";

const ADMIN_PASSCODE = "admin-e2e-passcode-secret";
const PLAYER_PASSCODE = "player-e2e-123";
const PLAYER1_NAME = "Jugador Alfa";

test.describe("AC-1: /guia responde sin sesión", () => {
  test("sin sesión, /guia NO redirige a /login", async ({ page }) => {
    await page.context().clearCookies();
    await page.goto("/guia");
    await expect(page).toHaveURL(/\/guia$/);
    await expect(page.locator("body")).toContainText(/Guía de uso/i);
  });

  test("cubre las cinco secciones de la guía", async ({ page }) => {
    await page.context().clearCookies();
    await page.goto("/guia");
    for (const title of [
      "Cómo entrar",
      "Apuntar un resultado",
      "Incomparecencia y 0-0",
      "Tu cupo de la ronda",
      "Qué pasa al cerrarse la ronda",
    ]) {
      await expect(page.getByRole("heading", { name: title })).toBeVisible();
    }
  });
});

test.describe("AC-2: /guia está enlazada desde el header y desde /login", () => {
  // The header nav link is icon-only below the `sm` breakpoint (same as the
  // rest of NAV_LINKS: the label span is `hidden sm:inline`), so it's
  // located by `href` rather than by accessible name — that keeps the test
  // meaningful on both the desktop and the mobile-chrome Playwright project.
  test("con sesión de jugador, el header enlaza a /guia", async ({ page }) => {
    await page.context().clearCookies();
    await page.goto("/login");
    await page.getByLabel("Tu nombre").fill(PLAYER1_NAME);
    await page.getByLabel("Código de acceso").fill(PLAYER_PASSCODE);
    await page.getByRole("button", { name: "Entrar" }).click();
    await expect(page).toHaveURL(/\/mis-partidas$/);

    const guideLink = page.locator('header nav a[href="/guia"]');
    await expect(guideLink).toBeVisible();
    await guideLink.click();
    await expect(page).toHaveURL(/\/guia$/);
  });

  test("con sesión de admin, el header enlaza a /guia", async ({ page }) => {
    await page.context().clearCookies();
    await page.goto("/login");
    await page.getByRole("tab", { name: "Admin" }).click();
    await page.getByLabel("Clave de administrador").fill(ADMIN_PASSCODE);
    await page.getByRole("button", { name: "Entrar" }).click();
    await expect(page).toHaveURL(/\/admin$/);

    const guideLink = page.locator('header nav a[href="/guia"]');
    await expect(guideLink).toBeVisible();
    await guideLink.click();
    await expect(page).toHaveURL(/\/guia$/);
  });

  test("sin sesión, /login enlaza a /guia junto a Bases", async ({ page }) => {
    await page.context().clearCookies();
    await page.goto("/login");
    await expect(
      page.getByRole("link", { name: "Ver las bases de la liga" })
    ).toBeVisible();
    await page.getByRole("link", { name: "Guía de uso" }).click();
    await expect(page).toHaveURL(/\/guia$/);
  });
});
