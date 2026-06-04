// /login — Server Component shell for the login page.
// If the user already has a valid session, redirect to home.

import { getSession } from "@/lib/session";
import { redirect } from "next/navigation";
import { LoginForm } from "./LoginForm";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Iniciar sesión — throne",
};

export default async function LoginPage() {
  const session = await getSession();
  if (session) {
    redirect("/");
  }

  return <LoginForm />;
}
