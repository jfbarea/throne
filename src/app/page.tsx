// / — role-based entry point.
// Admins land on the config panel, players on their matches, and anyone
// without a session is sent to login.

import { getSession } from "@/lib/session";
import { redirect } from "next/navigation";

export default async function Home() {
  const session = await getSession();

  if (!session) {
    redirect("/login");
  }

  redirect(session.role === "ADMIN" ? "/admin" : "/mis-partidas");
}
