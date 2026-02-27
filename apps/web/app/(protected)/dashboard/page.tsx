"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { AiSidebar } from "@/components/ai-sidebar";
import { AnomalyTable } from "@/components/anomaly-table";
import { KpiCards } from "@/components/kpi-cards";

type DashboardResponse = {
  summary: {
    impressions: number;
    clicks: number;
    conversions: number;
    revenue: number;
    cost: number;
    ctr: number | null;
    cvr: number | null;
    cpa: number | null;
    roas: number | null;
  };
  anomalies: Array<{
    date: string;
    type: "CPA悪化" | "CV減少" | "CTR低下" | "検知スキップ";
    platform: "google" | "yahoo" | "meta" | "tiktok" | "all";
    detail: string;
    severity: "High" | "Medium" | "Low";
    tags: string[];
  }>;
  topCampaigns: Array<{ campaign: string; cost: number; revenue: number }>;
  series: Array<{ date: string; cost: number; revenue: number; conversions: number }>;
  severityCounts: { High: number; Medium: number; Low: number };
};

const defaultDashboard: DashboardResponse = {
  summary: {
    impressions: 0,
    clicks: 0,
    conversions: 0,
    revenue: 0,
    cost: 0,
    ctr: null,
    cvr: null,
    cpa: null,
    roas: null,
  },
  anomalies: [],
  topCampaigns: [],
  series: [],
  severityCounts: { High: 0, Medium: 0, Low: 0 },
};

export default function DashboardPage() {
  const [range, setRange] = useState<"7" | "14" | "30">("7");
  const [platform, setPlatform] = useState<"all" | "google" | "yahoo" | "meta" | "tiktok">("all");
  const [data, setData] = useState<DashboardResponse>(defaultDashboard);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    void (async () => {
      try {
        const res = await fetch(`/api/dashboard?range=${range}&platform=${platform}`, {
          cache: "no-store",
        });
        if (!res.ok) {
          setData(defaultDashboard);
          return;
        }
        setData((await res.json()) as DashboardResponse);
      } finally {
        setLoading(false);
      }
    })();
  }, [range, platform]);

  const aiPayload = useMemo(
    () => ({
      summary: data.summary,
      anomalies: data.anomalies,
      top_campaigns: data.topCampaigns,
      period: `${range}d` as "7d" | "14d" | "30d",
    }),
    [data, range],
  );

  const helpTags = [...new Set(data.anomalies.flatMap((item) => item.tags))];

  return (
    <div>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">ダッシュボード</h1>
          <p className="mt-1 text-sm text-muted">KPI、異常、優先対応キャンペーンを一画面で確認できます。</p>
        </div>
        <div className="flex items-center gap-2">
          <select
            aria-label="期間"
            value={range}
            onChange={(event) => setRange(event.target.value as "7" | "14" | "30")}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
          >
            <option value="7">7日</option>
            <option value="14">14日</option>
            <option value="30">30日</option>
          </select>
          <select
            aria-label="媒体"
            value={platform}
            onChange={(event) =>
              setPlatform(event.target.value as "all" | "google" | "yahoo" | "meta" | "tiktok")
            }
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
          >
            <option value="all">全媒体</option>
            <option value="google">Google</option>
            <option value="yahoo">Yahoo</option>
            <option value="meta">Meta</option>
            <option value="tiktok">TikTok</option>
          </select>
        </div>
      </header>

      {loading && <p className="mt-3 text-sm text-muted">読み込み中…</p>}

      <div className="mt-6">
        <KpiCards summary={data.summary} />
      </div>

      <section className="mt-6 grid gap-6 xl:grid-cols-3">
        <article className="card rounded-2xl p-4 xl:col-span-2">
          <h2 className="text-base font-semibold">費用と売上トレンド</h2>
          <div className="mt-4 h-72">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data.series}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" />
                <YAxis />
                <Tooltip />
                <Legend />
                <Line type="monotone" dataKey="cost" stroke="#0b5fff" strokeWidth={2} name="費用" />
                <Line type="monotone" dataKey="revenue" stroke="#0f9d58" strokeWidth={2} name="売上" />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </article>

        <article className="card rounded-2xl p-4">
          <h2 className="text-base font-semibold">異常重要度サマリー</h2>
          <div className="mt-4 h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={[
                  { severity: "High", count: data.severityCounts.High },
                  { severity: "Medium", count: data.severityCounts.Medium },
                  { severity: "Low", count: data.severityCounts.Low },
                ]}
              >
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="severity" />
                <YAxis allowDecimals={false} />
                <Tooltip />
                <Bar dataKey="count" fill="#0b5fff" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </article>
      </section>

      <section className="mt-6 grid gap-6 xl:grid-cols-5">
        <article className="card rounded-2xl p-4 xl:col-span-3">
          <h2 className="text-base font-semibold">上位キャンペーン（費用順）</h2>
          <div className="mt-3 overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="text-left text-xs uppercase text-muted">
                <tr>
                  <th className="py-2">キャンペーン</th>
                  <th className="py-2">費用</th>
                  <th className="py-2">売上</th>
                  <th className="py-2">ROAS</th>
                </tr>
              </thead>
              <tbody>
                {data.topCampaigns.map((item) => {
                  const roas = item.cost ? item.revenue / item.cost : null;
                  return (
                    <tr key={item.campaign} className="border-t border-slate-100">
                      <td className="py-2">{item.campaign}</td>
                      <td className="py-2">¥{Math.round(item.cost).toLocaleString("ja-JP")}</td>
                      <td className="py-2">¥{Math.round(item.revenue).toLocaleString("ja-JP")}</td>
                      <td className="py-2">{roas ? `${(roas * 100).toFixed(1)}%` : "-"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </article>

        <article className="card rounded-2xl p-4 xl:col-span-2">
          <h2 className="text-base font-semibold">推奨Adコラム</h2>
          {helpTags.length === 0 ? (
            <p className="mt-2 text-sm text-muted">異常タグがないため、まずデータ更新を行ってください。</p>
          ) : (
            <>
              <p className="mt-2 text-sm text-muted">検知タグ: {helpTags.join(", ")}</p>
              <Link
                href={`/ad-column?tags=${encodeURIComponent(helpTags.join(","))}`}
                className="mt-4 inline-flex rounded-lg bg-accent px-3 py-2 text-sm font-semibold text-white"
              >
                関連記事を確認
              </Link>
            </>
          )}
        </article>
      </section>

      <AnomalyTable anomalies={data.anomalies} />

      <AiSidebar initialPromptPayload={aiPayload} />
    </div>
  );
}
