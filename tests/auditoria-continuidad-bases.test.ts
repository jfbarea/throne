// Tests for Z2 (auditoria-de-continuidad, multi-liga cierre). Spec §7.1,
// criterio 44 ("con una sola liga en circulación, /bases sin sesión devuelve
// las bases de esa liga, no una redirección a /login") — el "marcador
// público" del día del deploy (spec §2.11).
//
// tests/bases-publicas-y-ruta-antigua.test.ts (hito E2) ya prueba que
// `/bases` sin sesión, con exactamente una liga en circulación, lanza un
// `redirect()` hacia `/liga/<slug>/bases` — pero se detiene ahí, en el
// primer salto. Y tests/bases-por-liga.test.ts (hito E1) prueba, por su
// lado, que `/liga/[slug]/bases` renderiza sin lanzar redirect — pero
// arrancando siempre de un slug que el propio test ya conocía de antemano,
// nunca del que el primer salto acaba de calcular.
//
// El patrón que esta feature ya pagó tres veces (round-actions.ts,
// componentes de acción huérfanos, la carrera de redirects del layout de
// /liga/[slug]) es exactamente ese: cada pieza probada por separado, nunca
// la interacción entre las dos. Este fichero encadena los dos saltos en un
// solo test: toma el slug que `/bases` redirige de verdad y lo pasa, sin
// tocarlo a mano, a la página de destino — la misma cadena que seguiría un
// navegador real seguido de otra petición.
//
// (La comprobación de extremo a extremo con HTTP real y navegador —
// criterios 43 y 46, la continuidad de sesión con cookie firmada a mano y
// las cinco rutas antiguas— vive en tests/e2e/auditoria-continuidad.spec.ts,
// donde SÍ hay un servidor real que devuelve códigos de estado HTTP.
// `/bases` no tiene un equivalente ahí: las dos ligas del seed de e2e
// siempre están en circulación a la vez —lo exige spec §8 y lo consumen ya
// full-journey.spec.ts y multi-liga.spec.ts—, así que "exactamente una
// liga en circulación" no es un estado que se pueda producir en esa base
// sin desestabilizar el resto de la suite e2e, que corre secuencialmente
// contra el mismo e2e.db. Vitest, con su propio test.db aislado, es donde sí
// se puede fijar ese recuento con garantías — mismo motivo por el que
// bases-publicas-y-ruta-antigua.test.ts ya lo hace ahí.

import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/session", () => ({
  getSession: vi.fn(async () => null),
}));

import { renderToStaticMarkup } from "react-dom/server";
import { prisma } from "@/lib/db";

function uid(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function createTestLeague(overrides: Record<string, unknown> = {}) {
  const id = uid("league");
  return prisma.league.create({
    data: {
      id,
      name: `Liga única de auditoría ${uid("name")}`,
      season: "2026 Test",
      slug: `${id}-slug`,
      archivedAt: null,
      ...overrides,
    },
  });
}

/** Archive every league currently in circulation — same helper as
 * tests/bases-publicas-y-ruta-antigua.test.ts, needed for the same reason:
 * test.db accumulates leagues from every other file in the suite. */
async function archiveAllCirculatingLeagues(): Promise<void> {
  await prisma.league.updateMany({
    where: { archivedAt: null },
    data: { archivedAt: new Date() },
  });
}

function redirectUrl(err: unknown): string {
  const digest = (err as { digest?: string }).digest;
  if (!digest || !digest.startsWith("NEXT_REDIRECT")) {
    throw new Error(`Not a redirect error: ${String(err)}`);
  }
  return digest.split(";")[2];
}

describe("/bases sin sesión, una sola liga en circulación — recorrido completo de los dos saltos (spec §7.1, criterio 44)", () => {
  it("el slug al que /bases redirige de verdad renderiza sus propias bases, sin volver a redirigir", async () => {
    await archiveAllCirculatingLeagues();
    const only = await createTestLeague({
      rulesMarkdown:
        "## Ejércitos\n\nCláusula exclusiva de esta liga única de auditoría.",
    });

    vi.resetModules();
    const { default: BasesIndexPage } = await import("@/app/bases/page");

    // Salto 1 — el mismo que un marcador de producción sin sesión dispara
    // de verdad: /bases calcula a qué liga mandar a quien no tiene cookie.
    let target: string;
    try {
      await BasesIndexPage();
      expect.unreachable("expected a redirect to the single circulating league's bases");
      return;
    } catch (err) {
      target = redirectUrl(err);
    }
    expect(target).toBe(`/liga/${only.slug}/bases`);

    // Salto 2 — se sigue la redirección de verdad: el slug sale de `target`
    // (lo que /bases acaba de calcular), no de `only.slug` fijado a mano.
    // Es la comprobación que faltaba: que el destino de la redirección es
    // una página que en efecto responde (no otro redirect, no un throw), y
    // que además es la liga correcta, no una en blanco ni la equivocada.
    const slugFromRedirect = target.split("/")[2];
    expect(slugFromRedirect).toBe(only.slug);

    const { default: LigaBasesPage } = await import(
      "@/app/liga/[slug]/bases/page"
    );
    const element = await LigaBasesPage({
      params: Promise.resolve({ slug: slugFromRedirect }),
    });
    const html = renderToStaticMarkup(element as React.ReactElement);

    expect(html).toContain("Bases de la Liga");
    expect(html).toContain(
      "Cláusula exclusiva de esta liga única de auditoría"
    );
  });
});
