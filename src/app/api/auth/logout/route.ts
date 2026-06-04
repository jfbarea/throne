// Route Handler: POST /api/auth/logout
// Clears the session cookie.

import { NextResponse } from "next/server";
import { clearSessionCookie } from "@/lib/session";

export async function POST(): Promise<NextResponse> {
  const response = NextResponse.json({ ok: true });
  clearSessionCookie(response);
  return response;
}
