# Agent questions

Agent mode includes `request_user_input` for 1–3 questions with optional single-choice options. Both clients display one question at a time, support custom answers and direct composer replies, and require explicit final submission. Close and Skip all discard the unsubmitted set and resume with skipped answers. Stop cancels the response.

Ordinary message drafts and attachments stay separate. Question drafts persist locally for normal chats; temporary chats keep them in memory. Resolved questions remain in response history, including read-only shared views.

## Server lifecycle

- Migration `0079_agent_questions` adds durable question records, a `waiting_for_input` run state, and accumulated active duration/workspace cost.
- The agent checkpoints before the question's tool result. The worker exits while the response remains nonterminal, keeping queued messages behind it.
- `POST /api/responses/:id/questions/:questionSetId/answer` accepts `{action:"submit", answers:{questionId:{kind:"option",index:0}}}` or `{action:"skip_all"}`. Answers also support `{kind:"text",text:"…"}` and `{kind:"skipped"}`. The endpoint returns the response snapshot; a conflicting resolution returns HTTP 409 with the accepted snapshot.
- Resolved, unconsumed records act as the resume outbox. The worker retries dispatch every five seconds. Response locks serialize worker jobs, and recovery acknowledges tool results already present in a saved checkpoint.
- Waiting time is excluded from execution timeouts and active duration. Cancellation settles accrued usage without requiring a running model or workspace; interrupted accounting is retried durably.

## Automated checks

Focused tests cover shared answer state, validation, events, both question components, the real agent-loop boundary, and database concurrency/recovery. Existing composer, timeline, backup, localization and shared-chat tests also apply.

The PostgreSQL tests refuse to run outside a disposable database named `pulpo_questions_test`. Migrate that database before running:

```sh
PULPO_QUESTIONS_POSTGRES_TEST=1 \
DATABASE_URL=postgres://pulpo:pulpo@127.0.0.1:5549/pulpo_questions_test \
npm run test -w @pulpo/server -- src/agent/questions.postgres.test.ts
```

The runner integration additionally requires a disposable Redis on port 6399. It uses a local deterministic Responses provider and a workspace stub; no external model or workspace is called:

```sh
PULPO_QUESTION_RUNNER_TEST=1 \
DATABASE_URL=postgres://pulpo:pulpo@127.0.0.1:5549/pulpo_questions_test \
REDIS_URL=redis://127.0.0.1:6399 \
npm run test -w @pulpo/server -- src/agent/questions-runner.postgres.test.ts
```

On Node versions exposing experimental web storage, run browser unit tests with `NODE_OPTIONS=--no-experimental-webstorage` so jsdom supplies localStorage.

## Visual validation

Checked the actual web component at desktop and phone widths in light/dark themes, including navigation, custom answers and final submission. Checked the actual native component in an isolated iOS simulator shell with the keyboard visible, and corrected the card's available-height limit. Screenshots and temporary harnesses are excluded from the repository.

Android emulator visual testing and a complete native app walkthrough remain unverified. The shared React Native component tests and mobile typecheck cover the implemented mobile behavior.
