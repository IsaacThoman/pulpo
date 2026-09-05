# Account deletion

Self-service deletion is enabled by default. Administrators can change **Authentication → Allow users to delete their accounts**. This instance-wide setting is enforced by the API, including when a client has stale settings.

Users choose **Settings → Security → Delete account** on web, or **Account → Delete account** on mobile. Pending accounts have the same control on their approval screen. Confirmation requires the current password and, when enabled, an authenticator or recovery code. The last unblocked administrator must appoint another administrator first. Pool owners with other members must transfer ownership first.

Acceptance is irreversible. Sessions, API keys, management tokens, shared links, and future Pool funding are revoked immediately. The maintenance worker cancels outstanding work and subscriptions, expires Stripe checkout links, removes account-owned files, and permanently deletes database records. Payments and unused credits are not refunded automatically. Existing contributions to other users' requests are allowed to settle before their funder references are removed; other users' requests and accounting totals remain intact.

Final cleanup waits at least 16 minutes for previously signed upload URLs to expire. Background cleanup can take longer when external services fail or existing requests are still settling. This is not a recovery period. Instance backups and payment-provider records retain their existing retention policies.

The admin Users screen shows deletion progress and the most recent cleanup error. `users.deletion_requested_at` is the durable work marker; `users.deletion_error` stores the latest pending condition or failure. The worker retries jobs and the regular 15-minute maintenance sweep resumes outstanding requests, including after queue outages or restarts. Audit events record acceptance and completion without copying profile details. Restoring an old instance backup can restore historical account data; the operator's backup restoration procedure must account for later deletions.

## Rollout and verification

Apply database migrations before starting the updated API and worker, then release the updated clients. Older clients remain compatible; updated clients treat missing account-deletion support as unavailable. Do not roll back the database guards while deletions are pending.

For the PostgreSQL integration suite, use an isolated database named `pulpo_account_test`, run the migrations, and set `PULPO_ACCOUNT_DELETION_TESTS=true` and `DATABASE_URL` explicitly before running `npm run test -w @pulpo/server -- src/account`. The integration tests truncate fixtures and must never target a service database. External storage, queue dispatch, and Stripe are mocked in those tests.

Clients fetch session-authenticated `GET /api/me/deletion` before showing credential fields. Its `twoFactorEnabled` value controls whether an authenticator or recovery code is shown and required; unavailable status blocks submission and offers retry. Pending sessions can use this endpoint; API keys and impersonation cannot. The server still verifies current requirements on deletion submission.
