import { buildComposition, buildTimeSeries, getNormalizedMetrics, getWorkspaceId } from "@/lib/store";
import { summarizeKpi } from "@/lib/kpi";
import { fail, ok, requireAuth } from "@/lib/http";
import type { Platform } from "@/types/domain";

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
  const range = Number(searchParams.get("range") ?? "7");
  const platform = (searchParams.get("platform") ?? "all") as Platform | "all";

  const workspaceId = await getWorkspaceId();
  const rows = await getNormalizedMetrics(workspaceId, range, platform);
  const campaignMap = new Map<
    string,
    { campaign: string; cost: number; revenue: number; clicks: number; conversions: number; impressions: number }
  >();
  for (const row of rows) {
    const current = campaignMap.get(row.campaign) ?? {
      campaign: row.campaign,
      cost: 0,
      revenue: 0,
      clicks: 0,
      conversions: 0,
      impressions: 0,
    };
    current.cost += row.cost;
    current.revenue += row.revenue;
    current.clicks += row.clicks;
    current.conversions += row.conversions;
    current.impressions += row.impressions;
    campaignMap.set(row.campaign, current);
  }
  const campaignRanking = [...campaignMap.values()]
    .map((item) => ({
      ...item,
      roas: item.cost ? item.revenue / item.cost : null,
      ctr: item.impressions ? item.clicks / item.impressions : null,
      cvr: item.clicks ? item.conversions / item.clicks : null,
    }))
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 10);

  return ok({
    series: buildTimeSeries(rows),
    composition: buildComposition(rows),
    summary: summarizeKpi(rows),
    campaignRanking,
  });
}
