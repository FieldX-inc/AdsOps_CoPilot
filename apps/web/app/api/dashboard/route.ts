import { detectAnomalies, summarizeKpi } from "@/lib/kpi";
import {
  buildComposition,
  buildSeverityCounts,
  buildTimeSeries,
  buildTopCampaigns,
  getAnomalies,
  getDataSource,
  getNormalizedMetrics,
  getWorkspaceId,
  replaceAnomalies,
} from "@/lib/store";
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
  const summary = summarizeKpi(rows);

  const calculatedAnomalies = detectAnomalies(rows, platform, workspaceId);
  await replaceAnomalies(workspaceId, calculatedAnomalies);

  const anomalies = await getAnomalies(workspaceId, range, platform);
  const topCampaigns = buildTopCampaigns(rows);
  const dataSource = await getDataSource(workspaceId);
  const series = buildTimeSeries(rows);
  const composition = buildComposition(rows);
  const severityCounts = buildSeverityCounts(anomalies);

  return ok({ summary, anomalies, topCampaigns, dataSource, series, composition, severityCounts });
}
