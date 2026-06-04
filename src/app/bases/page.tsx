// /bases — Public league rules page. No auth guard: readable without login.

import Link from "next/link";
import type { Metadata } from "next";
import { Card, Eyebrow, Badge, Divider } from "@/components";

export const metadata: Metadata = {
  title: "Bases de la liga — throne",
  description:
    "Bases y reglamento de la liga privada de Warhammer 40.000: formato, ejércitos, misiones, puntuación, incidencias y convivencia.",
};

// A single rule section: small-caps label + heading + bulleted rules.
function RuleSection({
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

// A bullet row with a brass marker.
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

// Inline emphasis matching the brand accent / strong copy.
function S({ children }: { children: React.ReactNode }) {
  return (
    <strong className="font-semibold" style={{ color: "var(--fg)" }}>
      {children}
    </strong>
  );
}

export default function BasesPage() {
  return (
    <div
      className="min-h-screen flex flex-col"
      style={{ background: "var(--bg)", color: "var(--fg)" }}
    >
      {/* Minimal public top bar */}
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
        <Eyebrow as="p">Warhammer 40.000</Eyebrow>
        <h1
          className="text-[34px] sm:text-[40px] font-semibold leading-[1.1] mt-2"
          style={{ fontFamily: "var(--font-display)", color: "var(--fg)" }}
        >
          Bases de la Liga
        </h1>
        <p
          className="text-[15px] italic mt-3 max-w-[60ch]"
          style={{ color: "var(--fg-faint)", fontFamily: "var(--font-sans)" }}
        >
          Liga competitiva entre amigos. Reglas claras, mucho juego y buen rollo
          por delante del resultado.
        </p>

        {/* Meta chips */}
        <div className="flex flex-wrap gap-2 mt-6">
          <Badge variant="brass">Edición 11ª</Badge>
          <Badge variant="neutral">1500 puntos</Badge>
          <Badge variant="neutral">Liguilla · todos contra todos</Badge>
          <Badge variant="ash">Cierre 31 de julio (tentativo)</Badge>
        </div>

        <Divider ornamental />

        {/* Sections */}
        <div className="space-y-6">
          <RuleSection label="01" title="Formato">
            <Rule>
              Liguilla a una vuelta: todos contra todos, una partida por rival.
              Si sois 4 o menos, ida y vuelta.
            </Rule>
            <Rule>
              Los emparejamientos se publican al inicio.{" "}
              <S>No hay jornadas fijas:</S> cada uno acuerda con sus rivales
              cuándo jugar.
            </Rule>
            <Rule>
              Todas las partidas deben jugarse antes del cierre (31 de julio,
              ampliable si el grupo lo acuerda).
            </Rule>
          </RuleSection>

          <RuleSection label="02" title="Ejércitos">
            <Rule>
              <S>1500 puntos</S>, iguales para todos.
            </Rule>
            <Rule>
              Listas legales de matched play de 11ª (puntos del Munitorum Field
              Manual vigente). Los códex de 10ª valen hasta que salga su
              actualización.
            </Rule>
            <Rule>
              Lista por escrito al rival antes de cada partida. Puedes cambiarla
              entre partidas, no durante.
            </Rule>
            <Rule>
              Conversiones, impresiones 3D y <em>proxies</em> claros permitidos,
              avisando antes.
            </Rule>
          </RuleSection>

          <RuleSection label="03" title="Misiones">
            <Rule>
              Baraja <S>Chapter Approved 2026–2027</S>: se sortea misión y
              despliegue al empezar.
            </Rule>
            <Rule>Límite recomendado de 3 h por partida.</Rule>
          </RuleSection>

          <RuleSection label="04" title="Puntuación">
            <Rule>
              <S>Victoria 3 · Empate 1 · Derrota 0.</S>
            </Rule>
            <Rule>
              El ganador se decide por <em>Victory Points</em>; se anotan los VP
              de ambos jugadores.
            </Rule>
            <Rule>
              Desempates en la tabla: 1) resultado directo · 2) diferencia total
              de VP · 3) VP a favor · 4) dado.
            </Rule>
          </RuleSection>

          <RuleSection label="05" title="Incidencias">
            <Rule>
              Quien no responda para cuadrar la partida o no se presente sin
              causa: derrota técnica (rival 3 pts, 80–0).
            </Rule>
            <Rule>
              Si a una pareja no le cuadró antes del cierre: empate (1 pt cada
              uno), salvo que se amplíe la fecha.
            </Rule>
            <Rule>
              Si alguien abandona la liga, el grupo decide qué hacer con sus
              resultados.
            </Rule>
          </RuleSection>

          <RuleSection label="06" title="Convivencia">
            <Rule>
              Medir claro, declarar intenciones, dados a la vista, sin{" "}
              <em>slow play</em>.
            </Rule>
            <Rule>
              Dudas de reglas: se consulta; si no se resuelve en 2–3 min, dado
              (4+ decide) y se sigue.
            </Rule>
            <Rule>
              Lo no previsto y cualquier cambio a las bases lo decide la mayoría
              del grupo.
            </Rule>
            <Rule>
              <S>Respeto siempre:</S> el buen ambiente es lo primero.
            </Rule>
          </RuleSection>
        </div>

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
