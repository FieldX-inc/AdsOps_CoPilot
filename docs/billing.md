# Billing and entitlement contract

Updated: 2026-07-24

## Catalog ownership

Fixed capabilities and the approved JPY amounts live in `apps/api/src/billing.ts`. Six Stripe Price IDs—three monthly recurring Prices and three one-time setup-fee Prices—plus Standard/Premium chat credits and consultation estimates live in `BILLING_PLANS_JSON`. Price IDs and AI limits remain approval-gated.

`BILLING_PLANS_JSON` is an array of three objects:

```json
[
  {
    "id": "minimum",
    "estimatedConsultations": 0,
    "chatCreditLimit": 0,
    "setupFee": { "stripePriceId": "price_...", "amount": 50000, "currency": "jpy" },
    "prices": {
      "month": { "stripePriceId": "price_...", "amount": 9800, "currency": "jpy" }
    }
  }
]
```

Repeat the object for `standard` and `premium`. Approved pricing is:

| Plan | Setup fee | Monthly |
|---|---:|---:|
| minimum | JPY 50,000 | JPY 9,800 |
| standard | JPY 70,000 | JPY 49,800 |
| premium | JPY 70,000 | JPY 69,800 |

The server rejects a catalog whose amounts differ from these values. Empty Price IDs and unapproved Standard/Premium AI limits make production readiness fail closed.

## API contract

- `GET /billing/plans`: public catalog without Stripe Price IDs
- `POST /billing/checkout-session`: `{ planId, interval: "month" }`
- `POST /billing/portal-session`
- `GET /billing/status`: plan, interval, subscription, entitlements, customer-safe usage summary
- `GET /usage/current`: percentage, consultation estimate, reset date only
- `POST /billing/webhook`: raw body signature verification and idempotent synchronization

Checkout uses Stripe subscription mode without a trial. Each Session contains the selected recurring monthly Price and the plan-specific one-time setup-fee Price. Stripe places the one-time item on the initial invoice only. The server places workspace/user/plan/monthly/setup-fee Price metadata on the Session. Existing Customers are reused.

## Fail-closed rules

- unknown plan, interval or Price: reject
- duplicated Price in config: readiness failure
- amount differing from the approved pricing, missing Price ID, credit or consultation estimate: readiness failure
- canceled, unpaid, incomplete-expired or unknown subscription: no product access
- Stripe customer already linked to another workspace: reject
- plan downgrade above limits: preserve rows, reject new additions

Production uses `STRIPE_API_KEY` with a Restricted API Key and `STRIPE_WEBHOOK_SECRET`. Legacy `STRIPE_SECRET_KEY` is accepted only for migration compatibility and must not be the production template.

## Approval flow

1. Run at least 10 representative reports and 30 representative chat turns.
2. Calculate p50/p95 usage and cost for small, standard and multi-account conditions.
3. The setup fees and monthly prices were explicitly approved on 2026-07-24.
4. Present chat-limit candidates, consultation estimates and gross-margin scenarios for separate approval.
5. Create three recurring monthly Prices and three one-time setup-fee Prices in Stripe test mode after external-change approval, then run Checkout/Portal/change/cancel/unpaid E2E.
6. Create the identical approved live-mode catalog only at the production gate.
