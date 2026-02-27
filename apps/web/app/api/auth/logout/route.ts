import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { env } from "@/lib/env";

export async function POST() {
  const cookieStore = await cookies();
  cookieStore.delete(env.sessionCookieName);
  return NextResponse.redirect(new URL("/login", process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"));
}
