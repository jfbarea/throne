// Route Handler: POST /api/auth/login-admin
// Admin authenticates with ADMIN_PASSCODE env var.
// SPEC §6: constant-time comparison; identity in signed cookie, never in client input.

import { NextRequest, NextResponse } from "next/server";
import { verifyAdminPasscode } from "@/lib/auth";
import { setSessionCookie } from "@/lib/session";

export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: { passcode?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { passcode } = body;
  if (typeof passcode !== "string" || passcode.trim() === "") {
    return NextResponse.json({ error: "Passcode requerido" }, { status: 400 });
  }

  if (!verifyAdminPasscode(passcode)) {
    // Deliberate vague error to avoid info leaks.
    return NextResponse.json(
      { error: "Credenciales incorrectas" },
      { status: 401 }
    );
  }

  // The admin session carries no fixed playerId (multi-liga spec §2.4, §4.4):
  // the admin has a distinct Player row with role=ADMIN in every league, so
  // there's no single "the" admin player to resolve here. The acting player
  // for a given write action is derived per-league instead, via
  // resolveActingPlayerId(leagueId, session) (src/lib/league-context.ts).
  const response = NextResponse.json({ ok: true });
  await setSessionCookie(response, {
    playerId: null,
    role: "ADMIN",
  });

  return response;
}
