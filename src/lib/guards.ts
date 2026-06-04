// Authorization guards — protect server actions and route handlers by role.
// SPEC §5: role-based permissions. Identity always comes from the signed cookie,
// never from client input.

import { redirect } from "next/navigation";
import { getSession, SessionPayload } from "./session";
import { NextRequest } from "next/server";

// ---------------------------------------------------------------------------
// Guards (App Router / Server Actions)
// ---------------------------------------------------------------------------

/**
 * Require any authenticated session.
 * If no valid session exists, redirects to /login.
 * Returns the session payload.
 */
export async function requireAuth(req?: NextRequest): Promise<SessionPayload> {
  const session = await getSession(req);
  if (!session) {
    redirect("/login");
  }
  return session;
}

/**
 * Require an ADMIN session.
 * If not authenticated or role is not ADMIN, redirects to /login (unauthenticated)
 * or /unauthorized (authenticated but wrong role).
 */
export async function requireAdmin(req?: NextRequest): Promise<SessionPayload> {
  const session = await getSession(req);
  if (!session) {
    redirect("/login");
  }
  if (session.role !== "ADMIN") {
    redirect("/unauthorized");
  }
  return session;
}

/**
 * Require a PLAYER or ADMIN session (any authenticated player).
 * If not authenticated, redirects to /login.
 */
export async function requirePlayer(
  req?: NextRequest
): Promise<SessionPayload> {
  const session = await getSession(req);
  if (!session) {
    redirect("/login");
  }
  return session;
}

// ---------------------------------------------------------------------------
// API guard helpers — for Route Handlers (return Response instead of redirect)
// ---------------------------------------------------------------------------

/** Check admin role for Route Handlers. Returns null if authorised, or a 401/403 Response. */
export async function apiRequireAdmin(
  req: NextRequest
): Promise<Response | null> {
  const session = await getSession(req);
  if (!session) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (session.role !== "ADMIN") {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  return null;
}

/** Check any authenticated session for Route Handlers. */
export async function apiRequireAuth(
  req: NextRequest
): Promise<Response | null> {
  const session = await getSession(req);
  if (!session) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}
