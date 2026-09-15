# Stripe billing operations

Pulpo uses Stripe Checkout, Billing, Tax, and the Billing Portal. Stripe is a payment processor, not Pulpo's merchant of record. The account owner is responsible for confirming taxability, registrations, returns, and remittance with a qualified adviser.

## Stripe products and prices

Create these resources in both test mode and live mode. Set both products' Stripe product tax code to **Software as a service (SaaS) – personal use** (`txcd_10103000`) and set prices to **tax exclusive**.

1. **Pulpo Credits** — one product without a catalog price. Pulpo supplies the USD amount dynamically at Checkout. Save its `prod_…` ID as `STRIPE_CREDIT_PRODUCT_ID`.
2. **Pulpo Subscription** — one product with two recurring, tax-exclusive USD prices:
   - **$8.00 monthly** for Eight. Save its `price_…` ID as `STRIPE_EIGHT_PRICE_ID`.
   - **$24.00 monthly** for Fat. Save its `price_…` ID as `STRIPE_FAT_PRICE_ID`.

Do not reuse test resource IDs in live mode.

## Stripe Tax

1. Activate Stripe Tax and confirm the head-office address is the Georgia business address.
2. Confirm the default price behavior is tax exclusive.
3. Review both product tax codes above.
4. Add a tax registration in Stripe only after Pulpo is legally registered in that jurisdiction. Enabling automatic tax in the application does not register the business or file returns.
5. Review Stripe's threshold monitoring regularly. Obtain professional advice before activating Georgia or another state's registration; this repository intentionally contains no legal conclusion about Pulpo's taxability.

## Customer portal

Configure the Stripe Billing Portal to allow customers to update payment methods, view invoices, and cancel subscriptions at the end of the billing period. Disable portal plan switching; Pulpo owns Eight/Fat plan changes and their proration behavior.

## Plan changes

Monthly platform credits are granted in full when a subscription invoice is paid, so plan changes must not refund the current period:

- **Upgrade (Eight to Fat)** is immediate. Stripe invoices the prorated difference and the upgrade only completes once that invoice is paid. No additional credits are granted mid-cycle.
- **Downgrade (Fat to Eight)** switches the Stripe price with `proration_behavior: none`. Stripe issues no credit and the next renewal bills $8. Pulpo records the plan covered by the last paid invoice (`billing_subscriptions.paid_plan`) and keeps Fat benefits until the paid period ends. Switching back to Fat before renewal is free because the period was already paid at the Fat price.
- **Cancel** sets `cancel_at_period_end`; the paid plan stays in effect until the period ends.

The portal must not offer plan switching, because a portal downgrade would bypass this proration rule.

## Webhook endpoint

Create a webhook destination for:

```text
https://<PUBLIC_URL_HOST>/api/billing/webhooks/stripe
```

Subscribe it to:

- `checkout.session.completed`
- `checkout.session.async_payment_succeeded`
- `checkout.session.expired`
- `invoice.paid`
- `invoice.payment_failed`
- `customer.subscription.created`
- `customer.subscription.updated`
- `customer.subscription.deleted`
- `refund.created`
- `refund.updated`
- `charge.refunded`
- `charge.dispute.created`

Save the signing secret as `STRIPE_WEBHOOK_SECRET`. Use a separate destination and secret for test and live mode.

## Deployment

Before enabling billing, configure the API and worker with:

```env
PULPO_BILLING_ENABLED=true
STRIPE_SECRET_KEY=sk_test_... # use sk_live_... in production
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_CREDIT_PRODUCT_ID=prod_...
STRIPE_EIGHT_PRICE_ID=price_...
STRIPE_FAT_PRICE_ID=price_...
```

The API and worker fail closed when billing is enabled and any Stripe value is missing or malformed. Replace the previous billing-provider variables in Coolify before merging or deploying this change.

After deployment, complete a low-value test-mode credit purchase, subscription, renewal, plan change, cancellation, refund, and webhook replay. Confirm that credits are granted once, Stripe Tax reports the expected Georgia result, the admin dashboard links to the correct Stripe mode, and the hourly reconciliation job reports no error.

## Automatic balance top-ups

Automatic top-ups are opt-in under **Billing → Pay as you go → Configure top-ups**.
Defaults are a $5 personal available-balance threshold, $25 of credits, and a $100
monthly charge limit. The cap includes fees and tax, excludes manual purchases
and subscriptions, and resets on the first of each month at 00:00 UTC. Pending
payments reserve budget across month boundaries. Refunds do not restore budget.
A full top-up that cannot fit waits for a limit change or the next month.

Users authorize future card charges through Checkout setup mode, with a required
billing address. Setup callbacks are tied to the current settings revision;
stale or canceled setup cannot enable charging. Updating a paused account's card
does not resume charges: the user must authorize and save enabled settings again.

The dedicated `auto-top-up` queue checks affected funding accounts after usage and
reservation changes. Its one-minute sweep repairs missed submissions, unfinished
card setup, and payment attempts. It is enabled by `PULPO_BILLING_ENABLED` and uses
the existing Stripe credentials and credit product; no new environment variables
or webhook event subscriptions are required. Deploy migration `0079` before the
API and worker. Existing accounts stay disabled.

Every attempt creates an isolated invoice with `auto_advance: false`, automatic
tax, and no inherited discounts or pending invoice items. Pulpo reserves the
final payable amount before explicitly requesting off-session collection. Do not
manually enable automatic advancement or payment retries for these invoices.
Declines or authentication requests pause top-ups, and an unpaid invoice is
closed before its budget reservation is released. Account deletion closes unpaid
automatic invoices as well as checkout sessions and subscriptions.

Monitor worker events named `auto_top_up.failed` and the existing billing webhook
and reconciliation dashboards. Attempts in `auto_top_up_attempts` identify their
Stripe invoice and settings revision; invoice metadata contains
`pulpo_auto_top_up_attempt`. A timeout preserves the same attempt and its budget
reservation until Stripe's state is known. Never clear an unresolved reservation
or create a replacement charge based only on a timeout. Old attempts are reconciled by invoice ID or metadata before Stripe's idempotency
keys can be reused. Unpaid, unattempted invoices are closed before starting a new
attempt; ambiguous payment states remain reserved and fail closed for operator
review.

### Verification

Run the billing integration suite against a disposable, migrated PostgreSQL
database named `pulpo_billing_test`:

```sh
DATABASE_URL=postgres://.../pulpo_billing_test npm run db:migrate -w @pulpo/server
DATABASE_URL=postgres://.../pulpo_billing_test PULPO_BILLING_POSTGRES_TEST=1 npm run test -w @pulpo/server -- src/billing/auto-top-up.postgres.test.ts
```

In Stripe test mode, verify card setup and return, an off-session purchase,
tax-inclusive cap rejection, a declined/authentication-required card, explicit
resume, duplicate webhooks, and reconciliation after interrupting a worker.
Check that the invoice is paid once, one credit grant appears, and automatic
purchases are labeled in user history and counted in the admin top-up totals.
