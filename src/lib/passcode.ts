// Passcode generation — pure, testable utility.
// Hito 5: admin-liga-jugadores.
// SPEC §6: the admin generates a passcode/PIN shown once in plain text,
// stored hashed (bcrypt). After that the plain text is never accessible again.

import bcrypt from "bcryptjs";
import { randomBytes } from "crypto";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Passcode length in characters (alphanumeric, URL-safe). */
const PASSCODE_LENGTH = 8;

/** bcrypt work factor. Cost 10 is fast enough for 10-20 players, secure enough. */
const BCRYPT_ROUNDS = 10;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Generate a random alphanumeric passcode of PASSCODE_LENGTH characters.
 * Uses Node.js crypto.randomBytes for cryptographic randomness.
 * Returns the plain-text passcode (shown once to the admin).
 */
export function generatePasscode(): string {
  // Use a URL-safe alphabet (upper+lower+digits) for easy copy-paste.
  const alphabet =
    "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
  const bytes = randomBytes(PASSCODE_LENGTH);
  return Array.from(bytes)
    .map((b) => alphabet[b % alphabet.length])
    .join("");
}

/**
 * Hash a plain-text passcode using bcrypt.
 * Returns the bcrypt hash ready to be stored in Player.passcodeHash.
 */
export async function hashPasscode(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_ROUNDS);
}

/**
 * Generate a passcode and its bcrypt hash in one step.
 * Returns { plain, hash } — the caller must store hash in DB and show plain once.
 */
export async function generateHashedPasscode(): Promise<{
  plain: string;
  hash: string;
}> {
  const plain = generatePasscode();
  const hash = await hashPasscode(plain);
  return { plain, hash };
}
