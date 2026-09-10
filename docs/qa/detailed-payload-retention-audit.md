# Detailed payload retention audit — September 10, 2026

The admin Logging section and management instance settings expose `1h`, `24h`,
`7d` (default), `30d`, `90d`, and `indefinite`. Capture defaults to off. Both
settings APIs validate the shared enum and reconcile saved payloads in the same
transaction as the settings update. Request creation takes the same advisory
lock, reads current settings, and records one collection timestamp for the row
and its deadline. Finite durations are elapsed hours/days, independent of DST.

## Findings and fixes

- Raw retention SQL interpolated JavaScript dates without an encoder. With the
  application's Drizzle/postgres-js driver, PostgreSQL tests reproduced a driver
  serialization error, rolling back logging changes. Dates are now ISO strings.
- Increasing retention or selecting indefinite could revive already-expired
  bodies before the cleanup sweep. Reconciliation first purges the old deadline,
  then adjusts surviving records and immediately purges newly expired records.
- Cleanup ran every 15 minutes in the single maintenance worker, behind backups,
  account deletion, and unrelated cleanup operations. Payload expiry now has its
  own queue and worker, starts on worker boot, runs every minute, retries errors,
  reports failures, and participates in worker readiness and shutdown.
- Existing cleanup rewrote expired rows forever. It now updates only rows with
  active capture or bodies, and clears both request/response and linked OCR bodies
  transactionally. Operational metadata remains available.
- OCR bodies in request details bypassed deadline checks. Reads now redact them
  at expiry even if physical cleanup is delayed. Generation writes use the
  database clock at execution, preventing a prepared write from using stale time.
- New backups copied expired bodies; restore could replace an expired deadline
  with a longer one. Backup snapshots now scrub expired bodies and restore keeps
  the earlier of an existing finite deadline and the configured limit.

## Verified behavior

Database tests execute the actual retention SQL against PostgreSQL using isolated
session-local temporary tables. Coverage includes all finite choices, transitions
from indefinite to finite, finite extensions and indefinite, disabling/re-enabling,
all six choices after expiration, the exact deadline, unexpired data, OCR cleanup,
metadata preservation, idempotent cleanup, and delayed generation writes. Route
tests cover expired, disabled, indefinite, and unexpired OCR reads. Backup tests
cover expired bodies and preservation of earlier deadlines.

Run database coverage with `PULPO_PAYLOAD_TEST_DATABASE_URL` set, then
`npm run test -w @pulpo/server -- src/logging/detailed-payload-retention.postgres.test.ts`.
CI runs this suite in its PostgreSQL job.

## Retention boundaries

Payload access and generation writes stop at the deadline. Physical removal from
live database columns occurs on the next successful one-minute sweep; outages,
lock contention, or an unavailable worker can delay it. Shortening retention and
turning capture off clear affected bodies before the settings transaction returns.
This is logical database deletion, not secure erasure of PostgreSQL pages or WAL.

Completed backup archives retain their own backup lifecycle, including immutable
offsite object locks. Changing payload retention does not rewrite those archives;
restore filters expired payloads. Operators needing a deadline across every copy
must also account for backup retention and previously downloaded copies. Chat
history, tool execution records, OCR cache text (its own TTL), and operational
metadata are separate from optional detailed request/response bodies.
