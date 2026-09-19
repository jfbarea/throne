// Guard test — multi-liga I2.
//
// `src/app/liga/[slug]/layout.tsx` deliberately resolves the league for the
// header indicator WITHOUT enforcing player access: access control lives in
// each page, because only the page knows its own name and can therefore honour
// criterion 5 of the spec ("the player lands on the SAME page inside their own
// league"). See that file's comment for the full reasoning.
//
// That is only safe because nothing under `/liga/[slug]` is streamed: with no
// `loading.tsx`, no `error.tsx` and no `<Suspense>` boundary, Next.js holds the
// whole tree until it finishes, so a `redirect()` raised later by the page
// discards everything the layout rendered. Nothing reaches the browser.
//
// Add a streaming boundary and that stops being true: the layout's shell —
// including the name of a league the visitor may not belong to — would flush
// to the client before the page's redirect runs. This test exists so that
// happens as a failing test and not as a leak in production, because the
// invariant is otherwise invisible to anyone editing this route.

import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "fs";
import path from "path";

const LIGA_ROUTE_DIR = path.resolve(process.cwd(), "src/app/liga");

/** Every file under the /liga route segment, recursively. */
function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...walk(full));
    } else {
      out.push(full);
    }
  }
  return out;
}

describe("/liga/[slug] has no streaming boundary", () => {
  const files = walk(LIGA_ROUTE_DIR);

  it("defines no loading.tsx", () => {
    const offenders = files.filter((f) => path.basename(f) === "loading.tsx");
    expect(
      offenders,
      "A loading.tsx under /liga would let the layout flush a league name " +
        "before the page's access redirect runs. Enforce access in the layout " +
        "first (see layout.tsx), then remove this expectation."
    ).toEqual([]);
  });

  it("defines no error.tsx", () => {
    const offenders = files.filter((f) => path.basename(f) === "error.tsx");
    expect(offenders).toEqual([]);
  });

  it("uses no <Suspense> boundary", () => {
    const offenders = files.filter((f) => {
      if (!f.endsWith(".tsx")) return false;
      const source = readFileSync(f, "utf8");
      // Strip line comments so the layout's own explanatory comment — which
      // names Suspense to explain why it must not appear — is not a false hit.
      const code = source.replace(/^\s*\/\/.*$/gm, "");
      return /<Suspense[\s>]/.test(code);
    });
    expect(offenders).toEqual([]);
  });
});
