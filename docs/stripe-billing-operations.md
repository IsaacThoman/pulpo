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

## Automatic top-ups

Users can save a card and have Pulpo add credit when their available balance falls below a threshold they choose. A card is saved either through a card-only Checkout (`mode: setup`) or by ticking "Use this card for automatic top-ups" when buying credits (`setup_future_usage: off_session`). Both collect a billing address so tax can be calculated later.

- **Charge.** The worker creates a Stripe invoice for the credit product with `automatic_tax`, a price of credits plus the 5% + $0.50 platform fee, and `auto_advance: false`. It finalizes the invoice and pays it off-session with the saved card. The `invoice.paid` webhook and the worker both grant the credit; `billing_orders` keeps the grant to one. Orders use `billing_reason = auto_top_up`.
- **Triggers.** Reservations, settlements, and metered charges queue a per-user `auto-top-up` job when the balance falls below the threshold. A `auto-top-up-sweep` job runs every 15 minutes to catch missed checks and settle attempts a worker stopped part-way through.
- **Monthly limit.** Automatic charges before tax are totalled per UTC calendar month from `billing_auto_top_ups`. A top-up that would go over the user's limit is skipped until the next month. Manual purchases do not count.
- **Failures.** A declined card, or any request Stripe rejects, voids the invoice and turns automatic top-ups off with `payment_failed`. The billing page asks the user to review them. A card removed in the Billing Portal (`payment_method.detached`) turns them off with `payment_method_removed`. Account deletion detaches the saved card.
- **Holds.** Accounts on a billing hold are never charged automatically.

Keep the Billing Portal's payment method management enabled so users can remove the saved card.

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
- `payment_method.detached`

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

After deployment, complete a low-value test-mode credit purchase, subscription, renewal, plan change, cancellation, refund, automatic top-up (including a declined card such as `4000 0000 0000 0341`), and webhook replay. Confirm that credits are granted once, Stripe Tax reports the expected Georgia result, the admin dashboard links to the correct Stripe mode, and the hourly reconciliation job reports no error.
