"use client";

// PlayerCreateForm — form for creating a new player.
// Shows the generated passcode ONCE after creation.
// SPEC §6: passcode is shown in plain text to the admin at creation/reset.
// After dismissal the plain text is gone; only the hash remains in DB.

import { useState, useTransition } from "react";
import { Button } from "@/components/Button";
import { Input } from "@/components/Input";
import { Card, CardEyebrow, CardTitle } from "@/components/Card";
import { FactionSelect } from "@/components/FactionSelect";
import { serialiseFactions } from "@/lib/factions";
import { createPlayer } from "@/server/league-actions";
import { UserPlus, CopySimple, CheckCircle } from "@phosphor-icons/react";

interface PlayerCreateFormProps {
  leagueId: string;
  /** Called after successful creation so the list can refresh. */
  onCreated?: () => void;
}

export function PlayerCreateForm({ leagueId, onCreated }: PlayerCreateFormProps) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});

  // Form state
  const [displayName, setDisplayName] = useState("");
  const [factions, setFactions] = useState<string[]>([]);
  const [role, setRole] = useState<"PLAYER" | "ADMIN">("PLAYER");

  // One-time passcode display state
  const [plainPasscode, setPlainPasscode] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setFieldErrors({});
    setPlainPasscode(null);
    setCopied(false);

    startTransition(async () => {
      const result = await createPlayer(leagueId, {
        displayName: displayName.trim(),
        faction: serialiseFactions(factions),
        role,
      });

      if (!result.ok) {
        setError(result.error);
        setFieldErrors(result.fieldErrors ?? {});
        return;
      }

      // Show the passcode once and reset form for next player.
      setPlainPasscode(result.data.plainPasscode);
      setDisplayName("");
      setFactions([]);
      setRole("PLAYER");
      onCreated?.();
    });
  }

  async function handleCopy() {
    if (!plainPasscode) return;
    try {
      await navigator.clipboard.writeText(plainPasscode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard not available — user can copy manually
    }
  }

  function handleDismissPasscode() {
    setPlainPasscode(null);
    setCopied(false);
  }

  return (
    <div className="space-y-4">
      {/* One-time passcode banner — displayed only right after creation */}
      {plainPasscode && (
        <div
          className="rounded border px-4 py-4 space-y-3"
          style={{
            background: "rgba(201,166,107,0.08)",
            borderColor: "rgba(201,166,107,0.4)",
          }}
        >
          <div className="flex items-start gap-2">
            <CheckCircle
              size={18}
              style={{ color: "var(--accent)", flexShrink: 0, marginTop: 1 }}
            />
            <div className="min-w-0">
              <p
                className="text-[13px] font-semibold"
                style={{ color: "var(--accent)", fontFamily: "var(--font-sans)" }}
              >
                ¡Jugador creado! Copia el código de acceso ahora.
              </p>
              <p
                className="mt-0.5 text-[12px]"
                style={{ color: "var(--fg-muted)", fontFamily: "var(--font-sans)" }}
              >
                Este código solo se muestra una vez. Después no se podrá
                recuperar — solo resetear.
              </p>
            </div>
          </div>

          {/* Passcode display */}
          <div className="flex items-center gap-3">
            <code
              className="flex-1 px-3 py-2 rounded text-[18px] font-bold tracking-[0.12em] text-center select-all"
              style={{
                fontFamily: "var(--font-mono)",
                background: "var(--surface)",
                border: "1px solid var(--border)",
                color: "var(--fg)",
                letterSpacing: "0.2em",
              }}
            >
              {plainPasscode}
            </code>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={handleCopy}
              icon={<CopySimple size={14} />}
            >
              {copied ? "¡Copiado!" : "Copiar"}
            </Button>
          </div>

          <Button
            type="button"
            variant="ghost"
            size="sm"
            fullWidth
            onClick={handleDismissPasscode}
          >
            He anotado el código — cerrar
          </Button>
        </div>
      )}

      {/* Create form */}
      <Card>
        <CardEyebrow>Alta de jugador</CardEyebrow>
        <CardTitle>Nuevo jugador</CardTitle>
        <form onSubmit={handleSubmit} noValidate className="space-y-4 mt-2">
          <Input
            label="Nombre"
            placeholder="Ej: Capitán Torvayne"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            error={fieldErrors.displayName?.[0]}
            required
          />
          <FactionSelect
            label="Facciones (opcional)"
            value={factions}
            onChange={setFactions}
            error={fieldErrors.faction?.[0]}
            helper="El jugador puede cambiarlas luego desde su propio perfil."
          />

          {/* Role selector */}
          <div className="flex flex-col gap-[6px]">
            <label
              className="text-[11px] font-semibold uppercase tracking-[0.04em]"
              style={{ color: "var(--fg-faint)", fontFamily: "var(--font-sans)" }}
            >
              Rol
            </label>
            <div className="flex gap-2">
              {(["PLAYER", "ADMIN"] as const).map((r) => (
                <label
                  key={r}
                  className="flex items-center gap-2 cursor-pointer text-[13px] font-semibold select-none"
                  style={{ fontFamily: "var(--font-sans)", color: "var(--fg)" }}
                >
                  <input
                    type="radio"
                    name="role"
                    value={r}
                    checked={role === r}
                    onChange={() => setRole(r)}
                    className="accent-[var(--accent)]"
                  />
                  {r === "PLAYER" ? "Jugador" : "Administrador"}
                </label>
              ))}
            </div>
          </div>

          {error && !plainPasscode && (
            <p
              className="text-[12px] font-semibold"
              style={{ color: "var(--danger)", fontFamily: "var(--font-sans)" }}
            >
              {error}
            </p>
          )}

          <Button
            type="submit"
            variant="primary"
            fullWidth
            disabled={isPending}
            icon={<UserPlus size={16} />}
          >
            {isPending ? "Creando…" : "Crear jugador"}
          </Button>
        </form>
      </Card>
    </div>
  );
}
