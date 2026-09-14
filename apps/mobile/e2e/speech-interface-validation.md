# Inline speech settings validation

Validated September 13, 2026 on the iPhone 17 Pro / iOS 26.5 simulator.

The initial change placed speech controls directly in Settings → Interface,
between Conversation and Offline storage. The separate Speech destination was removed. iOS uses the
surrounding SwiftUI Form, sections, menus, text field, and stepper. Android uses
the existing settings cards and Material menus, fields, and buttons.

## Simulator checks

Rendered the actual MemberSettingsScreen and SettingsDetailScreen with this
checkout's production JavaScript bundle in a separate QA app. Reused the existing
Release simulator native shell. A disposable catalog provided a model with 13
voices, instructions, and speed plus a second model without those capabilities.
Preferences were persisted locally by the fixture; no account settings or live
speech providers were changed.

- Opened Interface from Settings and verified speech is inline with no additional
  destination. Inspected the form in dark and light appearance.
- Opened the native voice menu, scrolled, selected Cedar, and reset to Coral using
  Use default voice. The current choice and native selection checkmark updated.
- Changed speed from 1× to 1.1× and back to 1×. The displayed and accessibility
  values match. Expo's native stepper accepts integers, so the component converts
  hundredths to/from the stored decimal speed.
- Entered and appended instructions, including a longer sentence. They wrap
  naturally and remain intact when adjusting other controls and relaunching.
  Native text remains authoritative during editing to avoid delayed React
  renders overwriting newer keystrokes.
- Switched to the second model and verified unsupported instructions/speed
  controls disappear. Switching back restored that model's voice and speed.
- Relaunched the QA app and confirmed the model and instructions persisted.

## Automated checks

The mobile suite passed (634 tests) during implementation. After the final native
control refinements, the speech settings suite passed (11 tests), along with
mobile typechecking, repository lint, and diff whitespace checks. Coverage
includes iOS/Android preference persistence, unavailable selections, previews,
per-model capabilities, speed bounds, the integer stepper contract, and delayed
instructions updates during native editing.

This validates the settings UI and its preference behavior. Live speech synthesis
and physical-device audio playback were outside this change. Temporary harnesses,
raw screenshots, bundles, and the QA application are kept out of version control.

## Personalization follow-up

Moved speech from Interface into Personalization on web and mobile. Mobile adds
a Personalization destination under Preferences and retains the same native
controls. Web places speech after the existing personalization controls.

Rechecked the actual mobile Settings/SettingsDetail screens in the iOS 26.5
simulator: Personalization opens the speech controls directly, the speed stepper
updates from 1× to 1.1×, and Interface contains only conversation/offline settings.
The temporary fixture uses local preferences and no live providers. Web speech
and settings tests (10) and the production build passed; mobile typechecking,
repository lint, and diff whitespace checks passed.
