import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getDataMode, getSupabasePublicEnv, hasSupabasePublicConfig } from "./env";
import type { Database } from "./types";

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const mode = getDataMode();
  if (mode === "dev-sample") {
    return supabaseResponse;
  }

  if (!hasSupabasePublicConfig()) {
    return new NextResponse(
      "Supabase public environment is not configured for REGAPRO_DATA_MODE=supabase.",
      { status: 500 },
    );
  }

  const { url, publishableKey } = getSupabasePublicEnv();

  const supabase = createServerClient<Database>(url, publishableKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet: { name: string; value: string; options?: CookieOptions }[]) {
        cookiesToSet.forEach(({ name, value }) => {
          request.cookies.set(name, value);
        });
        supabaseResponse = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => {
          supabaseResponse.cookies.set(name, value, options);
        });
      },
    },
  });

  // Prefer getUser() for validated session (JWT signature check).
  const { data } = await supabase.auth.getUser();
  const user = data.user;
  const pathname = request.nextUrl.pathname;

  const isAuthRoute =
    pathname.startsWith("/login") ||
    pathname.startsWith("/reset-password") ||
    pathname.startsWith("/invite");
  const isPublicAsset =
    pathname.startsWith("/_next") ||
    pathname.startsWith("/icons") ||
    pathname === "/favicon.ico" ||
    pathname.startsWith("/api/health") ||
    pathname.startsWith("/api/auth/");

  if (isPublicAsset) {
    return supabaseResponse;
  }

  if (!user && !isAuthRoute) {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = "/login";
    redirectUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(redirectUrl);
  }

  if (user && isAuthRoute) {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = "/home";
    redirectUrl.search = "";
    return NextResponse.redirect(redirectUrl);
  }

  return supabaseResponse;
}
