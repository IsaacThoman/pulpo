# Integrated composer queue validation

Implemented the selected simple integrated layout in the production React Native composer and UIKit queue view. The queue shares the composer glass surface, uses a single “Queued” disclosure header without numbers/counts, and collapses when the input gains focus. Direct delete/edit buttons match the web action order. Editing exposes a cancel action. Attachment names, sync/dispatch/editing/error details, action locks, native drag-and-drop, and VoiceOver move actions remain available.

## Checks

- Mobile TypeScript check passed.
- Targeted queue and draft tests: 19 passed across messageQueue, composerSync, and composerDraftCache.
- Oxlint passed on changed TypeScript files.
- iOS Release build succeeded: 0 errors, 6 warnings.
- Simulator UI: expand/collapse, focus collapse, edit/cancel and edit/save with unsent draft restoration, native accessibility reorder, and deletion passed.
- Read the disposable backend after UI actions: persisted queue was `Quieter streets`, then `Keep Sunday afternoon free.`, both pending.

Backend interaction evidence: `evidence/integrated-queue-results.json`.

## Test environment

Used the existing isolated queue fixture at localhost:8091 with the test account documented in README.md. No requests were sent to live models. The production release rejects local HTTP by design. For UI testing only, a copy of the freshly compiled simulator app in `/tmp/pulpo-composer-native-qa` received a production-mode JS bundle with localhost allowed. The session source was restored immediately after export; no instance-security changes are part of this change. A development-mode JS bundle was attempted first but did not launch correctly inside the Release native runtime, so it was replaced before interaction testing.

Physical drag gestures, offline fault injection, and Dynamic Type were not re-run in this UI pass; existing drag/drop code remains unchanged. No physical iPhone deployment was performed.

## Divider and viewport follow-up

Row separators are drawn only between entries; the queue/composer boundary remains separate. The corrected native component passed an incremental iOS Release build.

The composer publishes its measured growth to `KeyboardChatScrollView.extraContentPadding`, retaining the existing `whenAtEnd` keyboard behavior. Expanded/collapsed queue movement was visually verified in a cached long conversation after the local test server was offline. The latest TypeScript and lint checks passed, along with all 7 viewport tests.
