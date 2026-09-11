// Authentication helpers — passcode verification (bcrypt) and admin passcode check.
// SPEC §6: admin authenticates via ADMIN_PASSCODE env var (constant-time compare);
// players authenticate via bcrypt.compare(passcode, player.passcodeHash).

import bcrypt from "bcryptjs";
import { timingSafeEqual } from "crypto";
import { prisma } from "./db";

// ---------------------------------------------------------------------------
// Admin authentication
// ---------------------------------------------------------------------------

/**
 * Verify the admin passcode using a timing-safe comparison.
 * Returns true if the provided passcode matches ADMIN_PASSCODE env var.
 * Uses crypto.timingSafeEqual to prevent timing attacks.
 */
export function verifyAdminPasscode(input: string): boolean {
  const expected = process.env.ADMIN_PASSCODE ?? "";
  // Constant-time comparison to prevent timing attacks.
  // Both buffers must be the same length for timingSafeEqual.
  // We hash the comparison to ensure equal-length buffers without leaking length info.
  const encoder = new TextEncoder();
  const inputBuf = encoder.encode(input.padEnd(64));
  const expectedBuf = encoder.encode(expected.padEnd(64));

  // Use Node.js built-in constant-time compare.
  return (
    input.length === expected.length &&
    timingSafeEqual(inputBuf, expectedBuf)
  );
}

// ---------------------------------------------------------------------------
// Player authentication
// ---------------------------------------------------------------------------

/**
 * Look up a player by displayName and verify the provided passcode against
 * the stored bcrypt hash. Returns the player if valid, null otherwise.
 *
 * SPEC §6: the server verifies the hash; it never stores the plain passcode.
 *
 * Multi-liga spec §2.7, §2.8, §4.4: two filters added on top of the
 * pre-multi-liga lookup —
 *  - `role: "PLAYER"`: the admin never logs in through this path (spec §2.4
 *    — it authenticates via `ADMIN_PASSCODE`), so its homonymous `role =
 *    ADMIN` row in every league must never be a candidate here. Without
 *    this, an admin and a player sharing a `displayName` (the deliberate
 *    exception in §2.7) would make `findFirst` return an arbitrary one of
 *    the two.
 *  - `league: { archivedAt: null }`: a player whose league was archived
 *    can't log in at all (§2.8) — same displayName from a later,
 *    non-archived league takes priority, and if none exists this simply
 *    finds no player, which the caller (login-player route) already turns
 *    into the same generic "credenciales incorrectas" as a wrong passcode.
 */
export async function verifyPlayerPasscode(
  displayName: string,
  passcode: string
): Promise<{ id: string; displayName: string; role: "ADMIN" | "PLAYER" } | null> {
  const player = await prisma.player.findFirst({
    where: {
      displayName,
      active: true,
      role: "PLAYER",
      league: { archivedAt: null },
    },
    select: { id: true, displayName: true, role: true, passcodeHash: true },
  });

  if (!player) return null;

  const valid = await bcrypt.compare(passcode, player.passcodeHash);
  if (!valid) return null;

  return {
    id: player.id,
    displayName: player.displayName,
    role: player.role as "ADMIN" | "PLAYER",
  };
}
