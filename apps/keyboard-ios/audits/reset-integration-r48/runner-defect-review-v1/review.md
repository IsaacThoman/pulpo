# R48 post-reveal runner defect adjudication v1

**Confirmed harness defect; retain the failed once-only round.** The frozen runner's inventory containment check mistakes two names for the same directory for an escape. This explains all 193 unavailable operations and 175 unfired operations in each retained run. It is not a demonstrated TouchModel constructor failure. It does not establish that any unexecuted learning/persistence behavior would pass, and does not admit the round or permit an in-place repair/rerun.

## Binding and exact mechanism

Frozen `Runner.swift` SHA256 is `2718e44462cf19625484ef2b82b40771475ef5c546c2cf034523fc7de6730255`. `execution-freeze-v2.json` SHA256 is `b89f52ecce3cefd535fc799e6f44a16651eddcc9b6cbaa474bd33eb17217d7b8`, exactly the retained RUN-STARTED contents. Both ledger entries report one launched attempt, exit 0, empty stdout/stderr and matching retained raw hashes. Those facts establish transport, not behavioral pass.

Runner line65 resolves the temporary-directory URL before adding its unique base/instance components. That is insufficient to make later enumeration use the same path spelling. At line40 `dir.path + "/"` uses `/var/folders/...`, while the Foundation directory enumerator returns file URLs with `/private/var/folders/...`. The `hasPrefix` test is false although both paths refer to the same directory.

The Foundation-only diagnostic enumerated path metadata of the first retained persistent directory for each variant, without reading file contents or invoking a product API. For each, all three regular file URLs had the alternate spelling: original prefix matches 0/3; applying `resolvingSymlinksInPath().standardizedFileURL` symmetrically to root and child makes matches 3/3. In this runtime that symmetric operation returns the `/var` spelling for both. Independent read-only `stat` confirms matching device/inode for `/var/...` and `/private/var/...` for all 18 retained instance directories per variant. This is a real filesystem alias, not a lexical permission to accept an arbitrary outside path.

At lines91–93 the persistent model has already been constructed and stored in `sessions`. Lines125–126 assign its `.ok` status and state projection before evaluating `files(s.directory)`. The latter obtains metadata and reads the first bounded file at line38, then throws `invalid("inventory escape")` at line40. The throwing right-hand side leaves the row's default empty `files` array. Catch lines131–133 mark the row unavailable and permanently block that session. There is no rollback or product retry. The existing files remain preserved; the diagnostic found sqlite/lock/initialized filenames, without opening their contents.

Every subsequent operation in that session stops at line96 before its operation switch or invoked=true assignment. Thus the inventory diagnostic, not the workload's learn/save/reload/reopen implementation, prevents those later calls. Empty raw inventories are failed observations, not evidence of empty storage. `.ok` at construction is real retained status evidence, but does not by itself prove later durable equivalence or all constructor semantics.

## Exact operation scope (each variant)

| Operation | Unavailable | Unfired |
|---|---:|---:|
| construct | 18 | 0 |
| setLearning | 38 | 38 |
| learn | 38 | 38 |
| save | 38 | 38 |
| reload | 36 | 36 |
| reopen | 18 | 18 |
| observe | 7 | 7 |
| Total | 193 | 175 |

Each raw contains all 375 operation rows. Exactly 18 unavailable rows were invoked: the 18 persistent constructors, all status `ok`, all with a recorded state and empty raw inventory, all with the direct inventory-escape error. The other 175 unavailable rows were unfired in those same 18 sessions. Every unavailable error includes that root inventory failure; none is a separate unavailable geometry/normalization/local-session call. This count review is not a recomputation of the full 2,285-check oracle, which the parent accountant reviews separately. Preserve the original 962/2285 versus 968/2285 failed scores and all failures; do not turn the unavailable portion into passes, drop it from the denominator, or infer six validated useful gains from aggregate scores.

## Additional static findings and future seam

The catch path overwrites `s.blocked` with the newly wrapped `session unavailable` error on every blocked operation. Quoted escapes repeatedly expand; the longest retained error is 65,979 UTF8 bytes in each variant. This is a reporting defect, not a second product failure. A future version should preserve the original immutable blocked cause and identify downstream rows as dependency-unavailable with a bounded reference, retaining every row.

Inventory containment is checked only **after** `Data(contentsOf:)` at line38. Future code should canonicalize/standardize both root and enumerated child consistently and compare contained path components before opening the child, retaining independent symlink/regular-file and byte/count limits. Do not strip a `/private` prefix, special-case these fixture names, blindly trust the enumerator, or weaken containment. Symmetric canonicalization handles the observed alias; a proper component comparison also rejects sibling-prefix names. Any general filesystem race-hardening claim would need separate work; no hostile concurrency is admitted by this protocol.

No additional independently established product/protocol failure follows from this source review. Reload false/.ok is correctly not treated as a failed observation, intentional .invalid can retain state, persistent constructor status is recorded, and save/reopen failure guards remain explicit. These static checks do not replace unexecuted workload evidence or prove every oracle correct.

A minimal future preexecution countercheck is Foundation-only: create owned disposable directories/files under the actual runtime temporary directory, enumerate them through both supported alias spellings, validate canonical containment/relative names/content inventory, reject a genuine sibling and symlink, and verify bounded root-cause propagation. This can exercise the generic inventory seam without product APIs or revealing author expectations. The prior mechanical executor review used an invented empty Runner and therefore did not validate this authored filesystem helper. The alias defect escaped preexecution review; the now-revealed failed round remains immutable.

## Recommendation and execution limits

Record this as a failed benchmark execution with a confirmed runner infrastructure cause for the persistent-session unavailability. Keep original source/oracle/runner/raw/evaluation/freeze/once marker unchanged. Do not reuse the consumed execution authorization or rerun patched code as fresh evidence. Any later general helper correction is a new, explicitly exposed version/round with preexecution seam checks and independently approved protocol; it cannot repair this round's admission result after reveal. Existing independent source/ordinary/native gates keep their own scope; this result supplies no broad reset, compatibility, EN/ES/BI accuracy or native claim.

Only read-only raw/runner/protocol/freeze inspection, filesystem stat/URL enumeration and Foundation-only diagnostics occurred here. No model, learning, product binary, app, native/device, retained-store write, or product compilation/replay was performed. `inspect-retained.py` yields identical bytes normally and under `-O`. `commands.json` records the Foundation-only invocations; `path-diagnostic.swift` and their outputs are preserved. The runner copy is inactive `.swift.txt`. Manifest hashes bind the review packet, not unobserved product outcomes.
