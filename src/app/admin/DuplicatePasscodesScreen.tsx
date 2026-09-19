"use client";

// DuplicatePasscodesScreen — the "pantalla de passcodes" that spec §2.9
// requires after duplicating a league: "termina en una pantalla que lista,
// una sola vez, los pares displayName + passcode de todos los jugadores
// creados, con opción de copiarlos en bloque."
//
// Multi-liga hito de integración I1: `DuplicateLeagueAction`
// (src/components/admin/DuplicateLeagueAction.tsx, lane D) already returns
// `{ newLeagueId, newLeagueSlug, generatedPasscodes }` via its `onDuplicated`
// callback — that part was built against the C2 contract. What never got
// built is this screen: lane D left it explicitly for lane B
// (league-actions-contract.ts: "lane B decides where that screen lives"),
// and B finished before D published the callback shape, so the seam went
// unowned. This file closes it.
//
// Shown once, as a full-screen overlay (spec: "una sola vez") — dismissing
// it is the only way past it, same convention as PlayerCreateForm's
// one-time passcode banner (src/app/admin/[slug]/jugadores/PlayerCreateForm.tsx)
// scaled up to a list. There is no way back in: the plaintext passcode is
// never persisted (only its hash), so the sole recovery path after closing
// is `resetPlayerPasscode`, player by player, from that same league's
// jugadores screen (spec §2.9).

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/Button";
import { Eyebrow } from "@/components/Eyebrow";
import { CheckCircle, CopySimple, Warning } from "@phosphor-icons/react";

interface GeneratedPasscode {
  displayName: string;
  plainPasscode: string;
}

interface DuplicatePasscodesScreenProps {
  leagueSlug: string;
  passcodes: GeneratedPasscode[];
  onClose: () => void;
}

export function DuplicatePasscodesScreen({
  leagueSlug,
  passcodes,
  onClose,
}: DuplicatePasscodesScreenProps) {
  const [copiedAll, setCopiedAll] = useState(false);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);

  const blockText = passcodes
    .map((p) => `${p.displayName}: ${p.plainPasscode}`)
    .join("\n");

  async function handleCopyAll() {
    try {
      await navigator.clipboard.writeText(blockText);
      setCopiedAll(true);
      setTimeout(() => setCopiedAll(false), 2000);
    } catch {
      // Clipboard unavailable — every passcode is still `select-all`-able
      // text, so the admin can select and copy by hand.
    }
  }

  async function handleCopyOne(index: number) {
    try {
      await navigator.clipboard.writeText(passcodes[index].plainPasscode);
      setCopiedIndex(index);
      setTimeout(() => setCopiedIndex(null), 2000);
    } catch {
      // Same fallback as handleCopyAll.
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto px-4 py-8"
      style={{ background: "rgba(10, 9, 8, 0.85)" }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="duplicate-passcodes-title"
    >
      <div
        className="w-full max-w-lg rounded-[var(--radius-sm)] border p-6 space-y-5"
        style={{ background: "var(--surface)", borderColor: "var(--border)" }}
      >
        <div>
          <Eyebrow>Liga duplicada</Eyebrow>
          <h2
            id="duplicate-passcodes-title"
            className="mt-2 text-[20px] font-semibold"
            style={{ fontFamily: "var(--font-display)", color: "var(--fg)" }}
          >
            Códigos de acceso generados
          </h2>
          <p
            className="mt-1 text-[13px]"
            style={{ color: "var(--fg-muted)", fontFamily: "var(--font-sans)" }}
          >
            La liga nueva está lista en{" "}
            <Link
              href={`/admin/${leagueSlug}/liga`}
              className="underline"
              style={{ color: "var(--accent)" }}
            >
              /admin/{leagueSlug}/liga
            </Link>
            .
          </p>
        </div>

        <div
          className="flex items-start gap-2 rounded border px-3 py-3"
          style={{
            borderColor: "rgba(201,166,107,0.4)",
            background: "rgba(201,166,107,0.08)",
          }}
        >
          <Warning
            size={16}
            weight="fill"
            style={{ color: "var(--accent)", flexShrink: 0, marginTop: 1 }}
          />
          <p
            className="text-[12px] leading-[16px]"
            style={{ color: "var(--fg-muted)", fontFamily: "var(--font-sans)" }}
          >
            Estos códigos solo se muestran una vez. Si cierras esta pantalla
            sin copiarlos, no se podrán recuperar — solo resetear, jugador a
            jugador, desde la pantalla de jugadores de esta liga.
          </p>
        </div>

        <ul className="space-y-2 max-h-[320px] overflow-y-auto">
          {passcodes.map((p, i) => (
            <li key={`${p.displayName}-${i}`} className="flex items-center gap-3">
              <span
                className="flex-1 min-w-0 truncate text-[13px] font-semibold"
                style={{ fontFamily: "var(--font-sans)", color: "var(--fg)" }}
              >
                {p.displayName}
              </span>
              <code
                className="px-3 py-1.5 rounded text-[14px] font-bold tracking-[0.1em] select-all"
                style={{
                  fontFamily: "var(--font-mono)",
                  background: "var(--bg-raised)",
                  border: "1px solid var(--border)",
                  color: "var(--fg)",
                }}
              >
                {p.plainPasscode}
              </code>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => handleCopyOne(i)}
                icon={<CopySimple size={14} />}
              >
                {copiedIndex === i ? "¡Copiado!" : "Copiar"}
              </Button>
            </li>
          ))}
        </ul>

        <div className="flex flex-wrap items-center gap-2 pt-1">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={handleCopyAll}
            icon={<CheckCircle size={14} />}
          >
            {copiedAll ? "¡Todos copiados!" : "Copiar todos"}
          </Button>
          <Button type="button" variant="primary" size="sm" onClick={onClose}>
            He anotado los códigos — cerrar
          </Button>
        </div>
      </div>
    </div>
  );
}
