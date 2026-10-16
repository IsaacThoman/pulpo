# R21 preview document lifetime

The baseline has a production ownership hazard, independently reproduced on the
iPhone 18 Pro simulator. `PreviewInputView` retains its controller, which retains
its engine and document. The controller's host is weak; `TextViewDocument` used
an unowned host. `Coordinator.removeKeyboard()` invalidates and releases that
host, but consumers can survive it. A later document access aborts even though
the host's text view was cleared during invalidation.

Candidate source `92059ca3` makes that reference private, weak and optional, and
uses `host?.textView`. Existing guards then return nil context, false `hasText`,
and ignore insert/delete after host release. The coordinator still owns a live
host; the adapter cannot rebind to a replacement. No strong retain cycle, editor
cache, persistence, cursor adjustment, or other production change was added.

## Frozen baseline and red result

Baseline source is `f17109e7`. Protocol and primary synthetic tests were frozen
at `b50afa3d` before any source edit. Two fixture corrections were versioned and
their failing runs preserved, rather than hidden:

- v1: automatic SwiftUI teardown had not released the host while UIKit views
  were retained. That dismantle fixture's 12 assertion failures do not prove a
  post-deallocation issue. The independent switch path did deallocate its host
  and then crash on its first context read.
- v2: calling dismantle while mounted let pending SwiftUI updates install a new
  host/controller. The old weak host did become nil and both lifecycle methods
  crashed, but two coordinator nil assertions were invalid for that ordering.
- Final v3 at `35a47dbb`: remove the hosting owner and settle, then invoke the
  unchanged production dismantle entry point deterministically. The system
  keyboard switch case continues through the actual `updateUIView` path.

Final baseline-v3 command exit **65**, 9.60 seconds wall time. The live control
passed; **both lifecycle methods aborted with SIGABRT** after weak-host nil,
without fixture assertion failures. The finalized result bundle reports
**1 passed, 2 failed, 0 skipped**, but neither crashing method completed its
remaining checks. XCTest restarted twice, eventually running zero additional
tests. This is a native crash red result, not a finalized all-method execution.

Both native crash reports identify `swift_unownedRetainStrong` →
`TextViewDocument.textView.getter` (`KeyboardPreview.swift:49`) →
`documentContextBeforeInput.getter` (`:52`) → the test's first nil assertion.
They correspond to test processes 24191 and 24209 and the assigned simulator.
This establishes the concrete baseline lifetime bug. No matching historical
R17 crash stacks were supplied or examined, so attribution of those crashes
remains unproven.

## Independent checks and review

Independent author commit `58773d4d` froze three native counterchecks before
candidate source reveal, without reading the primary tests. They cover direct
host release without invalidation, invalidation while host/editor remain alive,
and an actual standalone document after all original consumers release. See
the separate authorship record at
`audits/preview-document-lifetime/R21-countercheck-authorship.md` in the repo root.

First candidate all-AppTests run finalized **14 passed, 1 failed, 0 skipped**,
exit 65, 18.51 seconds, no runtime crash. All nine DraftEditor tests, three
primary lifetime tests and two independent checks passed. The standalone check
failed three immediate weak-deallocation assertions for UIKit input/controller/
engine (host was nil), and its guard correctly left later document checks
unexecuted. This failure is retained in `evidence.json`; no source workaround or
disabled assertion was used.

Independent source review request `pr782-r21-source-review-v1` approved
`92059ca3`, finding no blocking ownership or correctness issue. Review limits:
deterministic dismantle-entry execution does not prove automatic SwiftUI timing;
mounted primary fixtures are unfocused and deliberately retain real consumers;
actual UIKit retention duration is not measured. The pre-removal queued delegate
callback may drain early; explicit queued post-release controller/engine/document
operations supply late-access coverage. Source approval is separate from runtime
validation.

## Remaining countercheck failure — acceptance incomplete

The standalone consumer-release countercheck still fails. Independent timing
revision `88261014` pumps the run loop for at most two seconds without changing
the four nil assertions. Further implementation-authored fixture controls
`6b69906e` (window/layout/remove) and `026968d2` (separate non-inlined factory
scope) also preserve those assertions. Each focused run finalized one failed
test, no skips or crash: the host deallocated, but input/controller/engine
remained alive. Their later standalone-document reads/mutations were therefore
**not executed**. The two window variants additionally logged an unbalanced
appearance-transition warning; their result summaries report no runtime warnings.

Neither deferred UIKit retention nor conservative local ARC lifetimes was
established as the retaining cause. The factory/layout controls did not resolve
it. No owner was invalidated to force release, assertion removed, test skipped,
or product state patched. This is an open retaining-path/fixture investigation;
source-only approval does not settle it. The corrected standalone case is
informed development evidence, no longer a fresh heldout check. The first two
independent checks are unchanged and their initial candidate passes are
separately preserved.

The narrow TextViewDocument baseline crash is reproduced and the primary
candidate lifetime checks pass, but **overall frozen acceptance is incomplete**
while the standalone consumer-release countercheck remains red. Do not present
this branch as an all-green regression result or silently omit that test.

## Final runtime counts and handoff

Final AppTests run: exit **65**, **14 passed, 1 failed, 0 skipped**, no runtime
crash, 16.38 seconds wall time. Full DraftEditorTests **9/9** passed, including
the parent's actual held-delete detach and boundary-range tests; primary
lifetime tests **3/3** passed; independent counterchecks **2/3** passed. The one
failed method has three assertion failures for the surviving consumer probes.
Its host was nil. Result-summary runtimeWarnings is empty, but the temporary
window's appearance-transition warning remains visible in the failing log.

Established app UI selection: exit **0**, **6 passed, 0 failed, 0 skipped**,
no result-summary runtime warnings, 118.15 seconds. These are the previously
named regression tests, not execution of the six R17 broader UX heldouts.
No source changes followed `92059ca3`; SHA-256 source/test fingerprints and
per-run counts are in `evidence.json`.

Costs: nine serialized xcodebuild invocations, **215.27 seconds** summed command
wall time (including build/startup); three delegated tasks for independent
authorship, source review and fixture review. This excludes authoring, manual
inspection and orchestration overhead. Exact token usage and dollar cost were
not exposed, so no estimate is claimed. No typing latency or benchmark claim.
The extra failing fixture iterations are included in these costs.

The assigned 18 Pro is released: hardware keyboard re-enabled for that UUID;
`device_close(shutdown:false)` succeeded. No agent-device CLI session was opened
because device_open failed before a launcher was returned. The simulator remains
booted for the next owner; no R21 xcodebuild remains active. PR782 linking and
`list_thread_pull_requests` confirmation succeeded; unwatch confirmed false.
No push or deployment. Only the source, synthetic tests and curated audit are
committed; `git diff --check` passed. Overall acceptance remains incomplete,
with the failing countercheck preserved for the parent to inspect.

## Execution and limits

The device tool attempts returned the raw error
`Device list failed: The device command failed (exit code 127).`
Authorized fallback uses only simulator
`7E1D7979-7307-4C53-8466-BB41154B383C`; the repository keyboard helper disabled
hardware keyboard only there. A direct boot reported already Booted (405), so
no other device was booted or driven. Parent iPhone 17, E1C6B89D and performance
trees were untouched. No physical deployment, push, parent edits, or PR body
change was performed.

Native commands use this worktree's generated project, scheme `PulpoKeyboard`,
DerivedData `/tmp/pulpo-r21-build`, destination UUID above,
`-parallel-testing-enabled NO -collect-test-diagnostics never`. Baseline uses
`-only-testing:PulpoKeyboardAppTests/PreviewDocumentLifetimeTests test`;
candidate native uses `-only-testing:PulpoKeyboardAppTests test`. Established UI
selection uses `test-without-building`: DraftNavigationTests,
PreviewDismissalTests, KeyboardLanguageTests/testHostSettingsAndKeyboardShareLanguageSelection,
SetupGuideTests/testInAppPreviewDoesNotConfirmFullAccess. All runs are serialized.
Raw logs/results stay under `/tmp/pulpo-r21-evidence`; only indicated errors
authorized log inspection. No raw logs, xcresults, screenshots, or corpora are
versioned.

The six broader R17 UX heldout cases remain **unexecuted**. These native
synthetic lifecycle checks establish lifetime behavior, not a physical-device
or complete UX pass. R17 Character cursor candidate `85e7158a` was not imported;
its method was neither changed nor invoked by the new fixtures.
