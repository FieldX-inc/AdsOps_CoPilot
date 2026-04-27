type Platform = "google" | "meta" | "yahoo";

export type MockCampaignProfile = {
  platform: Platform;
  adAccountId: string;
  campaignId: string;
  campaignName: string;
  base: {
    impressions: number;
    ctr: number;
    cpc: number;
    cvr: number;
    revenuePerConversion: number;
  };
  mediaPattern: "search" | "meta" | "yahoo";
  trend: "stable" | "worsening" | "improving" | "seasonal";
  priorityHint: "High" | "Medium" | "Low";
};

export type MockDailyMetricRow = {
  date: string;
  platform: Platform;
  adAccountId: string;
  campaignId: string;
  campaignName: string;
  impressions: number;
  clicks: number;
  cost: number;
  conversions: number;
  revenue: number;
};

export const generatedAt = "2026-04-26T08:30:00+09:00";
export const latestMetricDate = "2026-04-26";

export const campaignProfiles: MockCampaignProfile[] = [
  {
    platform: "google",
    adAccountId: "acct-google-001",
    campaignId: "cmp-google-brand",
    campaignName: "Google / 指名検索",
    base: { impressions: 2450, ctr: 0.069, cpc: 255, cvr: 0.066, revenuePerConversion: 18500 },
    mediaPattern: "search",
    trend: "stable",
    priorityHint: "Low",
  },
  {
    platform: "google",
    adAccountId: "acct-google-001",
    campaignId: "cmp-google-nonbrand",
    campaignName: "Google / 一般検索",
    base: { impressions: 6200, ctr: 0.031, cpc: 345, cvr: 0.036, revenuePerConversion: 23000 },
    mediaPattern: "search",
    trend: "worsening",
    priorityHint: "High",
  },
  {
    platform: "google",
    adAccountId: "acct-google-001",
    campaignId: "cmp-google-pmax",
    campaignName: "Google / P-MAX テスト",
    base: { impressions: 18200, ctr: 0.012, cpc: 178, cvr: 0.027, revenuePerConversion: 21000 },
    mediaPattern: "search",
    trend: "improving",
    priorityHint: "Medium",
  },
  {
    platform: "meta",
    adAccountId: "acct-meta-001",
    campaignId: "cmp-meta-prospecting",
    campaignName: "Meta / 新規獲得 Broad",
    base: { impressions: 36500, ctr: 0.0089, cpc: 205, cvr: 0.026, revenuePerConversion: 21500 },
    mediaPattern: "meta",
    trend: "worsening",
    priorityHint: "High",
  },
  {
    platform: "meta",
    adAccountId: "acct-meta-001",
    campaignId: "cmp-meta-retargeting",
    campaignName: "Meta / リターゲティング",
    base: { impressions: 11800, ctr: 0.0145, cpc: 188, cvr: 0.046, revenuePerConversion: 19800 },
    mediaPattern: "meta",
    trend: "seasonal",
    priorityHint: "Medium",
  },
  {
    platform: "meta",
    adAccountId: "acct-meta-001",
    campaignId: "cmp-meta-leadform",
    campaignName: "Meta / 資料請求フォーム",
    base: { impressions: 17200, ctr: 0.0102, cpc: 168, cvr: 0.031, revenuePerConversion: 17600 },
    mediaPattern: "meta",
    trend: "improving",
    priorityHint: "Low",
  },
  {
    platform: "yahoo",
    adAccountId: "acct-yahoo-001",
    campaignId: "cmp-yahoo-brand",
    campaignName: "Yahoo / 指名検索",
    base: { impressions: 1750, ctr: 0.057, cpc: 205, cvr: 0.058, revenuePerConversion: 17200 },
    mediaPattern: "yahoo",
    trend: "stable",
    priorityHint: "Low",
  },
  {
    platform: "yahoo",
    adAccountId: "acct-yahoo-001",
    campaignId: "cmp-yahoo-generic",
    campaignName: "Yahoo / 一般検索",
    base: { impressions: 4300, ctr: 0.024, cpc: 265, cvr: 0.033, revenuePerConversion: 20200 },
    mediaPattern: "yahoo",
    trend: "worsening",
    priorityHint: "Medium",
  },
  {
    platform: "yahoo",
    adAccountId: "acct-yahoo-001",
    campaignId: "cmp-yahoo-display-rtg",
    campaignName: "Yahoo / ディスプレイRTG",
    base: { impressions: 13600, ctr: 0.0074, cpc: 132, cvr: 0.039, revenuePerConversion: 18800 },
    mediaPattern: "yahoo",
    trend: "seasonal",
    priorityHint: "Medium",
  },
];

export const dailyMetrics: MockDailyMetricRow[] = buildDailyMetrics();

function buildDailyMetrics() {
  const dates = listDates("2026-02-16", latestMetricDate);
  return campaignProfiles.flatMap((campaign) =>
    dates.map((date, index) => buildDailyRow(campaign, date, index, dates.length)),
  );
}

function buildDailyRow(campaign: MockCampaignProfile, date: string, index: number, totalDays: number): MockDailyMetricRow {
  const { base } = campaign;
  const seasonality = dayOfWeekFactor(date, campaign.mediaPattern);
  const payday = paydayFactor(date, campaign.platform);
  const monthProgress = index / Math.max(totalDays - 1, 1);
  const trend = trendFactors(campaign, date, monthProgress);
  const pulse = 1 + 0.045 * Math.sin(index * 1.7 + campaign.campaignId.length);

  const impressions = Math.max(1, Math.round(base.impressions * seasonality.impressions * payday.impressions * trend.volume * pulse));
  const ctr = clampRate(base.ctr * seasonality.ctr * trend.ctr);
  const clicks = Math.max(0, Math.round(impressions * ctr));
  const cpc = Math.max(20, base.cpc * payday.cpc * trend.cpc * (1 + 0.035 * Math.cos(index * 0.9)));
  const cost = Math.max(0, Math.round(clicks * cpc));
  const cvr = clampRate(base.cvr * seasonality.cvr * trend.cvr);
  const conversions = Math.max(0, Math.round(clicks * cvr));
  const revenue = Math.round(conversions * base.revenuePerConversion * trend.revenue);

  return {
    date,
    platform: campaign.platform,
    adAccountId: campaign.adAccountId,
    campaignId: campaign.campaignId,
    campaignName: campaign.campaignName,
    impressions,
    clicks,
    cost,
    conversions,
    revenue,
  };
}

function trendFactors(campaign: MockCampaignProfile, date: string, progress: number) {
  const lateApril = date >= "2026-04-14";
  const finalWeek = date >= "2026-04-20";
  const anomalyDay = date === "2026-04-24" || date === "2026-04-25";

  if (campaign.trend === "worsening") {
    return {
      volume: lateApril ? 1.18 : 1 + progress * 0.08,
      ctr: lateApril ? 0.82 : 1 - progress * 0.05,
      cpc: lateApril ? 1.28 : 1 + progress * 0.12,
      cvr: anomalyDay ? 0.58 : lateApril ? 0.72 : 1 - progress * 0.1,
      revenue: lateApril ? 0.95 : 1,
    };
  }

  if (campaign.trend === "improving") {
    return {
      volume: finalWeek ? 1.11 : 0.96 + progress * 0.08,
      ctr: finalWeek ? 1.14 : 1 + progress * 0.04,
      cpc: finalWeek ? 0.88 : 1 - progress * 0.04,
      cvr: finalWeek ? 1.24 : 0.9 + progress * 0.16,
      revenue: finalWeek ? 1.04 : 1,
    };
  }

  if (campaign.trend === "seasonal") {
    const seasonalLift = date >= "2026-04-18" && date <= "2026-04-21" ? 1.22 : 1;
    return {
      volume: seasonalLift,
      ctr: seasonalLift * 1.04,
      cpc: seasonalLift > 1 ? 1.06 : 1,
      cvr: seasonalLift > 1 ? 1.18 : 1,
      revenue: seasonalLift > 1 ? 1.08 : 1,
    };
  }

  return {
    volume: 1 + progress * 0.03,
    ctr: 1,
    cpc: 1 + progress * 0.03,
    cvr: 1,
    revenue: 1,
  };
}

function dayOfWeekFactor(date: string, pattern: MockCampaignProfile["mediaPattern"]) {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  const weekend = day === 0 || day === 6;

  if (pattern === "meta") {
    return weekend
      ? { impressions: 1.18, ctr: 1.08, cvr: 0.92 }
      : { impressions: 0.96, ctr: 0.98, cvr: 1.03 };
  }

  if (pattern === "yahoo") {
    return weekend
      ? { impressions: 0.88, ctr: 0.96, cvr: 1.06 }
      : { impressions: 1.04, ctr: 1.02, cvr: 0.99 };
  }

  return weekend
    ? { impressions: 0.72, ctr: 0.95, cvr: 0.9 }
    : { impressions: 1.08, ctr: 1.02, cvr: 1.03 };
}

function paydayFactor(date: string, platform: Platform) {
  const day = Number(date.slice(8, 10));
  const aroundPayday = day >= 24 && day <= 27;
  if (!aroundPayday) return { impressions: 1, cpc: 1 };

  if (platform === "meta") return { impressions: 1.12, cpc: 1.08 };
  if (platform === "google") return { impressions: 1.06, cpc: 1.05 };
  return { impressions: 1.04, cpc: 1.03 };
}

function listDates(start: string, end: string) {
  const dates: string[] = [];
  const current = new Date(`${start}T00:00:00Z`);
  const last = new Date(`${end}T00:00:00Z`);

  while (current <= last) {
    dates.push(current.toISOString().slice(0, 10));
    current.setUTCDate(current.getUTCDate() + 1);
  }

  return dates;
}

function clampRate(value: number) {
  return Math.min(Math.max(value, 0), 0.85);
}
