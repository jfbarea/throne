// Shared rendering primitives for the bases page (multi-liga spec §2.11,
// §4.11, lane E: bases-por-liga). Ported from the pre-multi-liga
// src/app/bases/page.tsx (259 lines of hardcoded JSX), split into the
// three-way model the spec asks for:
//
//  - `FormatoSection` — fixed page chrome. Same copy for every league: how
//    the league phase works (round-robin, monthly rounds, deadlines,
//    catching up) is product behaviour, not League config. The one thing it
//    used to hardcode (2 partidas por ronda) is now a live number, pulled
//    from `matchesPerRoundLabel` instead of typed into this JSX.
//  - `PuntuacionSection` — hybrid. One fixed sentence ("el ganador se decide
//    por VP") plus every number a League actually configures: scoring,
//    bonus, the real tiebreaker order (read via `parseTiebreakers`, the same
//    parser `computeStandings` uses — no separate copy to drift) and the
//    playoff cutoff. Nothing here is ever typed by the admin.
//  - `RulesProse` — renders `League.rulesMarkdown` (Ejércitos, Incidencias,
//    Convivencia by default, but genuinely free-form: the admin can add,
//    rename or remove sections) with the original page's look: numbered
//    eyebrow + ✦ bullets.
//
// `/liga/[slug]/bases/page.tsx` composes all three into the public page;
// `/admin/[slug]/bases/BasesRulesForm.tsx` reuses `RulesProse` (and the pure
// `parseRulesSections`) for the live preview, so the preview can never drift
// from what the public page actually renders.

import React from "react";
import { Card, Eyebrow, Divider } from "@/components";
import { parseTiebreakers, TIEBREAKER_LABELS } from "@/lib/schemas";

// ---------------------------------------------------------------------------
// Visual primitives (identical markup/styles to the pre-multi-liga page)
// ---------------------------------------------------------------------------

export function RuleSection({
  label,
  title,
  children,
}: {
  label?: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <Card>
      {label && <Eyebrow>{label}</Eyebrow>}
      <h2
        className="mt-1 mb-4 text-[22px] leading-tight font-semibold"
        style={{ fontFamily: "var(--font-display)", color: "var(--fg)" }}
      >
        {title}
      </h2>
      <ul className="space-y-3">{children}</ul>
    </Card>
  );
}

export function Rule({ children }: { children: React.ReactNode }) {
  return (
    <li
      className="flex gap-3 text-[14px] leading-[22px]"
      style={{ color: "var(--fg-muted)", fontFamily: "var(--font-sans)" }}
    >
      <span
        aria-hidden="true"
        className="shrink-0 select-none"
        style={{ color: "var(--accent)" }}
      >
        ✦
      </span>
      <span>{children}</span>
    </li>
  );
}

export function S({ children }: { children: React.ReactNode }) {
  return (
    <strong className="font-semibold" style={{ color: "var(--fg)" }}>
      {children}
    </strong>
  );
}

// ---------------------------------------------------------------------------
// Prose parsing (pure — testable without rendering anything)
// ---------------------------------------------------------------------------

export interface RulesSectionData {
  title: string;
  items: string[];
}

/**
 * Parse `League.rulesMarkdown` into `{ title, items }` sections.
 *
 * Deliberately lenient, since the admin edits this in a plain textarea, not
 * a markdown-aware editor (spec §4.11: "un textarea de markdown"):
 *  - `## Heading` starts a new section.
 *  - A line starting with `-` or `*` is its own bullet.
 *  - Any other run of non-blank lines (no bullet marker), up to the next
 *    blank line, is one bullet too — the same style the C0/E1 default
 *    template and the pre-multi-liga page both use (one paragraph = one
 *    bullet), so an admin who never learns the `-` syntax still gets a
 *    correctly rendered page.
 *  - Empty input (§5.8.3, criterio 38) returns `[]`.
 */
export function parseRulesSections(markdown: string): RulesSectionData[] {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const sections: RulesSectionData[] = [];
  let current: RulesSectionData | null = null;
  let buffer: string[] = [];

  function flushParagraph() {
    const text = buffer.join(" ").trim();
    buffer = [];
    if (text && current) {
      current.items.push(text);
    }
  }

  for (const rawLine of lines) {
    const line = rawLine.trim();

    if (line.startsWith("## ")) {
      flushParagraph();
      current = { title: line.slice(3).trim(), items: [] };
      sections.push(current);
      continue;
    }

    if (line === "") {
      flushParagraph();
      continue;
    }

    const bulletMatch = line.match(/^[-*]\s+(.*)$/);
    if (bulletMatch) {
      flushParagraph();
      current?.items.push(bulletMatch[1].trim());
      continue;
    }

    buffer.push(line);
  }
  flushParagraph();

  return sections.filter((section) => section.items.length > 0);
}

/** Turn `**bold**` and `*italic*` spans into `<S>`/`<em>`. Plain text otherwise. */
export function renderInline(text: string): React.ReactNode {
  const parts: React.ReactNode[] = [];
  const regex = /(\*\*[^*]+\*\*|\*[^*]+\*)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let key = 0;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }
    const token = match[0];
    if (token.startsWith("**")) {
      parts.push(<S key={key++}>{token.slice(2, -2)}</S>);
    } else {
      parts.push(<em key={key++}>{token.slice(1, -1)}</em>);
    }
    lastIndex = regex.lastIndex;
  }
  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }
  return parts;
}

/**
 * Render parsed prose sections with numbered eyebrows, continuing the
 * numbering after the two fixed sections that precede them on the real page
 * (Formato "01", Puntuación "02" — see `FormatoSection`/`PuntuacionSection`
 * below), so the whole page reads as one continuous 01..0N sequence
 * regardless of how many sections the admin's markdown actually has.
 */
export function RulesProse({
  sections,
  startAt = 3,
}: {
  sections: RulesSectionData[];
  startAt?: number;
}) {
  if (sections.length === 0) {
    return null;
  }
  return (
    <div className="space-y-6">
      {sections.map((section, i) => (
        <RuleSection
          key={`${section.title}-${i}`}
          label={String(startAt + i).padStart(2, "0")}
          title={section.title}
        >
          {section.items.map((item, j) => (
            <Rule key={j}>{renderInline(item)}</Rule>
          ))}
        </RuleSection>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Fixed section: Formato (page chrome, not League config, not admin prose)
// ---------------------------------------------------------------------------

/**
 * `matchesPerRoundLabel` is the only value this section owes to League
 * config — passed in rather than read here so this stays a plain
 * presentational component with no data-fetching of its own.
 */
export function FormatoSection({
  matchesPerRoundLabel,
}: {
  matchesPerRoundLabel: string;
}) {
  return (
    <RuleSection label="01" title="Formato">
      <Rule>
        Liguilla a una vuelta: todos contra todos, una partida por rival. Si
        sois 4 o menos, ida y vuelta.
      </Rule>
      <Rule>
        Los emparejamientos se publican al inicio, repartidos en{" "}
        <S>rondas mensuales:</S> cada ronda dura un mes y te toca jugar{" "}
        {matchesPerRoundLabel} en ella (el número exacto lo fija la
        configuración de esta liga, arriba). Dentro del mes, tú decides con
        quién juegas primero y qué día quedáis.
      </Rule>
      <Rule>
        Cada ronda tiene una <S>fecha límite</S> (el último día de su mes). No
        es un día de quedada obligatorio: es la fecha a partir de la cual el
        organizador puede dar la ronda por cerrada.
      </Rule>
      <Rule>
        Puedes <S>adelantar</S> una partida de un mes futuro sin haber acabado
        el actual — pero eso no te libra de las partidas de tu ronda en curso:
        cuando llegue su cierre, cuentan igual (ver «Incidencias»).
      </Rule>
    </RuleSection>
  );
}

// ---------------------------------------------------------------------------
// Fixed + generated section: Puntuación
// ---------------------------------------------------------------------------

export interface GeneratedRulesLeague {
  pointsWin: number;
  pointsDraw: number;
  pointsLoss: number;
  bonusEnabled: boolean;
  bonusMarginThreshold: number | null;
  bonusMinVP: number | null;
  matchesPerRound: number;
  playoffSize: number;
  tiebreakers: string; // JSON-encoded, as stored on League.
}

/** "2 partidas por ronda" / "1 partida por ronda" — used by the masthead badge and Formato. */
export function matchesPerRoundLabel(matchesPerRound: number): string {
  return `${matchesPerRound} partida${matchesPerRound === 1 ? "" : "s"} por ronda`;
}

/** "Victoria 3 · Empate 1 · Derrota 0." — pure, so criterio 35 is unit-testable without rendering. */
export function pointsLine(league: GeneratedRulesLeague): string {
  return `Victoria ${league.pointsWin} · Empate ${league.pointsDraw} · Derrota ${league.pointsLoss}.`;
}

/** Bonus description, or the "no bonus" sentence when disabled. Pure (criterio 36). */
export function bonusLine(league: GeneratedRulesLeague): string {
  if (!league.bonusEnabled) {
    return "Esta liga no tiene bonus de puntuación activados.";
  }
  const clauses: string[] = [];
  if (league.bonusMarginThreshold !== null) {
    clauses.push(
      `masacre si ganas por ${league.bonusMarginThreshold} VP de diferencia o más (+1)`
    );
  }
  if (league.bonusMinVP !== null) {
    clauses.push(
      `alcanzar ${league.bonusMinVP} VP, ganes o pierdas, suma otro punto (+1)`
    );
  }
  if (clauses.length === 0) {
    return "Bonus activados, pero esta liga aún no tiene umbrales configurados.";
  }
  return `Bonus activados: ${clauses.join(" · ")}.`;
}

/** Ordered tiebreaker labels, read from the same JSON `computeStandings` parses. Pure (criterio 36). */
export function tiebreakersLine(tiebreakers: string): string {
  const order = parseTiebreakers(tiebreakers);
  return `Desempates en la tabla, en este orden: ${order
    .map((tb) => TIEBREAKER_LABELS[tb])
    .join(" · ")}.`;
}

/** Pure (criterio 36). */
export function playoffsLine(playoffSize: number): string {
  return `Clasifican a playoffs los ${playoffSize} mejores de la tabla.`;
}

export function PuntuacionSection({
  league,
}: {
  league: GeneratedRulesLeague;
}) {
  return (
    <RuleSection label="02" title="Puntuación">
      <Rule>
        El ganador se decide por <em>Victory Points</em>; se anotan los VP de
        ambos jugadores.
      </Rule>
      <Rule>
        <S>{pointsLine(league)}</S>
      </Rule>
      <Rule>{bonusLine(league)}</Rule>
      <Rule>{tiebreakersLine(league.tiebreakers)}</Rule>
      <Rule>{playoffsLine(league.playoffSize)}</Rule>
    </RuleSection>
  );
}

// ---------------------------------------------------------------------------
// Whole-page composition, shared by the public page and the admin preview
// ---------------------------------------------------------------------------

export function BasesBody({
  league,
  sections,
}: {
  league: GeneratedRulesLeague;
  sections: RulesSectionData[];
}) {
  return (
    <div className="space-y-6">
      <FormatoSection
        matchesPerRoundLabel={matchesPerRoundLabel(league.matchesPerRound)}
      />
      <PuntuacionSection league={league} />
      <RulesProse sections={sections} startAt={3} />
    </div>
  );
}

export { Divider };
