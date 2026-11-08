"use server";

import { redirect } from "next/navigation";
import { sessionClient } from "@/lib/supabase/server";

export async function signIn(form: FormData) {
  const email = String(form.get("email") ?? "").trim();
  const password = String(form.get("password") ?? "");
  if (!email || email.length > 254 || !password || password.length > 1024) redirect("/login?failed=1");
  const db = await sessionClient();
  const { data, error } = await db.auth.signInWithPassword({ email, password });
  if (error || data.user.id !== process.env.APP_OWNER_USER_ID) {
    if (data.session) await db.auth.signOut({ scope: "local" });
    redirect("/login?failed=1");
  }
  redirect("/");
}

export async function signOut() {
  const db = await sessionClient();
  await db.auth.signOut({ scope: "local" });
  redirect("/login");
}
