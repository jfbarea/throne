// Tests for Hito 2 (dominio-reparto-y-fechas) of the feature rondas-con-fecha.
// Spec: plan/specs/rondas-con-fecha.md, §4.2, §4.3, §4.4, §4.6, §7.3, §8.
//
// Pure domain module, no DB — every describe block below is named after the
// spec's numbered acceptance criterion it covers (§7.3: "cada criterio, un
// test identificable"). Criteria out of scope for this milestone (8, 9, 12,
// 13...) are covered by later milestones per PLAN.md's coverage table.

import { describe, it, expect } from "vitest";
import { expectedPairingCount } from "@/server/pairings";
import {
  roundsCount,
  roundRobinRounds,
  assignPairsToRounds,
  deriveDeadlines,
  roundQuota,
  quotaLabel,
  type RoundMatchInput,
} from "@/server/rounds";
import type { Pairing } from "@/server/pairings";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeIds(n: number): string[] {
  return Array.from({ length: n }, (_, i) => `player-${String(i + 1).padStart(3, "0")}`);
}

function pairKey(p: Pairing): string {
  return p.homeId < p.awayId ? `${p.homeId}|${p.awayId}` : `${p.awayId}|${p.homeId}`;
}

/** Every appearance count of `playerId` inside a single round's pairs. */
function countAppearances(round: Pairing[], playerId: string): number {
  return round.filter((p) => p.homeId === playerId || p.awayId === playerId).length;
}

/** Full round-robin pair set, used to build subgraphs for the general case. */
function fullRoundRobin(ids: string[]): Pairing[] {
  const pairs: Pairing[] = [];
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      pairs.push({ homeId: ids[i], awayId: ids[j] });
    }
  }
  return pairs;
}

/**
 * The three properties that actually make a reparto correct, not just "the
 * right number of rounds" or "within Δ+1 colors" (SPEC §4.3, §8 criterio 2):
 *
 *   1. No round has any player appearing more than `maxPerRound` times —
 *      with `maxPerRound = 1` this literally means "no repeated player in
 *      the round" (the property a bare color-count assertion can miss
 *      entirely: a coloring can respect Δ+1 colors and still double-book a
 *      player if a round is built from the wrong color classes).
 *   2. The exact multiset of `expectedPairs` is covered by the output:
 *      every one of them appears exactly once, and nothing else does — no
 *      duplicate, nothing missing, nothing invented.
 *
 * Every test that builds a reparto (via `roundRobinRounds` or
 * `assignPairsToRounds`) should run its result through this, instead of
 * repeating ad-hoc loops that usually only check one of the two.
 */
function assertValidReparto(
  rounds: Pairing[][],
  expectedPairs: Pairing[],
  maxPerRound: number
): void {
  for (const round of rounds) {
    const appearances = new Map<string, number>();
    for (const p of round) {
      appearances.set(p.homeId, (appearances.get(p.homeId) ?? 0) + 1);
      appearances.set(p.awayId, (appearances.get(p.awayId) ?? 0) + 1);
    }
    for (const count of appearances.values()) {
      expect(count).toBeLessThanOrEqual(maxPerRound);
    }
  }

  const outputKeys = rounds.flat().map(pairKey).sort();
  const expectedKeys = expectedPairs.map(pairKey).sort();
  expect(outputKeys).toEqual(expectedKeys);
}

/** Groups `assignPairsToRounds`'s flat output back into per-round arrays. */
function groupByRoundIndex(assigned: { roundIndex: number; homeId: string; awayId: string }[]): Pairing[][] {
  const byIndex = new Map<number, Pairing[]>();
  for (const a of assigned) {
    const list = byIndex.get(a.roundIndex) ?? [];
    list.push({ homeId: a.homeId, awayId: a.awayId });
    byIndex.set(a.roundIndex, list);
  }
  return [...byIndex.values()];
}

const SIZES = [10, 11, 12, 13, 20]; // even and odd, per the task's requirement.
const MATCHES_PER_ROUND = [1, 2, 3];

/**
 * Reference implementation of the unified formula documented on
 * `roundsCount` (max of the per-player bound and the general capacity
 * bound), computed independently here so the test pins the exact numbers
 * rather than trivially re-checking the production code against itself.
 */
function expectedRoundsCount(n: number, k: number): number {
  const perPlayerBound = Math.ceil((n - 1) / k);
  const capacityBound = Math.ceil((n * (n - 1)) / 2 / Math.floor((n * k) / 2));
  return Math.max(perPlayerBound, capacityBound);
}

// ---------------------------------------------------------------------------
// AC-1: exact match and round counts
// ---------------------------------------------------------------------------

describe("AC-1: con n jugadores y matchesPerRound=k, genera exactamente C(n,2) partidas y ceil((n-1)/k) rondas", () => {
  // The spec's ceil((n-1)/k) is exact and achieved whenever n is even, or n
  // is odd and k is even (Walecki decomposition — see roundsCount and
  // waleckiFactors in src/server/rounds.ts). It is only unreachable when
  // both n and k are odd (K_n odd is a "Class 2" graph, Vizing) — in that
  // single case `expectedRoundsCount` (and `roundsCount`) return one round
  // more, never less, than criterio 2 could otherwise be satisfied with.
  for (const n of SIZES) {
    for (const k of MATCHES_PER_ROUND) {
      it(`n=${n}, k=${k}`, () => {
        const ids = makeIds(n);
        const rounds = roundRobinRounds(ids, k);
        const total = rounds.flat();

        expect(total).toHaveLength(expectedPairingCount(n));
        expect(rounds).toHaveLength(roundsCount(n, k));
        expect(roundsCount(n, k)).toBe(expectedRoundsCount(n, k));
        // Not just the right count: the right pairs, each once, no repeats.
        assertValidReparto(rounds, fullRoundRobin(ids), k);

        const bothOdd = n % 2 !== 0 && k % 2 !== 0;
        if (!bothOdd) {
          // Feasible case: matches the spec's own formula exactly, no
          // deviation at all.
          expect(roundsCount(n, k)).toBe(Math.ceil((n - 1) / k));
        }
      });
    }
  }

  // Pins the handful of concrete numbers from the coordinator's review,
  // computed independently from the general formula above.
  it("casos concretos verificados a mano: n=11/k=2->5, n=13/k=2->6, n=13/k=1->13, n=13/k=3->5, n=19/k=3->7", () => {
    expect(roundsCount(11, 2)).toBe(5);
    expect(roundsCount(13, 2)).toBe(6);
    expect(roundsCount(13, 1)).toBe(13);
    expect(roundsCount(13, 3)).toBe(5);
    expect(roundsCount(19, 3)).toBe(7);
  });
});

// ---------------------------------------------------------------------------
// AC-2: no player exceeds k matches in the same round
// ---------------------------------------------------------------------------

describe("AC-2: ningún jugador tiene más de k partidas en la misma ronda", () => {
  for (const n of SIZES) {
    for (const k of MATCHES_PER_ROUND) {
      it(`n=${n}, k=${k}`, () => {
        const ids = makeIds(n);
        const rounds = roundRobinRounds(ids, k);
        // assertValidReparto's cap check is exactly this criterion; it also
        // confirms the pair coverage is exact (no dup/missing), for free.
        assertValidReparto(rounds, fullRoundRobin(ids), k);
      });
    }
  }
});

// ---------------------------------------------------------------------------
// AC-3: even n — every player has exactly k matches per round, except maybe
// the last round, which can have fewer.
// ---------------------------------------------------------------------------

describe("AC-3: con n par, cada jugador tiene exactamente k partidas por ronda salvo en la última", () => {
  const EVEN_SIZES = [10, 12, 20];
  for (const n of EVEN_SIZES) {
    for (const k of MATCHES_PER_ROUND) {
      it(`n=${n}, k=${k}`, () => {
        const ids = makeIds(n);
        const rounds = roundRobinRounds(ids, k);
        rounds.forEach((round, index) => {
          const isLast = index === rounds.length - 1;
          for (const id of ids) {
            const count = countAppearances(round, id);
            if (isLast) {
              expect(count).toBeLessThanOrEqual(k);
            } else {
              expect(count).toBe(k);
            }
          }
        });
        // Plus the general check: exact pair coverage, no repeats beyond k.
        assertValidReparto(rounds, fullRoundRobin(ids), k);
      });
    }
  }
});

// ---------------------------------------------------------------------------
// AC-4: odd n — no bye Match, total stays C(n,2)
// ---------------------------------------------------------------------------

describe("AC-4: con n impar, ningún jugador queda con partida de bye", () => {
  const ODD_SIZES = [11, 13];
  for (const n of ODD_SIZES) {
    for (const k of MATCHES_PER_ROUND) {
      it(`n=${n}, k=${k}: exactamente C(n,2) partidas, ninguna con jugador vacío`, () => {
        const ids = makeIds(n);
        const rounds = roundRobinRounds(ids, k);
        const total = rounds.flat();
        expect(total).toHaveLength(expectedPairingCount(n));
        for (const p of total) {
          expect(p.homeId).toBeTruthy();
          expect(p.awayId).toBeTruthy();
          expect(p.homeId).not.toBe(p.awayId);
        }
        assertValidReparto(rounds, fullRoundRobin(ids), k);
      });
    }
  }
});

// ---------------------------------------------------------------------------
// AC-3 (extensión Walecki): n impar con matchesPerRound par — cupo uniforme,
// nadie descansa. Corrección de una revisión: §5.3 describe una consecuencia
// de agrupar jornadas de grado 1 (circle method con bye), no una regla — con
// la descomposición de Walecki (factores 2-regulares) para k par, ese
// descanso deja de existir por construcción. Lo normativo de §5.3 (no se
// crea Match de bye) sigue intacto y se comprueba en AC-4 de todas formas.
// ---------------------------------------------------------------------------

describe("AC-3 (Walecki): n impar con k par produce (n-1)/2 rondas con cupo uniforme de k, sin excepciones", () => {
  for (const n of [11, 13, 15, 17, 19]) {
    it(`n=${n}, k=2: (n-1)/2 rondas, cada jugador exactamente 2 partidas en TODAS las rondas`, () => {
      const ids = makeIds(n);
      const rounds = roundRobinRounds(ids, 2);

      expect(rounds).toHaveLength((n - 1) / 2);
      expect(roundsCount(n, 2)).toBe((n - 1) / 2);
      // Same as the spec's own literal formula: fully achievable here.
      expect(roundsCount(n, 2)).toBe(Math.ceil((n - 1) / 2));

      for (const round of rounds) {
        for (const id of ids) {
          expect(countAppearances(round, id)).toBe(2); // never less, nobody rests.
        }
      }

      const total = rounds.flat();
      expect(total).toHaveLength(expectedPairingCount(n));
      assertValidReparto(rounds, fullRoundRobin(ids), 2);
    });
  }
});

// ---------------------------------------------------------------------------
// Infactibilidad demostrada: n impar con matchesPerRound impar. K_n impar es
// "Clase 2" (Vizing): su índice cromático es n, no n-1. Con k=1 una ronda ES
// literalmente un emparejamiento, así que el mínimo real es n rondas, nunca
// n-1 — no es una limitación del algoritmo, es un hecho de teoría de grafos.
// ---------------------------------------------------------------------------

describe("infactibilidad demostrada: n impar con k impar necesita una ronda más que ceil((n-1)/k)", () => {
  for (const n of [11, 13, 15, 17, 19]) {
    it(`n=${n}, k=1: exactamente n rondas (K_n impar es Clase 2, no n-1)`, () => {
      expect(roundsCount(n, 1)).toBe(n);
      expect(roundRobinRounds(makeIds(n), 1)).toHaveLength(n);
    });
  }

  it("n=13, k=3: 5 rondas (no las 4 de ceil((13-1)/3), que exigirían un factor 3-regular imposible sobre 13 vértices)", () => {
    expect(roundsCount(13, 3)).toBe(5);
    expect(roundRobinRounds(makeIds(13), 3)).toHaveLength(5);
  });

  it("n=19, k=3: 7 rondas (no las 6 de ceil((19-1)/3))", () => {
    expect(roundsCount(19, 3)).toBe(7);
    expect(roundRobinRounds(makeIds(19), 3)).toHaveLength(7);
  });
});

// ---------------------------------------------------------------------------
// AC-5: determinism
// ---------------------------------------------------------------------------

describe("AC-5: el reparto es determinista", () => {
  it("roundRobinRounds: misma entrada, misma salida", () => {
    const ids = makeIds(13);
    expect(roundRobinRounds(ids, 2)).toEqual(roundRobinRounds(ids, 2));
  });

  it("roundRobinRounds: el orden de entrada de playerIds no importa", () => {
    const ids = makeIds(11);
    const shuffled = [...ids].reverse();
    expect(roundRobinRounds(ids, 2)).toEqual(roundRobinRounds(shuffled, 2));
  });

  it("assignPairsToRounds: misma entrada, misma salida (subgrafo arbitrario)", () => {
    const ids = makeIds(9);
    const pairs = fullRoundRobin(ids).filter((_, i) => i % 3 !== 0); // arbitrary subgraph
    const open = Array.from({ length: 10 }, (_, i) => i + 1);
    const first = assignPairsToRounds(pairs, ids, 2, open);
    const second = assignPairsToRounds(pairs, ids, 2, open);
    expect(first).toEqual(second);
    assertValidReparto(groupByRoundIndex(first), pairs, 2);
  });

  it("assignPairsToRounds: sobre K_n, misma salida que roundRobinRounds", () => {
    const ids = makeIds(12);
    const pairs = fullRoundRobin(ids);
    const roundsCountExpected = roundsCount(12, 2);
    const open = Array.from({ length: roundsCountExpected }, (_, i) => i + 1);
    const assigned = assignPairsToRounds(pairs, ids, 2, open);
    const viaCircleMethod = roundRobinRounds(ids, 2);

    // Same total, same "no player exceeds k per round" invariant, same
    // number of rounds used — i.e. optimal, equivalent to the circle method.
    expect(assigned).toHaveLength(pairs.length);
    const usedRoundIndexes = new Set(assigned.map((a) => a.roundIndex));
    expect(usedRoundIndexes.size).toBe(viaCircleMethod.length);
    assertValidReparto(groupByRoundIndex(assigned), pairs, 2);
  });
});

// ---------------------------------------------------------------------------
// AC-6: arbitrary subgraph respects AC-2 and never reassigns resolved pairs
// ---------------------------------------------------------------------------

describe("AC-6: repartir un subgrafo arbitrario respeta el criterio 2 y no reasigna partidas con Result", () => {
  it("respeta el cupo k por ronda sobre un subgrafo con huecos", () => {
    const ids = makeIds(12);
    const all = fullRoundRobin(ids);
    // Simulate: everything vs the first two players is already played
    // (has a Result) and therefore excluded from what gets redistributed.
    const alreadyPlayed = new Set(
      all.filter((p) => p.homeId === ids[0] || p.awayId === ids[0]).map(pairKey)
    );
    const pending = all.filter((p) => !alreadyPlayed.has(pairKey(p)));

    const open = Array.from({ length: 12 }, (_, i) => i + 1);
    const assigned = assignPairsToRounds(pending, ids, 2, open);

    assertValidReparto(groupByRoundIndex(assigned), pending, 2);
  });

  it("no incluye ni reasigna ninguna partida excluida por ya tener Result", () => {
    const ids = makeIds(8);
    const all = fullRoundRobin(ids);
    const resolvedKey = pairKey(all[0]);
    const pending = all.filter((p) => pairKey(p) !== resolvedKey);

    const open = Array.from({ length: 10 }, (_, i) => i + 1);
    const assigned = assignPairsToRounds(pending, ids, 2, open);

    expect(assigned.some((a) => pairKey(a) === resolvedKey)).toBe(false);
    expect(assigned).toHaveLength(pending.length);
    assertValidReparto(groupByRoundIndex(assigned), pending, 2);
  });
});

// ---------------------------------------------------------------------------
// Misra & Gries (SPEC §4.3's "coloreado voraz por grado descendente"):
// nunca usa más de Δ+1 colores sobre un subgrafo arbitrario.
//
// Revisión previa: la primera implementación era un voraz simple (elegir la
// arista de mayor grado combinado, asignar el color libre más pequeño), que
// *no* garantiza Δ+1 — solo 2Δ-1 en el peor caso (cota de libro de texto
// para un voraz en orden arbitrario) — y ese peor caso aparece precisamente
// en "K_n menos unas pocas aristas", la forma exacta de las partidas
// pendientes tras un alta a mitad de liga (§5.1) o un cambio de
// matchesPerRound (§5.5). Los 6 casos de abajo son exactamente los que lo
// detectaron: con el voraz simple gastaban hasta 15 colores donde Δ+1
// permite 12. Quedan pinneados como regresión con el número exacto que
// produce Misra & Gries (que además de cumplir Δ+1 es determinista, así que
// el número exacto — no solo "≤ Δ+1" — es estable de verdad).
// ---------------------------------------------------------------------------

describe("Misra & Gries: nunca usa más de Δ+1 colores (SPEC §4.3, corrige D4)", () => {
  function maxDegree(pairs: Pairing[]): number {
    const degree = new Map<string, number>();
    for (const p of pairs) {
      degree.set(p.homeId, (degree.get(p.homeId) ?? 0) + 1);
      degree.set(p.awayId, (degree.get(p.awayId) ?? 0) + 1);
    }
    return Math.max(...degree.values());
  }

  /**
   * Colors `pairs` with `assignPairsToRounds` at `matchesPerRound = 1`
   * (each "round" is then literally one color class — one journey), and
   * returns both the grouped rounds (for `assertValidReparto`) and how many
   * distinct colors were actually used.
   */
  function misraGriesRounds(
    pairs: Pairing[],
    ids: string[]
  ): { rounds: Pairing[][]; colorsUsed: number } {
    // Give it as many open rounds as pairs (upper bound, always enough for
    // matchesPerRound=1: one journey per round).
    const open = Array.from({ length: pairs.length + 1 }, (_, i) => i + 1);
    const assigned = assignPairsToRounds(pairs, ids, 1, open);
    const rounds = groupByRoundIndex(assigned);
    return { rounds, colorsUsed: rounds.length };
  }

  /** K_n with the first `removeCount` pairs (lexicographic order) removed. */
  function kMinus(n: number, removeCount: number): { ids: string[]; pairs: Pairing[] } {
    const ids = makeIds(n);
    const all = fullRoundRobin(ids);
    return { ids, pairs: all.slice(removeCount) };
  }

  // ---- Regression: the 6 cases that broke the earlier plain greedy. ----
  describe("regresión: los 6 casos que violaban Δ+1 con el voraz simple", () => {
    const cases: [name: string, n: number, removeCount: number, delta: number, expectedColors: number][] = [
      ["K_12 menos 1", 12, 1, 11, 12],
      ["K_11 menos 1", 11, 1, 10, 11],
      ["K_10 menos 1", 10, 1, 9, 10],
      ["K_13 menos 2", 13, 2, 12, 13],
      ["K_14 menos 3", 14, 3, 13, 14],
      ["K_15 menos 4", 15, 4, 14, 15],
    ];

    for (const [name, n, removeCount, delta, expectedColors] of cases) {
      it(`${name}: Δ=${delta}, usa exactamente ${expectedColors} colores (≤ Δ+1=${delta + 1}), coloreado válido`, () => {
        const { ids, pairs } = kMinus(n, removeCount);
        expect(maxDegree(pairs)).toBe(delta);
        const { rounds, colorsUsed } = misraGriesRounds(pairs, ids);
        expect(colorsUsed).toBeLessThanOrEqual(delta + 1);
        expect(colorsUsed).toBe(expectedColors); // pinned exact regression value.
        // Not just the color count: no round repeats a player, and every
        // pair of `pairs` is covered exactly once.
        assertValidReparto(rounds, pairs, 1);
      });
    }
  });

  // ---- "K_n menos 1 arista": el caso que más duele, para varios n. ----
  describe("K_n menos 1 arista, para varios n", () => {
    for (const n of [8, 9, 10, 11, 12, 13, 16, 20]) {
      it(`n=${n}`, () => {
        const { ids, pairs } = kMinus(n, 1);
        const delta = maxDegree(pairs);
        const { rounds, colorsUsed } = misraGriesRounds(pairs, ids);
        expect(colorsUsed).toBeLessThanOrEqual(delta + 1);
        assertValidReparto(rounds, pairs, 1);
      });
    }
  });

  it("subgrafo en estrella: un jugador con muchas pendientes, el resto con solo una", () => {
    const ids = makeIds(10);
    const hub = ids[0];
    const pairs = ids.slice(1).map((id) => ({
      homeId: hub < id ? hub : id,
      awayId: hub < id ? id : hub,
    }));
    const { rounds, colorsUsed } = misraGriesRounds(pairs, ids);
    expect(colorsUsed).toBeLessThanOrEqual(maxDegree(pairs) + 1);
    assertValidReparto(rounds, pairs, 1);
  });

  it("subgrafo con grados muy desiguales (algunos jugadores casi al día, otros con toda la liga pendiente)", () => {
    const ids = makeIds(14);
    const all = fullRoundRobin(ids);
    // Players 0-2 still have everything pending; the rest only have their
    // pairs against players 0-2 pending (already played among themselves).
    const heavy = new Set(ids.slice(0, 3));
    const pending = all.filter((p) => heavy.has(p.homeId) || heavy.has(p.awayId));
    const { rounds, colorsUsed } = misraGriesRounds(pending, ids);
    expect(colorsUsed).toBeLessThanOrEqual(maxDegree(pending) + 1);
    assertValidReparto(rounds, pending, 1);
  });

  it("subgrafo disperso (ciclo impar): grado bajo pero cromático impar", () => {
    const ids = makeIds(7);
    const pairs: Pairing[] = ids.map((id, i) => {
      const next = ids[(i + 1) % ids.length];
      return { homeId: id < next ? id : next, awayId: id < next ? next : id };
    });
    const { rounds, colorsUsed } = misraGriesRounds(pairs, ids);
    expect(colorsUsed).toBeLessThanOrEqual(maxDegree(pairs) + 1);
    assertValidReparto(rounds, pairs, 1);
  });

  // ---- Deterministic pseudo-random generator, reused by the property test
  // below (no Math.random — this keeps criterio 5, determinism, checkable). ----
  function pseudoRandom(seed: number) {
    let s = seed;
    return () => {
      s = (s * 1103515245 + 12345) & 0x7fffffff;
      return s / 0x7fffffff;
    };
  }

  it("varios subgrafos aleatorios con grados desiguales, mismo resultado", () => {
    for (const seed of [1, 2, 3]) {
      const rnd = pseudoRandom(seed * 97 + 13);
      const ids = makeIds(12);
      const all = fullRoundRobin(ids);
      const skewed = new Set(ids.slice(0, 3));
      const pending = all.filter((p) => {
        const isSkewed = skewed.has(p.homeId) || skewed.has(p.awayId);
        return rnd() < (isSkewed ? 0.9 : 0.3);
      });
      if (pending.length === 0) continue;
      const { rounds, colorsUsed } = misraGriesRounds(pending, ids);
      expect(colorsUsed).toBeLessThanOrEqual(maxDegree(pending) + 1);
      assertValidReparto(rounds, pending, 1);
    }
  });

  // ---- Property test: many sizes, densities and skews, deterministic PRNG. ----
  it("property test: Δ+1 se cumple y el coloreado es válido en decenas de subgrafos aleatorios deterministas (varios tamaños y densidades)", () => {
    let casesChecked = 0;
    for (let n = 5; n <= 20; n++) {
      for (const density of [0.15, 0.35, 0.5, 0.7, 0.9]) {
        for (let seed = 1; seed <= 2; seed++) {
          const rnd = pseudoRandom(n * 10007 + Math.round(density * 1000) + seed);
          const ids = makeIds(n);
          const all = fullRoundRobin(ids);
          const pending = density === 1 ? all : all.filter(() => rnd() < density);
          if (pending.length === 0) continue;
          casesChecked++;
          const delta = maxDegree(pending);
          const { rounds, colorsUsed } = misraGriesRounds(pending, ids);
          expect(colorsUsed).toBeLessThanOrEqual(delta + 1);
          assertValidReparto(rounds, pending, 1);
        }
      }
    }
    // Sanity: the loop above actually ran a meaningful number of cases.
    expect(casesChecked).toBeGreaterThan(100);
  });

  it("determinismo: el mismo subgrafo arbitrario da siempre el mismo número de colores y la misma asignación", () => {
    const { ids, pairs } = kMinus(14, 3);
    const open = Array.from({ length: pairs.length + 1 }, (_, i) => i + 1);
    const first = assignPairsToRounds(pairs, ids, 1, open);
    const second = assignPairsToRounds(pairs, ids, 1, open);
    expect(first).toEqual(second);
    assertValidReparto(groupByRoundIndex(first), pairs, 1);
  });

  // ---- The point of this whole block: prove the new assertions actually
  // catch a broken coloring, not just a bad color count. Forcing two
  // adjacent edges (sharing a player) to the same color simulates exactly
  // the bug this review is guarding against. ----
  it("las aserciones nuevas cazan un coloreado inválido (dos aristas adyacentes forzadas al mismo color)", () => {
    const ids = makeIds(6);
    const pairs = fullRoundRobin(ids);
    const { rounds } = misraGriesRounds(pairs, ids);
    // Corrupt a genuinely valid reparto: merge the first two rounds into
    // one. Since every round is itself a matching (SPEC §4.3), and two
    // different rounds necessarily share at least one player's pair of
    // matches, this reintroduces a repeated player within a single round —
    // exactly the class of bug a bare "colors <= Delta+1" count would miss.
    const corrupted = [
      [...rounds[0], ...rounds[1]],
      ...rounds.slice(2),
    ];
    expect(() => assertValidReparto(corrupted, pairs, 1)).toThrow();
  });
});

// ---------------------------------------------------------------------------
// AC-7: deriveDeadlines
// ---------------------------------------------------------------------------

describe("AC-7: fechas de ronda derivadas del mes de arranque", () => {
  it("marzo 2026, 6 rondas → 31 mar, 30 abr, 31 may, 30 jun, 31 jul, 31 ago de 2026", () => {
    const start = new Date(Date.UTC(2026, 2, 1)); // March 2026
    const deadlines = deriveDeadlines(start, 6);
    const expected = [
      Date.UTC(2026, 2, 31),
      Date.UTC(2026, 3, 30),
      Date.UTC(2026, 4, 31),
      Date.UTC(2026, 5, 30),
      Date.UTC(2026, 6, 31),
      Date.UTC(2026, 7, 31),
    ];
    expect(deadlines.map((d) => d.getTime())).toEqual(expected);
  });

  it("febrero de año bisiesto (2028) → 29 feb", () => {
    const start = new Date(Date.UTC(2028, 0, 1)); // January 2028 (leap year)
    const deadlines = deriveDeadlines(start, 2);
    expect(deadlines[0].getTime()).toBe(Date.UTC(2028, 0, 31));
    expect(deadlines[1].getTime()).toBe(Date.UTC(2028, 1, 29));
  });

  it("febrero de año NO bisiesto (2026) → 28 feb", () => {
    const start = new Date(Date.UTC(2026, 1, 1)); // February 2026
    const deadlines = deriveDeadlines(start, 1);
    expect(deadlines[0].getTime()).toBe(Date.UTC(2026, 1, 28));
  });

  it("meses de 30 y 31 días consecutivos", () => {
    const start = new Date(Date.UTC(2026, 8, 1)); // September (30 days)
    const deadlines = deriveDeadlines(start, 2);
    expect(deadlines[0].getTime()).toBe(Date.UTC(2026, 8, 30));
    expect(deadlines[1].getTime()).toBe(Date.UTC(2026, 9, 31)); // October (31 days)
  });

  it("cruce de fin de año: diciembre → enero del siguiente año", () => {
    const start = new Date(Date.UTC(2026, 11, 1)); // December 2026
    const deadlines = deriveDeadlines(start, 2);
    expect(deadlines[0].getTime()).toBe(Date.UTC(2026, 11, 31));
    expect(deadlines[1].getTime()).toBe(Date.UTC(2027, 0, 31));
  });

  it("roundsCount=0 devuelve []", () => {
    const start = new Date(Date.UTC(2026, 2, 1));
    expect(deriveDeadlines(start, 0)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// AC-10 / AC-11: roundQuota + quotaLabel
// ---------------------------------------------------------------------------

describe("AC-10: el contador de cupo dice «falta N de K» o «cumplido»", () => {
  it("2 exigidas, 1 resuelta → «falta 1 de 2»", () => {
    expect(quotaLabel(1, 2)).toBe("falta 1 de 2");
  });

  it("2 exigidas, 0 resueltas → «faltan 2 de 2»", () => {
    expect(quotaLabel(0, 2)).toBe("faltan 2 de 2");
  });

  it("última ronda con 1 exigida, 0 resueltas → «falta 1 de 1»", () => {
    expect(quotaLabel(0, 1)).toBe("falta 1 de 1");
  });

  it("resuelto == exigido → «cumplido»", () => {
    expect(quotaLabel(2, 2)).toBe("cumplido");
  });

  it("0 exigidas (jugador que descansa con matchesPerRound=1) → «cumplido»", () => {
    expect(quotaLabel(0, 0)).toBe("cumplido");
  });
});

describe("AC-11: una partida con scheduledAt futuro y sin Result cuenta como pendiente", () => {
  it("hasResult=false no cuenta como resuelta, tenga o no fecha futura agendada", () => {
    const matches: RoundMatchInput[] = [
      {
        roundIndex: 3,
        playerHomeId: "p1",
        playerAwayId: "p2",
        // scheduledAt is deliberately not part of RoundMatchInput: the quota
        // is computed from `hasResult` alone (SPEC §4.6, criterio 11), so a
        // match agreed for two weeks from now with no Result yet still
        // counts as pending.
        hasResult: false,
      },
      { roundIndex: 3, playerHomeId: "p1", playerAwayId: "p3", hasResult: true },
    ];
    const quota = roundQuota("p1", 3, matches);
    expect(quota).toEqual({ required: 2, resolved: 1 });
    expect(quotaLabel(quota.resolved, quota.required)).toBe("falta 1 de 2");
  });

  it("filtra por ronda y por jugador (ni otras rondas ni otros jugadores cuentan)", () => {
    const matches: RoundMatchInput[] = [
      { roundIndex: 1, playerHomeId: "p1", playerAwayId: "p2", hasResult: true },
      { roundIndex: 2, playerHomeId: "p1", playerAwayId: "p3", hasResult: false },
      { roundIndex: 2, playerHomeId: "p4", playerAwayId: "p5", hasResult: false },
      { roundIndex: 2, playerHomeId: "p6", playerAwayId: "p1", hasResult: true },
    ];
    expect(roundQuota("p1", 2, matches)).toEqual({ required: 2, resolved: 1 });
  });

  it("jugador sin partidas en esa ronda → 0 de 0 (cumplido)", () => {
    const matches: RoundMatchInput[] = [
      { roundIndex: 1, playerHomeId: "p2", playerAwayId: "p3", hasResult: true },
    ];
    expect(roundQuota("p1", 1, matches)).toEqual({ required: 0, resolved: 0 });
  });

  it("jugador como awayId también cuenta", () => {
    const matches: RoundMatchInput[] = [
      { roundIndex: 1, playerHomeId: "p2", playerAwayId: "p1", hasResult: false },
    ];
    expect(roundQuota("p1", 1, matches)).toEqual({ required: 1, resolved: 0 });
  });
});

// ---------------------------------------------------------------------------
// Guard / error-path coverage (defensive, not spec-numbered but required for
// AC-43's 100% branch coverage — every guard this module has needs both its
// happy and its throwing path exercised).
// ---------------------------------------------------------------------------

describe("guardas defensivas", () => {
  it("roundsCount: menos de 2 jugadores → 0 rondas", () => {
    expect(roundsCount(0, 2)).toBe(0);
    expect(roundsCount(1, 2)).toBe(0);
  });

  it("roundsCount: matchesPerRound inválido lanza un error", () => {
    expect(() => roundsCount(10, 0)).toThrow(/matchesPerRound/);
    expect(() => roundsCount(10, -1)).toThrow(/matchesPerRound/);
    expect(() => roundsCount(10, 1.5)).toThrow(/matchesPerRound/);
  });

  it("roundRobinRounds: menos de 2 jugadores (tras deduplicar) → []", () => {
    expect(roundRobinRounds([], 2)).toEqual([]);
    expect(roundRobinRounds(["only-one"], 2)).toEqual([]);
    // Duplicated id collapses to 1 unique player.
    expect(roundRobinRounds(["dup", "dup"], 2)).toEqual([]);
  });

  it("roundRobinRounds: matchesPerRound inválido lanza un error", () => {
    expect(() => roundRobinRounds(makeIds(4), 0)).toThrow(/matchesPerRound/);
  });

  it("assignPairsToRounds: matchesPerRound inválido lanza un error", () => {
    const ids = makeIds(4);
    expect(() =>
      assignPairsToRounds(fullRoundRobin(ids), ids, 0, [1, 2, 3])
    ).toThrow(/matchesPerRound/);
  });

  it("assignPairsToRounds: sin pares pendientes (subgrafo vacío, no K_n) no exige ninguna ronda", () => {
    const ids = makeIds(5);
    // Not the complete graph over 5 players (isCompleteGraph requires
    // C(5,2)=10 pairs), so this exercises misraGriesColoring's own
    // no-edges guard, not decomposeCompleteGraph's.
    const assigned = assignPairsToRounds([], ids, 2, [1, 2, 3]);
    expect(assigned).toEqual([]);
  });

  it("assignPairsToRounds: un homeId fuera de playerIds lanza un error", () => {
    const ids = makeIds(3);
    const pairs: Pairing[] = [{ homeId: "player-999", awayId: ids[0] }];
    expect(() => assignPairsToRounds(pairs, ids, 1, [1, 2, 3])).toThrow(
      /playerIds/
    );
  });

  it("assignPairsToRounds: un awayId fuera de playerIds lanza un error", () => {
    const ids = makeIds(3);
    const pairs: Pairing[] = [{ homeId: ids[0], awayId: "player-999" }];
    expect(() => assignPairsToRounds(pairs, ids, 1, [1, 2, 3])).toThrow(
      /playerIds/
    );
  });

  it("assignPairsToRounds: no caben las rondas abiertas dadas → lanza un error", () => {
    const ids = makeIds(4);
    // K_4 needs 3 rounds at matchesPerRound=1; only 1 open round given.
    expect(() =>
      assignPairsToRounds(fullRoundRobin(ids), ids, 1, [1])
    ).toThrow(/round/i);
  });

  it("assignPairsToRounds: detecta K_n aunque algunos pares vengan con home/away invertido", () => {
    const ids = makeIds(4);
    // Same unordered pairs as fullRoundRobin(ids), but half of them with
    // homeId/awayId swapped — completeness detection must be orientation-
    // agnostic (normalised via pairKey internally).
    const pairs: Pairing[] = fullRoundRobin(ids).map((p, i) =>
      i % 2 === 0 ? { homeId: p.awayId, awayId: p.homeId } : p
    );
    const open = [1, 2, 3];
    const assigned = assignPairsToRounds(pairs, ids, 2, open);
    // Optimal (K_4, even): exactly roundsCount(4,2)=2 rounds used, not more.
    const usedRounds = new Set(assigned.map((a) => a.roundIndex));
    expect(usedRounds.size).toBe(roundsCount(4, 2));
  });

  it("assignPairsToRounds: un duplicado exacto entre pares hace que no se detecte como K_n (usa el voraz igualmente)", () => {
    const ids = makeIds(3);
    // Same count as C(3,2)=3 but with a duplicate and a missing pair — not
    // the complete graph, so it must fall back to the greedy path and still
    // produce a valid, fully-covering assignment.
    const pairs: Pairing[] = [
      { homeId: ids[0], awayId: ids[1] },
      { homeId: ids[0], awayId: ids[1] },
      { homeId: ids[0], awayId: ids[2] },
    ];
    const assigned = assignPairsToRounds(pairs, ids, 1, [1, 2, 3]);
    expect(assigned).toHaveLength(3);
  });
});
