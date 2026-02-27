import { fail, ok, requireAuth } from "@/lib/http";
import { getHelpArticleById } from "@/lib/store";

export async function GET(_: Request, context: { params: Promise<{ id: string }> }) {
  const session = await requireAuth();
  if (!session) {
    return fail(401, {
      code: "UNAUTHORIZED",
      message: "認証が必要です。",
      retryable: false,
    });
  }

  const { id } = await context.params;
  const article = await getHelpArticleById(id);
  if (!article) {
    return fail(404, {
      code: "NOT_FOUND",
      message: "記事が見つかりません。",
      retryable: false,
    });
  }

  return ok({ article });
}
