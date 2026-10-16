# R50 exposed companion and emoji UX handoff

Base: `fc85f84bb6df3fcf9e7a8afb471658cfc83d082b`. PR #782 linked immediately. No push, merge, deploy, PR-source update, parent cherry-pick, or dependency publication. All evidence here is exposed development evidence. No blind/heldout or spoken VoiceOver claim.

## Narrow source commits

- `b90093fe`: settings URL handling adds only `showSetupGuide = false` before `.settings`. Existing guide-seen dismissal semantics remain; it neither marks setup complete nor changes permissions.
- `41abf982`: actual rendered emoji tone becomes the cell accessibility value; category cells expose default plus all available tone custom actions. Gesture and actions call the same preference/insert/reload method. Recents describe their stored variant and offer no tone-changing actions. Cell configuration tokens, weak references, mounted/hidden checks, panel cancellation generation, and reuse cleanup prevent retained actions affecting stale content.

Only `App/AppModel.swift` and `PulpoKeyboardKit/Sources/KeyboardUI/EmojiPanelView.swift` change in production. AppModel outside its one added route line is byte-identical to base, preserving R42 account and R33 clear-Bool glue. SetupGuideView, HomeView/PulpoKeyboardApp, Controller and all prohibited core/storage/learning/dictionary files remain unchanged. No R39/R49/R47/R46 files edited.

Discovery copied verbatim before edits in `cb8b9062`; SHA-256 `16ae2900070ea6d15691120b0c140eed53b6b86d8b21596ababa72a3315c70b5`. All eight source hashes independently matched. See `discovery/`, `intended-outcomes.md`, old/new source manifests and fixture manifests. Independent source review round 1 raised cancellation and test-coverage objections; both were addressed. Round 2 reviewed final production source and returned no findings. `source-review.md` retains both task IDs, findings, responses and limits. Later runtime-only fixture corrections are recorded below, not represented as independently reviewed source changes.

## Primary old/new UI comparison

The SAME corrected fixtures (`9e9f363d`, hashes in `fixture-final.sha256`) and production bindings ran against exact base source and final source. No oracle changed after candidate results. Both builds succeeded. Old `old-corrected.xcresult`: **0 pass / 2 fail / 0 skip**, five native assertions plus one route assertion. New `new.xcresult`: **2 pass / 0 fail / 0 skip**. Structured summaries are in `results/`; screenshots, mounted accessibility values/actions, and attachment manifests are in `witnesses/old` and `witnesses/new`.

- **Actual displayed route:** XCUISystem opens the real registered `pulpokeyboard://settings` URL while the app displays Setup Guide. Old screenshot still shows Guide; new screenshot shows Keyboard settings. The new test uses real Find Setting → Language controls, selects English + Español, reopens Continue Setup, and checks the original three setup statuses are unchanged. Initial primary state is keyboard not yet enabled; this is a public OS URL witness, not installed-menu dispatch.
- **Actual mounted accessible cells:** production EmojiPanelView in a UIWindow, with its real UICollectionView cells and images. Isolated EmojiHistory controls fixture state; the production KeyboardController delegate inserts through PreviewHost into a real UITextView containing `Hola hello `. Old thumbs-up category value is nil and actions empty; new value is Medium skin tone with six named choices. Two recents identify Dark and Light skin tone independently of the category preference.
- **Action behavior:** seven successful public custom-action dispatches covering six unique choices, including default; real document insertion, selected preference and panel reopen checked. Retained actions after panel removal, manual reuse lifecycle, actual non-tone reconfiguration and cancellation leave text and preference unchanged. This is public actionHandler dispatch, not spoken VoiceOver navigation.
- **Reuse denominator:** 220 reused non-tone cell observations across category stops; 141 distinct cell objects encountered; retained tone cell actually reconfigured as non-tone once. Observations may repeat the same object. Non-tone values are nil and actions empty; retained captured action remains rejected. See `reuse-denominators.txt`.

## Ordinary checks and installed-state extension

`ordinary.xcresult`: **3 pass / 0 fail / 1 skip** of four selected existing tests. CompanionWorkflowR24Tests, EmojiSearchTests/testSearchInPreview, and SetupGuideTests/testGuideShowsLiveStepsAndPrivacy pass. CompanionDynamicTypeR24Tests skips with its existing requirement: the dedicated UUID-pinned R24 live-size runner was not provided. This is retained as a skip, not a pass. No unchanged whole-core rerun.

`installed-availability.xcresult`: **1 pass / 0 fail / 0 skip**. Existing OS setup test enabled the real extension and Full Access switch. Additional tests then used normal ad-hoc simulator signing and actual Settings permission switches, reached confirmed completed and Full Access off states through the real installed keyboard, and kept the guide displayed. Initial `old-installed.xcresult`: **0 pass / 0 fail / 2 skip** because the Keyboard Settings menu item was not hittable. Exported hierarchy does contain its button; screenshots show a clipped/blurred keyboard menu. Thus “unavailable” means unavailable to a normal hittable control interaction, not absent from the accessibility tree. No coordinate or internal callback dispatch manufactured success.

The installed-state fixture was then explicitly changed (`15e8f711`, `installed-fixture.sha256`) to retain menu availability and route-origin evidence and use the real public OS URL when the installed menu is not hittable. The initial two skips remain in `results/old-installed-unavailable-*`. The final old/new comparison for those states and its limitations are recorded in `states-result.md`.

## Initial failures and fixture corrections retained

- First intended-outcome write used a duplicated relative path and failed before source edits; corrected document was written before edits.
- Initial git add saw an existing index.lock; normal retry succeeded. No unowned lock was deleted.
- First Xcode invocation used the wrong project path: exit 66. The next run was interrupted to regenerate the project with newly added fixtures: exit 75.
- `old-attempt3`: tests actually executed early (native five assertions and route three assertions failed), then verbose failure-diagnostic finalization stalled. After ten minutes INT then TERM ended it (143), leaving an incomplete xcresult. The temporary commentary inference “no tests ran” was wrong; inspection after explicit failure corrected that. This attempt is not a completed-result pass or a valid final-fixture denominator.
- A native-only attempt with verbose failure diagnostics also executed and failed five assertions, then was terminated (143). `-collect-test-diagnostics never` allowed subsequent normal structured result completion; assertions and screenshots remained enabled. Both interrupted artifacts/logs are retained.
- `old-final-native-nodiag`: **0 pass / 1 fail / 0 skip**, five assertions. Its category index was computed from an unfiltered catalog while the production panel removed unsupported glyphs; the captured category was thumbs down instead of thumbs up. This is a fixture fault, not accepted category evidence. The two recents witnesses were correctly identified. The fixture now uses the same glyph-filtered catalog supplied by the production controller.
- Initial direct route `old-final-route`: **0 pass / 1 fail / 0 skip**, three assertions. The guide did remain visible, but the fixture also sought a language control below the initial viewport. The corrected fixture first checks guide dismissal, then uses actual Find Setting → Language interaction. Both source versions were rerun on that corrected fixture before acceptance.

Failed logs are retained compressed in `raw/`. External logs, result streams and xcresults remain under `/tmp/pulpo-r50-*`; hashes are in `external-artifact-hashes.json`. Successful build logs were redirected and never inspected. Structured candidate build issues retain an existing unused `timed` result warning in MultilingualResourceSweepTests. Native/ordinary structured results retain a priority-inversion warning from existing learning-save activity; no Engine/storage change or performance claim follows from it.

## Reproduction and limits

Xcode pinned to `/Applications/Xcode.app/Contents/Developer`. Every build/test destination and device-driving command pinned to **371DE15B-3876-4931-8C6B-31C5467C215F** (fresh owned iPhone 17, iOS 27.0). `device_list` raw error: `Device list failed: The device command failed (exit code 127).` `device_open` raw error: `No device 371DE15B-3876-4931-8C6B-31C5467C215F on host local. Call device_list for current ids.` Refresh still omitted it and returned 127. Authorized CoreSimulator/XCTest fallback used. UUID announced before driving.

Generate with xcodegen; `xcodebuild ... -destination 'platform=iOS Simulator,id=371DE15B-3876-4931-8C6B-31C5467C215F' -derivedDataPath /tmp/pulpo-r50-build build-for-testing`; execute the generated `PulpoKeyboard_iphonesimulator27.1-arm64.xctestrun` using `test-without-building`, `-parallel-testing-enabled NO -collect-test-diagnostics never`, explicit resultBundlePath/resultStreamPath and only-testing selectors for the R50 classes. Primary unsigned and later ad-hoc-signed state runs are distinct reported stages. No timing benchmark or quiet/performance reservation.

Physical long-press tone selection was not remeasured; source review establishes the shared selection path. No spoken VoiceOver or sourceblind result is claimed. Installed menu dispatch remains bounded by actual control availability and is distinguished from public OS URL fallback. No microphone/speech requirement was imposed.

Release status and final artifact hashes are in `release.md` and `artifact.sha256`. Protected working copies and other devices were not edited/driven. Parent owns any future merged source binding; this worktree does not update it.
