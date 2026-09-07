# Mobile signup and session regression checks

Local QA uses a dedicated `pulpo-signup-qa` Compose project and PostgreSQL,
Redis, worker, API and gateway built from this checkout. The gateway is
`http://localhost:8187`; Metro runs on 8188. No production accounts or services
are involved. Raw screenshots and build output stay outside the repository.

## Cause

`RealtimeProvider` used to open Socket.IO for any session with a token and user
ID, including pending accounts. The server intentionally rejects pending users
with `unauthorized`. Socket.IO sets `active` to false on middleware rejection,
so automatic reconnection stops. Refreshing approval updates the user role and
session status but preserves the token and ID, neither of which reran the
connection effect. The initial connection timer left the unavailable banner
visible. Open signup (`defaultSignupRole: user`) connects immediately.

The fix gates realtime on authenticated status and includes that status in the
connection effect dependencies. Session cleanup clears the old connection
error. A disposed sync attempt cannot set an error on a later session.

## Other reproduced client cases

- Failed instance discovery changed the API singleton to the unreachable
  server while the session store retained the original instance. Restore the
  original API configuration on failure.
- A delayed 401 from the previous token could invoke the new session's expiry
  handler. Only expire the session that issued the request.
- An in-flight approval refresh could restore authenticated UI after sign-out.
  Discard the result if the token or instance changed.
- Failed secure-storage deletion could prevent expired credentials from being
  cleared in memory. Clear memory synchronously and settle storage cleanup.

Each case has a regression test that failed before its fix.

## Real-server acceptance

`signup-realtime.mjs` checks pending signup, approval with the same token,
explicit reconnection and sync, open signup, wrong passwords without revoking
an existing valid session, case-insensitive login, logout token revocation,
duplicate email rejection, and disabled signup. It restores the server's
original auth settings in `finally`; generated accounts remain in the
**disposable** QA database. Do not run against an everyday local instance.

Create the initial administrator in the disposable stack through
`POST /api/mobile/auth/setup`, then run from the repository root with its native
bearer token in `PULPO_SIGNUP_QA_ADMIN_TOKEN`:

```sh
node apps/mobile/e2e/signup-realtime.mjs
```

Override the gateway using `PULPO_SIGNUP_QA_URL` (localhost only).

## Simulator results — September 7, 2026

Built this checkout's native Debug app and ran it in **Pulpo Signup QA**, an
isolated iPhone 17 Pro simulator on iOS 26.5. The baseline realtime provider was
left unchanged until the first on-screen reproduction.

| Check | Result |
| --- | --- |
| Baseline pending signup → admin approval → Refresh status | Chat opened with persistent “Realtime is temporarily unavailable. Retrying…” badge. |
| Fixed pending signup → Refresh status before approval | Correctly remained pending with “Still waiting for administrator approval.” |
| Fixed pending signup → admin approval → Refresh status | Chat opened without the unavailable badge, using the same native session. |
| Cross-client update after approval | A folder created by a second native API session appeared immediately in the open mobile drawer. |
| Sign out → failed switch to localhost:8199 → back | Error appeared; original localhost:8187 instance remained selected and usable. |
| Open signup, default role `user` | Went directly to chat without the unavailable badge. |
| Cross-client update after open signup | Folder count changed from 0 to 1 live; the expected new folder appeared. |
| Background → foreground | Authenticated chat resumed without the unavailable badge. |

Raw before/after captures were saved to `/tmp/pulpo-signup-before.png` and
`/tmp/pulpo-signup-after.png`. The empty stack has no model configured; real
realtime delivery was verified through folder mutations without external model
calls. Native passkey ceremonies and Android UI were not exercised in this run.

Final checks: **514 mobile tests passed across 80 files**, mobile TypeScript
check passed, changed JavaScript/TypeScript files passed oxlint with warnings
denied, and `git diff --check` passed. The server acceptance script passed all
its checks. New regression tests failed on the original implementation before
the corresponding fixes were applied.
