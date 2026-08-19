# Billing operations

Pulpo billing is disabled by default and fails closed. When disabled, the API does not register billing or admin-billing routes, the worker does not schedule reconciliation, and the web app hides every billing entry point. `PULPO_BILLING_ENABLED` is an operational gate; it does not grant rights beyond the repository license.

## Configuration

Apply database migrations while billing is still disabled. Then configure every value below on both the API and worker before enabling the feature:

```dotenv
PULPO_BILLING_ENABLED=false
POLAR_ENVIRONMENT=sandbox
POLAR_ACCESS_TOKEN=replace-with-a-sandbox-access-token
POLAR_WEBHOOK_SECRET=replace-with-the-webhook-signing-secret
POLAR_CREDIT_PRODUCT_ID=00000000-0000-4000-8000-000000000001
POLAR_EIGHT_PRODUCT_ID=00000000-0000-4000-8000-000000000002
POLAR_FAT_PRODUCT_ID=00000000-0000-4000-8000-000000000003
```

All six Polar values are required when billing is enabled. A missing or invalid value prevents startup. `POLAR_ENVIRONMENT` must be `sandbox` or `production`, and `PUBLIC_URL` must be the canonical HTTPS application origin so checkout and portal return URLs are correct.

Create three USD products in the matching Polar environment:

- A one-time credit product. Pulpo supplies a tax-exclusive ad-hoc price for each checkout.
- Pulpo Eight at $8 per month.
- Le Pulpo Fat at $24 per month.

Configure the webhook destination as:

```text
https://your-pulpo-origin.example/api/billing/webhooks/polar
```

Subscribe it to `order.paid`, `order.refunded`, `refund.created`, `refund.updated`, `checkout.updated`, `checkout.expired`, and the subscription created, updated, active, canceled, uncanceled, past-due, and revoked events. Webhook requests are verified against the raw request body before any state is changed. See Polar's [webhook event reference](https://polar.sh/docs/integrate/webhooks/events) for event descriptions.

## Accounting behavior

- Weekly periods run from Monday 00:00 UTC to the following Monday. Pulpo Eight defaults to $3 per week and Le Pulpo Fat to $4 per week.
- Pulpo Baby has no default weekly allowance, although an administrator may assign an individual override.
- New usage reserves weekly allowance first and accumulated account credit second. Pending reservations are included so concurrent work cannot overspend either source.
- A reservation stays attached to the UTC week in which it began. Settlement records both funding sources and deducts only the account-credit portion from the user balance.
- A paid initial or renewal order grants $2 for Pulpo Eight or $16 for Le Pulpo Fat exactly once. Proration and plan-update orders do not grant monthly credit.
- Top-ups grant the requested credit amount. The tax-exclusive checkout charge covers the configured 5% plus $0.50 transaction cost and is recalculated on the server.
- A successful refund or dispute-related reversal places the user on billing hold. The hold blocks new billable usage until an administrator reconciles the balance and clears it with an audit note.

The end-user API returns the account balance and a clamped whole weekly percentage, but never exposes the weekly USD allowance or spend. Exact values are restricted to admin APIs and the Admin Billing and Users pages.

## Reconciliation and recovery

The worker reconciles Polar subscriptions and paid/refunded orders hourly. Admin → Billing exposes the last successful run, the most recent error, failed webhook count, and a **Sync now** action. Reconciliation feeds the same idempotent event handlers as signed webhooks, so replays do not duplicate grants.

Polar remains the system of record for payment and subscription state. Use its [customer portal](https://polar.sh/docs/features/customer-portal/introduction) for payment methods, invoices, cancellation, and plan changes, and its dashboard for [refunds](https://polar.sh/docs/features/refunds). Pulpo remains the system of record for account credit and weekly usage allocations.

If a webhook fails:

1. Inspect the failed event and reconciliation error in Admin → Billing and the server logs.
2. Correct configuration or data problems without manually marking the event processed.
3. Run **Sync now**. The worker retries the event through the normal handler.
4. For a refund or dispute, reconcile the user balance in Admin → Users before clearing the billing hold with a note.

## Rollout checklist

1. Deploy and run migrations with `PULPO_BILLING_ENABLED=false`.
2. Create sandbox products and a sandbox webhook, then configure all sandbox environment values on the API and worker.
3. Enable billing in sandbox and exercise credit top-ups, initial subscriptions, renewals, customer-portal plan changes, cancellation, failed-payment recovery, refunds, and billing-hold clearance.
4. Confirm hourly and manual reconciliation complete successfully and that duplicate webhook delivery does not duplicate credits.
5. Create the corresponding production products and webhook. Replace every sandbox ID, token, and signing secret with its production value and set `POLAR_ENVIRONMENT=production`.
6. Restart the API and worker with billing enabled, verify `/api/auth/settings` reports `billingEnabled: true`, and perform a small production checkout before announcing availability.

To disable billing operationally, set `PULPO_BILLING_ENABLED=false` on both services and restart them. Existing balances and billing records remain intact while all billing interfaces and integrations become unavailable.
