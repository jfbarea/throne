"use client";

// PlayerList — interactive list of players with edit, deactivate, and passcode reset.
// SPEC §4.2, §5, §6.

import { useState, useTransition } from "react";
import { Button } from "@/components/Button";
import { Input } from "@/components/Input";
import { Card } from "@/components/Card";
import { Badge } from "@/components/Badge";
import {
  setPlayerActive,
  resetPlayerPasscode,
  updatePlayer,
  deletePlayer,
} from "@/server/league-actions";
import {
  PencilSimple,
  ArrowCounterClockwise,
  Eye,
  EyeSlash,
  FloppyDisk,
  X,
  CopySimple,
  CheckCircle,
  Trash,
} from "@phosphor-icons/react";

interface PlayerRow {
  id: string;
  displayName: string;
  faction: string | null;
  role: "ADMIN" | "PLAYER";
  active: boolean;
}

interface PlayerListProps {
  players: PlayerRow[];
}

// ---------------------------------------------------------------------------
// Inline edit form for a single player row
// ---------------------------------------------------------------------------

interface EditFormProps {
  player: PlayerRow;
  onDone: () => void;
}

function EditForm({ player, onDone }: EditFormProps) {
  const [isPending, startTransition] = useTransition();
  const [displayName, setDisplayName] = useState(player.displayName);
  const [faction, setFaction] = useState(player.faction ?? "");
  const [role, setRole] = useState<"PLAYER" | "ADMIN">(player.role);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});

  function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setFieldErrors({});
    startTransition(async () => {
      const result = await updatePlayer(player.id, {
        displayName: displayName.trim(),
        faction: faction.trim() || null,
        role,
      });
      if (!result.ok) {
        setError(result.error);
        setFieldErrors(result.fieldErrors ?? {});
        return;
      }
      onDone();
    });
  }

  return (
    <form onSubmit={handleSave} noValidate className="space-y-3 mt-2">
      <Input
        label="Nombre"
        value={displayName}
        onChange={(e) => setDisplayName(e.target.value)}
        error={fieldErrors.displayName?.[0]}
        required
      />
      <Input
        label="Facción"
        placeholder="(sin facción)"
        value={faction}
        onChange={(e) => setFaction(e.target.value)}
        error={fieldErrors.faction?.[0]}
      />
      <div className="flex gap-3">
        {(["PLAYER", "ADMIN"] as const).map((r) => (
          <label
            key={r}
            className="flex items-center gap-1.5 cursor-pointer text-[12px] font-semibold"
            style={{ fontFamily: "var(--font-sans)", color: "var(--fg)" }}
          >
            <input
              type="radio"
              name={`role-${player.id}`}
              value={r}
              checked={role === r}
              onChange={() => setRole(r)}
              className="accent-[var(--accent)]"
            />
            {r === "PLAYER" ? "Jugador" : "Admin"}
          </label>
        ))}
      </div>
      {error && (
        <p
          className="text-[12px]"
          style={{ color: "var(--danger)", fontFamily: "var(--font-sans)" }}
        >
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <Button
          type="submit"
          variant="primary"
          size="sm"
          disabled={isPending}
          icon={<FloppyDisk size={14} />}
        >
          {isPending ? "Guardando…" : "Guardar"}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onDone}
          icon={<X size={14} />}
        >
          Cancelar
        </Button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Passcode reset banner — shows plain passcode once
// ---------------------------------------------------------------------------

interface PasscodeBannerProps {
  plain: string;
  onDismiss: () => void;
}

function PasscodeBanner({ plain, onDismiss }: PasscodeBannerProps) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(plain);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard not available
    }
  }

  return (
    <div
      className="mt-3 rounded border px-3 py-3 space-y-2"
      style={{
        background: "rgba(201,166,107,0.08)",
        borderColor: "rgba(201,166,107,0.4)",
      }}
    >
      <div className="flex items-start gap-2">
        <CheckCircle
          size={15}
          style={{ color: "var(--accent)", flexShrink: 0, marginTop: 1 }}
        />
        <p
          className="text-[12px] font-semibold"
          style={{ color: "var(--accent)", fontFamily: "var(--font-sans)" }}
        >
          Nuevo código (se muestra solo una vez):
        </p>
      </div>
      <div className="flex items-center gap-2">
        <code
          className="flex-1 px-2 py-1.5 rounded text-[15px] font-bold text-center tracking-[0.15em] select-all"
          style={{
            fontFamily: "var(--font-mono)",
            background: "var(--surface)",
            border: "1px solid var(--border)",
            color: "var(--fg)",
          }}
        >
          {plain}
        </code>
        <button
          type="button"
          onClick={handleCopy}
          className="flex-shrink-0 p-1.5 rounded"
          style={{ color: "var(--fg-faint)" }}
          title="Copiar"
        >
          {copied ? <CheckCircle size={14} style={{ color: "var(--success)" }} /> : <CopySimple size={14} />}
        </button>
      </div>
      <button
        type="button"
        onClick={onDismiss}
        className="text-[11px] w-full text-center"
        style={{ color: "var(--fg-faint)", fontFamily: "var(--font-sans)" }}
      >
        He anotado el código — cerrar
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Single player card
// ---------------------------------------------------------------------------

interface PlayerCardProps {
  player: PlayerRow;
}

function PlayerCard({ player }: PlayerCardProps) {
  const [editing, setEditing] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [plainPasscode, setPlainPasscode] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  function handleToggleActive() {
    startTransition(async () => {
      await setPlayerActive(player.id, !player.active);
    });
  }

  function handleDelete() {
    setDeleteError(null);
    startTransition(async () => {
      const result = await deletePlayer(player.id);
      if (!result.ok) {
        setDeleteError(result.error);
        return;
      }
      // On success the row disappears via revalidation; nothing else to do.
    });
  }

  function handleResetPasscode() {
    startTransition(async () => {
      const result = await resetPlayerPasscode(player.id);
      if (result.ok) {
        setPlainPasscode(result.data.plainPasscode);
      }
    });
  }

  return (
    <Card className={!player.active ? "opacity-60" : ""}>
      <div className="flex items-start justify-between gap-4">
        {/* Info */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <p
              className="text-[14px] font-semibold"
              style={{ fontFamily: "var(--font-sans)", color: "var(--fg)" }}
            >
              {player.displayName}
            </p>
            <Badge
              variant={player.role === "ADMIN" ? "brass" : "neutral"}
            >
              {player.role === "ADMIN" ? "Admin" : "Jugador"}
            </Badge>
            {!player.active && (
              <Badge variant="ember">Inactivo</Badge>
            )}
          </div>
          {player.faction && (
            <p
              className="mt-0.5 text-[12px]"
              style={{ color: "var(--fg-faint)", fontFamily: "var(--font-sans)" }}
            >
              {player.faction}
            </p>
          )}
        </div>

        {/* Actions */}
        {!editing && (
          <div className="flex items-center gap-1 flex-shrink-0">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setEditing(true)}
              icon={<PencilSimple size={13} />}
              title="Editar"
            >
              <span className="hidden sm:inline">Editar</span>
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleResetPasscode}
              disabled={isPending}
              icon={<ArrowCounterClockwise size={13} />}
              title="Resetear código"
            >
              <span className="hidden sm:inline">Código</span>
            </Button>
            <Button
              variant={player.active ? "danger" : "ghost"}
              size="sm"
              onClick={handleToggleActive}
              disabled={isPending}
              icon={player.active ? <EyeSlash size={13} /> : <Eye size={13} />}
              title={player.active ? "Dar de baja" : "Reactivar"}
            >
              <span className="hidden sm:inline">
                {player.active ? "Baja" : "Activar"}
              </span>
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setDeleteError(null);
                setConfirmingDelete(true);
              }}
              disabled={isPending}
              icon={<Trash size={13} />}
              title="Borrar definitivamente"
            >
              <span className="hidden sm:inline">Borrar</span>
            </Button>
          </div>
        )}
      </div>

      {/* Delete confirmation */}
      {confirmingDelete && (
        <div
          className="mt-3 rounded border px-3 py-3 space-y-2"
          style={{
            background: "rgba(184,92,60,0.08)",
            borderColor: "rgba(184,92,60,0.4)",
          }}
        >
          <p
            className="text-[12px] font-semibold"
            style={{ color: "var(--danger)", fontFamily: "var(--font-sans)" }}
          >
            ¿Borrar a {player.displayName} definitivamente? Esta acción no se
            puede deshacer.
          </p>
          {deleteError && (
            <p
              className="text-[12px]"
              style={{ color: "var(--danger)", fontFamily: "var(--font-sans)" }}
            >
              {deleteError}
            </p>
          )}
          <div className="flex gap-2">
            <Button
              type="button"
              variant="danger"
              size="sm"
              onClick={handleDelete}
              disabled={isPending}
              icon={<Trash size={14} />}
            >
              {isPending ? "Borrando…" : "Sí, borrar"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setConfirmingDelete(false);
                setDeleteError(null);
              }}
              disabled={isPending}
              icon={<X size={14} />}
            >
              Cancelar
            </Button>
          </div>
        </div>
      )}

      {/* Inline edit */}
      {editing && (
        <EditForm player={player} onDone={() => setEditing(false)} />
      )}

      {/* One-time passcode banner */}
      {plainPasscode && (
        <PasscodeBanner
          plain={plainPasscode}
          onDismiss={() => setPlainPasscode(null)}
        />
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// PlayerList — main export
// ---------------------------------------------------------------------------

export function PlayerList({ players }: PlayerListProps) {
  const active = players.filter((p) => p.active);
  const inactive = players.filter((p) => !p.active);

  if (players.length === 0) {
    return (
      <p
        className="text-center text-[14px] py-8"
        style={{ color: "var(--fg-faint)", fontFamily: "var(--font-sans)" }}
      >
        No hay jugadores todavía. Crea el primero usando el formulario de arriba.
      </p>
    );
  }

  return (
    <div className="space-y-6">
      {/* Active players */}
      <div className="space-y-3">
        {active.map((p) => (
          <PlayerCard key={p.id} player={p} />
        ))}
      </div>

      {/* Inactive players (collapsed visually) */}
      {inactive.length > 0 && (
        <div>
          <p
            className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em]"
            style={{ color: "var(--fg-faint)", fontFamily: "var(--font-sans)" }}
          >
            Inactivos ({inactive.length})
          </p>
          <div className="space-y-2">
            {inactive.map((p) => (
              <PlayerCard key={p.id} player={p} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
