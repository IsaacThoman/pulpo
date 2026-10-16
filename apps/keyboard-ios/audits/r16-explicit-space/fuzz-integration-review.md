# R16 prefreeze FuzzHost integration review, round 2

Decision: **integration implemented and reviewed; candidate freeze/reveal NOT approved.** The focused adapter/oracle tests pass. The short randomized gate fails, and its failures remain ordinary test failures with no allowances. Unresolved manual capitalization and broader alphabetic-only oracle scope objections are carried forward below.

Reviewed candidate checkout: `1b6fc8720b8b66106f85884f14e91d01bbc6f873` (`fix(keyboard): correct owned boundary words only on explicit space`). The candidate was being applied concurrently; this reviewer did not edit or retune it. This review owns only `EngineFuzz.swift`, `R16FuzzOracleIntegrationTests.swift`, and this report. No commits, sealed/heldout reads, dictionary/literal/helper/runner edits, devices, deployment, or push were performed. Other agents' report/development output changes in the shared checkout are outside this review's ownership.

## Physical evidence and action provenance

`FuzzHost` now captures full text, caret and selection immediately before and after each **physically applied** insertion/deletion. The before snapshot follows the reentrant callback and precedes the actual mutation; the after snapshot precedes history/report bookkeeping. These snapshots are separate from the existing requested-write `log`. Neither optimistic state nor reported context is substituted for actual host state. Swift Character coordinates and scalar-exact comparisons are delegated to the unchanged independent oracle.

`FuzzRun.execute` fixes the originating operation and independent action/casing label before calling the engine, collects that action's physical steps, then observes a complete trace. The retained `conservationOp`, `conservationTrace` and `conservationVerdict` identify the latest physical action for inspection. All verdict failures enter the normal violations list as `r16Conservation`, including stale/pending cases, without deduplication or exception allowances. No-write/skipped keyboard actions still revoke ownership conservatively. Swipe/fallback taps retain `.swipe` provenance rather than becoming explicit spaces or letter taps.

Actual paste/move/selection/replacement/delete/type-after/field events call `hostChanged`, even for identical text, before observing any callback-produced primitive trace as host sync. Proxy-only lag/hide/window/ack/deliver/reentrant configuration events preserve ownership only when physical state is unchanged and no write occurred; callback reports are observations only. A report cannot establish, extend or resurrect ownership. Unexpected physical writes/changes on such an event still go through trace validation. FuzzHost applies synchronously; no enqueue state or queued-host exception was introduced. The separately reviewed queued/sweep adapter was not changed.

## Independent casing proof and conservative limits

The new test-only `FuzzOracleShift` reads user Shift actions and timings, never `engine.shift`, insertion output, engine composition, correction flags, expected context, suggestions or ownership helpers. It models one-shot/manual Shift, the 0.35-second double-tap contract, explicit double taps, held Shift and character consumption. Default capitalization uses the existing independently authored `expectsCapital` calculation over the actual full before-caret text and stateless field/settings policy. Letter labels are determined before execution and require a physically matching single insertion; the oracle still validates every primitive even when the action is conservatively labeled `.other`.

Casing labels require truthful, complete context and no pending host/field delivery. Missing automatic context can recover from a later fresh, unambiguous contract calculation. Ambiguous manual transitions remain unknown until explicit double tap supplies new user evidence; observed capitals/lowercase never repair the model. Generic actions remain provenance barriers even when production retains ownership across them. Opening punctuation ambiguity, hidden/truncated/lagged/reentrant context, skipped actions and pending delivery cannot manufacture casing evidence. Intentional caps lock and held Shift have positive adapter coverage, as do automatic first-letter/word/all-character capitalization and manually suppressing initial automatic Shift.

**Unresolved objection:** the model cannot independently prove every manual capitalization history, especially a suggestion action following a manual one-shot Shift. It deliberately declines exceptions in those histories. It also declines a letter typed during one-operation proxy lag, even when later snapshots and output look plausible. This is a coverage limitation, not a finding that the conserved resulting text is necessarily corrupt. It must not be repaired by consulting production Shift/output or by granting a seed/word exemption.

## Exact justified guard diff and proof

Only the existing I4/I5 `partialWordReplacement@midWord` condition gains:

```swift
&& !(isSpace && conservationVerdict.permitsSpaceReplacement)
```

The existing outer `!isBackspace`, `!isWordDelete`, `net.removed > 0` scope remains. Every other legacy check remains unchanged: I3 suffix conservation, corrupt insertion, multi-token/letter deletion, partial-word-start, deletion before selection, private/literal policy, Undo, stale suggestions, capitalization and spacing. A script extracted the complete `check` body from HEAD and the edited file and verified byte-for-byte equality after removing only this conjunct. No new verdict can bypass the partial-start check. There is no generic terminator, swipe, field-wide or all-actions bypass.

The unchanged oracle grants permission only after independently verified alphabetic taps begin at document start/whitespace, preserve P and S, and accumulate all of W. Explicit space must physically delete exactly all W before inserting alphabetic C plus one ASCII space, with every intermediate prefix/suffix, caret and selection conserved. Transient deletion beyond the lower bound cannot be repaired into a pass. A synthetic full replacement at an owned boundary before inherited suffix passes the real adapter and suppresses only the midword complaint. Partial-start, inherited-midword, punctuation/return, wrong trigger, selection/host, dropped primitive evidence and transient corruption controls fail as required.

The original fuzzer's `isTerminator` excludes swipe and external text. That source contract is explicitly tested and unchanged. Such actions never receive oracle space permission; swipe partial-start protection remains active. The separate R16 sweep must continue providing the independent swipe-before-inherited-suffix blanket; this integration does not claim to add one.

## Final verification and retained failures

Commands use only `/tmp/pulpo-r16-fuzz-build` for scratch artifacts:

```text
swift test --package-path apps/keyboard-ios/PulpoKeyboardKit --scratch-path /tmp/pulpo-r16-fuzz-build --filter 'R16FuzzOracleIntegrationTests|R16ConservationOracleTests'
swift test --package-path apps/keyboard-ios/PulpoKeyboardKit --scratch-path /tmp/pulpo-r16-fuzz-build --filter shortRandomizedEditingSequences
```

First command: **exit 0, 43 tests passed** (16 adapter tests plus the 27 unchanged oracle tests; parameterized tests include additional cases). The adapter suite includes physical callback timing, selection and decomposed graphemes; real dispatch/action grouping; exact whole-word space permission; partial-start/inherited-midword/punctuation/return/swipe/external-text controls; identical host replacement and selection barriers; lag/nil report behavior; all-failures recording; lost evidence; transient prefix/suffix corruption; automatic/manual/held casing; ambiguous/skipped taps; and visible multiword rejection outside an inherited word.

Final short randomized gate: **exit 1**, seeds 1–12 at 150 operations each, with the existing deterministic replay checks. Retained failures:

- Seed **2**, op **111**: `partialWordReplacement@midWord`. The fresh word's third letter at op 102 occurred during one-operation lag, so independent casing ownership was revoked and could not restart inside the word. Explicit space physically replaced seven letters before an inherited letter suffix; no oracle permission was available.
- Seed **9**, op **87**: `partialWordReplacement@midWord`. Manual Shift followed by `tapStale` at op 35 left manual capitalization unresolved. Later output cannot independently repair that state. Explicit space replaced three letters before an inherited letter suffix without oracle permission.
- Seed **11**, op **119**: `partialWordReplacement@pending+midWord`. Host delivery/context remained pending; a Shift tap at op 111 also introduced unresolved manual casing. The three new letters lacked independently labeled ownership before the explicit-space replacement.
- Seed **7**, op **57**: `r16Conservation`: replacement is not a nonempty alphabetic word plus one space. The actual trace deletes seven owned letters then inserts a **two-word** replacement and separator at document end.
- Seed **10**, op **128**: the same `r16Conservation` failure. The actual trace deletes seven owned letters then inserts a **two-word** replacement and separator before an inherited whitespace-prefixed suffix.

**Scope objection:** unconditional per-action observation plus mandatory recording of all oracle failures exposes existing multiword corrections outside the new inherited-letter exception. These failures are real under the frozen oracle, but do not themselves establish prefix/suffix corruption. Relabeling an action after inspecting its output, skipping verdict failures, or weakening the alphabetic proof would conceal the mismatch and is not justified. Root must resolve this gate/scope issue before freeze/reveal. No oracle helper changes were made here.

The first integration draft reported four midword seeds (2, 5, 9, 11). Separating recoverable automatic-context uncertainty from unresolved manual uncertainty, without seed/literal conditions, supplied independent ownership for seed 5 and exposed the two multiword failures above. During test authoring, a `.hide` argument-label compilation error was fixed, and a purportedly ambiguous example after an actual swipe was replaced by the contract's genuinely ambiguous opening-punctuation setup. No corpus expectations, candidate source or lexical expected outputs were changed. A temporary diagnostic replay test was removed; it only inspected the already exposed short-fuzz development seeds and never changed pass/fail handling.

Raw outputs remain outside Git: `/tmp/pulpo-r16-fuzz-integration-final.txt`, `/tmp/pulpo-r16-fuzz-short-final.txt`, and `/tmp/pulpo-r16-fuzz-diagnostic-final.txt`. `git diff --check` passes for the owned changes. Full release/core/services validation and candidate source review remain root responsibilities. This is a completed integration review with an explicit failing prefreeze gate, not approval to reveal heldout data.

## Hashes at review completion

```text
EngineFuzz.swift
bd6443807eb70fc203b801e49cf0ceaaf67c5ed99a9bbabfb2c377f400131084
R16FuzzOracleIntegrationTests.swift
03bd0b37fd765db7438e33af74d8fab7303b3b1948596cd8e8d5fe9c30cd8a9a
R16ConservationOracle.swift (unchanged from prior review)
bdbc6eb60abfa0cd781f6d5f5dbb4d4e01bf525aeaed4f55b066adb76366188a
R16ConservationOracleTests.swift (unchanged from prior review)
4ebaf4b0deb26366bcbd2bca9ed2fa2a40b32e8d3f9c90ec4b888a49526f0de7
KeyboardEngine.swift (observed candidate; not edited by reviewer)
888da16d77069f316581eb9db11d2ea6e515d6d8907d36b75a7972a2869ff608
```

These are review observations, not a candidate freeze declaration. Root still owns all commits and the sealed-input/hash/freeze ordering.
