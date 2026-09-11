// /liga/[slug]/bases — public league rules page (multi-liga spec §2.11,
// §4.11). Replaces the pre-multi-liga src/app/bases/page.tsx.
//
// No auth guard of its own: readable without login, same invariant the old
// unslugged /bases had (spec §2.11 — "es la única grieta consciente en
// §2.2"). The parent layout (src/app/liga/[slug]/layout.tsx, C2) reflects
// that on purpose: it does NOT gate a sessionless request at all, so a
// session (player or admin) still gets the full §4.2 access guard
// (own/ajena/archivada/inexistente) via `requireLeagueAccess`, while a
// sessionless request only needs the league to exist.
import type { Metadata } from "next";
import Link from "next/link";
import { Eyebrow, Badge, Divider } from "@/components";
import { getSession } from "@/lib/session";
import { requireLeagueAccess, resolveLeagueBySlug } from "@/lib/league-context";
import { BasesNotFound } from "./BasesNotFound";
import {
  BasesBody,
  matchesPerRoundLabel,
  parseRulesSections,
} from "./rules-content";

export const metadata: Metadata = {
  title: "Bases de la liga — throne",
  description:
    "Bases y reglamento de la liga privada de Warhammer 40.000: formato, ejércitos, puntuación, incidencias y convivencia.",
};

export default async function LigaBasesPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const session = await getSession();

  // A session (player or admin) goes through the same §4.2 guard every other
  // page under this segment uses — for a PLAYER this means "ajena"/
  // "archivada propia"/"inexistente" all redirect elsewhere before this line
  // returns, so by the time we get a value here it's always their own,
  // resolved league. A sessionless request only needs existence: an archived
  // league still reads fine (spec §5.8.2), only writing to it is blocked
  // (assertLeagueWritable, in updateLeagueRules).
  const league = session
    ? await requireLeagueAccess(slug, session, "bases")
    : await resolveLeagueBySlug(slug);

  if (!league) {
    return <BasesNotFound />;
  }

  const sections = parseRulesSections(league.rulesMarkdown);

  return (
    <div
      className="flex min-h-screen flex-col"
      style={{ background: "var(--bg)", color: "var(--fg)" }}
    >
      {/* Minimal public top bar — same as the pre-multi-liga page. Shown
          regardless of session: this route stays reachable without one, and
          a logged-in visitor clicking "Entrar" just sees the login form
          again, which is harmless. */}
      <header
        className="sticky top-0 z-10 flex items-center justify-between border-b px-4 py-3"
        style={{ background: "var(--bg-raised)", borderColor: "var(--border)" }}
      >
        <Link href="/" className="flex items-center gap-2 no-underline">
          <span style={{ color: "var(--accent)" }}>✦</span>
          <span
            className="text-[20px] leading-none font-semibold"
            style={{ fontFamily: "var(--font-display)", color: "var(--fg)" }}
          >
            throne
          </span>
        </Link>
        <Link
          href="/login"
          className="text-[13px] font-semibold no-underline"
          style={{ color: "var(--accent)", fontFamily: "var(--font-sans)" }}
        >
          Entrar
        </Link>
      </header>

      <main className="mx-auto w-full max-w-[760px] px-4 py-10 sm:py-14">
        {/* Masthead — fixed page chrome, same for every league. */}
        <Eyebrow as="p">Warhammer 40.000</Eyebrow>
        <h1
          className="mt-2 text-[34px] leading-[1.1] font-semibold sm:text-[40px]"
          style={{ fontFamily: "var(--font-display)", color: "var(--fg)" }}
        >
          Bases de la Liga
        </h1>
        <p
          className="mt-3 max-w-[60ch] text-[15px] italic"
          style={{ color: "var(--fg-faint)", fontFamily: "var(--font-sans)" }}
        >
          Liga competitiva entre amigos. Reglas claras, mucho juego y buen rollo
          por delante del resultado.
        </p>

        {/* Meta chips — only the round cadence is config-derived; the rest is
            fixed presentational flavour, same as before. */}
        <div className="mt-6 flex flex-wrap gap-2">
          <Badge variant="brass">Edición 11ª</Badge>
          <Badge variant="neutral">Puntos acordados por partida</Badge>
          <Badge variant="neutral">Liguilla · todos contra todos</Badge>
          <Badge variant="ash">
            Rondas mensuales · {matchesPerRoundLabel(league.matchesPerRound)}
          </Badge>
        </div>

        <Divider ornamental />

        <BasesBody league={league} sections={sections} />

        <Divider ornamental />

        <p
          className="text-center text-[13px]"
          style={{ color: "var(--fg-faint)", fontFamily: "var(--font-sans)" }}
        >
          ¿Listo para jugar?{" "}
          <Link
            href="/login"
            className="font-semibold no-underline"
            style={{ color: "var(--accent)" }}
          >
            Entra a la liga
          </Link>
        </p>
      </main>
    </div>
  );
}
