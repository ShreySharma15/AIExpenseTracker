import "server-only";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

export async function sessionClient() {
  const jar = await cookies();
  return createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, {
    cookies: {
      getAll: () => jar.getAll(),
      setAll: (updates) => {
        try { for (const { name, value, options } of updates) jar.set(name, value, options); }
        catch { /* Read-only render. The request proxy refreshes the session. */ }
      },
    },
  });
}

export async function ownerSession() {
  const db = await sessionClient();
  const { data, error } = await db.auth.getUser();
  if (error || !data.user || data.user.id !== process.env.APP_OWNER_USER_ID) redirect("/login");
  return { db, owner: data.user.id };
}

export function botClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: (input, init) => fetch(input, {
      ...init, cache: "no-store", signal: init?.signal
        ? AbortSignal.any([init.signal, AbortSignal.timeout(6000)])
        : AbortSignal.timeout(6000),
    }) },
  });
}
