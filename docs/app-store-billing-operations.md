# App Store billing operations

The iOS app sells Pulpo Eight and Le Pulpo Fat as auto-renewable App Store subscriptions. Apple is the merchant of record for these purchases: it charges the customer, collects and remits tax, handles refunds, and pays proceeds after its commission. Stripe still handles the web, credit purchases, and automatic top-ups ([Stripe billing operations](./stripe-billing-operations)).

App Store subscriptions grant the same `eight` and `fat` plans, with the same allowances and storage, as Stripe subscriptions. Only the price differs, to cover Apple's commission.

| Plan | Web (Stripe) | App Store (US) | App Store proceeds at 15% | App Store proceeds at 30% |
|---|---|---|---|---|
| Pulpo Eight | $8.00 | $9.99 | $8.49 | $6.99 |
| Le Pulpo Fat | $24.00 | $29.99 | $25.49 | $20.99 |

## Before selling

1. Accept the Paid Apps Agreement and complete tax and banking in App Store Connect.
2. Enroll in the [App Store Small Business Program](https://developer.apple.com/app-store/small-business-program/) so the commission is 15% instead of 30% while proceeds stay under $1 million a year. The prices above assume 15%; at 30% the margin is thin.
3. Have the [hosted service terms](./terms-hosted) and [privacy policy](./privacy-hosted) reviewed. Both describe App Store purchases.

## Products

In App Store Connect, create one subscription group, **Pulpo plans**, with two auto-renewable subscriptions:

| Reference name | Product ID (example) | Duration | Level | US price |
|---|---|---|---|---|
| Le Pulpo Fat monthly | `com.isaacthoman.pulpo.fat.monthly` | 1 month | 1 (highest) | $29.99 |
| Pulpo Eight monthly | `com.isaacthoman.pulpo.eight.monthly` | 1 month | 2 | $9.99 |

- Use the display names **Pulpo Eight** and **Le Pulpo Fat**, and describe the plan benefits in each localization.
- Keep both products in the same group. Apple then treats Eight to Fat as an upgrade (immediate, with a prorated refund of unused time) and Fat to Eight as a downgrade at the next renewal. Pulpo records which plan the latest payment covered, so a downgrade keeps Fat benefits until the period ends, as on the web.
- Leave **Family Sharing** off. Plans belong to one Pulpo account, and the server ignores Family Sharing transactions.
- Let App Store Connect generate prices for other storefronts from the US price, and review them.
- Credits are not sold in the app. See [Credits](#credits).

## Server notifications

In **App Store Connect → App Information → App Store Server Notifications**, set both the production and sandbox URLs to:

```text
https://<PUBLIC_URL_HOST>/api/billing/webhooks/app-store
```

Choose **Version 2**. Pulpo verifies each notification's signature against Apple Root CA - G3, checks the bundle ID and (in production) the app's Apple ID, and stores it in `billing_webhook_events` as `app_store:<notificationUUID>` so Apple's retries apply once. Failed notifications appear under **Failed webhooks** on the admin billing dashboard; Apple retries them for several days.

## Deployment

App Store billing requires Stripe billing. Configure the API and worker with:

```env
APP_STORE_BILLING_ENABLED=true
APP_STORE_BUNDLE_ID=com.isaacthoman.pulpo
APP_STORE_APP_APPLE_ID=<the app's Apple ID from App Store Connect>
APP_STORE_EIGHT_PRODUCT_ID=<Pulpo Eight product ID>
APP_STORE_FAT_PRODUCT_ID=<Le Pulpo Fat product ID>
APP_STORE_ACCEPT_SANDBOX=true
```

The server refuses to start when App Store billing is enabled without Stripe billing, the app's Apple ID, or two distinct product IDs. The API applies the `0093_app_store_subscriptions` migration on startup. Then release an iOS build: it shows **Settings → Subscription** only when the instance reports the `appStoreSubscriptions` capability.

### Sandbox purchases

App Review and TestFlight buy with sandbox accounts against the production server, so `APP_STORE_ACCEPT_SANDBOX` must stay `true` for review to pass. Sandbox subscriptions grant real plans on the server. Sandbox Apple Accounts can only be created in App Store Connect, but every TestFlight tester can subscribe for free, so don't hand out public TestFlight links while it is on. The admin dashboard marks sandbox subscriptions.

## How a purchase reaches the server

1. The app starts a StoreKit 2 purchase with the Pulpo user ID as the `appAccountToken`.
2. It sends Apple's signed transaction and renewal info to `POST /api/billing/app-store/transactions`, then finishes the transaction. If the request fails, StoreKit delivers the transaction again on the next launch.
3. App Store Server Notifications report renewals, plan changes, cancellations, billing problems, refunds, and expirations.

The server verifies every signature itself. It never trusts a plan, date, or price the app reports. A subscription belongs to one Pulpo account. A purchase made in the app carries its account ID and cannot be linked to another account. A subscription without one, such as an offer code redeemed in the App Store, belongs to the first account that restores it.

State is kept in `app_store_subscriptions` (one row per subscription) and `app_store_transactions` (one row per payment). Access lasts until the latest transaction expires, through a billing grace period if one is enabled in App Store Connect, and ends immediately on refund. A refund also places a billing hold, as Stripe refunds do. Clear it from the admin billing dashboard after review.

## Mixing web and App Store billing

- A web subscriber sees their plan in the app but cannot buy over it there. The app says the plan isn't billed through the App Store and offers no way to change it.
- An App Store subscriber sees **Billed through the App Store** on the web billing page, with a link to Apple's subscription settings. The server rejects web checkout and plan changes while the App Store plan is in effect, including after it is canceled and until its period ends.
- Account deletion cannot cancel an App Store subscription. The app warns a renewing subscriber before deletion and links to Apple's subscription settings.

## Credits

Credits and automatic top-ups are only sold on the web; the app doesn't show or link to them. App Review Guideline 3.1.3(b) lets the app honor balances bought on the web only if those items are "also available as in-app purchases". Offering credits in the app would need consumable products priced to cover Apple's commission (the 5.5% + $0.50 web fee doesn't). Decide this before submission, and be ready to explain it to App Review if asked.

## App Store compliance checklist

- **In-app purchase only (3.1.1).** The app never links to, mentions, or prices web checkout, Stripe, or credits. US storefront rules for external purchase links have changed since 2025. Recheck the current guidelines before adding any link.
- **Subscription disclosure (3.1.2).** The subscription screen shows each plan's name, length, StoreKit's localized price, and benefits before purchase, plus the auto-renewal terms and working links to the [Terms of Service](https://help.pulpo.baby/terms-hosted) and [Privacy Policy](https://help.pulpo.baby/privacy-hosted). The App Store description in `apps/mobile/store.config.json` links to both. If you use a custom EULA, set it in App Store Connect.
- **Restore Purchases** is on the subscription screen.
- **Manage and cancel.** App Store subscribers open Apple's subscription management sheet from the app.
- **Account deletion (5.1.1(v)).** The deletion screen tells App Store subscribers that Apple keeps billing until they cancel.
- **App privacy.** The privacy manifest and the App Store Connect privacy details include **Purchase History**, linked to the user, for app functionality.
- **App Review notes.** Provide a demo account and explain that subscriptions are under **Settings → Subscription**.

## Testing

Use a sandbox Apple Account on a device with a development or TestFlight build against a server with `APP_STORE_ACCEPT_SANDBOX=true`. Xcode's local StoreKit testing signs transactions with a local certificate, which the server rejects by design. Check:

1. Subscribing to Eight grants Eight on the web and in the app, and the transaction is finished.
2. Upgrading to Fat applies immediately. Switching back to Eight shows **Switches to Pulpo Eight** and keeps Fat until renewal.
3. Turning off auto-renew in **Manage Subscription** shows **Ends** and keeps the plan until expiry.
4. Restore Purchases on a second device links the subscription, and a different Pulpo account is refused.
5. A refund from the sandbox account settings revokes the plan and places a billing hold.
6. The web billing page shows **Billed through the App Store** and refuses checkout.
