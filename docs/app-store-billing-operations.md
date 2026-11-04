# App Store billing operations

The iOS app sells Eight and Fat as App Store auto-renewable subscriptions. Pulpo's server stays the source of truth: it verifies every signed transaction and notification against Apple Root CA - G3, stores App Store subscriptions and payments in the same billing tables as Stripe, and applies the same plans, usage tiers, and billing holds. Credits, top-ups, and payment history are never shown in the iOS app.

## App Store Connect

1. Join the App Store Small Business Program. Pulpo books App Store revenue after a 15% commission.
2. Create one subscription group with two monthly auto-renewable subscriptions, Eight and Fat, priced at $9.99 and $29.99 in the US. Rank Fat above Eight so moving between them is an upgrade or downgrade. Save their product IDs as `APP_STORE_EIGHT_PRODUCT_ID` and `APP_STORE_FAT_PRODUCT_ID`. Product IDs cannot be changed or reused after they are created.
3. Leave Family Sharing off for both products. Shared purchases never create payments.
4. Under **Users and Access → Integrations → In-App Purchase**, create a key. Save the downloaded `.p8` file's contents as `APP_STORE_PRIVATE_KEY`, its key ID as `APP_STORE_KEY_ID`, and the issuer ID as `APP_STORE_ISSUER_ID`. The key may be multi-line, use escaped `\n`, or have its line breaks flattened to spaces; the server refuses to start if it does not parse. The `.p8` can be downloaded only once.
5. Save the bundle ID (`com.isaacthoman.pulpo`) as `APP_STORE_BUNDLE_ID` and the app's Apple ID from **App Information** as `APP_STORE_APP_APPLE_ID`.

## Server notifications

In **App Information → App Store Server Notifications**, choose Version 2 and set:

| Field | URL |
| --- | --- |
| Production Server URL | `https://pulpo.baby/api/billing/webhooks/app-store` |
| Sandbox Server URL | `https://pulpo.baby/api/billing/webhooks/app-store` |

TestFlight, App Review, and the demo account all make sandbox purchases against pulpo.baby, so both URLs point there. Apple allows one sandbox URL per app. The server acknowledges and ignores notifications for subscriptions it does not track, and a sync job also re-reads sandbox subscriptions about to renew every five minutes.

## Environments

`APP_STORE_ENVIRONMENTS` lists the StoreKit environments a server accepts purchases from, and `/api/mobile/config` advertises it so the app offers purchases only when its own environment is listed:

| Server | `APP_STORE_ENVIRONMENTS` | Purchases offered to |
| --- | --- | --- |
| pulpo.baby | `production,sandbox` | App Store, TestFlight, and App Review builds |
| dev.pulpo.baby | not configured | Nobody: App Store billing is off |

Leave every `APP_STORE_*` setting unset on dev.pulpo.baby. If staging ever sells subscriptions, give it `APP_STORE_ENVIRONMENTS=sandbox` so it never accepts a real purchase that pulpo.baby would not know about, and point the sandbox URL at it.

## Sandbox purchases

Sandbox purchases cost nothing, so they grant a plan only for accounts an admin allows. Turn on **App Store sandbox purchases** for an account in **Admin → Billing → Users** for admins, testers, and the App Review demo account. Without it, the app's purchase is refused and no plan is granted; after an admin allows it, **Restore Purchases** grants the plan. Turning the setting off ends the account's sandbox subscriptions immediately. Sandbox payments are recorded at $0 and never count toward usage tiers or revenue.

## The iOS app

**Settings → Usage** offers Eight and Fat only when all of these hold:

- the app is on iOS and signed in to `https://pulpo.baby` or `https://dev.pulpo.baby`, never a self-hosted instance;
- `/api/mobile/config` lists `capabilities.appStoreBilling` with the product IDs, and its environments include the build's StoreKit environment (TestFlight and development builds are `sandbox`);
- the account has no plan, or its plan comes from an App Store subscription. An account billed through Stripe sees "Your subscription is managed outside the App Store", and a plan an admin set shows no purchases.

An account on Pulpo Baby sees a card for each plan in place of the Usage form. Each card shows the plan's name and price from App Store Connect, then the web Billing page's selling points, with the plan storage and Fat Pool share from **Admin → Billing** (sent in `/api/billing/limits`). App Store descriptions aren't shown. Subscribers keep the Usage form with a Subscription section for changing plans. Both show the renewal terms, links to the [hosted Terms of Service](./terms-hosted) and [Privacy Policy](./privacy-hosted), **Restore Purchases**, and, for App Store subscribers, **Manage Subscription**, which opens Apple's subscription sheet.

The app reports every transaction it sees to `POST /api/billing/app-store/transactions` and finishes it only once the server settles it, either by applying it or by refusing it for good (another account's subscription, sandbox purchases not allowed, an unknown product). If the server can't be reached, the transaction stays unfinished and the app reports it again on its next launch. The app also listens for renewals and purchases approved later (Ask to Buy) while it is open. **Restore Purchases** syncs with the App Store and reports the Apple Account's active Pulpo subscriptions.

Plan limit errors in the native apps never show balances or dollar amounts: the app rewords `insufficient_balance` and `daily_spend_limit_reached` as reaching the plan's or today's usage limit.

## How purchases map to plans

- The app gets a per-account token from `GET /api/billing/app-store/account-token` and attaches it to every purchase as `appAccountToken`. The first account to report a subscription keeps it; another account reporting the same subscription, or a purchase made with another account's token, is refused with `409 app_store_subscription_other_account`.
- The current product sets the plan in effect, and the auto-renew product sets the plan the next renewal bills. A downgrade keeps Fat until the period ends; an upgrade takes effect immediately.
- Billing grace periods keep the plan until the grace period ends. Billing retry, expiry, and refunds end it.
- Each transaction is a payment. US purchases record the price charged; other storefronts record the plan's US price, since usage tiers and revenue are in dollars. Apple's commission is recorded as the processing fee.
- A refund marks the payment refunded, places a `payment_refunded` billing hold referencing the transaction ID, and removes the plan, just like a Stripe refund. Clear the hold in **Admin → Billing** as for Stripe. A reversed refund marks the payment paid again but leaves any hold for an admin.
- Stripe checkout and plan changes are refused for an account with an active App Store subscription. If an account somehow holds both, the billing page manages the Stripe one.
- Deleting a Pulpo account does not cancel an App Store subscription; only the subscriber can, in their Apple account settings. The web and iOS apps warn about this before deletion.

## Reconciliation

The hourly billing reconciliation re-reads Apple's status for every live or recently ended App Store subscription, plus 35 days of its transaction history, so missed notifications, renewals, and refunds are applied. Failures appear with Stripe's on the admin billing dashboard.

## Deployment

Configure the API and worker:

```env
APP_STORE_BUNDLE_ID=com.isaacthoman.pulpo
APP_STORE_APP_APPLE_ID=...
APP_STORE_ISSUER_ID=...
APP_STORE_KEY_ID=...
APP_STORE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----"
APP_STORE_EIGHT_PRODUCT_ID=...
APP_STORE_FAT_PRODUCT_ID=...
APP_STORE_ENVIRONMENTS=production,sandbox
```

Coolify's environment editor keeps only the first line of a multi-line value, so paste the key on one line with spaces between its lines (`tr '\n' ' ' < AuthKey_XXXXXXXXXX.p8`). The server rebuilds the line breaks and names a key cut off after its first line in its startup error.

App Store billing turns on only when billing is enabled and every value is set; the server refuses to start with some but not all of them. After deploying, use **Admin → Billing → Send App Store test notification** (`POST /api/admin/billing/app-store/test-notification`) for each environment the server's notification URL covers, and confirm a processed `TEST` event appears in `billing_webhook_events`. Apple sends the test to the URL configured for that environment. The admin button tests the first listed environment (production on pulpo.baby); send `{"environment":"sandbox"}` to the endpoint to test the sandbox URL.
