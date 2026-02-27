"use client";

import { useEffect, useState } from "react";

export default function DataSourcePage() {
  const [url, setUrl] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [lastError, setLastError] = useState("");
  const [lastUpdatedAt, setLastUpdatedAt] = useState("");

  useEffect(() => {
    void (async () => {
      const res = await fetch("/api/dashboard?range=7&platform=all");
      if (!res.ok) {
        return;
      }
      const data = await res.json();
      const ds = data?.dataSource;
      if (ds?.sheets_url) {
        setUrl(ds.sheets_url);
      }
      if (ds?.updated_at) {
        setLastUpdatedAt(ds.updated_at);
      }
      if (ds?.last_error) {
        setLastError(ds.last_error);
      }
    })();
  }, []);

  async function onSaveAndRefresh() {
    setBusy(true);
    setStatus("");
    setLastError("");

    try {
      const res = await fetch("/api/sheets/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sheetsUrl: url }),
      });

      if (!res.ok) {
        const errorData = await res.json();
        setLastError(errorData?.error?.message ?? "更新に失敗しました。");
        setStatus("更新失敗");
        return;
      }

      setStatus("更新完了");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold">データ連携設定</h1>
      <p className="mt-1 text-sm text-muted">Google Sheets URLを登録し、手動更新を実行します。</p>

      <section className="card mt-6 max-w-3xl rounded-2xl p-5">
        <label className="grid gap-2">
          <span className="text-sm font-medium">Google Sheets URL</span>
          <input
            name="sheetsUrl"
            type="url"
            autoComplete="off"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://docs.google.com/spreadsheets/d/…"
            className="rounded-lg border border-slate-300 px-3 py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
          />
        </label>

        <button
          type="button"
          onClick={() => {
            void onSaveAndRefresh();
          }}
          disabled={busy || !url}
          className="mt-4 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
        >
          {busy ? "更新中…" : "保存して更新"}
        </button>

        {status && (
          <p aria-live="polite" className="mt-3 text-sm text-ok">
            {status}
          </p>
        )}
        {lastError && (
          <p aria-live="polite" className="mt-2 text-sm text-bad">
            {lastError}
          </p>
        )}
        {lastUpdatedAt && (
          <p className="mt-2 text-xs text-muted">
            最終更新: {new Date(lastUpdatedAt).toLocaleString("ja-JP")}
          </p>
        )}
      </section>
    </div>
  );
}
