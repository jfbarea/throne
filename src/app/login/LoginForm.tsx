"use client";

// LoginForm — client component for the login page.
// Handles both player login (displayName + passcode) and admin login (passcode only).
// Uses design-system primitives: Button, Input, Card, CardTitle, CardEyebrow, Eyebrow.

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/Button";
import { Input } from "@/components/Input";
import { Card, CardEyebrow, CardTitle } from "@/components/Card";
import { Eyebrow } from "@/components/Eyebrow";
import { Toast } from "@/components/Toast";
import { Lock, User, ShieldStar } from "@phosphor-icons/react";

type LoginMode = "player" | "admin";

export function LoginForm() {
  const router = useRouter();
  const [mode, setMode] = useState<LoginMode>("player");

  // Player form state
  const [displayName, setDisplayName] = useState("");
  const [passcode, setPasscode] = useState("");

  // Admin form state
  const [adminPasscode, setAdminPasscode] = useState("");

  // Toast carries an incrementing id so re-submitting with the same error
  // remounts the Toast and restarts its auto-dismiss timer.
  const [toast, setToast] = useState<{ id: number; message: string } | null>(
    null
  );
  const [loading, setLoading] = useState(false);

  function showError(message: string) {
    setToast((prev) => ({ id: (prev?.id ?? 0) + 1, message }));
  }

  function clearError() {
    setToast(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    clearError();
    setLoading(true);

    try {
      if (mode === "player") {
        const res = await fetch("/api/auth/login-player", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ displayName: displayName.trim(), passcode }),
        });
        const data = await res.json();
        if (!res.ok) {
          showError(data.error ?? "Error al iniciar sesión");
          return;
        }
        // Players land on their own matches, not the design showcase at "/".
        router.push("/mis-partidas");
      } else {
        const res = await fetch("/api/auth/login-admin", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ passcode: adminPasscode }),
        });
        const data = await res.json();
        if (!res.ok) {
          showError(data.error ?? "Error al iniciar sesión");
          return;
        }
        // Admins land on the admin panel, not the design showcase at "/".
        router.push("/admin");
      }
    } catch {
      showError("Error de red. Inténtalo de nuevo.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center px-4 py-12"
      style={{ background: "var(--bg)", color: "var(--fg)" }}
    >
      {/* Error toast — prominent feedback on failed login */}
      {toast && (
        <Toast
          key={toast.id}
          message={toast.message}
          type="error"
          onClose={clearError}
        />
      )}

      {/* Masthead */}
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
        <p
          className="text-[13px]"
          style={{ color: "var(--fg-faint)", fontFamily: "var(--font-sans)" }}
        >
          Liga privada de Warhammer 40.000
        </p>
      </div>

      {/* Mode selector */}
      <div
        className="flex gap-1 mb-6 p-1 rounded-[var(--radius-sm)]"
        style={{ background: "var(--surface)", border: "1px solid var(--border)" }}
        role="tablist"
        aria-label="Tipo de acceso"
      >
        <button
          role="tab"
          aria-selected={mode === "player"}
          onClick={() => {
            setMode("player");
            clearError();
          }}
          className="flex items-center gap-2 px-4 py-2 text-[13px] font-semibold rounded-[2px] transition-all duration-[120ms]"
          style={{
            fontFamily: "var(--font-sans)",
            background: mode === "player" ? "var(--bg-raised)" : "transparent",
            color: mode === "player" ? "var(--fg)" : "var(--fg-faint)",
            border: "none",
            cursor: "pointer",
          }}
        >
          <User size={16} />
          Jugador
        </button>
        <button
          role="tab"
          aria-selected={mode === "admin"}
          onClick={() => {
            setMode("admin");
            clearError();
          }}
          className="flex items-center gap-2 px-4 py-2 text-[13px] font-semibold rounded-[2px] transition-all duration-[120ms]"
          style={{
            fontFamily: "var(--font-sans)",
            background: mode === "admin" ? "var(--bg-raised)" : "transparent",
            color: mode === "admin" ? "var(--fg)" : "var(--fg-faint)",
            border: "none",
            cursor: "pointer",
          }}
        >
          <ShieldStar size={16} />
          Admin
        </button>
      </div>

      {/* Login card */}
      <Card className="w-full max-w-[380px]" featured={mode === "admin"}>
        <CardEyebrow>
          {mode === "player" ? "Acceso de jugador" : "Acceso de administrador"}
        </CardEyebrow>
        <CardTitle>
          {mode === "player" ? "Iniciar sesión" : "Panel de admin"}
        </CardTitle>

        <form onSubmit={handleSubmit} className="mt-2 space-y-4" noValidate>
          {mode === "player" && (
            <Input
              label="Tu nombre"
              placeholder="Ej: Fran Barea"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              autoComplete="username"
              required
              maxLength={256}
              leadingIcon={<User size={16} />}
            />
          )}

          <Input
            label={mode === "player" ? "Código de acceso" : "Clave de administrador"}
            placeholder="••••••"
            type="password"
            value={mode === "player" ? passcode : adminPasscode}
            onChange={(e) =>
              mode === "player"
                ? setPasscode(e.target.value)
                : setAdminPasscode(e.target.value)
            }
            autoComplete={
              mode === "player" ? "current-password" : "current-password"
            }
            required
            maxLength={256}
            leadingIcon={<Lock size={16} />}
            invalid={Boolean(toast)}
          />

          <Button
            type="submit"
            variant="primary"
            fullWidth
            disabled={loading}
          >
            {loading ? "Verificando…" : "Entrar"}
          </Button>
        </form>

        {/* Helper text */}
        <p
          className="mt-4 text-[11px] leading-[16px] text-center"
          style={{ color: "var(--fg-faint)", fontFamily: "var(--font-sans)" }}
        >
          {mode === "player"
            ? "Tu código de acceso te lo ha dado el administrador de la liga."
            : "La clave de administrador está configurada en el servidor."}
        </p>
      </Card>

      {/* Public links — no login required. /guia has to be reachable from
          here too: it's public, but AppHeader (where the other nav links
          live) only renders once there's a session, so the login page is
          the only way an unauthenticated visitor can find it (Hito 12). */}
      <div className="mt-6 flex items-center gap-4">
        <Link
          href="/bases"
          className="text-[13px] font-semibold no-underline"
          style={{ color: "var(--accent)", fontFamily: "var(--font-sans)" }}
        >
          Ver las bases de la liga
        </Link>
        <Link
          href="/guia"
          className="text-[13px] font-semibold no-underline"
          style={{ color: "var(--accent)", fontFamily: "var(--font-sans)" }}
        >
          Guía de uso
        </Link>
      </div>

      {/* Footer */}
      <div className="mt-8">
        <Eyebrow>throne · Liga privada de Warhammer 40.000</Eyebrow>
      </div>
    </div>
  );
}
