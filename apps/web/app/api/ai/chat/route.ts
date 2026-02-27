import { streamChatReply } from "@/lib/ai";
import { getChatMessages, getWorkspaceId, listChatSessions, saveChatMessage } from "@/lib/store";
import { fail, ok, requireAuth } from "@/lib/http";
import type { ChatMessage } from "@/types/domain";

export async function GET(req: Request) {
  try {
    const session = await requireAuth();
    if (!session) {
      return fail(401, {
        code: "UNAUTHORIZED",
        message: "認証が必要です。",
        retryable: false,
      });
    }

    const workspaceId = await getWorkspaceId();
    const sessions = await listChatSessions(workspaceId);
    const url = new URL(req.url);
    const sessionId = url.searchParams.get("sessionId");
    if (!sessionId) {
      return ok({ sessions, messages: [] });
    }

    const messages = await getChatMessages(sessionId);
    return ok({ sessions, messages });
  } catch (error) {
    const message = error instanceof Error ? error.message : "会話履歴の取得に失敗しました。";
    return fail(500, {
      code: "AI_CHAT_FETCH_FAILED",
      message,
      retryable: true,
    });
  }
}

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
    const body = (await req.json()) as {
      sessionId?: string;
      messages?: ChatMessage[];
      userMessage?: ChatMessage;
      context?: unknown;
    };
    const sessionId = body.sessionId ?? "session-default";
    if (body.userMessage) {
      await saveChatMessage(sessionId, body.userMessage);
    }

    const history = body.messages?.length ? body.messages : await getChatMessages(sessionId);
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        try {
          const reply = await streamChatReply(history, (delta) => {
            controller.enqueue(encoder.encode(`${JSON.stringify({ type: "delta", delta })}\n`));
          }, body.context, (toolEvent) => {
            controller.enqueue(
              encoder.encode(`${JSON.stringify({ type: "tool", ...toolEvent })}\n`),
            );
          });

          await saveChatMessage(sessionId, reply);
          controller.enqueue(encoder.encode(`${JSON.stringify({ type: "done", message: reply })}\n`));
        } catch (error) {
          const message = error instanceof Error ? error.message : "AIチャットに失敗しました。";
          controller.enqueue(encoder.encode(`${JSON.stringify({ type: "error", message })}\n`));
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      status: 200,
      headers: {
        "Content-Type": "application/x-ndjson; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "AIチャットに失敗しました。";
    return fail(500, {
      code: "AI_CHAT_FAILED",
      message,
      retryable: true,
    });
  }
}
