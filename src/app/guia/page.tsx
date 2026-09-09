// /guia — Public player guide. No auth guard: readable without login, same
// as /bases (Hito 12, `guia-de-usuario`). Content is written for players,
// not lifted verbatim from `docs/guia-de-uso.md` (that file targets whoever
// maintains the app, not whoever plays in it).

import Link from "next/link";
import type { Metadata } from "next";
import { Card, Eyebrow, Badge, Divider } from "@/components";
import { GUIDE_SECTIONS } from "./sections";

export const metadata: Metadata = {
  title: "Guía de uso — throne",
  description:
    "Cómo entrar, apuntar un resultado, declarar una incomparecencia, ver tu cupo de la ronda y qué pasa al cerrarse.",
};

// A single guide section: small-caps label + heading + bulleted steps.
function GuideCard({
  label,
  title,
  children,
}: {
  label: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <Eyebrow>{label}</Eyebrow>
      <h2
        className="text-[22px] font-semibold leading-tight mt-1 mb-4"
        style={{ fontFamily: "var(--font-display)", color: "var(--fg)" }}
      >
        {title}
      </h2>
      <ul className="space-y-3">{children}</ul>
    </Card>
  );
}

// A bullet row with a brass marker, matching /bases.
function Rule({ children }: { children: React.ReactNode }) {
  return (
    <li
      className="flex gap-3 text-[14px] leading-[22px]"
      style={{ color: "var(--fg-muted)", fontFamily: "var(--font-sans)" }}
    >
      <span
        aria-hidden="true"
        className="select-none shrink-0"
        style={{ color: "var(--accent)" }}
      >
        ✦
      </span>
      <span>{children}</span>
    </li>
  );
}

export default function GuiaPage() {
  return (
    <div
      className="min-h-screen flex flex-col"
      style={{ background: "var(--bg)", color: "var(--fg)" }}
    >
      {/* Minimal public top bar, same as /bases */}
      <header
        className="sticky top-0 z-10 flex items-center justify-between px-4 py-3 border-b"
        style={{ background: "var(--bg-raised)", borderColor: "var(--border)" }}
      >
        <Link href="/" className="flex items-center gap-2 no-underline">
          <span style={{ color: "var(--accent)" }}>✦</span>
          <span
            className="text-[20px] font-semibold leading-none"
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

      <main className="w-full max-w-[760px] mx-auto px-4 py-10 sm:py-14">
        {/* Masthead */}
        <Eyebrow as="p">Para jugadores</Eyebrow>
        <h1
          className="text-[34px] sm:text-[40px] font-semibold leading-[1.1] mt-2"
          style={{ fontFamily: "var(--font-display)", color: "var(--fg)" }}
        >
          Guía de uso
        </h1>
        <p
          className="text-[15px] italic mt-3 max-w-[60ch]"
          style={{ color: "var(--fg-faint)", fontFamily: "var(--font-sans)" }}
        >
          Lo justo para moverte por la app: entrar, apuntar tus partidas y
          saber qué pasa cuando cierra la ronda.
        </p>

        {/* Meta chips */}
        <div className="flex flex-wrap gap-2 mt-6">
          <Badge variant="brass">5 pasos</Badge>
          <Badge variant="neutral">Sin confirmación del rival</Badge>
          <Badge variant="ash">Rondas mensuales</Badge>
        </div>

        <Divider ornamental />

        {/* Sections */}
        <div className="space-y-6">
          {GUIDE_SECTIONS.map((section) => (
            <GuideCard key={section.label} label={section.label} title={section.title}>
              {section.bullets.map((bullet, i) => (
                <Rule key={i}>{bullet}</Rule>
              ))}
            </GuideCard>
          ))}
        </div>

        <Divider ornamental />

        <p
          className="text-center text-[13px]"
          style={{ color: "var(--fg-faint)", fontFamily: "var(--font-sans)" }}
        >
          ¿Buscas las reglas de la liga?{" "}
          <Link
            href="/bases"
            className="font-semibold no-underline"
            style={{ color: "var(--accent)" }}
          >
            Ver las bases
          </Link>
        </p>
      </main>
    </div>
  );
}
