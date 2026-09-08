"use client";

// Client component: inline form to edit a single round's deadline.
// Rondas-con-fecha spec §4.4: editing a deadline never reassigns matches nor
// touches scheduledAt — it only calls updateRoundDeadline, which writes to
// Round alone. Hito 3: generar-con-rondas.

import { useState, useTransition } from "react";
import { Button } from "@/components/Button";
import { Input } from "@/components/Input";
import { updateRoundDeadline } from "@/server/round-actions";
import { FloppyDisk } from "@phosphor-icons/react";

interface EditDeadlineFormProps {
  roundId: string;
  /** "YYYY-MM-DD", the shape a native <input type="date"> expects. */
  initialDeadline: string;
}

export function EditDeadlineForm({
  roundId,
  initialDeadline,
}: EditDeadlineFormProps) {
  const [deadline, setDeadline] = useState(initialDeadline);
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    startTransition(async () => {
      const result = await updateRoundDeadline(roundId, { deadline });
      if (!result.ok) {
        setMessage({ type: "error", text: result.error });
        return;
      }
      setMessage({ type: "success", text: "Fecha actualizada." });
    });
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-wrap items-end gap-3"
    >
      <Input
        label="Fecha de cierre"
        type="date"
        value={deadline}
        onChange={(e) => setDeadline(e.target.value)}
      />
      <Button
        type="submit"
        size="sm"
        variant="secondary"
        disabled={isPending}
        icon={<FloppyDisk size={14} />}
      >
        {isPending ? "Guardando…" : "Guardar"}
      </Button>
      {message && (
        <span
          className="text-[12px] font-semibold"
          style={{
            color:
              message.type === "success" ? "var(--success)" : "var(--danger)",
            fontFamily: "var(--font-sans)",
          }}
        >
          {message.text}
        </span>
      )}
    </form>
  );
}
