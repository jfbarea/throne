// Session management via signed JWT stored in an HttpOnly cookie.
// Uses `jose` for compact JWS (HS256). No Session table in DB.
// SPEC §6: SESSION_SECRET signs the token; server never trusts client-sent IDs.

import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";

export const SESSION_COOKIE = "__throne_session";

// Maximum session duration: 7 days.
const SESSION_TTL_S = 7 * 24 * 60 * 60;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Payload stored in the JWT. Minimal — only what the server needs to derive identity. */
export interface SessionPayload {
  /** DB Player.id. Null only for the admin session when ADMIN_PASSCODE auth is used. */
  playerId: string | null;
  role: "ADMIN" | "PLAYER";
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function getSecret(): Uint8Array {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error(
      "SESSION_SECRET is missing or shorter than 32 characters. Set it in .env"
    );
  }
  return new TextEncoder().encode(secret);
}

// ---------------------------------------------------------------------------
// Core functions
// ---------------------------------------------------------------------------

/** Sign and return a compact JWT for the given session payload. */
export async function signSession(payload: SessionPayload): Promise<string> {
  return new SignJWT(payload as unknown as Record<string, unknown>)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_S}s`)
    .sign(getSecret());
}

/** Verify a compact JWT and return the payload, or null if invalid/expired. */
export async function verifySession(
  token: string
): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret(), {
      algorithms: ["HS256"],
    });
    return payload as unknown as SessionPayload;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Next.js cookie helpers
// ---------------------------------------------------------------------------

/** Read and verify the session from the incoming request cookies (App Router). */
export async function getSession(
  req?: NextRequest
): Promise<SessionPayload | null> {
  let token: string | undefined;

  if (req) {
    // Route Handler context — read from request directly.
    token = req.cookies.get(SESSION_COOKIE)?.value;
  } else {
    // Server Component / Server Action context — use next/headers.
    const cookieStore = await cookies();
    token = cookieStore.get(SESSION_COOKIE)?.value;
  }

  if (!token) return null;
  return verifySession(token);
}

/**
 * Set the session cookie on a NextResponse.
 * HttpOnly, SameSite=Lax, Secure in production.
 */
export async function setSessionCookie(
  response: NextResponse,
  payload: SessionPayload
): Promise<void> {
  const token = await signSession(payload);
  const isProduction = process.env.NODE_ENV === "production";

  response.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: isProduction,
    maxAge: SESSION_TTL_S,
    path: "/",
  });
}

/** Clear the session cookie on a NextResponse. */
export function clearSessionCookie(response: NextResponse): void {
  response.cookies.set(SESSION_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 0,
    path: "/",
  });
}
