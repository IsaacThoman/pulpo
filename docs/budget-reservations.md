# Generation budget reservations

Generation requires enough available credit for estimated input, the request fee,
and the model’s minimum output allocation (8,000 tokens by default). A smaller request or catalog output limit lowers that
minimum. This is an admission allowance, not a minimum response length or a
charge for tokens that were never generated.

The accounting transaction chooses the largest affordable output limit up to the
request/catalog ceiling, and reserves its entire estimated cost. Available funds
include the tighter of the weekly and five-hour subscription allowances, then
eligible account/pool balances. Other pending reservations and API-key monthly
and lifetime budgets constrain the same calculation. Account locks cover reading
availability and writing reservations, including resizes and settlement.

Before each provider call, the worker recalculates using the prepared input and
the current model's pricing. API, browser, and agent calls send the funded output
limit. Retries and fallbacks keep the original requested ceiling and retain known
costs from earlier calls. If fewer than the minimum tokens can be funded, the next
call does not start. A provider length cutoff remains an incomplete response.

While preparing a request, the worker reduces its initial hold to the minimum
allowance so preprocessing can reserve its own calls. Once generation finishes,
unused output capacity is released so agent tools and optional post-response
calls can reserve their costs. Actual usage is settled; unused funds become
available again. A long-running call can temporarily reserve all remaining funds
and prevent another request from starting.

## Per-model configuration

In **Admin → Models**, edit **Minimum output allocation** beside **Max output
tokens**. Managed Codex models expose it in their model settings. The admin
create/update API field is `minimumOutputReservationTokens`; it accepts whole
numbers from 1 to 2,147,483,647. Omitting it on an update preserves the saved value.
Existing models and newly created models default to 8,000.

Admission and each subsequent provider call use the active model’s setting,
including agent turns and fallbacks. A floor above the request or model output
ceiling is capped to that smaller ceiling. For example, a 12,000-token minimum
with a 2,000-token request limit requires funding for 2,000 output tokens.

## Accounting boundary

The reservation fully funds the transmitted output cap **at configured prices
and estimated input usage**. Input still uses the existing JSON-length estimate;
provider-reported prices, multimodal accounting, hidden provider overhead, and
unreported usage from a broken connection can differ. This does not promise an
exact ceiling on a provider invoice.

Because the reservation is an estimate, settlement never fails when actual
usage exceeds it. Under the same pool and account locks as a resize, settlement
grows the reservation toward the actual cost as far as the subscription
allowance, unreserved balances, and API-key limits permit, then charges that
amount. Any remainder the account cannot fund is absorbed by Pulpo: it is
recorded as `uncoveredCostMicros` in the usage ledger entry and logged as
`settlement.overrun_absorbed`. Balances never go negative and other pending
reservations are never drawn on.

Once an answer is completed, billing errors are logged
(`billing.settlement_failed`) instead of marking the answer failed. Optional
post-response work such as title generation is skipped when it cannot be
reserved, and its incurred cost is settled even if its output is rejected.

## Verification

- `npm run test -w @pulpo/server -- src/accounting src/billing/allocation.test.ts`
- With a migrated disposable `pulpo_budget_test` database, set `DATABASE_URL` and
  `PULPO_BUDGET_POSTGRES_TEST=1` to run the accounting PostgreSQL tests.
- `npm run test:public-api -w @pulpo/server` exercises actual request/queue/worker
  payloads against a local fixture provider, including browser and multi-turn
  agent limits, fallback pricing, billed retries, truncation, and settlement.
  It requires the disposable database and Redis settings documented in the script.

CI runs both the PostgreSQL accounting tests and the provider fixture checks.
