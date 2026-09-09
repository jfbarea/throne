// /bases — Public league rules page. No auth guard: readable without login.

import Link from "next/link";
import type { Metadata } from "next";
import { Card, Eyebrow, Badge, Divider } from "@/components";

export const metadata: Metadata = {
  title: "Bases de la liga — throne",
  description:
    "Bases y reglamento de la liga privada de Warhammer 40.000: formato, ejércitos, puntuación, incidencias y convivencia.",
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
          <Badge variant="neutral">Puntos acordados por partida</Badge>
          <Badge variant="neutral">Liguilla · todos contra todos</Badge>
          <Badge variant="ash">Rondas mensuales · 2 partidas por ronda</Badge>
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
              Los emparejamientos se publican al inicio, repartidos en{" "}
              <S>rondas mensuales:</S> cada ronda dura un mes y te toca jugar
              un número fijo de partidas en ella (2 por defecto — puede
              cambiar según la liga). Dentro del mes, tú decides con quién
              juegas primero y qué día quedáis.
            </Rule>
            <Rule>
              Cada ronda tiene una <S>fecha límite</S> (el último día de su
              mes). No es un día de quedada obligatorio: es la fecha a partir
              de la cual el organizador puede dar la ronda por cerrada.
            </Rule>
            <Rule>
              Puedes <S>adelantar</S> una partida de un mes futuro sin haber
              acabado el actual — pero eso no te libra de las partidas de tu
              ronda en curso: cuando llegue su cierre, cuentan igual (ver
              «Incidencias»).
            </Rule>
          </RuleSection>

          <RuleSection label="02" title="Ejércitos">
            <Rule>
              El <S>tamaño de las listas lo acordáis los dos</S> antes de cada
              partida. No hay un valor fijo para toda la liga: lo pactáis al
              quedar, igual que la fecha y el sitio.
            </Rule>
            <Rule>
              Si no os ponéis de acuerdo, no hay partida que jugar — y entonces
              aplica lo de siempre: pactáis un vencedor o la ronda la cierra el
              organizador con un 0-0 (ver «Incidencias»).
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

          <RuleSection label="03" title="Puntuación">
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

          <RuleSection label="04" title="Incidencias">
            <Rule>
              Si os ponéis de acuerdo en quién gana sin llegar a jugar
              (alguien no puede presentarse, no responde, etc.):{" "}
              <S>incomparecencia</S>. Se apunta un 80-0 a favor de quien
              ganáis entre los dos — cualquiera de los dos lo puede declarar
              en la app, y el rival puede corregirlo si no está de acuerdo.
            </Rule>
            <Rule>
              La incomparecencia <S>no lleva punto de bonus</S>, aunque la
              liga los tenga activados. Con un margen de 80 puntos, un 80-0
              real ya se llevaría los dos bonus configurables; si eso también
              contara en la incomparecencia, saldría más a cuenta no
              presentarse que jugar una partida reñida. Sin bonus, ganar
              jugando siempre renta igual o más.
            </Rule>
            <Rule>
              Si no llegáis a un acuerdo antes de que cierre la ronda:{" "}
              <S>0-0</S>, un punto para cada uno. El cierre de cada ronda lo
              da el organizador, no es automático — así que hay margen para
              pactar un resultado con algo de retraso si hace falta.
            </Rule>
            <Rule>
              Adelantar una partida de un mes futuro está permitido y no os
              exime de las de vuestra ronda en curso: si llega su cierre y
              siguen sin jugarse, se resuelven igual (incomparecencia o 0-0,
              como arriba).
            </Rule>
            <Rule>
              Si alguien abandona la liga, el grupo decide qué hacer con sus
              resultados.
            </Rule>
          </RuleSection>

          <RuleSection label="05" title="Convivencia">
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
