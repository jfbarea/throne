// Content for the public /guia page — pure data, no JSX, so it can be
// unit-tested in Vitest without a DOM (SPEC's "no criterion checked by eye").
// Kept in plain Spanish and free of technical jargon: this is written for
// players, not for the docs in `docs/guia-de-uso.md` (which stays as the
// engineering-facing source and is not copied verbatim here).

export type GuideSection = {
  /** Two-digit label shown as the small-caps marker, matching /bases. */
  label: string;
  title: string;
  /** Plain bullet text (no markup) — the page wraps it with the shared
   * `Rule`/`S` components for styling and inline emphasis. */
  bullets: string[];
};

export const GUIDE_SECTIONS: GuideSection[] = [
  {
    label: "01",
    title: "Cómo entrar",
    bullets: [
      "Entra en /login con tu nombre y tu código de acceso de 8 caracteres — te lo da el admin.",
      "El admin tiene su propia pestaña «Admin» en el login, con su propia clave: no comparte el mismo formulario que los jugadores.",
      "La sesión se mantiene con una cookie. Para salir, usa el botón de cerrar sesión.",
    ],
  },
  {
    label: "02",
    title: "Apuntar un resultado",
    bullets: [
      "Ve a Mis partidas y localiza la partida sin resultado. La apunta cualquiera de los dos jugadores que la disputó.",
      "Cuenta en la clasificación en cuanto la apuntas — no hace falta que el rival la confirme. No hay disputas: eso no existe.",
      "Si alguien se equivoca al escribir los VP, el otro participante puede corregirlo entrando y editando el resultado.",
    ],
  },
  {
    label: "03",
    title: "Incomparecencia y 0-0",
    bullets: [
      "Si no vais a jugar una partida y os ponéis de acuerdo en quién gana, cualquiera de los dos declara la incomparecencia: se apunta un 80-0 a favor de quien acordéis.",
      "Ese 80-0 no da el punto de bonus, aunque la liga los tenga activados.",
      "Si no llegáis a un acuerdo antes de que cierre la ronda, la partida queda en 0-0 y os lleváis un punto cada uno — no tenéis que hacer nada, lo hace el cierre de la ronda.",
      "Una partida que ya se jugó de verdad, con su resultado apuntado, no la puede convertir un jugador en incomparecencia. Eso, si hace falta corregirlo, solo lo hace el admin.",
    ],
  },
  {
    label: "04",
    title: "Tu cupo de la ronda",
    bullets: [
      "Cada mes (cada ronda) te toca jugar un número de partidas — 2 por defecto, puede ser otro según la liga.",
      "En Mis partidas ves tus partidas agrupadas por ronda, con cuántas te faltan («falta 1 de 2»). En Rondas ves el cupo de todo el mundo.",
      "Adelantar está permitido: puedes jugar en octubre una partida que te tocaba en diciembre. Pero eso no te libra de las de tu ronda en curso — cuando llegue su cierre, cuentan igual.",
    ],
  },
  {
    label: "05",
    title: "Qué pasa al cerrarse la ronda",
    bullets: [
      "El admin cierra cada ronda a partir de su fecha límite; no es automático, así que puede haber margen si hace falta un poco más de tiempo.",
      "Al cerrarla, lo que quedó sin jugar se salda como 0-0 (ver arriba). Las partidas que ya tenían resultado no se tocan.",
      "Una vez cerrada la ronda, ya no puedes apuntar resultados nuevos en ella; solo el admin puede corregir algo si hace falta.",
    ],
  },
];
