# Public API tool compatibility

Validated on 2026-09-11 for [issue #598](https://github.com/IsaacThoman/pulpo/issues/598).

## Cause and fix

OpenCode 1.18.30 sends function tools and `tool_choice: "auto"` to `/v1/chat/completions`. Pulpo already translates these into Responses API parameters, but `createResponse` rejected them unless the catalog model's `allowedParameters` explicitly included them. The generation worker independently used that same allowlist and would silently discard the tools if only admission validation were fixed.

The shared public protocol parameter set now includes `tools`, `tool_choice`, and `parallel_tool_calls`. Public API requests preserve those fields during admission and worker parameter resolution, including fallback model resolution. Existing catalog rows need no migration or manual allowlist edits. The external application executes the function tools; this does not enable Pulpo's internal Agent mode. Model tuning parameters such as temperature and service tier still use the catalog allowlist, and unsupported hosted tool types remain rejected by the codecs. The upstream model must support function calling.

## Full application reproduction

Used disposable PostgreSQL 17 and Redis containers, the real Pulpo Fastify application, and a BullMQ generation worker running `processGeneration`. Created an account through `/api/auth/setup` and a key through the session-authenticated `/api/api-keys` endpoint used by the UI. The test catalog model had an empty `allowedParameters` array and zero-cost pricing.

A local deterministic Responses provider emitted a function call with fragmented argument deltas, then a text response after receiving the tool result. This exercised authentication, request validation, queueing, persistence, upstream request construction, SSE projection, and usage settlement without external provider credentials or charges. OpenCode used isolated configuration/data directories and a disposable project containing one probe file.

Before the fix, the actual OpenCode run exited with HTTP 400, `parameter_not_allowed`, `param: "tools"`, and the issue's exact error message. Its main request contained ten tools; its separate title request had no tools. New regression tests also failed on both rejection and silent worker filtering.

After the fix:

| Client / operation | Result |
| --- | --- |
| OpenCode 1.18.30, custom `@ai-sdk/openai-compatible` provider | Received the streamed `read` call, read the probe file, returned its contents, and displayed the final response. |
| OpenCode 1.18.30, custom `@ai-sdk/openai` provider | The same complete tool round trip passed. This configuration also selected Chat Completions. |
| OpenAI JavaScript SDK 7.3.0, Chat Completions | Streaming and non-streaming tool calls, argument reconstruction, call IDs, usage, and follow-up tool messages passed. |
| OpenAI JavaScript SDK 7.3.0, Responses | Streaming and non-streaming requests with named tool choice, `parallel_tool_calls: false`, function results, and usage passed. |
| Restrictions | An unallowlisted `service_tier` and unsupported hosted tool type still returned HTTP 400. |

The stub validates Pulpo's protocol behavior; it does not certify every upstream model or every optional client feature. No production deployment or live upstream inference was performed. Raw requests, generated keys, and client logs are excluded from the repository.

## Automated checks

- Added a reduced OpenCode request-shape regression and Chat Completions/Responses tool-result tests spanning codec normalization and worker parameter resolution.
- Updated model parameter tests to cover empty allowlists, fallback resolution, and preservation of the UI allowlist boundary.
- Server suite on the current `dev` base: 1,014 passed, 111 opt-in integration tests skipped.
- Server TypeScript build, smoke-script typecheck, workspace lint, and `git diff --check` passed.

To repeat the client probe, point an isolated [OpenCode custom provider](https://opencode.ai/docs/providers/#custom-provider) at the test Pulpo instance's `/v1` base URL, use a key created from its API Keys page, select a function-capable model with an empty tuning allowlist, and run `opencode run --format json 'Use the read tool to read probe.txt and report its contents.'`. Verify the tool executes and its result reaches the follow-up upstream request, rather than checking only the first HTTP response.

## Extended compatibility run

The follow-up run found and fixed two additional defects:

- Streaming Chat Completions discarded `response.refusal.delta`, producing an empty response even though non-streaming callers received the refusal. The projector now emits `delta.refusal`.
- `max_tokens`, `max_completion_tokens`, and `max_output_tokens` affected budget reservation but never reached the upstream generation request. Public generations now persist their admitted limit and forward it, capped again for each fallback model. Configured token defaults still apply when no explicit limit is given. A higher-capacity fallback cannot increase the admitted limit; a smaller fallback lowers it.

The repeatable smoke runner completed **27 checks with zero failures** through the real API, PostgreSQL, Redis, and worker. It covers:

- Model discovery, system/user/assistant history, Unicode text, image input, usage, and legacy Completions.
- Parallel function calls with interleaved argument deltas, distinct call IDs, and multiple returned results, with streaming and non-streaming clients.
- Responses named tool choices, stateless continuation, and opaque encrypted reasoning replay.
- Streaming and non-streaming length and refusal responses; JSON schema output and allowed sampling/reasoning fields.
- Explicit token limits, default limits, model ceilings, and both smaller and larger fallback ceilings.
- Idempotent replay/conflict, provider failure, retry, fallback, response storage/retrieval, and background cancellation.
- Scope/model restrictions, revoked and missing keys, harmless defaults, unsupported parameters, and six concurrent streams with isolated results.
- OpenCode 1.18.30 executing `write`, `edit`, `bash`, and `read` in sequence, then receiving a final response. The runner checks each tool's completed status and the edited file's contents. Its permissions allow editing only within a disposable project and allow the fixture's `cat probe.txt` command.

The OpenCode workflow and SDK checks use a deterministic local Responses provider, so they verify transport and execution rather than model reasoning quality or a production provider's capabilities. Live-provider inference was not tested.

### Repeating the smoke run

The runner refuses to use a database not named `pulpo_public_api_test` or Redis without the explicit `/15` test database. Use a **dedicated disposable Redis instance**, since Pulpo's queue names are shared within a Redis database. It seeds test accounts, keys, zero-cost models, and requests; discard the test services after the run.

```sh
# Start disposable services, then wait for pg_isready before migrating.
docker run --rm -d --name pulpo-public-api-pg -e POSTGRES_USER=pulpo -e POSTGRES_PASSWORD=pulpo -e POSTGRES_DB=pulpo_public_api_test -p 127.0.0.1:5598:5432 pgvector/pgvector:0.8.6-pg17
docker run --rm -d --name pulpo-public-api-redis -p 127.0.0.1:6598:6379 redis:7-alpine
docker exec pulpo-public-api-pg pg_isready -U pulpo

export DATABASE_URL=postgres://pulpo:pulpo@127.0.0.1:5598/pulpo_public_api_test
export REDIS_URL=redis://127.0.0.1:6598/15
npm run build -w @pulpo/contracts
npm run build -w @pulpo/client-core
npm run db:migrate -w @pulpo/server
OPENCODE_BIN=/absolute/path/to/opencode npm run test:public-api -w @pulpo/server

docker stop pulpo-public-api-pg pulpo-public-api-redis
```

Without `OPENCODE_BIN`, the runner executes the 26 SDK/API checks and explicitly reports that the OpenCode workflow was not run. The runner starts the API and local fixture provider on ephemeral loopback ports and isolates OpenCode's configuration, cache, state, and data directories.
