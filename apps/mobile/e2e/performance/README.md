# Mobile performance validation

This directory contains synthetic fixtures and evidence. Nothing here is imported
by the normal application. Use disposable simulators/emulators, never a user's
installed app or account.

## Baseline

`AUDIT.md`, `ios-simulator-results.json`, and `environment.json` preserve the audit
at `675eb02274d9e2f66212e55c1a7662acdfacb9f1`. `baseline-entry.tsx.txt` preserves its
entry point. That run used an existing iOS Release native shell without ExpoImage;
it measured functions, not full-app startup.

## Current harnesses

- `audit-entry.tsx`: real SQLite, scoped projection, batch hydration, and residency
  code against synthetic data. Writes `Documents/performance-after.json`.
- `ui-entry.tsx`: the real application/providers with synthetic API responses and
  an isolated account. Seeds 20 chats, including a 1,000-turn chat with native
  Markdown and a local PNG. The fixture stream button emits snapshots every
  100 ms. Network fallback points only to `https://127.0.0.1:1`; no credentials,
  live account, or model calls are involved.
- `fixture.ts`: deterministic shared transcript generator.

For a large-account drawer check, set `EXPO_PUBLIC_PERF_HISTORY_COUNT=5000` when
exporting `ui-entry.tsx`, then run the `testLargeHistorySwipe` XCTest case. Extra
chats contain summaries only. The case repeats swipe-open/chat-selection cycles
and searches for the 5,000th chat. It checks interaction correctness, not frame
latency; keep any screenshots and result bundles outside the repository.

`testSelectLongAndCachedChats` alternates between the 1,000-turn and short chats
twice, checks the selected transcript's native test identifier, and verifies the
keyboard stays dismissed. This covers initial local hydration and resident detail
selection after drawer closure; it does not measure physical-device frame timing.

Set `EXPO_PUBLIC_PERF_COLD_CHAT=1` to omit chat 3's offline document, delay its
network response by five seconds, and make chat 4 empty. `testSelectedChatCover` checks that selection
shows the destination placeholder, hides the previous transcript and intermediate
spinner, reveals the loaded transcript, handles selecting the same chat again,
and switches through an empty chat.

Build current native dependencies first (`expo prebuild`, `pod install`, then
Release Xcode/Gradle builds). Keep the normal build intact. Export a harness from
`apps/mobile`, for example:

```sh
npx expo export:embed --entry-file e2e/performance/audit-entry.tsx \
  --platform ios --dev false --minify true \
  --bundle-output /tmp/pulpo-performance/main.jsbundle \
  --assets-dest /tmp/pulpo-performance/assets --max-workers 4
```

For iOS, replace the bundle in a **temporary copy** of the freshly built `.app`,
copy exported assets, ad-hoc sign it, and install on the disposable simulator.
For Android, export with `--platform android`, replace `assets/index.android.bundle`
in a temporary APK copy, zipalign and sign with the local debug keystore. Never
modify or distribute the normal build as a benchmark app.

Retrieve the iOS result using `simctl get_app_container <UDID>
com.isaacthoman.pulpo data`; Android results live under the app's files directory.
Errors write `performance-audit-error.txt`. Shut down and remove only the test
simulator/emulator after collecting evidence.

## Measurement rules

Use the same M3 Pro host, iPhone 17 Pro simulator, and iOS 26.5 as the baseline.
Do not run builds during measured work. The result verifies Hermes, React Native
version, and `__DEV__`. Three warmups precede 15 projection/hydration samples,
10 SQLite samples, and five metadata samples; samples are separated by 30 ms.
These small samples identify bottlenecks, not production SLO compliance.

Projection fixtures contain 10–1,000 turns with 256-character answers. Each warm
update changes one live snapshot and reuses the per-chat projector. Hydration
publishes one collection, counting store notifications without React rendering.

The residency check performs three cycles of 20 distinct 100-turn documents with
one selected chat. It records retained query/snapshot counts and Hermes heap
instrumentation when exposed by the Release runtime. Counts and serialized byte
budgets are not actual heap measurements.

Cache fixtures contain 1, 10, or 45 100-turn documents with 2,048-character answers.
The largest is exactly 22,092,625 bytes, matching the audit. Insertion is outside
measurement. Targeted reads call `cachedChat`; maintenance calls
`markCachedChatOpened`; metadata reads select stored sizes only. The queue check
measures a tiny `getValue` queued behind maintenance.

See `IMPLEMENTATION.md` for implementation details, measurements, validation
coverage, and native/device limitations.

## Focused iOS UI tests

`PerformanceUITests.swift` contains the native interaction checks. After installing the
UI fixture on a disposable simulator, run `create-ui-test-project.rb` with Ruby's
`xcodeproj` gem (available with CocoaPods), then run `xcodebuild test` against the
generated `Performance.xcodeproj` / `PerformanceUITests` scheme and that explicit
simulator UDID. Keep result bundles outside the repository. The generator defaults
to `/tmp/pulpo-performance-uitests` and accepts a different directory as argument.

Android Release benchmark results can be reconstructed from the ordered
`PULPO_PERF_<offset>:` logcat chunks; this avoids requiring a debuggable APK or
access to another app's private files. Keep native UI images and raw process-memory
captures outside the repository, as CI artifacts or PR attachments when needed.
The UI fixture clears only its synthetic namespace
when launched so reruns do not merge changed fixtures with old snapshot versions.
