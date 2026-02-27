import { generateInsight } from "@/lib/ai";
import { logEvent } from "@/lib/store";
import { fail, ok, requireAuth } from "@/lib/http";
import type { AiInsightRequest } from "@/types/domain";

export async function POST(req: Request) {
  try {
    const session = await requireAuth();
    if (!session) {
      return fail(401, {
        code: "UNAUTHORIZED",
        message: "認証が必要です。",
        retryable: false,
      });
    }
    const body = (await req.json()) as AiInsightRequest;
    const result = await generateInsight(body);
    return ok(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "AI生成に失敗しました。";
    await logEvent({
      event_type: "ai_generate_failed",
      level: "error",
      payload: { message },
    }).catch(() => undefined);

    return fail(500, {
      code: "AI_GENERATE_FAILED",
      message,
      retryable: true,
    });
  }
}
