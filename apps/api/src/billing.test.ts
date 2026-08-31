import assert from "node:assert/strict";
import test from "node:test";

import {
  billingConfigurationIssues,
  findBillingPlanByPriceId,
  getBillingPrice,
  publicBillingPlans,
} from "./billing.js";

test("three-plan catalog fixes approved pricing and hides all six Price IDs", () => {
  withBillingCatalog(() => {
    const plans = publicBillingPlans();
    assert.deepEqual(plans.map((plan) => plan.id), ["minimum", "standard", "premium"]);
    assert.deepEqual(plans.map((plan) => plan.entitlements.maxUsers), [2, 2, 5]);
    assert.deepEqual(plans.map((plan) => plan.entitlements.maxAdAccounts), [1, 3, 10]);
    assert.deepEqual(plans.map((plan) => plan.entitlements.aiChat), [false, true, true]);
    assert.deepEqual(plans.map((plan) => plan.entitlements.googleAdsWrite), [false, true, true]);
    assert.ok(plans.every((plan) => plan.entitlements.reportIntervalDays === 3));
    assert.deepEqual(plans.map((plan) => plan.prices.month.amount), [9800, 49800, 69800]);
    assert.deepEqual(plans.map((plan) => plan.setupFee.amount), [50000, 70000, 70000]);
    assert.ok(plans.every((plan) => plan.prices.month.configured && plan.setupFee.configured));
    assert.equal(JSON.stringify(plans).includes("price_"), false);
    assert.equal(billingConfigurationIssues().length, 0);
  });
});

test("checkout catalog rejects unknown selection and resolves approved Price server-side", () => {
  withBillingCatalog(() => {
    assert.equal(getBillingPrice("unknown", "month"), null);
    assert.equal(getBillingPrice("standard", "week"), null);
    assert.equal(getBillingPrice("standard", "year"), null);
    assert.equal(getBillingPrice("standard", "month")?.price.stripePriceId, "price_standard_month");
    assert.equal(getBillingPrice("standard", "month")?.setupFee.stripePriceId, "price_standard_setup");
    assert.equal(findBillingPlanByPriceId("price_premium_month")?.plan.id, "premium");
    assert.equal(findBillingPlanByPriceId("price_unknown"), null);
  });
});

test("duplicate Prices and unapproved chat limits fail closed", () => {
  withBillingCatalog(() => {
    const catalog = approvedCatalog();
    catalog[1].chatCreditLimit = 0;
    catalog[2].setupFee.stripePriceId = catalog[0].prices.month.stripePriceId;
    process.env.BILLING_PLANS_JSON = JSON.stringify(catalog);
    const issues = billingConfigurationIssues();
    assert.ok(issues.some((issue) => issue.includes("standard.chatCreditLimit")));
    assert.ok(issues.some((issue) => issue.includes("configured more than once")));
  });
});

test("catalog shape rejects duplicate, missing, and unknown plans", () => {
  withBillingCatalog(() => {
    const catalog = approvedCatalog();
    catalog[2].id = "standard";
    process.env.BILLING_PLANS_JSON = JSON.stringify([...catalog, { ...catalog[0], id: "enterprise" }]);
    const issues = billingConfigurationIssues();
    assert.ok(issues.some((issue) => issue.includes("duplicate standard")));
    assert.ok(issues.some((issue) => issue.includes("missing premium")));
    assert.ok(issues.some((issue) => issue.includes("unknown plan id")));
    assert.ok(issues.some((issue) => issue.includes("exactly three")));
  });
});

test("production never falls back to a broad legacy Stripe key", async () => {
  const { stripeApiKey } = await import("./billing.js");
  const originalAppEnv = process.env.APP_ENV;
  const originalApiKey = process.env.STRIPE_API_KEY;
  const originalSecret = process.env.STRIPE_SECRET_KEY;
  process.env.APP_ENV = "production";
  delete process.env.STRIPE_API_KEY;
  process.env.STRIPE_SECRET_KEY = "sk_test_legacy";
  try {
    assert.equal(stripeApiKey(), "");
  } finally {
    if (originalAppEnv === undefined) delete process.env.APP_ENV; else process.env.APP_ENV = originalAppEnv;
    if (originalApiKey === undefined) delete process.env.STRIPE_API_KEY; else process.env.STRIPE_API_KEY = originalApiKey;
    if (originalSecret === undefined) delete process.env.STRIPE_SECRET_KEY; else process.env.STRIPE_SECRET_KEY = originalSecret;
  }
});

function approvedCatalog() {
  const pricing = {
    minimum: { monthly: 9800, setup: 50000 },
    standard: { monthly: 49800, setup: 70000 },
    premium: { monthly: 69800, setup: 70000 },
  } as const;
  return (["minimum", "standard", "premium"] as const).map((id, index) => ({
    id,
    estimatedConsultations: id === "minimum" ? 0 : 30 + index * 30,
    chatCreditLimit: id === "minimum" ? 0 : 100 + index * 100,
    setupFee: { stripePriceId: `price_${id}_setup`, amount: pricing[id].setup, currency: "jpy" },
    prices: {
      month: { stripePriceId: `price_${id}_month`, amount: pricing[id].monthly, currency: "jpy" },
    },
  }));
}

function withBillingCatalog(run: () => void) {
  const original = process.env.BILLING_PLANS_JSON;
  process.env.BILLING_PLANS_JSON = JSON.stringify(approvedCatalog());
  try {
    run();
  } finally {
    if (original === undefined) delete process.env.BILLING_PLANS_JSON;
    else process.env.BILLING_PLANS_JSON = original;
  }
}
