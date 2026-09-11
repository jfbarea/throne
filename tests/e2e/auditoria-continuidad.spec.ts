/**
 * E2E — Z2 (auditoria-de-continuidad, multi-liga cierre). Spec §7.1,
 * criterios 43 y 46.
 *
 * Demuestra la restricción dura de continuidad en producción —"un usuario de
 * producción no debe notar este cambio más allá de que le cambie la
 * URL"— en lugar de asumirla porque `SessionPayload` no ganó campos.
 *
 * Deliberadamente NO inicia sesión a través del formulario de `/login` ni
 * mockea `@/lib/session` o `@/lib/guards`: firma la cookie a mano, con el
 * mismo mecanismo real (`signSession` de src/lib/session.ts) y el mismo
 * `SESSION_SECRET` con el que arranca el servidor de este proyecto
 * (`E2E_SESSION_SECRET`, playwright.config.ts), tal y como quedaría una
 * cookie emitida por el código de ANTES del deploy de multi-liga. Es
 * exactamente la garantía que hay que probar: esa cookie, generada sin que
 * el código nuevo intervenga en absoluto, tiene que seguir siendo válida
 * para el servidor ya desplegado con el código nuevo.
 *
 * El payload de sesión no cambió con esta feature (`{ playerId, role }`,
 * spec §4.4) — por eso "antes" y "después" son literalmente el mismo
 * shape. Lo que este fichero prueba no es que el shape sea igual (eso ya lo
 * garantiza el tipo `SessionPayload`), sino que una cookie construida sin
 * pasar por ningún flujo de login real navega el árbol de rutas nuevo sin
 * que el jugador tenga que volver a autenticarse, incluidas las cinco rutas
 * antiguas sin slug.
 *
 * Usa el navegador real (`page.goto`) contra el servidor real que levanta
 * `webServer` en playwright.config.ts, y una petición HTTP cruda con
 * `maxRedirects: 0` para comprobar que cada ruta antigua resuelve en un
 * único salto directo a `/liga/<slug>/<página>` — "sin pasos intermedios"
 * (criterio 46), no dos redirecciones encadenadas.
 */

import { test, expect, type BrowserContext } from "@playwright/test";
import { E2E_SESSION_SECRET, E2E_BASE_URL } from "../../playwright.config";
import { LEAGUE_A, LEAGUE_A_SLUG } from "./seed-data";

// Debe fijarse ANTES de llamar a `signSession` (se lee en cada invocación,
// no al importar el módulo) — mismo secreto con el que `webServer` arrancó
// el servidor contra el que corre este fichero.
process.env.SESSION_SECRET = E2E_SESSION_SECRET;

// Import diferido a después de fijar SESSION_SECRET por claridad de lectura
// (no es requisito técnico: `getSecret()` solo se llama dentro de
// `signSession`, en tiempo de invocación, nunca al importar el módulo).
import { signSession, SESSION_COOKIE } from "../../src/lib/session";

const PLAYER = LEAGUE_A.players[0]; // "Jugador Alfa" — sembrado por seed-e2e.ts.

const LEGACY_ROUTES = [
  "clasificacion",
  "calendario",
  "rondas",
  "bracket",
  "mis-partidas",
] as const;

/**
 * Firma una cookie de sesión de PLAYER con el mecanismo real de
 * src/lib/session.ts — el mismo que produce el código de hoy y el que
 * producía el código de antes de multi-liga, porque `SessionPayload` no
 * cambió (spec §4.4, §7.1). No pasa por `/api/auth/login-*` ni por ningún
 * mock: es una cookie "de antes del deploy" construida desde cero.
 */
async function signPreDeployPlayerCookie(playerId: string): Promise<string> {
  return signSession({ playerId, role: "PLAYER" });
}

async function installSessionCookie(
  context: BrowserContext,
  token: string
): Promise<void> {
  await context.addCookies([
    {
      name: SESSION_COOKIE,
      value: token,
      url: E2E_BASE_URL,
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
}

test.describe("Continuidad de sesión — cookie firmada sin pasar por /login (spec §7.1, criterio 43)", () => {
  test("una cookie de PLAYER firmada a mano con signSession sigue siendo válida: no aparece el login", async ({
    page,
  }) => {
    const token = await signPreDeployPlayerCookie(PLAYER.id);
    await installSessionCookie(page.context(), token);

    await page.goto("/mis-partidas");

    // Aterriza dentro de su liga, no en /login — la cookie fue aceptada sin
    // que el jugador hiciera nada.
    await expect(page).toHaveURL(
      new RegExp(`/liga/${LEAGUE_A_SLUG}/mis-partidas$`)
    );
    await expect(page.getByLabel("Tu nombre")).not.toBeVisible();
    await expect(page.locator("body")).toContainText(PLAYER.displayName);
  });
});

test.describe("Marcadores antiguos — las cinco rutas sin slug, con sesión previa (spec §7.1, criterio 46)", () => {
  for (const route of LEGACY_ROUTES) {
    test(`/${route} lleva a /liga/${LEAGUE_A_SLUG}/${route}, con la misma cookie, sin ver login`, async ({
      page,
    }) => {
      const token = await signPreDeployPlayerCookie(PLAYER.id);
      await installSessionCookie(page.context(), token);

      await page.goto(`/${route}`);

      await expect(page).toHaveURL(
        new RegExp(`/liga/${LEAGUE_A_SLUG}/${route}$`)
      );
      await expect(page.getByLabel("Tu nombre")).not.toBeVisible();
    });

    test(`/${route} resuelve en un único salto HTTP directo a /liga/${LEAGUE_A_SLUG}/${route} (sin pasos intermedios)`, async ({
      request,
    }) => {
      const token = await signPreDeployPlayerCookie(PLAYER.id);

      const res = await request.get(`${E2E_BASE_URL}/${route}`, {
        maxRedirects: 0,
        headers: { cookie: `${SESSION_COOKIE}=${token}` },
      });

      expect([301, 302, 307, 308]).toContain(res.status());
      const location = res.headers()["location"];
      expect(location).toBe(`/liga/${LEAGUE_A_SLUG}/${route}`);
    });
  }
});
