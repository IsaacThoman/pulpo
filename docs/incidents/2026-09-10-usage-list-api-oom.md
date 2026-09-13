# Production API heap exhaustion, September 10, 2026

## Impact and cause

The production API repeatedly exhausted its approximately 4 GiB JavaScript heap
while parsing JSON. The first retained fatal error was at 23:48:51 UTC on
September 10 (19:48:51 Eastern). The container had reached 114 automatic
restarts when inspected during the investigation, and continued crashing.

`GET /api/admin/usage/requests` selected the entire `request_logs` row for every
joined `generation_attempts` row. Captured agent request bodies include multiple
turns and can be large. Joining each turn to its parent request duplicated that
body in the database result. Although the response mapper discarded those
bodies, the PostgreSQL driver first had to parse all of them in Node.

The latest 51 model-call rows referenced 5,172,515,904 bytes of stored request
payloads, counting repeated parent requests. This is a database storage-size
measurement, not a measurement of JSON wire size or JavaScript heap usage.
The largest recent individual captured request occupied 150,454,892 bytes.
Usage-list requests were repeatedly followed by fatal JSON-parser heap errors.
API restarts interrupted requests and connections across the application.

The workspace controller and workspace pods were healthy. The workspace node
had 176 GiB free, no disk-pressure outage, and the controller reported zero
active leases when checked. API readiness probes could pass between crashes,
so a single successful readiness request did not establish service health.

## Recovery and verification

At 00:35:06 UTC on September 11 (20:35:06 Eastern on September 10), the API was
restarted with a narrow emergency patch: the usage-list query now selects only
request id, response id, sticky-fallback state, and OCR status from the parent
request. Captured bodies and user data were preserved. The controller, worker,
database, and workspace storage did not require a restart.

The original compiled route and patched copy were saved on the production host
under `/var/backups/pulpo-incidents/2026-09-11/`. The emergency patch modified
the running API container; a replacement deployment must include the source fix
in this change, or it will restore the faulty query.

- Against the production database, the patched route returned 50 rows in 40 ms
  with 43 MiB heap usage and a 44,807-byte response.
- A 100-row request also succeeded, using 45 MiB heap. Both checks ran in a
  separate process with a 128 MiB heap limit.
- The production worker successfully acquired a canary workspace, executed a
  shell command, and released the lease using its normal authenticated HTTPS
  connection to the controller.
- The API remained healthy without further automatic restarts during the
  recovery observation window, using approximately 117–149 MiB container memory.

## Remaining hardening

Detailed agent payload capture has no aggregate size budget in the inspected
runner. A separate worker generation failed with `Invalid string length` at
23:40:59 UTC; the retained log does not include a stack trace, so its exact
source is not established by this investigation. Bound capture size and avoid
letting diagnostic persistence fail a generation in a follow-up change.
Audit other metadata queries that fetch full request logs and discard payloads
afterward. Alerting on repeated API restarts would detect this failure more
reliably than readiness alone.
