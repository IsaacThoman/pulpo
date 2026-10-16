# Independent R33 development source/protocol review

Decision: **corrections required before candidate freeze**. This is an early, static DEVELOPMENT review of the copied snapshot, not final candidate approval, blind authorship, runtime evidence, or release approval.

## Scope and exact inputs

Read only `/tmp/pulpo-r33-early-source/manifest.json`, its four copied source files, and the approved `contract-preflight-v3.md`, `schema-preflight-v3.json`, `public-api-v3.md`, and permitted `protocol-review-v3.md` under the specified R33 audit directory. Directory listings exposed names only; no other audit contents were read. No parent/live product source, blind material, runner, validator, test outcomes, builds, devices, delegation, or unrelated repository was read or executed. No source edits were made. This report is the only authored artifact. Schedules below are deductions from source, not observed executions. Concurrent fixes in the live checkout are outside this review.

SHA-256:

| Input | Hash |
| --- | --- |
| copied `manifest.json` | `6875cee0ef516b6f7d4c274e269f16d41c322f828a6b2bb6ed16ad03c033c1b9` |
| `Shared/LearnedDataPersistence.swift` | `a0cfa455626cbc4b6ae5dd0c2e300aa5dd04b3facaeefab8415408ebd4ab684a` |
| `Dictionary/PersonalDictionary.swift` | `4bbc182f27d30bd3e89592e45a811496b2a83154c2b03297bb3a3a5e09b24ad9` |
| `Geometry/TouchModel.swift` | `f7ec443dd88f22da9c355c5f109591d4132e53e6da8754f694ed4b4184686a1f` |
| `App/AppModel.swift` | `c9707901f8803489b0f01188932c298337fa80d785385cdd5c978d3c6b9d1bbd` |
| approved contract v3 | `a517f4b627b3575a99d0959240a0a6bd3a0dd2781c7d763c52214fe714799ccd` |
| approved schema v3 | `2b7a34f6c482a6ac0ffe7f23c2d9964c72b6f31c34eed3f0b7aa59f75e4cb6ef` |
| approved public map v3 | `85289af4b0993e78250b0d223d28aa4568ca0488036dd0356f1818c8c701997e` |
| protocol review v3 | `a8f3c441e903a097640998250ffa7a2e989efbece6ef7ebd3ab36685cf61f85e` |

All four copied source hashes match the manifest. Source line references below are to these copies; `Persistence` abbreviates `LearnedDataPersistence.swift`.

## Findings

### 1. P1 — valid oversized legacy dictionaries cannot migrate

**Source:** Persistence 66–72, 265–278, 291–308; PersonalDictionary 260–298.

`legacy()` uses the same strict decoder as a current authoritative payload. That decoder rejects more than 5,000 words or 20,000 pairs before any pruning. Nothing in migration invokes existing deterministic pruning. The approved baseline explicitly permits valid oversized legacy data when current pruning brings it within limits.

**Counterexample:** Start with no marker/database and a semantically valid, sub-8MiB version-1 dictionary with 5,001 short words, count 1 and finite timestamps; its touch sibling is valid or absent. Construct either canonical store. Migration returns invalid at line 71, before marker creation. Repeating constructor/reload/combined clear repeats that rejection. The user's existing valid learning cannot enter the new authority, and even the public reset cannot complete through this path.

**Minimal correction:** Separate bounded legacy validation from current payload count validation. Validate every legacy element and all numeric/string invariants first, apply the existing deterministic prune policy when oversized, then enforce current counts and encoded bytes before marker creation. Never prune malformed elements to make validation pass. Retain existing blocks. Verify both word and pair overflow fixtures, with a fresh-process durable read after migration.

### 2. P1 — unresolved rollback can permanently poison the cached connection

**Source:** Persistence 280–285, 322–336, 445–466, 474–488, 498–528.

The transaction helper explicitly recognizes the state “ROLLBACK attempted but SQLite transaction still active” and returns uncertain. It nevertheless leaves that same connection cached. The next transaction's `BEGIN IMMEDIATE` failure returns immediately, without retrying rollback or discarding/reopening the connection. This gives no route from a transient rollback failure to a fresh durable-status reconciliation while the coordinator survives.

**Source-based fault schedule:** A learn or save reaches an active transaction. COMMIT fails before completion; the rollback attempt also fails and `sqlite3_get_autocommit` remains zero, so the operation returns uncertain. Restore healthy storage/fault behavior. Every subsequent save/reload/admission obtains the same `sql` object and issues a nested `BEGIN IMMEDIATE`, which SQLite rejects. The early catch at line 323 does not roll back; subsequent boundaries repeat the failure. Pending/uncertain reservations and the lifetime slot remain retained until coordinator destruction. This schedule is conditional on the exact active-transaction state the implementation already handles; it is not a claim that the approved single COMMIT-error gate alone creates that state.

**Minimal correction:** Mark such a connection unusable for a new boundary. Under local/global exclusion, resolve or discard it and reopen/recover the same authority before fresh status reconciliation. Preserve local identities and ineligible reservations; do not replay payloads or infer rollback from an error code. Invalidate connection-derived validation/cache bookkeeping when reopening. Add a targeted surviving-caller fault case in development, separate from the approved gate vocabulary if necessary.

### 3. P2 — pair histories containing the internal separator do not round-trip

**Source:** Persistence 32–34, 79–92; PersonalDictionary 125–133, 175–179, 230–232, 286–294, 320–325.

Admission accepts an arbitrary short history string, but the durable pair key concatenates history, U+001F, and target. Reconstruction splits on the first separator. There is no escaping or separator rejection, and payload validation accepts the resulting alternative decomposition. The in-memory and fresh-reader language models therefore disagree after a successful save.

**Counterexample:** On a healthy dictionary, call `learn("c", after: "a\u{1F}b")`; admission and save can return true/ok. The live locally updated successor table records history `a<U+001F>b` → `c`. A fresh successful reader reconstructs the key as history `a` → target `b<U+001F>c`. `pairCount("a\u{1F}b", "c")` and `historyCount("a\u{1F}b")` become 0 instead of 1. The same separator-bearing history also makes target-based forget parse the wrong target. This needs no race or storage fault.

**Minimal correction:** Define a lossless pair-key representation or constrain separator-bearing inputs before registration, consistently with the public contract and legacy policy. The smallest implementation change is explicit rejection of unrepresentable histories/targets, but that narrows currently approved arbitrary-String acceptance and therefore needs the contract/API decision recorded. Do not silently teach a different pair. Cover round-trip, normalized-target forget, and leading-separator cases.

### 4. P2 — a missing initialization marker is ignored on a warm authority

**Source:** Persistence 233–237, 280–289.

`noSymlink()` allows ENOENT. `openDatabase()` calls it on the marker and then returns a cached connection before checking `hasDB == hasMarker`. The approved policy says a database without its marker is fail closed, and prohibits treating namespace loss as successful authority observation.

**Counterexample:** A successfully initialized actor retains its coordinator/connection. Remove only the `.initialized` marker. Its next reload/save/admission can report ok, because the database inode still matches and the cached branch returns. A fresh actor without that cached coordinator rejects exactly the same database/marker namespace as invalid. The warm actor can keep adding learning while a fresh process cannot observe or reset it.

**Minimal correction:** Require the marker to exist and have the expected regular-file shape on the cached path as well as the initial path. Return invalid/io without reconstructing the marker. Keep inode checks. This is one metadata check, not a request to reload large payloads at letter/query boundaries.

### 5. P2 — successful no-URL operations can retain a prior failure result

**Source:** PersonalDictionary 138–149, 185–197, 212–220, 243–257, 416–436; TouchModel 104–125, 153–174.

The public map requires successful local operations to expose ok. Several no-URL success paths return true without resetting `persistenceResult`.

**Counterexample:** `PersonalDictionary(url:nil).learn("", after:nil)` returns false/invalid. A later valid learn returns true and changes the model, but its result remains invalid. The same problem follows an invalid touch learn followed by a valid local touch learn or reset. Memory actors cannot satisfy the schema's acceptedtrue/completedtrue ⇒ ok mapping.

**Minimal correction:** Set `.ok` on each successful no-URL boundary, including save/reset/clear/forget; decide the observation result consistently for no-URL reload. Preserve existing local dirty semantics. No storage or API expansion is needed.

### 6. P1 snapshot closure item — unchecked count arithmetic still permits crash after admission

**Source:** PersonalDictionary 152–179, 116–133; Persistence 426–465, 490–511.

This is recorded as an existing snapshot gap, with the brief explicitly saying the root is already adding overflow guards; it is not presented as a novel competing fix. Current persisted validation permits a single word count of `Int.max`, but the next valid learn registers successfully and then traps at `entry.count += 1`. `totalCount`, pair counts, and history totals also use unchecked increments. Validating the encoded payload in `put` happens after `applying()` has already executed this arithmetic.

**Minimal correction/closure criterion:** Check projected arithmetic before local teaching/accepted admission and during merge against the latest durable base. Independent pending operations can overflow only when combined, so local preflight alone is insufficient. Failed save must preserve the same eligible token identities and must not wrap, drop tokens, or partially write either store. Inspect the frozen replacement source for this closure rather than treating the announced concurrent work as completed evidence.

## Protocol paths that appear sound in this snapshot

- Constructor/observation/reset do not acquire writer slots. A ninth process with eight occupied writer slots can reach the global transaction; reset revokes tokens without reclaiming lifetime locks. A new writer instead gets capacity. Slot acquisition is nonblocking and precedes global acquisition; stopped owners retain slots, and descriptor lifetime permits reclamation after death.
- Admission returns no model payload on non-ok; an uncertain false admission remains ineligible. Subsequent synchronization deletes/cancels it rather than promoting it. Successful COMMIT followed by a reported error attempts fresh durable-token confirmation while the global lock excludes intervening reset.
- Ordinary save reads current store payloads and token statuses under the transaction, changes payload and committed statuses together, then removes replayable local records before scheduling terminal deletion. A delayed acknowledgement therefore has an explicit at-most-once path. Reset/forget mark tokens revoked, and later ordinary merges do not blindly recreate missing rows.
- Combined reset writes both fresh epochs, both empty payloads, and token revocations in one SQLite transaction. Cleanup has a separate failure result after commit. Touch replay keeps one reference offset per word and preserves sample order, clamp, and decay. Model adoption rebuilds dictionary indexes and invalidates touch offset caches.
- Pending/acknowledgement collections are capped per coordinator/store, capacity attempts a synchronous nonblocking flush, and background work captures the coordinator rather than payload snapshots. SQLite/page/cache/encoded-byte settings are present. These are source observations, not measured resource/liveness or latency passes.

## Remaining boundaries

The registry-capacity path creates uncached ephemeral coordinators, so repeated same-authority lookups at that cap do not literally share one local mutex as correction A requires (Persistence 174–182). Such coordinators are admission-disabled and global flock still serializes their storage work; I have not derived a lost-update schedule from this alone. Keep this as a contract/concurrency check for the frozen review, rather than claiming it defeats the full-eight-slot reset path.

The warm connection checks only database inode identity and does not recheck the meta version/identity or exact schema (Persistence 280–285 versus 313–315). Registrar validation checks token-linked slot rows, not every standalone slot row. Frozen corruption coverage should distinguish unsupported schema/version, marker loss, and payload corruption from ordinary revision-based cache reuse; no runtime corruption coverage is inferred here. Legacy block validation also newly subjects every blocked string to pin/admission word limits (Persistence 84–85), while the contract preserves legacy preferences under the byte bound; resolve that compatibility decision alongside finding 1.

AppModel maps only confirmed combined-reset success to true and supplies the specified error text. The copied four files cannot prove the parent-owned Settings Bool/error binding, controller behavior, private-field gates outside TouchModel, unchanged letter path outside these models, native UI/suspension, file-protection behavior on a device, hot-journal recovery, measured resource highwater, or development/release gates. None is approved or marked passed by this review. Final candidate+runner/gates still need the separate independent frozen review before any blind reveal.
