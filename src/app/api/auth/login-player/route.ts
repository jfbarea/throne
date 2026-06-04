// Route Handler: POST /api/auth/login-player
// Player authenticates by selecting their displayName + entering their passcode.
// SPEC §6: server verifies bcrypt hash; identity stored in signed cookie only.

import { NextRequest, NextResponse } from "next/server";
import { verifyPlayerPasscode } from "@/lib/auth";
import { setSessionCookie } from "@/lib/session";

export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: { displayName?: string; passcode?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { displayName, passcode } = body;

  if (typeof displayName !== "string" || displayName.trim() === "") {
    return NextResponse.json(
      { error: "Nombre de jugador requerido" },
      { status: 400 }
    );
  }
  if (typeof passcode !== "string" || passcode.trim() === "") {
    return NextResponse.json({ error: "Passcode requerido" }, { status: 400 });
  }

  const player = await verifyPlayerPasscode(displayName.trim(), passcode);

  if (!player) {
    return NextResponse.json(
      { error: "Credenciales incorrectas" },
      { status: 401 }
    );
  }

  const response = NextResponse.json({
    ok: true,
    player: { id: player.id, displayName: player.displayName, role: player.role },
  });

  await setSessionCookie(response, {
    playerId: player.id,
    role: player.role,
  });

  return response;
}
