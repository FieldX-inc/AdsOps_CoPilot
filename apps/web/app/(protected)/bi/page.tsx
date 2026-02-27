"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

type CampaignRow = {
  campaign: string;
  cost: number;
  revenue: number;
  clicks: number;
  conversions: number;
  impressions: number;
  roas: number | null;
  ctr: number | null;
  cvr: number | null;
};

type BiPayload = {
  series: Array<{
    date: string;
    cost: number;
    revenue: number;
    conversions: number;
    clicks: number;
    impressions: number;
    ctr: number | null;
    cvr: number | null;
  }>;
  composition: Array<{ platform: string; cost: number; revenue: number }>;
  summary: {
    cost: number;
    revenue: number;
    clicks: number;
    conversions: number;
    ctr: number | null;
    cvr: number | null;
    cpa: number | null;
    roas: number | null;
  };
  campaignRanking: CampaignRow[];
};

const defaultData: BiPayload = {
  series: [],
  composition: [],
  summary: {
    cost: 0,
    revenue: 0,
    clicks: 0,
    conversions: 0,
    ctr: null,
    cvr: null,
    cpa: null,
    roas: null,
  },
  campaignRanking: [],
};

export default function BIPage() {
  const [range, setRange] = useState<"7" | "14" | "30">("7");
  const [platform, setPlatform] = useState<"all" | "google" | "yahoo" | "meta" | "tiktok">("all");
  const [rankingMetric, setRankingMetric] = useState<"revenue" | "cost" | "roas">("revenue");
  const [data, setData] = useState<BiPayload>(defaultData);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    void (async () => {
      try {
        const res = await fetch(`/api/bi?range=${range}&platform=${platform}`);
        if (!res.ok) {
          setData(defaultData);
          return;
        }
        setData((await res.json()) as BiPayload);
      } finally {
        setLoading(false);
      }
    })();
  }, [range, platform]);

  const rankingChartData = useMemo(() => {
    const sorted = [...data.campaignRanking].sort((a, b) => {
      const aValue = rankingMetric === "roas" ? (a.roas ?? 0) : a[rankingMetric];
      const bValue = rankingMetric === "roas" ? (b.roas ?? 0) : b[rankingMetric];
      return bValue - aValue;
    });
    return sorted.slice(0, 8).map((item) => ({
      campaign: item.campaign,
      value: rankingMetric === "roas" ? Number((item.roas ?? 0).toFixed(2)) : item[rankingMetric],
    }));
  }, [data.campaignRanking, rankingMetric]);

  return (
    <div>
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">BI分析</h1>
          <p className="mt-1 text-sm text-muted">時系列、構成比、キャンペーン比較をまとめて分析します。</p>
        </div>

        <div className="flex items-center gap-2">
          <select
            aria-label="期間"
            value={range}
            onChange={(e) => setRange(e.target.value as "7" | "14" | "30")}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
          >
            <option value="7">7日</option>
            <option value="14">14日</option>
            <option value="30">30日</option>
          </select>

          <select
            aria-label="媒体"
            value={platform}
            onChange={(e) =>
              setPlatform(e.target.value as "all" | "google" | "yahoo" | "meta" | "tiktok")
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

      <section className="mt-6 grid gap-4 md:grid-cols-4">
        <article className="card rounded-2xl p-4">
          <p className="text-xs text-muted">費用</p>
          <p className="mt-1 text-xl font-semibold">¥{Math.round(data.summary.cost).toLocaleString("ja-JP")}</p>
        </article>
        <article className="card rounded-2xl p-4">
          <p className="text-xs text-muted">売上</p>
          <p className="mt-1 text-xl font-semibold">¥{Math.round(data.summary.revenue).toLocaleString("ja-JP")}</p>
        </article>
        <article className="card rounded-2xl p-4">
          <p className="text-xs text-muted">ROAS</p>
          <p className="mt-1 text-xl font-semibold">{data.summary.roas ? `${(data.summary.roas * 100).toFixed(1)}%` : "-"}</p>
        </article>
        <article className="card rounded-2xl p-4">
          <p className="text-xs text-muted">CVR</p>
          <p className="mt-1 text-xl font-semibold">{data.summary.cvr ? `${(data.summary.cvr * 100).toFixed(2)}%` : "-"}</p>
        </article>
      </section>

      <section className="mt-6 grid gap-6 lg:grid-cols-2">
        <article className="card rounded-2xl p-4">
          <h2 className="mb-3 text-base font-semibold">時系列（費用 / 売上 / CV）</h2>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data.series}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" />
                <YAxis />
                <Tooltip />
                <Legend />
                <Line type="monotone" dataKey="cost" stroke="#0b5fff" strokeWidth={2} name="費用" />
                <Line type="monotone" dataKey="revenue" stroke="#0f9d58" strokeWidth={2} name="売上" />
                <Line type="monotone" dataKey="conversions" stroke="#d97706" strokeWidth={2} name="CV" />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </article>

        <article className="card rounded-2xl p-4">
          <h2 className="mb-3 text-base font-semibold">構成比（媒体別費用）</h2>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={data.composition} dataKey="cost" nameKey="platform" outerRadius={96} fill="#0b5fff" />
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </article>
      </section>

      <section className="mt-6 grid gap-6 lg:grid-cols-2">
        <article className="card rounded-2xl p-4">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold">キャンペーンランキング</h2>
            <select
              value={rankingMetric}
              onChange={(event) => setRankingMetric(event.target.value as "revenue" | "cost" | "roas")}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
            >
              <option value="revenue">売上</option>
              <option value="cost">費用</option>
              <option value="roas">ROAS</option>
            </select>
          </div>

          <div className="mt-4 h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={rankingChartData} layout="vertical" margin={{ left: 12 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis type="number" />
                <YAxis type="category" dataKey="campaign" width={120} />
                <Tooltip />
                <Bar dataKey="value" fill="#0b5fff" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </article>

        <article className="card rounded-2xl p-4">
          <h2 className="text-base font-semibold">キャンペーン詳細</h2>
          <div className="mt-3 max-h-72 overflow-auto">
            <table className="min-w-full text-sm">
              <thead className="text-left text-xs uppercase text-muted">
                <tr>
                  <th className="py-2">キャンペーン</th>
                  <th className="py-2">ROAS</th>
                  <th className="py-2">CTR</th>
                  <th className="py-2">CVR</th>
                </tr>
              </thead>
              <tbody>
                {data.campaignRanking.map((item) => (
                  <tr key={item.campaign} className="border-t border-slate-100">
                    <td className="py-2">{item.campaign}</td>
                    <td className="py-2">{item.roas ? `${(item.roas * 100).toFixed(1)}%` : "-"}</td>
                    <td className="py-2">{item.ctr ? `${(item.ctr * 100).toFixed(2)}%` : "-"}</td>
                    <td className="py-2">{item.cvr ? `${(item.cvr * 100).toFixed(2)}%` : "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </article>
      </section>
    </div>
  );
}
