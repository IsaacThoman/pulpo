# Parent check of the recorded activity warning

At published source `ababd98f`, `LearningAuthority.scheduleSave()` schedules the
commit on its utility queue and waits for its completion inside
`ProcessInfo.performExpiringActivity`. The wait has a five-second timeout. The
source is `LearnedDataPersistence.swift`, lines 663–682 at this revision.

Both the installed iOS SDK's `Foundation/NSProcessInfo.h` and
[Apple's method documentation](https://developer.apple.com/documentation/foundation/processinfo/performexpiringactivity(withreason:using:))
specify asynchronous execution of the activity closure on a concurrent queue.
Consequently, the timeout in this closure is not evidence that the calling input
thread waits for five seconds. This checks the closure's scheduling contract; it
does not measure the API call's overhead, identify every wait in an input path,
or establish a native latency bound.

The parent R47 run's structured summary still records two priority warnings.
Structured issue records associate one with `LearningForgetControllerTests` and
this activity call, and the other with `EmojiToneAccessibilityR50Tests` without a
source location. Root/action issue lists repeat the same records; they do not
create four distinct warnings. The R47 method has no attributed runtime warning.
The exact summary and records remain in
`../kept-word-boundary-r47/parent-integration/`.

No source, queue priority, persistence semantics, test allowance, or runtime
result changed during this check. The warning remains an observation, not a
demonstrated foreground stall. The earlier 454.816 ms macOS outlier and missing
iOS suspension, expiry, physical-device latency and crash-durability evidence
remain unchanged. A scheduling change would need a concrete measured problem
and its own validation rather than merely removing this diagnostic.

Checked October 16, 2026 against the SDK under
`/Applications/Xcode.app/Contents/Developer/Platforms/iPhoneOS.platform/Developer/SDKs/iPhoneOS.sdk/`.
No successful build log was read and no new workload or device operation ran.
