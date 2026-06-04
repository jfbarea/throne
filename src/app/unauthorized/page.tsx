// /unauthorized — shown when a player tries to access an admin-only route.

import { Card, CardEyebrow, CardTitle } from "@/components/Card";
import { Eyebrow } from "@/components/Eyebrow";
import { ShieldSlash } from "@phosphor-icons/react/dist/ssr";
import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Sin acceso — throne",
};

export default function UnauthorizedPage() {
  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center px-4 py-12"
      style={{ background: "var(--bg)", color: "var(--fg)" }}
    >
      <div className="mb-10 text-center">
        <div className="flex items-center justify-center gap-2 mb-3">
          <span style={{ color: "var(--accent)", fontSize: 28 }}>✦</span>
          <span
            className="text-[32px] font-semibold leading-none"
            style={{ fontFamily: "var(--font-display)", color: "var(--fg)" }}
          >
            throne
          </span>
        </div>
      </div>

      <Card className="w-full max-w-[380px]">
        <CardEyebrow>Acceso denegado</CardEyebrow>
        <CardTitle>Sin autorización</CardTitle>

        <div className="flex flex-col items-center gap-4 py-4">
          <ShieldSlash
            size={48}
            style={{ color: "var(--danger)" }}
            weight="thin"
          />
          <p
            className="text-center text-[14px]"
            style={{ color: "var(--fg-muted)", fontFamily: "var(--font-sans)" }}
          >
            No tienes permisos para acceder a esta sección. Esta área es solo
            para el administrador de la liga.
          </p>
        </div>

        <Link
          href="/"
          className="mt-2 flex w-full items-center justify-center px-[18px] py-[11px] text-[14px] font-semibold leading-none border rounded-[var(--radius-sm)] transition-all duration-[120ms] cursor-pointer"
          style={{
            fontFamily: "var(--font-sans)",
            background: "var(--surface)",
            color: "var(--fg)",
            borderColor: "var(--border-strong)",
          }}
        >
          Volver al inicio
        </Link>
      </Card>

      <div className="mt-8">
        <Eyebrow>throne · Hito 4</Eyebrow>
      </div>
    </div>
  );
}
