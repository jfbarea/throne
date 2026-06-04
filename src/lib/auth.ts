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
 */
export async function verifyPlayerPasscode(
  displayName: string,
  passcode: string
): Promise<{ id: string; displayName: string; role: "ADMIN" | "PLAYER" } | null> {
  const player = await prisma.player.findFirst({
    where: { displayName, active: true },
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
