export type PlanId = "minimum" | "standard" | "premium";
export type BillingInterval = "month";

export type PlanEntitlements = {
  maxUsers: number;
  maxAdAccounts: number;
  aiSetup: true;
  reportIntervalDays: 3;
  aiChat: boolean;
  chatCreditLimit: number;
  googleAdsWrite: boolean;
  humanOnboarding: boolean;
};

export type BillingPrice = {
  stripePriceId: string | null;
  amount: number | null;
  currency: string;
};

export type BillingPlan = {
  id: PlanId;
  label: string;
  recommended: boolean;
  estimatedConsultations: number | null;
  prices: { month: BillingPrice };
  setupFee: BillingPrice;
  approvedPricing: {
    monthlyAmount: number;
    setupFeeAmount: number;
    currency: "jpy";
  };
  entitlements: PlanEntitlements;
};

type PlanEnvironmentConfig = {
  id?: unknown;
  estimatedConsultations?: unknown;
  chatCreditLimit?: unknown;
  setupFee?: { stripePriceId?: unknown; amount?: unknown; currency?: unknown };
  prices?: {
    month?: { stripePriceId?: unknown; amount?: unknown; currency?: unknown };
  };
};

const planOrder: PlanId[] = ["minimum", "standard", "premium"];

const fixedPlanDefinitions: Record<PlanId, Omit<BillingPlan, "prices" | "setupFee" | "estimatedConsultations">> = {
  minimum: {
    id: "minimum",
    label: "ミニマム",
    recommended: false,
    approvedPricing: {
      monthlyAmount: 9_800,
      setupFeeAmount: 50_000,
      currency: "jpy",
    },
    entitlements: {
      maxUsers: 2,
      maxAdAccounts: 1,
      aiSetup: true,
      reportIntervalDays: 3,
      aiChat: false,
      chatCreditLimit: 0,
      googleAdsWrite: false,
      humanOnboarding: false,
    },
  },
  standard: {
    id: "standard",
    label: "スタンダード",
    recommended: true,
    approvedPricing: {
      monthlyAmount: 49_800,
      setupFeeAmount: 70_000,
      currency: "jpy",
    },
    entitlements: {
      maxUsers: 2,
      maxAdAccounts: 3,
      aiSetup: true,
      reportIntervalDays: 3,
      aiChat: true,
      chatCreditLimit: 0,
      googleAdsWrite: true,
      humanOnboarding: false,
    },
  },
  premium: {
    id: "premium",
    label: "プレミアム",
    recommended: false,
    approvedPricing: {
      monthlyAmount: 69_800,
      setupFeeAmount: 70_000,
      currency: "jpy",
    },
    entitlements: {
      maxUsers: 5,
      maxAdAccounts: 10,
      aiSetup: true,
      reportIntervalDays: 3,
      aiChat: true,
      chatCreditLimit: 0,
      googleAdsWrite: true,
      humanOnboarding: true,
    },
  },
};

export function billingPlans(): BillingPlan[] {
  const configured = parsePlanEnvironmentConfig();
  return planOrder.map((id) => {
    const fixed = fixedPlanDefinitions[id];
    const item = configured.get(id);
    const chatCreditLimit = fixed.entitlements.aiChat ? positiveInteger(item?.chatCreditLimit) ?? 0 : 0;
    return {
      ...fixed,
      estimatedConsultations: fixed.entitlements.aiChat ? positiveInteger(item?.estimatedConsultations) : null,
      entitlements: { ...fixed.entitlements, chatCreditLimit },
      prices: {
        month: normalizePrice(item?.prices?.month),
      },
      setupFee: normalizePrice(item?.setupFee),
    };
  });
}

export function publicBillingPlans() {
  return billingPlans().map((plan) => ({
    id: plan.id,
    label: plan.label,
    recommended: plan.recommended,
    estimatedConsultations: plan.estimatedConsultations,
    prices: {
      month: publicPrice(plan.prices.month, plan.approvedPricing.monthlyAmount, plan.approvedPricing.currency),
    },
    setupFee: publicPrice(plan.setupFee, plan.approvedPricing.setupFeeAmount, plan.approvedPricing.currency),
    entitlements: plan.entitlements,
  }));
}

export function getBillingPlan(planId: string | null | undefined) {
  return billingPlans().find((plan) => plan.id === planId) ?? null;
}

export function getBillingPrice(planId: string | null | undefined, interval: string | null | undefined) {
  const plan = getBillingPlan(planId);
  if (!plan || interval !== "month") return null;
  const price = plan.prices.month;
  if (!price.stripePriceId || !plan.setupFee.stripePriceId) return null;
  return { plan, interval: "month", price, setupFee: plan.setupFee } as const;
}

export function findBillingPlanByPriceId(priceId: string | null | undefined) {
  if (!priceId) return null;
  for (const plan of billingPlans()) {
    if (plan.prices.month.stripePriceId === priceId) return { plan, interval: "month" as const };
  }
  return null;
}

export function billingConfigurationIssues() {
  const issues: string[] = [...billingCatalogShapeIssues()];
  const plans = billingPlans();
  const configuredPriceIds = new Set<string>();
  for (const plan of plans) {
    const pricedItems = [
      {
        key: "month",
        price: plan.prices.month,
        approvedAmount: plan.approvedPricing.monthlyAmount,
      },
      {
        key: "setupFee",
        price: plan.setupFee,
        approvedAmount: plan.approvedPricing.setupFeeAmount,
      },
    ] as const;
    for (const item of pricedItems) {
      const { key, price, approvedAmount } = item;
      if (!price.stripePriceId) issues.push(`${plan.id}.${key}.stripePriceId is required`);
      if (price.stripePriceId && !/^price_[A-Za-z0-9_]+$/.test(price.stripePriceId)) {
        issues.push(`${plan.id}.${key}.stripePriceId must be a Stripe Price ID`);
      }
      if (price.amount !== approvedAmount) {
        issues.push(`${plan.id}.${key}.amount must equal the approved JPY amount ${approvedAmount}`);
      }
      if (price.currency !== plan.approvedPricing.currency) {
        issues.push(`${plan.id}.${key}.currency must be ${plan.approvedPricing.currency}`);
      }
      if (price.stripePriceId) {
        if (configuredPriceIds.has(price.stripePriceId)) issues.push(`${price.stripePriceId} is configured more than once`);
        configuredPriceIds.add(price.stripePriceId);
      }
    }
    if (plan.entitlements.aiChat && plan.entitlements.chatCreditLimit <= 0) {
      issues.push(`${plan.id}.chatCreditLimit must be approved and positive`);
    }
    if (plan.entitlements.aiChat && !plan.estimatedConsultations) {
      issues.push(`${plan.id}.estimatedConsultations must be approved and positive`);
    }
  }
  return [...new Set(issues)];
}

export function isBillingCatalogConfigured() {
  return billingConfigurationIssues().length === 0;
}

export function stripeApiKey() {
  const restrictedKey = process.env.STRIPE_API_KEY?.trim() || "";
  if ((process.env.APP_ENV ?? "").trim().toLowerCase() === "production") return restrictedKey;
  return restrictedKey || process.env.STRIPE_SECRET_KEY?.trim() || "";
}

export function stripeApiVersion() {
  return process.env.STRIPE_API_VERSION?.trim() || "2026-05-27.dahlia";
}

function parsePlanEnvironmentConfig() {
  const result = new Map<PlanId, PlanEnvironmentConfig>();
  const raw = process.env.BILLING_PLANS_JSON?.trim();
  if (!raw) return result;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return result;
    for (const item of parsed) {
      if (!item || typeof item !== "object") continue;
      const candidate = item as PlanEnvironmentConfig;
      if (candidate.id === "minimum" || candidate.id === "standard" || candidate.id === "premium") {
        result.set(candidate.id, candidate);
      }
    }
  } catch {
    return result;
  }
  return result;
}

function billingCatalogShapeIssues() {
  const raw = process.env.BILLING_PLANS_JSON?.trim();
  if (!raw) return ["BILLING_PLANS_JSON must contain exactly minimum, standard, and premium"];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return ["BILLING_PLANS_JSON must be valid JSON"];
  }
  if (!Array.isArray(parsed)) return ["BILLING_PLANS_JSON must be an array"];
  const issues: string[] = [];
  if (parsed.length !== planOrder.length) issues.push("BILLING_PLANS_JSON must contain exactly three plans");
  const ids = parsed.map((item) => item && typeof item === "object" ? (item as PlanEnvironmentConfig).id : null);
  for (const id of planOrder) {
    const count = ids.filter((candidate) => candidate === id).length;
    if (count === 0) issues.push(`BILLING_PLANS_JSON is missing ${id}`);
    if (count > 1) issues.push(`BILLING_PLANS_JSON contains duplicate ${id}`);
  }
  for (const id of ids) {
    if (id !== "minimum" && id !== "standard" && id !== "premium") {
      issues.push(`BILLING_PLANS_JSON contains an unknown plan id`);
    }
  }
  return issues;
}

function normalizePrice(value?: { stripePriceId?: unknown; amount?: unknown; currency?: unknown }): BillingPrice {
  const candidate = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return {
    stripePriceId: stringValue(candidate.stripePriceId),
    amount: positiveInteger(candidate.amount),
    currency: stringValue(candidate.currency)?.toLowerCase() || "jpy",
  };
}

function publicPrice(price: BillingPrice, approvedAmount: number, approvedCurrency: string) {
  return {
    amount: approvedAmount,
    currency: approvedCurrency,
    configured: Boolean(
      price.stripePriceId
      && price.amount === approvedAmount
      && price.currency === approvedCurrency,
    ),
  };
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function positiveInteger(value: unknown) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}
