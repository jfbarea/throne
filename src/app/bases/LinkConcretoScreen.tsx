// "/bases" with no session and no single obvious league to jump to
// (multi-liga spec §2.11, §4.3). Queries nothing: an index of leagues would
// leak which ones exist to an anonymous visitor, which is exactly what
// §2.11 forbids ("un índice público de ligas... no existe en ningún caso").
import Link from "next/link";
import { Eyebrow } from "@/components";

export function LinkConcretoScreen() {
  return (
    <div
      className="flex min-h-screen flex-col items-center justify-center gap-3 px-4 text-center"
      style={{ background: "var(--bg)", color: "var(--fg)" }}
    >
      <Eyebrow as="p">throne</Eyebrow>
      <h1
        className="text-[26px] leading-tight font-semibold"
        style={{ fontFamily: "var(--font-display)", color: "var(--fg)" }}
      >
        Bases de la liga
      </h1>
      <p
        className="max-w-[48ch] text-[14px] leading-[22px]"
        style={{ color: "var(--fg-muted)", fontFamily: "var(--font-sans)" }}
      >
        No hay una única liga en throne a la que llevarte directamente. Usa el
        enlace de bases que te haya pasado tu organizador — tiene esta forma:{" "}
        <code>/liga/&lt;tu-liga&gt;/bases</code> — o entra con tu cuenta si ya
        tienes una.
      </p>
      <Link
        href="/login"
        className="mt-2 text-[14px] font-semibold no-underline"
        style={{ color: "var(--accent)" }}
      >
        Entrar
      </Link>
    </div>
  );
}
