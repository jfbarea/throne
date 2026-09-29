// t00 (contratos-y-dominio) · plan/partidas-por-jornada/PLAN.md.
// Spec: plan/specs/partidas-por-jornada.md — §4.1/§5 (CA-7), §4.2 (CA-11u),
// §4.4 (parte de CA-6), §4.6 (CA-15u, CA-16u).

import { describe, it, expect } from "vitest";
import {
  pickCurrentRoundId,
  type CurrentRoundInput,
} from "@/server/round-ui";
import { foldText, matchesPlayerQuery } from "@/server/match-search";
import {
  resolveVista,
  isPendingMatch,
  matchesStatusFilter,
} from "@/server/partidas-view";

describe("CA-7: pickCurrentRoundId", () => {
  const now = new Date("2026-06-15T12:00:00Z");

  it("entre abiertas no vencidas, gana la de deadline más cercano", () => {
    const rounds: CurrentRoundInput[] = [
      { id: "r1", index: 1, deadline: new Date("2026-05-01"), closedAt: null },
      { id: "r2", index: 2, deadline: new Date("2026-07-01"), closedAt: new Date("2026-06-01") },
      { id: "r3", index: 3, deadline: new Date("2026-08-01"), closedAt: null },
      { id: "r4", index: 4, deadline: new Date("2026-09-01"), closedAt: null },
    ];

    expect(pickCurrentRoundId(rounds, now)).toBe("r3");
  });

  it("si todas las abiertas han vencido, gana la abierta de deadline más reciente", () => {
    const rounds: CurrentRoundInput[] = [
      { id: "r1", index: 1, deadline: new Date("2026-01-01"), closedAt: null },
      { id: "r2", index: 2, deadline: new Date("2026-03-01"), closedAt: null },
      { id: "r3", index: 3, deadline: new Date("2026-02-01"), closedAt: null },
    ];

    expect(pickCurrentRoundId(rounds, now)).toBe("r2");
  });

  it("sin rondas abiertas, devuelve null", () => {
    const rounds: CurrentRoundInput[] = [
      { id: "r1", index: 1, deadline: new Date("2026-01-01"), closedAt: new Date("2026-01-05") },
      { id: "r2", index: 2, deadline: new Date("2026-09-01"), closedAt: new Date("2026-09-05") },
    ];

    expect(pickCurrentRoundId(rounds, now)).toBeNull();
  });

  it("con lista vacía, devuelve null", () => {
    expect(pickCurrentRoundId([], now)).toBeNull();
  });

  it("empate de deadline entre abiertas no vencidas: gana el índice menor", () => {
    const rounds: CurrentRoundInput[] = [
      { id: "r-hi", index: 5, deadline: new Date("2026-07-01"), closedAt: null },
      { id: "r-lo", index: 2, deadline: new Date("2026-07-01"), closedAt: null },
    ];

    expect(pickCurrentRoundId(rounds, now)).toBe("r-lo");
  });

  it("empate de deadline entre abiertas vencidas: gana el índice menor", () => {
    const rounds: CurrentRoundInput[] = [
      { id: "r-hi", index: 5, deadline: new Date("2026-01-01"), closedAt: null },
      { id: "r-lo", index: 2, deadline: new Date("2026-01-01"), closedAt: null },
    ];

    expect(pickCurrentRoundId(rounds, now)).toBe("r-lo");
  });

  it("deadline igual al instante actual cuenta como no vencida", () => {
    const rounds: CurrentRoundInput[] = [
      { id: "r1", index: 1, deadline: now, closedAt: null },
      { id: "r2", index: 2, deadline: new Date("2026-08-01"), closedAt: null },
    ];

    expect(pickCurrentRoundId(rounds, now)).toBe("r1");
  });

  it("una abierta vencida no le quita el sitio a otra en curso", () => {
    const rounds: CurrentRoundInput[] = [
      { id: "expired", index: 1, deadline: new Date("2026-01-01"), closedAt: null },
      { id: "current", index: 2, deadline: new Date("2026-07-01"), closedAt: null },
    ];

    expect(pickCurrentRoundId(rounds, now)).toBe("current");
  });
});

describe("CA-11u: matchesPlayerQuery / foldText", () => {
  it("casa sin distinguir mayúsculas ni acentos", () => {
    expect(foldText("Martín")).toBe("martin");
    expect(
      matchesPlayerQuery(
        { playerHomeName: "Martín", playerAwayName: "Beta" },
        "martin"
      )
    ).toBe(true);
  });

  it("recorta espacios y con needle vacía casa todo", () => {
    expect(
      matchesPlayerQuery(
        { playerHomeName: "Alfa", playerAwayName: "Beta" },
        "   "
      )
    ).toBe(true);
    expect(
      matchesPlayerQuery(
        { playerHomeName: "Alfa", playerAwayName: "Beta" },
        ""
      )
    ).toBe(true);
  });

  it("con playerAway null, solo casa por el nombre del local", () => {
    const match = { playerHomeName: "Martín", playerAwayName: null };
    expect(matchesPlayerQuery(match, "martin")).toBe(true);
    expect(matchesPlayerQuery(match, "beta")).toBe(false);
  });

  it("no casa un texto ausente de ambos nombres", () => {
    expect(
      matchesPlayerQuery(
        { playerHomeName: "Alfa", playerAwayName: "Beta" },
        "gamma"
      )
    ).toBe(false);
  });
});

describe("CA-6u: resolveVista", () => {
  it("un jugador siempre resuelve MIAS, aunque pida ?vista=todas", () => {
    expect(resolveVista("PLAYER", "todas")).toBe("MIAS");
    expect(resolveVista("PLAYER", undefined)).toBe("MIAS");
  });

  it("un admin con ?vista=todas resuelve TODAS", () => {
    expect(resolveVista("ADMIN", "todas")).toBe("TODAS");
  });

  it("un admin sin parámetro, o con un valor desconocido, resuelve MIAS", () => {
    expect(resolveVista("ADMIN", undefined)).toBe("MIAS");
    expect(resolveVista("ADMIN", "otra-cosa")).toBe("MIAS");
  });

  it("un admin con el parámetro repetido en la URL toma el primer valor", () => {
    expect(resolveVista("ADMIN", ["todas", "mias"])).toBe("TODAS");
  });
});

describe("CA-15u/CA-16u: isPendingMatch / matchesStatusFilter", () => {
  it("SCHEDULED sin resultado es pendiente; cualquier otra combinación no", () => {
    expect(isPendingMatch({ status: "SCHEDULED", result: null })).toBe(true);
    expect(isPendingMatch({ status: "REPORTED", result: {} })).toBe(false);
    expect(isPendingMatch({ status: "CONFIRMED", result: {} })).toBe(false);
    expect(isPendingMatch({ status: "DISPUTED", result: {} })).toBe(false);
  });

  it("PENDIENTES solo deja las pendientes; JUGADAS solo las que no lo son; TODAS deja todo", () => {
    const pending = { id: "m1", status: "SCHEDULED", result: null };
    const played = { id: "m2", status: "REPORTED", result: {} };
    const legacy = { id: "m3", status: "CONFIRMED", result: {} };

    expect(matchesStatusFilter(pending, "PENDIENTES")).toBe(true);
    expect(matchesStatusFilter(played, "PENDIENTES")).toBe(false);
    expect(matchesStatusFilter(legacy, "PENDIENTES")).toBe(false);

    expect(matchesStatusFilter(pending, "JUGADAS")).toBe(false);
    expect(matchesStatusFilter(played, "JUGADAS")).toBe(true);
    expect(matchesStatusFilter(legacy, "JUGADAS")).toBe(true);

    expect(matchesStatusFilter(pending, "TODAS")).toBe(true);
    expect(matchesStatusFilter(played, "TODAS")).toBe(true);
  });

  it("una recién resuelta sigue casando con PENDIENTES si su id está en el set sticky", () => {
    const resolvedWhileWatched = { id: "m1", status: "REPORTED", result: {} };
    const sticky = new Set(["m1"]);

    expect(matchesStatusFilter(resolvedWhileWatched, "PENDIENTES")).toBe(false);
    expect(matchesStatusFilter(resolvedWhileWatched, "PENDIENTES", sticky)).toBe(true);
  });

  it("el set sticky no afecta a JUGADAS: una resuelta sigue casando igual", () => {
    const resolved = { id: "m1", status: "REPORTED", result: {} };
    const sticky = new Set(["m1"]);

    expect(matchesStatusFilter(resolved, "JUGADAS", sticky)).toBe(true);
  });
});
