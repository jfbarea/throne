// "Esa liga no existe" for the PUBLIC bases page — multi-liga spec §5.8.1.
// Deliberately NOT `LeagueNotFoundScreen` (src/components, owned by lane B
// after C2): that screen lists every league for the admin to pick the right
// one. This route has no session to know who's asking, so listing anything
// here would leak which leagues exist to whoever guessed a slug — the exact
// thing §2.11 says the public bases route must never do. This component
// queries nothing; it can't leak what it never asked for.
import Link from "next/link";
import { Eyebrow } from "@/components";

export function BasesNotFound() {
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
        Esa liga no existe
      </h1>
      <p
        className="max-w-[48ch] text-[14px] leading-[22px]"
        style={{ color: "var(--fg-muted)", fontFamily: "var(--font-sans)" }}
      >
        El enlace que has usado no corresponde a ninguna liga de throne.
        Comprueba que lo has copiado bien, o entra con tu cuenta si ya tienes
        una.
      </p>
      <Link
        href="/login"
        className="mt-2 text-[14px] font-semibold no-underline"
        style={{ color: "var(--accent)" }}
      >
        Ir a iniciar sesión
      </Link>
    </div>
  );
}
