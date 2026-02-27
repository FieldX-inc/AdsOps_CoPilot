import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { verifySessionToken } from "@/lib/auth";
import { env } from "@/lib/env";

const publicPaths = ["/login", "/api/auth/login", "/api/auth/session"];

function isPublicPath(pathname: string) {
  return publicPaths.some((path) => pathname.startsWith(path));
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon") ||
    pathname.endsWith(".svg") ||
    pathname.endsWith(".png")
  ) {
    return NextResponse.next();
  }

  if (isPublicPath(pathname)) {
    return NextResponse.next();
  }

  const sessionToken = req.cookies.get(env.sessionCookieName)?.value;
  const session = await verifySessionToken(sessionToken);

  if (!session) {
    if (pathname.startsWith("/api/")) {
      const response = NextResponse.json(
        {
          error: {
            code: "UNAUTHORIZED",
            message: "認証が必要です。",
            retryable: false,
          },
        },
        { status: 401 },
      );
      response.cookies.delete(env.sessionCookieName);
      return response;
    }

    const loginUrl = new URL("/login", req.url);
    loginUrl.searchParams.set("next", pathname);
    const response = NextResponse.redirect(loginUrl);
    response.cookies.delete(env.sessionCookieName);
    return response;
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
