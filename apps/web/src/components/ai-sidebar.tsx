"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { MarkdownContent } from "@/components/markdown-content";
import type { AiInsightResponse, ChatMessage } from "@/types/domain";

type Props = {
  initialPromptPayload: unknown;
};

const ACTIVE_SESSION_KEY = "adops_ai_session";

type SuggestedArticle = {
  id: string;
  title: string;
  tags: string[];
};

type ChatSessionSummary = {
  id: string;
  title: string;
  createdAt: string;
  lastMessageAt: string | null;
};

type ChatHistoryResponse = {
  sessions: ChatSessionSummary[];
  messages: ChatMessage[];
};

function parseHelpTags(text: string): string[] {
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const helpHeaderIndex = lines.findIndex((line) => line.includes("参考ヘルプ"));
  const candidate =
    helpHeaderIndex >= 0 ? lines[helpHeaderIndex + 1] ?? "" : lines[lines.length - 1] ?? "";
  return candidate
    .split(",")
    .map((item) => item.trim())
    .filter((item) => /^[a-z_]+$/i.test(item));
}

export function AiSidebar({ initialPromptPayload }: Props) {
  const [sessionId, setSessionId] = useState("");
  const [sessions, setSessions] = useState<ChatSessionSummary[]>([]);
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [insight, setInsight] = useState<AiInsightResponse | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [streamingTools, setStreamingTools] = useState<string[]>([]);
  const [suggestedArticles, setSuggestedArticles] = useState<SuggestedArticle[]>([]);
  const scrollAnchorRef = useRef<HTMLDivElement | null>(null);

  async function fetchSessions(preferredSessionId?: string) {
    const res = await fetch("/api/ai/chat", { cache: "no-store" });
    if (!res.ok) {
      throw new Error("会話セッションの取得に失敗しました。");
    }

    const data = (await res.json()) as ChatHistoryResponse;
    const existingId = window.sessionStorage.getItem(ACTIVE_SESSION_KEY);
    const nextSessionId =
      preferredSessionId ??
      existingId ??
      data.sessions[0]?.id ??
      globalThis.crypto.randomUUID();

    const hasSession = data.sessions.some((item) => item.id === nextSessionId);
    const normalizedSessions = hasSession
      ? data.sessions
      : [
          {
            id: nextSessionId,
            title: "新しい会話",
            createdAt: new Date().toISOString(),
            lastMessageAt: null,
          },
          ...data.sessions,
        ];

    setSessions(normalizedSessions);
    setSessionId(nextSessionId);
    window.sessionStorage.setItem(ACTIVE_SESSION_KEY, nextSessionId);
  }

  useEffect(() => {
    void fetchSessions().catch(() => {
      const fallbackSessionId = globalThis.crypto.randomUUID();
      setSessions([
        {
          id: fallbackSessionId,
          title: "新しい会話",
          createdAt: new Date().toISOString(),
          lastMessageAt: null,
        },
      ]);
      setSessionId(fallbackSessionId);
      setMessages([]);
      window.sessionStorage.setItem(ACTIVE_SESSION_KEY, fallbackSessionId);
    });
  }, []);

  useEffect(() => {
    if (!sessionId) {
      return;
    }
    let canceled = false;
    setLoadingHistory(true);
    void (async () => {
      try {
        const res = await fetch(`/api/ai/chat?sessionId=${encodeURIComponent(sessionId)}`, {
          cache: "no-store",
        });
        if (!res.ok) {
          if (!canceled) {
            setMessages([]);
          }
          return;
        }
        const data = (await res.json()) as ChatHistoryResponse;
        if (!canceled) {
          setMessages(data.messages ?? []);
          if (data.sessions?.length) {
            setSessions((prev) => {
              const next = [...prev];
              for (const item of data.sessions) {
                if (!next.some((current) => current.id === item.id)) {
                  next.push(item);
                }
              }
              return next;
            });
          }
        }
      } finally {
        if (!canceled) {
          setLoadingHistory(false);
        }
      }
    })();

    window.sessionStorage.setItem(ACTIVE_SESSION_KEY, sessionId);
    setInsight(null);
    setSuggestedArticles([]);

    return () => {
      canceled = true;
    };
  }, [sessionId]);

  useEffect(() => {
    if (!open) {
      return;
    }
    scrollAnchorRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, loading, open]);

  async function generate() {
    setLoading(true);
    try {
      const res = await fetch("/api/ai/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(initialPromptPayload),
      });
      const data = await res.json();
      setInsight(data);
      const tags = parseHelpTags(data.text ?? "");
      if (tags.length > 0) {
        const helpRes = await fetch(`/api/help?tags=${encodeURIComponent(tags.join(","))}`);
        if (helpRes.ok) {
          const helpData = await helpRes.json();
          setSuggestedArticles(helpData.articles ?? []);
        }
      } else {
        setSuggestedArticles([]);
      }
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: data.text,
          createdAt: new Date().toISOString(),
        },
      ]);
    } finally {
      setLoading(false);
    }
  }

  async function sendChat() {
    if (!input.trim() || !sessionId) {
      return;
    }
    const pendingInput = input.trim();
    const nextUserMessage: ChatMessage = {
      role: "user",
      content: pendingInput,
      createdAt: new Date().toISOString(),
    };
    const draftId = `draft-${Date.now()}`;
    const draftAssistantMessage: ChatMessage = {
      role: "assistant",
      content: "",
      createdAt: draftId,
    };

    setInput("");
    setStreamingTools([]);
    const chatHistory = [...messages, nextUserMessage];
    setMessages((prev) => [...prev, nextUserMessage, draftAssistantMessage]);
    setLoading(true);

    try {
      const res = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId,
          userMessage: nextUserMessage,
          messages: chatHistory,
          context: initialPromptPayload,
        }),
      });
      if (!res.ok || !res.body) {
        throw new Error("AI応答の取得に失敗しました。");
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let fullAssistantText = "";
      let finalCreatedAt = new Date().toISOString();

      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const rawLine of lines) {
          const line = rawLine.trim();
          if (!line) {
            continue;
          }

          const event = JSON.parse(line) as
            | { type: "delta"; delta: string }
            | { type: "done"; message: ChatMessage }
            | { type: "error"; message: string }
            | { type: "tool"; phase: "start" | "done"; tool: string; platform?: string };

          if (event.type === "delta") {
            fullAssistantText += event.delta;
            setMessages((prev) =>
              prev.map((message) =>
                message.createdAt === draftId ? { ...message, content: fullAssistantText } : message,
              ),
            );
          }

          if (event.type === "done") {
            finalCreatedAt = event.message.createdAt;
            if (!fullAssistantText && event.message.content) {
              fullAssistantText = event.message.content;
              setMessages((prev) =>
                prev.map((message) =>
                  message.createdAt === draftId
                    ? { ...message, content: event.message.content }
                    : message,
                ),
              );
            }
          }

          if (event.type === "tool") {
            if (event.phase === "start") {
              const label = event.platform ? `${event.tool} (${event.platform})` : event.tool;
              setStreamingTools((prev) => (prev.includes(label) ? prev : [...prev, label]));
            }
          }

          if (event.type === "error") {
            throw new Error(event.message);
          }
        }
      }

      setMessages((prev) =>
        prev.map((message) =>
          message.createdAt === draftId ? { ...message, createdAt: finalCreatedAt } : message,
        ),
      );
      await fetchSessions(sessionId);
    } catch (error) {
      const errorText = error instanceof Error ? error.message : "AI応答の取得に失敗しました。";
      setMessages((prev) =>
        prev.map((message) =>
          message.createdAt === draftId ? { ...message, content: errorText } : message,
        ),
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setOpen(true);
          if (!insight) {
            void generate();
          }
        }}
        className="fixed bottom-6 right-6 rounded-full bg-accent px-5 py-3 text-sm font-semibold text-white shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
      >
        AI分析を開く
      </button>

      {open && (
        <aside className="fixed right-0 top-0 z-40 h-full w-full max-w-[400px] border-l border-slate-200 bg-white shadow-2xl">
          <header className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
            <h2 className="text-base font-semibold">AIサイドバー</h2>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-lg border border-slate-300 px-3 py-1 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
            >
              閉じる
            </button>
          </header>

          <div className="flex h-[calc(100%-58px)] flex-col">
            <div className="border-b border-slate-200 p-3">
              <div className="flex gap-2">
                <select
                  value={sessionId}
                  onChange={(event) => setSessionId(event.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
                >
                  {sessions.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.title}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => {
                    const nextId = globalThis.crypto.randomUUID();
                    setSessions((prev) => [
                      {
                        id: nextId,
                        title: "新しい会話",
                        createdAt: new Date().toISOString(),
                        lastMessageAt: null,
                      },
                      ...prev,
                    ]);
                    setSessionId(nextId);
                  }}
                  className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
                >
                  新規
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-4" aria-live="polite">
              {loadingHistory && <p className="text-sm text-muted">会話履歴を読み込み中...</p>}
              {loading && streamingTools.length > 0 && (
                <div className="mb-3 rounded-lg border border-slate-200 bg-slate-50 p-2 text-xs text-slate-700">
                  実行中ツール: {streamingTools.join(" -> ")}
                </div>
              )}
              {messages.length === 0 && !loading && (
                <p className="text-sm text-muted">AIとのやりとりはここに表示されます。</p>
              )}
              {messages.map((message, idx) => (
                <article
                  key={`${message.createdAt}-${idx}`}
                  className={`mb-3 flex ${message.role === "user" ? "justify-end" : "justify-start"}`}
                >
                  <div
                    className={`max-w-[90%] rounded-2xl px-3 py-2 ${
                      message.role === "user" ? "bg-accent text-white" : "bg-slate-100 text-slate-900"
                    }`}
                  >
                    <MarkdownContent content={message.content || "生成中..."} />
                  </div>
                </article>
              ))}
              <div ref={scrollAnchorRef} />

              {insight?.mode === "mock" && insight.fallbackReason && (
                <p className="mt-2 text-xs text-amber-700">
                  Geminiフォールバック理由: {insight.fallbackReason}
                </p>
              )}

              {suggestedArticles.length > 0 && (
                <section className="mt-4">
                  <h3 className="text-sm font-semibold">AI提案の参考記事</h3>
                  <div className="mt-2 grid gap-2">
                    {suggestedArticles.map((article) => (
                      <Link
                        key={article.id}
                        href={`/ad-column/${article.id}`}
                        className="rounded-lg border border-slate-200 p-2 text-sm hover:bg-slate-50"
                      >
                        <p className="font-medium">{article.title}</p>
                        <p className="mt-1 text-xs text-muted">{article.tags.join(", ")}</p>
                      </Link>
                    ))}
                  </div>
                </section>
              )}
            </div>

            <div className="border-t border-slate-200 p-3">
              <div className="flex gap-2">
                <input
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder="質問を入力"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
                />
                <button
                  type="button"
                  onClick={() => {
                    void sendChat();
                  }}
                  disabled={loading}
                  className="rounded-lg bg-accent px-3 py-2 text-sm font-semibold text-white disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
                >
                  送信
                </button>
              </div>
              <button
                type="button"
                onClick={() => {
                  void generate();
                }}
                disabled={loading}
                className="mt-2 text-xs text-accent underline disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
              >
                再試行
              </button>
            </div>
          </div>
        </aside>
      )}
    </>
  );
}
