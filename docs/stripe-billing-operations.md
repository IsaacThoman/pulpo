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

Subscriptions include weekly and five-hour usage allowances and do not grant platform credits. A paid invoice covers that plan's allowances for the whole period, so plan changes must not refund the current period:

- **Upgrade (Eight to Fat)** is immediate. Stripe invoices the prorated difference and the upgrade only completes once that invoice is paid. Fat allowances apply as soon as it does.
- **Downgrade (Fat to Eight)** switches the Stripe price with `proration_behavior: none`. Stripe issues no credit and the next renewal bills $8. Pulpo records the plan covered by the last paid invoice (`billing_subscriptions.paid_plan`) and keeps Fat benefits until the paid period ends. Switching back to Fat before renewal is free because the period was already paid at the Fat price.
- **Cancel** sets `cancel_at_period_end`; the paid plan stays in effect until the period ends.

The portal must not offer plan switching, because a portal downgrade would bypass this proration rule.

## Shared usage

Fat subscribers share part of their weekly allowance with the other members of their Pool. It is not extra usage: a member's draw counts against the owner's weekly allowance, and the shared limit only caps how much of it members can take.

- **Shared limit.** `fatSharedWeeklyPercent` (default 50%) of the owner's weekly limit, after any per-user override. It resets with the weekly allowance. The owner can still use their whole weekly allowance themselves.
- **Member five-hour limit.** Each member draws within their own five-hour window, capped by `sharedFiveHourLimitMicros` (default $1.00), so one member cannot use up the shared limit in one sitting.
- **Funding order.** A request is paid from custom limit allowances (see below), then the member's own plan allowance, then shared usage, then their balance, then the Pool balance. With several Fat subscribers in a Pool, members draw from each in proportion to what they have left.
- **Records.** Reservations record each owner's share in `budget_reservation_allowance_funders`. Settlement adds it to the owner's `weekly_usage_periods` and `shared_allowance_periods` and to the member's `shared_five_hour_usage_periods`. `usage_events.shared_cost_micros` counts as covered by a subscription.

Owners see a **Shared usage** bar on the billing page. The Pool section on the Friends page shows shared usage across every Fat subscriber in the Pool, plus the viewer's own five-hour shared limit.

## Custom limits

Admins can give users extra allowances in **Admin → Billing → Custom limits**. Each limit has an amount, a period, the models it covers (or all models), and an audience: everyone, some subscription plans, or specific users. Admins are covered like anyone else.

- **Allowance.** Every covered user gets the full amount each period: a UTC day, a Monday-to-Monday UTC week, or a rolling five hours. It is spent on the limit's models before anything else. Once it runs out, requests continue on plan usage, shared usage, and credits as usual, so a limit never blocks a request.
- **Order.** When several allowances cover a request, model-specific ones are spent before those covering every model, then the soonest to reset. A fallback answer from a covered model can draw on its allowance. Metered charges such as speech are not model usage and never draw on allowances.
- **Sharing.** A limit's shared percentage (default 0%) lets the other members of a user's Pool draw that part of the user's allowance for the same models, after their own allowances. A member's draw counts against the owner's allowance.
- **Daily cap.** Allowances are included usage, so they neither count toward nor are limited by the usage tier cap.
- **Records.** Reservations record each allowance's share in `budget_reservation_custom_funders`. Settled draws are kept in `custom_limit_spend` (included in backups) so deleting a chat never returns spent allowance. `usage_events.custom_cost_micros` counts as covered by a subscription.

Users see one bar per allowance on the billing page. The chart button beside a limit shows each user's spending, what Pool members drew from them, and what is reserved in the current period.

## Usage tiers

Every account has a daily spend cap set by its usage tier. It limits how much one account can run up in a day, for example after a stolen card buys a large credit pack. It is not a balance check: the cap applies even when credit remains.

| Tier | Requirement | Daily cap |
| --- | --- | --- |
| 0 | New accounts | $3 |
| 1 | $5 paid (any first payment) | $10 |
| 2 | $50 paid and 7 days since first payment | $25 |
| 3 | $150 paid and 14 days | $75 |
| 4 | $500 paid and 30 days | $250 |

- **Payments.** "Paid" is the lifetime total of `billing_orders.net_amount_cents` (before tax, including the platform fee) minus refunds, across credit purchases, automatic top-ups, and subscription invoices. The waiting period counts from the first payment that was not fully refunded. A refund lowers the tier on the next request.
- **What counts.** The cap covers everything the account spends in a UTC day: plan allowance, shared usage, its own balance, and Pool balance. Custom limit allowances do not count. Settled generation and metered charges accumulate in `daily_usage_periods`, and pending reservations count until they settle.
- **Enforcement.** Reservations, resizes, and tool holds are limited to what remains, so a request near the cap gets a shorter output limit before it is refused with `402 daily_spend_limit_reached`. Optional calls such as titles skip instead of failing. Speech and dictation, charged after the provider call, are refused up front once the cap is used up.
- **Exceptions.** A cap never falls below the plan's weekly allowance. Admins are exempt. An admin can set a per-user daily limit in **Admin → Users**, which replaces the tier cap.
- **Configuration.** Edit the tiers in **Admin → Billing → Usage tiers** (`usageTiers` in the `billing` setting). Requirements cannot decrease from one tier to the next. Caps apply only when billing is enabled.

Users see their tier, today's spend, and what the next tier needs on the billing page.

## Automatic top-ups

Users can save a card and have Pulpo add credit when their available balance falls below a threshold they choose. A card is saved either through a card-only Checkout (`mode: setup`) or by ticking "Use this card for automatic top-ups" when buying credits (`setup_future_usage: off_session`). Both collect a billing address so tax can be calculated later.

- **Charge.** The worker creates a Stripe invoice for the credit product with `automatic_tax`, a price of credits plus the 5.5% + $0.50 platform fee, and `auto_advance: false`. It finalizes the invoice and pays it off-session with the saved card. The `invoice.paid` webhook and the worker both grant the credit; `billing_orders` keeps the grant to one. Orders use `billing_reason = auto_top_up`.
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
