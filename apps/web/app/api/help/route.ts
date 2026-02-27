import { getHelpArticles } from "@/lib/store";
import { fail, ok, requireAuth } from "@/lib/http";

export async function GET(req: Request) {
  const session = await requireAuth();
  if (!session) {
    return fail(401, {
      code: "UNAUTHORIZED",
      message: "認証が必要です。",
      retryable: false,
    });
  }
  const { searchParams } = new URL(req.url);
  const tags = (searchParams.get("tags") ?? "")
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);

  const articles = await getHelpArticles(tags);
  return ok({ articles });
}
