import { detectAnomalies } from "@/lib/kpi";
import { logEvent, getWorkspaceId, insertRawRows, replaceAnomalies, upsertDataSource, upsertNormalizedMetrics } from "@/lib/store";
import { fetchAndNormalizeSheets } from "@/lib/sheets";
import { fail, ok, requireAuth } from "@/lib/http";

export async function POST(req: Request) {
  let sheetsUrl = "";
  try {
    const session = await requireAuth();
    if (!session) {
      return fail(401, {
        code: "UNAUTHORIZED",
        message: "認証が必要です。",
        retryable: false,
      });
    }
    const body = await req.json();
    sheetsUrl = body?.sheetsUrl ?? "";
    const workspaceId = await getWorkspaceId();

    const { rawRows, normalizedRows } = await fetchAndNormalizeSheets(body, workspaceId);

    await Promise.all([
      insertRawRows(workspaceId, rawRows),
      upsertNormalizedMetrics(normalizedRows),
      upsertDataSource(workspaceId, sheetsUrl, "success", null),
    ]);

    const anomalies = detectAnomalies(normalizedRows, "all", workspaceId);
    await replaceAnomalies(workspaceId, anomalies);

    await logEvent({
      event_type: "sheets_refresh_success",
      level: "info",
      payload: {
        importedRows: normalizedRows.length,
      },
    });

    return ok({ importedRows: normalizedRows.length, anomalies: anomalies.length });
  } catch (error) {
    const message = error instanceof Error ? error.message : "更新に失敗しました。";
    const workspaceId = await getWorkspaceId();

    if (sheetsUrl) {
      await upsertDataSource(workspaceId, sheetsUrl, "failed", message).catch(() => undefined);
    }
    await logEvent({
      event_type: "sheets_refresh_failed",
      level: "error",
      payload: { message },
    }).catch(() => undefined);

    return fail(400, {
      code: "SHEETS_REFRESH_FAILED",
      message,
      retryable: true,
    });
  }
}
