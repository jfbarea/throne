"use client";

// Toast — transient, prominent feedback message. Self-contained (no global
// provider): the parent holds the visibility state and renders <Toast> when it
// has something to say. Remount with a changing `key` to re-trigger the
// auto-dismiss timer for repeated messages.

import { useEffect } from "react";
import { Warning, CheckCircle, X } from "@phosphor-icons/react";

export interface ToastProps {
  message: string;
  type?: "error" | "success";
  onClose: () => void;
  /** Auto-dismiss delay in ms. Pass 0 to disable auto-dismiss. */
  duration?: number;
}

export function Toast({
  message,
  type = "error",
  onClose,
  duration = 5000,
}: ToastProps) {
  useEffect(() => {
    if (duration <= 0) return;
    const timer = setTimeout(onClose, duration);
    return () => clearTimeout(timer);
  }, [duration, onClose]);

  const isError = type === "error";
  const accent = isError ? "var(--danger)" : "var(--success)";
  const borderColor = isError
    ? "rgba(184,92,60,0.45)"
    : "rgba(76,153,85,0.45)";

  return (
    <div
      role="alert"
      aria-live="assertive"
      className="fixed top-4 left-1/2 -translate-x-1/2 z-50 flex items-start gap-3 px-4 py-3 rounded-[var(--radius-sm)] w-[360px] max-w-[calc(100vw-2rem)]"
      style={{
        background: "var(--bg-raised)",
        border: `1px solid ${borderColor}`,
        boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
      }}
    >
      <span className="mt-[1px] shrink-0" style={{ color: accent }}>
        {isError ? (
          <Warning size={18} weight="fill" />
        ) : (
          <CheckCircle size={18} weight="fill" />
        )}
      </span>
      <p
        className="flex-1 text-[13px] leading-[18px]"
        style={{ color: "var(--fg)", fontFamily: "var(--font-sans)" }}
      >
        {message}
      </p>
      <button
        type="button"
        onClick={onClose}
        aria-label="Cerrar"
        className="shrink-0 cursor-pointer"
        style={{ color: "var(--fg-faint)", background: "transparent", border: "none" }}
      >
        <X size={16} />
      </button>
    </div>
  );
}
