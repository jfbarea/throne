// Route Handler: POST /api/auth/login-admin
// Admin authenticates with ADMIN_PASSCODE env var.
// SPEC §6: constant-time comparison; identity in signed cookie, never in client input.

import { NextRequest, NextResponse } from "next/server";
import { verifyAdminPasscode } from "@/lib/auth";
import { setSessionCookie } from "@/lib/session";
import { prisma } from "@/lib/db";

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

  // Look up the admin player record (there must be a Player with role=ADMIN).
  // If none exists, the session still works but playerId will be null.
  const adminPlayer = await prisma.player.findFirst({
    where: { role: "ADMIN", active: true },
    select: { id: true },
  });

  const response = NextResponse.json({ ok: true });
  await setSessionCookie(response, {
    playerId: adminPlayer?.id ?? null,
    role: "ADMIN",
  });

  return response;
}
