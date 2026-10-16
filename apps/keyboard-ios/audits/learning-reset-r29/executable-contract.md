# R29 executable public-operation contract v1

Immutable runner input is a UTF-8 JSON array. Each case has exactly `id` (unique nonempty string), `description` (nonempty string), `actions` (1–200 objects). Each object has `op`, `instance` (nonempty actor name), and only the fields listed below. An actor is one retained public `PersonalDictionary`; `new` may not reuse an actor name. All persistent actors in a case share one fresh temporary URL; different cases never share storage. `new` with `memory:true` passes `url:nil`, isolating that actor entirely from disk and other actors. Default is persistent.

Allowed action objects (optional fields shown with ?):
- `new`: `memory?:Bool`.
- `learn`: `word:String`, `after?:String|null`, `pinned?:Bool=false` → `learn(word, after: after, pinned: pinned)`.
- `pin`, `forget`: `word:String` → public corresponding method.
- `transient`: `words:[String]` → `setTransientWords(words)`.
- `save`, `background`, `clear`: no additional fields → `save()`, `saveInBackground()`, `clear()` respectively.
- `reload`: `expected?:Bool` → `reloadIfChangedOnDisk()`; optionally check its return.
- `check`: `field`, `expected`, plus query arguments below. Every case needs ≥1 check (or checked reload).

Check fields (exact types):
- `count` + `word` → `count(of:)`, expected nonnegative Int.
- `known` + `word` → `isKnown`, expected Bool.
- `blocked` + `word` → `isBlocked`, expected Bool.
- `pair` + `after:String` + `word` → `pairCount`, expected nonnegative Int.
- `history` + `after:String` → `historyCount`, expected nonnegative Int.
- `total` → `totalCount`, expected nonnegative Int.
- `dirty` → `hasUnsavedChanges`, expected Bool.
- `knownWords` → sorted public `knownWords`, expected sorted [String].
- `files` → sorted immediate entries in this case's temporary directory, expected sorted [String]. A no-URL-only case should have no files. Persistent filename is `PersonalDictionary.json`.

All actions execute sequentially on the calling thread; file writes retain the real public background queue. Subsequent construction/load, reload, save preparation and dirty checks drain earlier same-process queued writes as in the real API. This adapter has no synthetic notification API. Do not invent one. `background` then another actor's `clear` in this harness does NOT cover cross-process overlap or suspension. Its serial order covers already queued writes in one process only. Cross-process queued writes have a separate deterministic syscall-gated reproduction, unavailable to this JSON interface. There are no clocks, sleep, hidden state reads, caret edits, ranking, language-mode inputs, or keyboard/controller operations in this adapter. Unsupported desired coverage must be reported as unavailable, never turned into a new feature precondition.

Public spelling capability map and existing behavior:
- Words are stored by exact spelling; counts and known tests are exact case/accent spelling. A word is known after two learns or pin/learn(pinned:true). Existing-word pin does not increment count.
- Lookup/forget/block keys lowercase, remove diacritics and apostrophes; forgetting a key removes all learned spellings with that key and all pair targets with that key. Deliberate learning unblocks that key. `forget` may block even a lexicon spelling absent from personal words.
- Pair history lowercases the previous word; target spelling remains exact. `total` sums word counts, not pairs. `clear` empties learned words, pairs and blocks and saves synchronously, but transient contact/replacement words remain known and are never persisted.
- `reload` currently replaces local learned state if the file stamp differs. Own queued writes update that stamp, so a later own-save-only reload returns false. The normative requirement is that ordinary external learning/reload must preserve unsaved local learning; a stamp replacement alone is not proof of clear.
- Failed disk writes are retried by a subsequent save; the JSON adapter does not expose filesystem fault injection. No-URL saves do not persist; `dirty` is not required to become false for a no-URL actor.

Normative desired semantics to author against (not claims of baseline correctness): completed explicit clear prevents stale retained snapshots and already queued pre-clear writes from restoring pre-clear learned words/pairs/blocks. New explicit learning after clear remains learnable, including the same spelling. Ordinary external saves/reloads preserve unsaved local and external new learning, and external explicit forgetting survives a stale writer's save unless there is a genuinely later explicit learn/pin of that key. Sequential operations have their explicit action order; active writers must distinguish reset from ordinary external learning. Same-process own delayed saves do not masquerade as external resets. English, Spanish and mixed spelling can be used for wording diversity; this core API has no language selector, so these are not three language stacks.

Authorship: independently create 12–20 small unique schedules covering reset/retention, ordinary external changes, forget/pin/case/accents, save/reload, own queued writes, transient/no-URL. Include independent wording and schedule order. No production source, development tests, previous benches, or result inputs. Avoid correlated timing variants and do not pretend this interface tests controller lifecycle, failure injection, real language stacks or cross-process suspension. Run the provided STATIC validator before sealing. Do not execute schedules against production. Keep invalid/unavailable author attempts in a separate count/report. Seal original bytes/hash without implementer reading payload; reveal only after the production source freeze and independent review are recorded. No post-reveal source tuning.
