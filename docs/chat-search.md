# Chat search

`search_chats` searches eligible conversations owned by the current user, excluding the current chat, temporary chats, and deleted, purging, or expired chats. Memories must be enabled both globally and for the user. Historical content remains untrusted reference material.

Explicit search accepts plain text. It removes conversational filler and deduplicates up to 32 query terms. The text search gathers partial matches with OR, requires up to two matching terms in a passage, and ranks query coverage before repetition. Titles are searched separately and boosted, including when no embedding generation is available. Operators such as quotes, OR, and minus signs have no special search syntax in explicit queries.

The best passage from each conversation is selected before each retrieval source's candidate limit. Title, text, and semantic evidence are combined by chat. Explicit search defaults to the balanced moderate semantic threshold, independently of the automatic-recall preference; automatic recall retains its configured stricter evidence gates and conjunctive text query. These thresholds are heuristics, not confidence probabilities. Results are candidates for verification with `read_chat`.

## Indexing and availability

Visible user and assistant text is indexed in passages of up to 2,400 characters with 300 characters of overlap. Long-turn tails are retained. Short turns keep the user and assistant together. Hidden reasoning, tool output, and attachments are not indexed.

Text rows are searchable while embeddings are pending or failed. The tool's `search` field reports:

- `availability`: `available` or `disabled`.
- `index`: `ready`, `incomplete`, or `unavailable`. Incomplete covers builds, legacy formats, missing chats, and pending or failed passage embeddings. This is an index-health indication, not a guarantee of synchronization with every recent edit.
- `semantic`: `available` or `unavailable`. Semantic embedding requests have a 10-second timeout; eligible text and title matches remain usable on failure.

Migration `0062_chat_search_recall` adds a title GIN index, passage ordinals, and an index format version. On normal worker startup reconciliation, legacy generations are rebuilt in the background using format version 2. The previous active generation continues serving searches until successful cutover. Existing embedding models and input formatting are unchanged. The rebuild increases embedding work for long conversations.

## Regression tests

Unit tests run as part of the server suite. The PostgreSQL tests require a disposable database named `pulpo_search_test` and apply the real production migrations. They run in the `Chat search / PostgreSQL` CI job. For local use, point `DATABASE_URL` at that disposable database, then run:

```sh
npm run build -w @pulpo/contracts
npm run db:migrate -w @pulpo/server
npm run test:episodic-search -w @pulpo/server
```

The fixtures cover the performance-audit queries, title renames, missing generations, embedding outages, ownership and lifecycle exclusions, explicit versus automatic relevance gates, candidate diversity, long-answer tails, edits, index upgrades, and cancellation. Semantic scores use deterministic vectors to test filtering; this is not a live-model relevance benchmark. Broader threshold tuning should use labeled query-to-chat examples and measure top-five retrieval and irrelevant-result rates for each model.
