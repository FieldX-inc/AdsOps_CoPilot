import { formatNumber, formatPercent } from "@/lib/kpi";
import type { KpiSummary } from "@/types/domain";

const cards = [
  { key: "ctr", label: "CTR", type: "rate" },
  { key: "cvr", label: "CVR", type: "rate" },
  { key: "cpa", label: "CPA", type: "money" },
  { key: "roas", label: "ROAS", type: "rate" },
  { key: "cost", label: "費用", type: "money" },
  { key: "conversions", label: "CV", type: "number" },
] as const;

export function KpiCards({ summary }: { summary: KpiSummary }) {
  return (
    <section aria-label="KPIサマリー" className="grid gap-4 md:grid-cols-3 xl:grid-cols-6">
      {cards.map((card) => {
        const raw = summary[card.key];
        const value =
          card.type === "rate"
            ? formatPercent(raw as number | null)
            : card.type === "money"
              ? `¥${formatNumber(raw as number | null, 0)}`
              : formatNumber(raw as number | null, 0);

        return (
          <article key={card.key} className="card rounded-2xl p-4">
            <p className="text-xs font-medium text-muted">{card.label}</p>
            <p className="mt-2 text-2xl font-semibold text-text">{value}</p>
          </article>
        );
      })}
    </section>
  );
}
