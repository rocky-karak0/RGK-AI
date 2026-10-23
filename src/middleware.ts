import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function middleware(req: NextRequest) {
  let res = NextResponse.next({ request: req });
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => req.cookies.getAll(),
        setAll: (list) => {
          list.forEach(({ name, value }) => req.cookies.set(name, value));
          res = NextResponse.next({ request: req });
          list.forEach(({ name, value, options }) => res.cookies.set(name, value, options));
        },
      },
    }
  );
  const { data: { user } } = await supabase.auth.getUser();
  const path = req.nextUrl.pathname;
  if (!user && (path.startsWith("/chat") || path.startsWith("/settings") || path.startsWith("/admin"))) return NextResponse.redirect(new URL("/login", req.url));
  if (user && (path === "/login" || path === "/signup")) return NextResponse.redirect(new URL("/chat", req.url));
  return res;
}

export const config = { matcher: ["/chat/:path*", "/settings/:path*", "/admin/:path*", "/login", "/signup"] };
