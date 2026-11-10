import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  let subject: string | undefined;
  if (url && key && request.cookies.getAll().some(({ name }) => name.startsWith("sb-"))) {
    const client = createServerClient(url, key, {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (updates) => {
          for (const { name, value } of updates) request.cookies.set(name, value);
          response = NextResponse.next({ request });
          for (const { name, value, options } of updates) response.cookies.set(name, value, options);
        },
      },
    });
    try {
      const { data, error } = await client.auth.getClaims();
      if (!error) subject = data?.claims.sub;
    } catch {
      // Protected requests fail closed if authentication cannot be verified.
    }
  }
  if (request.nextUrl.pathname !== "/login" && (!subject || subject !== process.env.APP_OWNER_USER_ID)) {
    const redirect = NextResponse.redirect(new URL("/login", request.url));
    for (const cookie of response.cookies.getAll()) redirect.cookies.set(cookie);
    response = redirect;
  }
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}
export const config = { matcher: ["/", "/login", "/transactions/:path*", "/people/:path*"] };
