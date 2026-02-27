import { getSessionUser } from "@/lib/auth";
import { fail, ok } from "@/lib/http";

export async function GET() {
  const session = await getSessionUser();
  if (!session) {
    return fail(401, {
      code: "UNAUTHORIZED",
      message: "認証が必要です。",
      retryable: false,
    });
  }

  return ok({ user: { id: session.sub } });
}
