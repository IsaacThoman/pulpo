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
