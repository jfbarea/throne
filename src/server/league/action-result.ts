// Shared `ActionResult` type for src/server/league/{config,players,lifecycle}.ts.
// Split out on its own (multi-liga C1, contexto-de-liga-y-modulos) so
// league-actions.ts's `export *` barrel doesn't re-export the same type name
// from three different modules, which TypeScript treats as an ambiguous
// export error (unlike plain ESM, which would just drop it silently).
export type ActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: string; fieldErrors?: Record<string, string[]> };
