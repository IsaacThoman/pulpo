# R50 companion/UI exposed discovery

Static read-only discovery against current source in `/Users/isaacthoman/.t3/worktrees/pulpo/t3-a3218df3`, 2026-10-16. No audits, earlier reports/outcomes/benchmarks, dictionary contents, tests, builds, product binaries or devices were read/run. No repository edits. These findings and scenarios are exposed to the developer; this is not a source-blind held-out suite. Runtime UI reproduction remains for the device owner.

## 1. Settings opened from the keyboard remains hidden behind Setup Guide (P2)

**Trigger / proposed actual-UI reproduction:** Enable the installed keyboard, open the companion's Setup Guide (first launch or its Setup Guide button), tap the step 3 text field, switch to Pulpo Keyboard, open its EN/ES language menu, and choose Keyboard Settings. This is reachable with or without confirmed Full Access. The guide can remain presented after setup becomes complete because completion announces success but does not dismiss it.

**Expected:** The companion displays Keyboard settings and its language/typing controls. **Source-predicted actual:** The app consumes the settings route and clears underlying navigation while `showSetupGuide` remains true; the full-screen Setup Guide continues covering settings. A user must separately leave the guide to reach the requested destination.

**Evidence:** `App/SetupGuideView.swift:97-105` provides an installed-keyboard text field. `KeyboardUI/SuggestionBarView.swift:155-159` includes Keyboard Settings in the language menu, calling the settings handler bound to `pulpo-keyboard://settings` in `KeyboardUI/KeyboardController.swift:306`. `App/AppModel.swift:327-328` sets only `.settings`; unlike `.account` and `.dictation` at lines 321/325, it never clears `showSetupGuide`. `App/PulpoKeyboardApp.swift:209-211` keeps the guide full-screen while that Boolean is true. Its settings-route observer at lines 225-230 clears path/route and refreshes status without dismissing the guide. `SetupGuideView.swift:137-140` only announces setup completion.

**Minimal repair direction:** Clear `showSetupGuide` when handling the settings deep link, following existing account/dictation navigation behavior. Do not mark setup complete or change permission state.

**Confidence / limits:** High confidence in state defect; medium-high confidence in visible result pending actual installed-keyboard routing on iOS. Static evidence does not establish details of UIKit's transition animation or when the keyboard resigns.

**Novel UI scenario for later independent author:** Begin in an actively presented guide with the installed keyboard in its step 3 field, request Keyboard Settings through the keyboard, and establish that language/typing settings become interactable and the guide is absent. Reopen Setup Guide afterwards to check it remains available. Cover both incomplete setup (Full Access off) and completed setup with the guide intentionally still open. Do not validate only the model route or URL dispatch.

## 2. Emoji skin tones are missing from the accessible representation and standard accessible choices (P2)

**Trigger / proposed actual-UI reproduction:** In Try It's In-App Preview, open emoji; visually long-press a tone-capable emoji (for example thumbs up), select a nondefault skin tone, return to letters and reopen emoji. Enable VoiceOver and focus that emoji in its category and in Frequently Used. Insert two different skin-tone variants to create two recents with the same base name, and compare their announcements.

**Expected:** The focused cell identifies the actual skin tone it will insert; the available skin tones can be selected through standard accessible actions, matching the existing accessible long-press equivalents on letter and one-handed keys. **Source-predicted actual:** Both toned recents and the category's preferred variant expose only the base emoji name. The actual preferred value exists only in the drawn image and insert path. The skin-tone picker is driven solely by physical long-press position, with no named tone custom actions on cells.

**Evidence:** `KeyboardUI/EmojiPanelView.swift:159-161` converts toned recents into `Emoji(value: tonedValue, name: base.name, ... tones: nil)`. Cell configuration at lines 248-254 always assigns `emoji.name` to `accessibilityLabel`. Lines 257-260 choose/draw the preferred variant and lines 285-288 insert it, but publish no accessibility value for that variant. `EmojiCell` at lines 458-485 supplies only keyboard-key traits and an image; no custom actions or skin-tone value. Tone choices exist only in `held(_:)` at lines 358-381. The shared popup at `KeyboardUI/KeyPopupView.swift:24` disables interaction and has no named choice activation API. In comparison, existing letter/one-handed alternatives explicitly expose `UIAccessibilityCustomAction` in `KeyboardUI/KeysView.swift:669-703`.

**Minimal repair direction:** Derive an accessible name/value for the actual displayed/insertion variant, including tone, and give tone-capable category cells named actions for the default plus each available tone using the same preference+insert behavior as the gesture. Keep actions safe across cell reuse and reset actions/value on cells without tone options. Frequently Used must identify the stored variant even if it deliberately offers no tone-changing actions.

**Confidence / limits:** High confidence that explicit accessible cell labels omit tone and that custom actions are absent. No VoiceOver session was run. Do not claim all physical VoiceOver pass-through gestures are impossible; the verified issue is indistinguishable named content and absent standard named actions. The visible long-press behavior was not remeasured.

**Novel UI scenario for later independent author:** Populate two skin-tone variants of one base emoji in recents; verify accessible labels/values distinguish them and activation inserts the variant announced. On the original category cell, enumerate and activate a named tone action, verify the document output and updated preferred variant after reopening the panel. Check a recycled non-tone cell has no leaked actions or tone value. Use a UI-level accessibility inspection/VoiceOver run; a helper-only mapping test cannot establish the cell's accessible behavior.

## Hypotheses rejected during discovery

- Ordinary letter accents, space cursor movement and one-handed menus are not generically inaccessible: `KeysView.swift:671-703` already provides custom actions.
- Returning from Try It to settings does refresh the app model after the keyboard changes shared language: `PulpoKeyboardApp.swift:220-223` handles the navigation pop. No stale-language finding is reported.
- Reopening emoji does rebuild its panel and recents: `KeyboardController.swift:120-130,703-719`; no stale ordinary-reopen recents finding is reported.
- No broad localization wishlist or cosmetic EN/ES copy issue is reported as a bug.

## Exact source snapshot SHA-256

Paths below are relative to `apps/keyboard-ios/`.

| Source | SHA-256 |
| --- | --- |
| `App/AppModel.swift` | `31e6f935e21701c4c7f3ddeef1756aaf0f8346a01a3b75a17571e195a707a135` |
| `App/PulpoKeyboardApp.swift` | `1ff4b34077ad63148acb3ae97c7d1465dd391aec6784276e580b9383f66a5617` |
| `App/SetupGuideView.swift` | `7feb8507cff83e027ffe1a0f69ed52c0740c99acb96ab9b1a4363ce0226ace17` |
| `PulpoKeyboardKit/Sources/KeyboardUI/EmojiPanelView.swift` | `9b3899e6559aa00659c5aaa7e86651012349a44ff8dda4b39f6ed999191b201d` |
| `PulpoKeyboardKit/Sources/KeyboardUI/KeyPopupView.swift` | `ff58891a535b40037887cc7d730f57199cd889489960fdabb7f586498a18844d` |
| `PulpoKeyboardKit/Sources/KeyboardUI/KeysView.swift` | `671ea47eba2716cf6ae3e57777d677264c428836c31ab1113c0f0ded59f2cb7a` |
| `PulpoKeyboardKit/Sources/KeyboardUI/KeyboardController.swift` | `30ec7b843868c2f22bca2cb90d58d9733d82c0c0961d3c75e1f6d82246a2bfae` |
| `PulpoKeyboardKit/Sources/KeyboardUI/SuggestionBarView.swift` | `ec1c5a7aadf8a51dff940855a7fbbc941f987e5a208363622c0323cf07105400` |
