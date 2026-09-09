"use client";

// FactionSelect — grouped, searchable, multi-select dropdown over the faction
// catalogue (src/lib/factions.ts). Used by the player's own profile
// (/mi-perfil) and by the admin player forms so both write the same shape.
//
// A selection can be undone one at a time — the aspa on each chip, or
// unchecking the row — or all at once with "Quitar todas".
//
// Values not present in the catalogue (legacy free text, an English name from
// before the catalogue was translated, homebrew armies) are never dropped:
// they render as chips like any other and in an extra "Otras" group, already
// checked, so the only way to lose one is to remove it deliberately.

import { useEffect, useMemo, useRef, useState } from "react";
import { CaretDown, Check, MagnifyingGlass, X } from "@phosphor-icons/react";
import {
  FACTION_GROUPS,
  MAX_FACTIONS_PER_PLAYER,
  isKnownFaction,
} from "@/lib/factions";

interface FactionSelectProps {
  label?: string;
  /** Currently selected faction names. */
  value: string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
  error?: string;
  helper?: string;
  /** Maximum selectable factions. Defaults to MAX_FACTIONS_PER_PLAYER. */
  max?: number;
  /** Text shown on the trigger when nothing is selected. */
  placeholder?: string;
}

/** Case/accent-insensitive contains, so "tau" matches "Imperio T'au". */
function matches(haystack: string, needle: string): boolean {
  const fold = (s: string) =>
    s
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/['\u2019]/g, "")
      .toLowerCase();
  return fold(haystack).includes(fold(needle));
}

export function FactionSelect({
  label = "Facciones",
  value,
  onChange,
  disabled = false,
  error,
  helper,
  max = MAX_FACTIONS_PER_PLAYER,
  placeholder = "Sin facción",
}: FactionSelectProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click or Escape — same pattern as UserMenu/AdminMenu.
  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node))
        setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Selected values outside the catalogue get their own group so they stay
  // visible, checked and removable instead of disappearing on the next save.
  const groups = useMemo(() => {
    const extras = value.filter((v) => !isKnownFaction(v));
    return extras.length > 0
      ? [...FACTION_GROUPS, { label: "Otras", factions: extras }]
      : FACTION_GROUPS;
  }, [value]);

  const filteredGroups = useMemo(() => {
    const q = query.trim();
    if (q.length === 0) return groups;
    return groups
      .map((g) => ({
        label: g.label,
        factions: g.factions.filter((f) => matches(f, q)),
      }))
      .filter((g) => g.factions.length > 0);
  }, [groups, query]);

  const atMax = value.length >= max;

  function toggle(name: string) {
    if (value.includes(name)) {
      onChange(value.filter((v) => v !== name));
      return;
    }
    if (atMax) return;
    onChange([...value, name]);
  }

  const showErrorBorder = Boolean(error);

  return (
    <div className="flex flex-col gap-[6px]">
      {label && (
        <span
          className="text-[11px] font-semibold tracking-[0.04em] uppercase"
          style={{ color: "var(--fg-faint)", fontFamily: "var(--font-sans)" }}
        >
          {label}
        </span>
      )}

      <div className="relative" ref={ref}>
        {/* Shell — mirrors the Input shell so both fields line up. It is a
            div, not a button: each chip carries its own remove button, and a
            button may not nest another button. The toggle is the flex-1
            button that fills whatever space the chips leave, so clicking the
            empty part of the field still opens the dropdown. */}
        <div
          className="flex w-full items-center gap-2 rounded-[var(--radius-sm)] border px-3 py-[10px] transition-all duration-[120ms]"
          style={{
            background: "var(--bg-raised)",
            borderColor: showErrorBorder
              ? "var(--danger)"
              : open
                ? "var(--accent)"
                : "var(--border)",
            color: "var(--fg)",
            fontFamily: "var(--font-sans)",
            opacity: disabled ? 0.4 : 1,
          }}
        >
          {value.length > 0 && (
            <span className="flex min-w-0 flex-wrap gap-1.5">
              {value.map((name) => (
                <span
                  key={name}
                  className="inline-flex items-center gap-1 rounded py-[2px] pr-1 pl-2 text-[12px] font-semibold"
                  style={{
                    background: "var(--surface)",
                    border: "1px solid var(--border-strong)",
                    color: "var(--fg)",
                  }}
                >
                  {name}
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => toggle(name)}
                    aria-label={`Quitar ${name}`}
                    title={`Quitar ${name}`}
                    className="flex items-center rounded p-[2px] transition-colors duration-[120ms]"
                    style={{
                      background: "transparent",
                      border: "none",
                      color: "var(--fg-faint)",
                      cursor: disabled ? "not-allowed" : "pointer",
                    }}
                  >
                    <X size={10} />
                  </button>
                </span>
              ))}
            </span>
          )}

          <button
            type="button"
            disabled={disabled}
            onClick={() => setOpen((v) => !v)}
            aria-haspopup="listbox"
            aria-expanded={open}
            aria-label={label}
            className="flex min-w-0 flex-1 items-center gap-2 text-left"
            style={{
              background: "transparent",
              border: "none",
              color: "var(--fg)",
              fontFamily: "var(--font-sans)",
              cursor: disabled ? "not-allowed" : "pointer",
              // Keeps the row the same height as an Input when there are no
              // chips to give it one.
              minHeight: 20,
            }}
          >
            {value.length === 0 && (
              <span
                className="text-[14px]"
                style={{ color: "var(--fg-faint)" }}
              >
                {placeholder}
              </span>
            )}
            <CaretDown
              size={13}
              className="ml-auto"
              style={{
                color: "var(--fg-faint)",
                flexShrink: 0,
                transform: open ? "rotate(180deg)" : undefined,
                transition: "transform 120ms",
              }}
            />
          </button>
        </div>

        {open && (
          <div
            role="listbox"
            aria-multiselectable
            className="absolute right-0 left-0 mt-1 overflow-hidden rounded-[var(--radius-sm)]"
            style={{
              background: "var(--bg-raised)",
              border: "1px solid var(--border)",
              boxShadow: "var(--shadow-2, 0 4px 16px rgba(0,0,0,0.4))",
              zIndex: 40,
            }}
          >
            {/* Search */}
            <div
              className="flex items-center gap-2 border-b px-3 py-2"
              style={{ borderColor: "var(--border)" }}
            >
              <MagnifyingGlass
                size={13}
                style={{ color: "var(--fg-faint)", flexShrink: 0 }}
              />
              <input
                autoFocus
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Buscar facción…"
                aria-label="Buscar facción"
                className="min-w-0 flex-1 border-0 bg-transparent text-[13px] outline-none"
                style={{
                  color: "var(--fg)",
                  fontFamily: "var(--font-sans)",
                }}
              />
              {query && (
                <button
                  type="button"
                  onClick={() => setQuery("")}
                  aria-label="Limpiar búsqueda"
                  style={{ color: "var(--fg-faint)", cursor: "pointer" }}
                >
                  <X size={12} />
                </button>
              )}
            </div>

            {/* Options */}
            <div className="max-h-[260px] overflow-y-auto">
              {filteredGroups.length === 0 && (
                <p
                  className="px-3 py-4 text-center text-[12px]"
                  style={{
                    color: "var(--fg-faint)",
                    fontFamily: "var(--font-sans)",
                  }}
                >
                  Ninguna facción coincide con «{query.trim()}»
                </p>
              )}

              {filteredGroups.map((group) => (
                <div key={group.label}>
                  <p
                    className="px-3 pt-2.5 pb-1 text-[10px] font-semibold tracking-[0.14em] uppercase"
                    style={{
                      color: "var(--fg-faint)",
                      fontFamily: "var(--font-sans)",
                    }}
                  >
                    {group.label}
                  </p>
                  {group.factions.map((name) => {
                    const selected = value.includes(name);
                    const blocked = !selected && atMax;
                    return (
                      <button
                        key={name}
                        type="button"
                        role="option"
                        aria-selected={selected}
                        disabled={blocked}
                        onClick={() => toggle(name)}
                        className="flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] transition-colors duration-[120ms]"
                        style={{
                          background: selected
                            ? "var(--surface)"
                            : "transparent",
                          color: blocked ? "var(--fg-faint)" : "var(--fg)",
                          border: "none",
                          fontFamily: "var(--font-sans)",
                          cursor: blocked ? "not-allowed" : "pointer",
                          opacity: blocked ? 0.4 : 1,
                        }}
                      >
                        <span
                          className="flex flex-shrink-0 items-center justify-center rounded"
                          style={{
                            width: 15,
                            height: 15,
                            border: `1px solid ${
                              selected
                                ? "var(--accent)"
                                : "var(--border-strong)"
                            }`,
                            background: selected
                              ? "var(--accent)"
                              : "transparent",
                          }}
                        >
                          {selected && (
                            <Check size={10} style={{ color: "var(--bg)" }} />
                          )}
                        </span>
                        {name}
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>

            {/* Footer */}
            <div
              className="flex items-center justify-between gap-2 border-t px-3 py-2"
              style={{ borderColor: "var(--border)" }}
            >
              <span
                className="text-[11px]"
                style={{
                  color: "var(--fg-faint)",
                  fontFamily: "var(--font-sans)",
                }}
              >
                {value.length} de {max} seleccionada
                {value.length !== 1 ? "s" : ""}
              </span>
              {value.length > 0 && (
                <button
                  type="button"
                  onClick={() => onChange([])}
                  className="text-[11px] font-semibold"
                  style={{
                    color: "var(--fg-muted)",
                    fontFamily: "var(--font-sans)",
                    cursor: "pointer",
                  }}
                >
                  Quitar todas
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {(helper || error) && (
        <span
          className="text-[11px] leading-[16px]"
          style={{
            color: error ? "var(--danger)" : "var(--fg-faint)",
            fontFamily: "var(--font-sans)",
          }}
        >
          {error ?? helper}
        </span>
      )}
    </div>
  );
}
