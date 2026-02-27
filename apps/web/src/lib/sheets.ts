import crypto from "crypto";

import { z } from "zod";

import type { NormalizedMetric, Platform } from "@/types/domain";

const platformSheetNames: Record<Platform, string> = {
  google: "GoogleAds",
  yahoo: "YahooAds",
  meta: "MetaAds",
  tiktok: "TikTokAds",
};

const dataSourceSchema = z.object({
  sheetsUrl: z.string().url(),
});

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let current = "";
  let row: string[] = [];
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === "," && !inQuotes) {
      row.push(current.trim());
      current = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") {
        i += 1;
      }
      row.push(current.trim());
      rows.push(row);
      row = [];
      current = "";
      continue;
    }

    current += char;
  }

  if (current || row.length > 0) {
    row.push(current.trim());
    rows.push(row);
  }

  return rows.filter((r) => r.some((c) => c.length > 0));
}

function parseNumber(value: string): number {
  const cleaned = value.replace(/,/g, "").trim();
  if (!cleaned) {
    return 0;
  }
  const num = Number(cleaned);
  if (!Number.isFinite(num)) {
    throw new Error(`数値変換に失敗: ${value}`);
  }
  return num;
}

function normalizeDate(raw: string): string {
  const value = raw.trim();
  if (!value) {
    throw new Error("日付が空です");
  }
  const replaced = value.replace(/[年月]/g, "-").replace(/日/g, "");
  const date = new Date(replaced);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`日付変換に失敗: ${raw}`);
  }
  return date.toISOString().slice(0, 10);
}

function extractSpreadsheetId(url: string): string {
  const match = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (!match) {
    throw new Error("Google Sheets URLからスプレッドシートIDを抽出できません");
  }
  return match[1];
}

function rowHash(platform: Platform, values: Record<string, string>): string {
  const payload = JSON.stringify({ platform, ...values });
  return crypto.createHash("sha256").update(payload).digest("hex");
}

type RawImportRow = {
  platform: Platform;
  rowHash: string;
  rowJson: Record<string, string>;
};

export async function fetchAndNormalizeSheets(
  sourceInput: unknown,
  workspaceId: string,
): Promise<{ rawRows: RawImportRow[]; normalizedRows: NormalizedMetric[] }> {
  const { sheetsUrl } = dataSourceSchema.parse(sourceInput);
  const spreadsheetId = extractSpreadsheetId(sheetsUrl);

  const requests = (Object.keys(platformSheetNames) as Platform[]).map(
    async (platform) => {
      const sheetName = platformSheetNames[platform];
      const csvUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/gviz/tq?tqx=out:csv&sheet=${sheetName}`;
      const res = await fetch(csvUrl, { cache: "no-store" });
      if (!res.ok) {
        throw new Error(`${sheetName} の取得に失敗しました (${res.status})`);
      }
      const csvText = await res.text();
      return { platform, sheetName, rows: parseCsv(csvText) };
    },
  );

  const fetched = await Promise.all(requests);
  const rawRows: RawImportRow[] = [];
  const normalizedRows: NormalizedMetric[] = [];

  for (const item of fetched) {
    const [headerRow, ...dataRows] = item.rows;
    if (!headerRow || headerRow.length === 0) {
      throw new Error(`${item.sheetName} のヘッダーが見つかりません`);
    }

    for (const dataRow of dataRows) {
      const rowObj: Record<string, string> = {};
      headerRow.forEach((h, idx) => {
        rowObj[h] = dataRow[idx] ?? "";
      });

      rawRows.push({
        platform: item.platform,
        rowHash: rowHash(item.platform, rowObj),
        rowJson: rowObj,
      });

      const normalized = mapRowToNormalized(item.platform, rowObj, workspaceId);
      normalizedRows.push(normalized);
    }
  }

  return { rawRows, normalizedRows };
}

function mapRowToNormalized(
  platform: Platform,
  row: Record<string, string>,
  workspaceId: string,
): NormalizedMetric {
  const mappings: Record<
    Platform,
    {
      date: string;
      campaign: string;
      adgroup: string;
      cost: string;
      impressions: string;
      clicks: string;
      conversions: string;
      revenue: string;
    }
  > = {
    google: {
      date: "Date",
      campaign: "Campaign",
      adgroup: "Ad group",
      cost: "Cost",
      impressions: "Impr.",
      clicks: "Clicks",
      conversions: "Conversions",
      revenue: "Conv. value",
    },
    yahoo: {
      date: "日付",
      campaign: "キャンペーン名",
      adgroup: "広告グループ名",
      cost: "ご利用金額",
      impressions: "インプレッション数",
      clicks: "クリック数",
      conversions: "コンバージョン数",
      revenue: "コンバージョン値",
    },
    meta: {
      date: "Reporting starts",
      campaign: "Campaign name",
      adgroup: "Ad set name",
      cost: "Amount spent",
      impressions: "Impressions",
      clicks: "Link clicks",
      conversions: "Purchases",
      revenue: "Purchase value",
    },
    tiktok: {
      date: "Date",
      campaign: "Campaign name",
      adgroup: "Ad group name",
      cost: "Spend",
      impressions: "Impressions",
      clicks: "Clicks",
      conversions: "Conversions",
      revenue: "Conversion value",
    },
  };

  const m = mappings[platform];
  const required = Object.values(m);
  for (const key of required) {
    if (!(key in row)) {
      throw new Error(`${platform} の必須列が不足: ${key}`);
    }
  }

  return {
    workspace_id: workspaceId,
    date: normalizeDate(row[m.date]),
    platform,
    campaign: row[m.campaign] || "(未設定)",
    adgroup: row[m.adgroup] || "(未設定)",
    cost: parseNumber(row[m.cost]),
    impressions: parseNumber(row[m.impressions]),
    clicks: parseNumber(row[m.clicks]),
    conversions: parseNumber(row[m.conversions]),
    revenue: parseNumber(row[m.revenue]),
  };
}
