# R16 independent conservation oracle review

Status: tests ready; integration design proposed, awaiting parent acknowledgement. No commit made by this reviewer. Review baseline: frozen development `ccff89487cbebfeb5c17f0e7816e36697096f1cd`. No production candidate was inspected or changed. The sealed directory and heldout data were not accessed.

Reviewer-owned files are `Tests/KeyboardCoreTests/R16ConservationOracle.swift`, `Tests/KeyboardCoreTests/R16ConservationOracleTests.swift` (relative to PulpoKeyboardKit), and this report. No existing fuzz, production, dictionary, literal-helper, protocol, or fixture edits were made by this reviewer. Other agents' concurrent harness/audit files remain their responsibility.

## Independent evidence and scope

Read `AGENTS.md`, the R16 protocol, `EngineFuzz.swift`, its regression/randomized/harness tests, `Support.swift`, package configuration, the earlier R12 runner, and the existing engine character/space/return/external-text paths. Also inspected the R16 `ExplicitSpaceSweepTests.swift` adapter as it appeared in the shared workspace. Neither lexical outcomes nor development corpus expectations were used to design the oracle. The synthetic oracle tests use abstract alphabetic tokens and no lexicon or engine.

The helper imports Foundation only. It consumes an independently labeled input action, actual full host snapshots, and snapshots immediately before/after each applied primitive. It never consumes engine composition, automatic-correction flags, expected context, suggestions, production ownership state, tokenizer helpers, or dictionary results. Snapshots include full text, caret, and selection length. Coordinates are Swift Character counts; text conservation compares Unicode scalars exactly, including decomposed accents. Ordinary Swift String equality would miss canonical-normalization changes to inherited text.

This is a conservation/provenance oracle, not a lexical accuracy or policy oracle. Existing literal, privacy, field, correction-quality and default-capitalization expectations still apply independently. An exception denied by the helper means the existing blanket guard must remain active; it does not mean every generic action is intrinsically invalid.

## Ownership and primitive proof

A letter action carries its key and independently authored casing. Casing must come from the fixture/user shift and capitalization contract, never the engine or observed insertion. A single physically applied insert must equal that expected alphabetic output. Selection must be absent. Ownership starts only at document start or immediately after whitespace. Subsequent verified letter taps extend it only when the entire actual state equals `P+W+S` with caret immediately after W and no selection. The exact unchanged P and S are retained independently. A replaced selection cannot establish ownership, even after that selection has disappeared. Inherited letters, numbers, apostrophes, path punctuation, and opening punctuation cannot establish the whitespace/start boundary.

For an explicit-space replacement, the trace must start at the independently owned state. Every primitive is replayed using independent insert/delete/selection semantics and checked against its supplied actual snapshots. Every intermediate snapshot must preserve P and S exactly, retain zero selection, and keep the caret at or above the lower bound. The action must delete **exactly all of W**, before any insertion, then insert a nonempty alphabetic C and exactly one ASCII space. The exact final state is `P+C+" "+S`, caret `|P+C+" "|`, selection zero. Split inserts for C and its separator are accepted. Partial word replacements, insertion/deletion interleaving, and transient prefix deletion are denied even when the final document is repaired.

Requiring complete W deletion is intentional: it preserves the existing stricter partial-word-start guard. This reviewer does not recommend weakening that guard to accommodate a production implementation that deletes only a common-prefix tail.

The successful correction creates a separate immediate-Undo proof. Backspace must delete exactly C plus its separator, restore W, preserve every primitive boundary, and finish at `P+W+S` with caret directly before S. A retained separator, excess deletion, or host destination change fails this proof. This extra proof does not authorize bypassing existing fuzz Undo guards. Undo does not reestablish fresh letter-tap ownership.

All unmodeled actions conservatively revoke ownership. Punctuation, return, swipe, external insertText, and host sync never receive a space-replacement exception. A real host mutation, selection or move calls `hostChanged`, even when it recreates an old own snapshot or leaves identical text. A before-state discontinuity also fails closed if an adapter forgot that call.

## Reports and queued hosts

`proxyReported` is deliberately observational and has no clock. Nil context, intermediate own reports, reports older than two seconds, and reports delivered reentrantly between primitives cannot acquire, extend, replace, or resurrect ownership. They also cannot revoke valid ownership merely because a physically unchanged host reports an earlier own state. An actual host revert to that same old state is a host change, not a report, and must revoke ownership. An age or own-snapshot grace window is not independent evidence of current host truth.

Queued commands must retain their original action labels and grouping. Enqueueing and optimistic logical/report states cannot advance the oracle. At physical flush, reconstruct action boundaries from the actual primitive sequence and deliver completed `Trace` values in issuance order. Do not use the same pre-flush physical before-state for every action. No-write actions still need their labels processed so selection/host/nonletter provenance barriers are retained. Flush before external moves/selections/replacements and final scoring. Final conservation verdicts must enter the case's pass/fail result.

The observed sweep adapter now retains per-action traces, replays all queued commands against physical host state, and asserts scalar-exact before/after agreement with every requested primitive before observing the traces. That satisfies the physical-replay requirement provided those assertions remain mandatory. A final logical-shadow equality assertion alone is insufficient. The adapter must distinguish a real host-authored sync/replacement from delivery of an own report; ordinary `documentDidChange` delivery is not by itself a host edit.

For `FuzzHost`, its existing `[insert/delete]` log alone cannot provide this evidence. Add separate snapshots immediately around actual application of each primitive, retain originating `FuzzOp`, and observe one complete action. Derive casing independently, using the existing contract capitalization calculation and a separate user-shift model where unambiguous. If casing is ambiguous or an action is skipped, classify conservatively and grant no exception. Do not derive expected casing from `engine.shift` or inserted text. Lag, reentrant callbacks, hidden context and pending traits are not permission to skip primitive validation.

## Exact existing fuzz gating recommendation

The relevant existing blanket is `EngineFuzz.swift` I4/I5, currently around lines 906–908: terminator deletes letters while `preAfter.first` is a letter or number, recording `partialWordReplacement@midWord`.

After parent acknowledgement and actual-snapshot integration, only this condition may gain the following additional conjunct:

```swift
&& !(isSpace && conservationVerdict.permitsSpaceReplacement)
```

Here `conservationVerdict` must come from the independently tracked actual action trace, and every `failures` entry must also be reported as a violation. No production flag, composing length, insertion suffix, net removal count alone, or post-output inferred word may substitute for that verdict.

Keep the original outer `!isBackspace`, `!isWordDelete`, `net.removed > 0` scope and all its other checks. Preserve I3 after-text conservation, I4 multi-token/letter-tap deletion, partial-word-start detection, deletion before selection, corrupt insertion, private/literal policy, Undo and stale-suggestion guards. No exemption for punctuation, return, swipe, insertText or host-origin actions. No field-wide, `isTerminator`-wide, or all-actions bypass.

The old fuzz `isTerminator` excludes swipe. This recommendation does not claim that existing fuzz alone prohibits every swipe-triggered correction. The R16 sweep must retain its independent blanket on swipe as well as space/punctuation/return/external text before inherited letter/number suffixes. Its current adapter does so. A swipe must never be relabeled as explicit space, including when it internally calls a commit routine or queued commands flush during another action.

No edits to existing `EngineFuzz.swift` were made by this reviewer. This is the pre-candidate recommendation to coordinate, not permission for post-reveal gate changes.

## Verification and limitations

Focused command:

```text
swift test --package-path apps/keyboard-ios/PulpoKeyboardKit --scratch-path /tmp/pulpo-r16-oracle-build --filter R16ConservationOracleTests
```

Final result: **exit 0, 27 tests passed**, no oracle known-issue allowances. Parameterized tests cover both atomic/split replacement inserts, invalid separator/replacement outputs, and inherited non-whitespace origins. Added controls cover corrected length changes, inherited letter/number suffixes, Unicode graphemes, independently authored capitalization, canonical-normalization damage, corrupt prefix deletion with final repair, transient suffix damage, wrong final suffix/caret/selection, partial-word deletion, wrong trigger, swipe without explicit space, inherited midword, selection origin/commit, actual host sync/move/replacement, unreported actual changes, old/nil/earlier own reports, reentrant earlier reports between primitives, queued ownership acquisition and corruption, skipped taps, exact Undo, and wrong Undo separator/destination.

The first focused run passed 25 tests. After adding two queued/reentrant controls, a concurrent sweep-adapter update briefly failed compilation because it still passed the removed `actual:` argument to `proxyReported`. The harness owner corrected that call; the final run above passed all 27 tests. No expectations were changed in response to any test execution.

This proves the helper against synthetic host edits. It does not establish candidate correctness, exact EN/ES/bilingual correction accuracy, actual timing behavior of a production candidate, or the required full core/services release suite with the five preexisting known issues. Those remain parent integration/evaluation work. The helper trusts adapter provenance and full host snapshots; fabricating or mislabeling them invalidates the evidence. It conservatively declines ownership for multi-primitive letter actions, ambiguous casing, and grapheme resegmentation that changes an inherited boundary. No device, push, deployment, or sealed/heldout access occurred. Raw test output stays outside Git at `/tmp/pulpo-r16-oracle-test-output.txt`.

Pre-integration SHA-256:

```text
R16ConservationOracle.swift
bdbc6eb60abfa0cd781f6d5f5dbb4d4e01bf525aeaed4f55b066adb76366188a
R16ConservationOracleTests.swift
4ebaf4b0deb26366bcbd2bca9ed2fa2a40b32e8d3f9c90ec4b888a49526f0de7
```

Record final unchanged runner/oracle hashes at candidate freeze after the independent author reports the sealed input hash, as required by the protocol. No gate changes after reveal.
