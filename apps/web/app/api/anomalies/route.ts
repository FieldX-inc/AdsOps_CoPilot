import { getAnomalies, getWorkspaceId } from "@/lib/store";
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
  const anomalies = await getAnomalies(workspaceId, range, platform);

  return ok({ anomalies });
}
