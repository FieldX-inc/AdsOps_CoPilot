import { cookies } from "next/headers";

import { createSessionToken } from "@/lib/auth";
import { env } from "@/lib/env";
import { fail, ok } from "@/lib/http";

export async function POST(req: Request) {
  const body = (await req.json()) as { id?: string; password?: string };

  if (body.id !== env.authId || body.password !== env.authPassword) {
    return fail(401, {
      code: "AUTH_INVALID",
      message: "ログインに失敗しました。",
      retryable: false,
    });
  }

  const token = await createSessionToken(body.id);
  const cookieStore = await cookies();
  cookieStore.set(env.sessionCookieName, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: env.nodeEnv === "production",
    maxAge: env.sessionMaxAgeSeconds,
    path: "/",
  });

  return ok({ user: { id: body.id } });
}
