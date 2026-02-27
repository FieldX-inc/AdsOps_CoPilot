"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export default function LoginPage() {
  const router = useRouter();
  const [id, setId] = useState("dev");
  const [password, setPassword] = useState("1234");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError("");

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, password }),
      });

      if (!res.ok) {
        setError("ログインに失敗しました。入力を確認してください。");
        return;
      }

      router.push("/dashboard");
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <section className="card w-full max-w-md rounded-2xl p-6">
        <h1 className="text-xl font-semibold">Ad Insight Copilot ログイン</h1>
        <p className="mt-2 text-sm text-muted">MVP向け固定認証（環境変数設定）</p>

        <form className="mt-6 grid gap-4" onSubmit={onSubmit}>
          <label className="grid gap-1">
            <span className="text-sm font-medium">ID</span>
            <input
              name="id"
              type="text"
              spellCheck={false}
              autoComplete="username"
              value={id}
              onChange={(e) => setId(e.target.value)}
              className="rounded-lg border border-slate-300 px-3 py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
            />
          </label>

          <label className="grid gap-1">
            <span className="text-sm font-medium">パスワード</span>
            <input
              name="password"
              autoComplete="current-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="rounded-lg border border-slate-300 px-3 py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
            />
          </label>

          {error && (
            <p aria-live="polite" className="text-sm text-bad">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="rounded-lg bg-accent px-4 py-2 font-semibold text-white disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
          >
            {loading ? "ログイン中…" : "ログイン"}
          </button>
        </form>
      </section>
    </main>
  );
}
