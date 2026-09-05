# Android screen quality and motion review

Reviewed September 5, 2026 on Android 17 / API 37, with an iPhone 17 Pro / iOS 26.5 comparison. This follows the [selector correction](selector-parity-review.md). The goal is stable state changes, consistent native controls, readable layouts, and preserved functionality.

## Android guidance applied

- [Android animation guidance](https://developer.android.com/develop/ui/views/animations/overview): use subtle visibility transitions to explain changing state. The chat badges now fade and scale in place; the expiry action fades without changing toolbar geometry. Reduced-motion preferences skip these transitions.
- [Android layout basics](https://developer.android.com/design/ui/mobile/guides/layout-and-content/layout-basics): maintain consistent alignment and spacing, honor system/keyboard insets, and test different window sizes. The badge area reserves space in every mode, including no badge, and grows with font scale. Compact profile forms scroll to expose Save above the keyboard.
- [Compose accessibility defaults](https://developer.android.com/develop/ui/compose/accessibility/api-defaults): provide sufficiently large touch areas and meaningful descriptions. Toolbar actions retain 48 dp targets; hidden expiry actions stop accepting input immediately. Settings switches can be toggled from the whole labeled row and expose checked state.

## Root fixes

1. **Badge reflow:** Android inserted its badge into the centered model content conditionally, moving the title and prompts. Both badge layers now remain mounted in reserved space, use the existing shared state transitions, and hide inactive accessibility content.
2. **Toolbar jump:** Android conditionally removed its leading action and inherited the iOS model-centering offset. It now reserves both action targets and leaves the model trigger fixed. The disappearing action animates inside its reserved slot.
3. **Stale live theme:** static Android resource-color props could retain their resolved colors on mounted React Native surfaces after appearance changed. Chat/history components now consume a shared, memoized set of concrete Material colors and styles. Color props update without remounting the conversation or draft. iOS retains its semantic colors and native presentation.
4. **Screen consistency:** settings section headings and switch-row typography now follow Android sizing; setting descriptions reflect controls that actually exist. Android profile editing includes the read-only email and name explanation present on iOS. Password forms include the existing password requirements and appropriate autofill hints.
5. **Keyboard completion:** native fields without an explicit submit handler dismiss the keyboard on Done. Fields with explicit handlers retain their submission behavior, covered by regression tests.

## Device review

| Area | Checks in this pass |
| --- | --- |
| Empty chat | Expiry off/on, temporary on/off, expiry restoration, stable toolbar/model/provider/composer bounds; tested with keyboard visible and hidden. Captured an intermediate animation frame and the complete transition recording below. |
| Reduced motion | Repeated all badge states with Android animator duration scale disabled; controls remain usable and bounds stay fixed. Restored the prior system setting. |
| Appearance | Changed system light → dark → light with an unsent draft open. Text, logos, suggestion cards, and composer update together; the draft remains intact. Removed the test draft afterward. This resolves the live-theme limitation recorded in the selector review. |
| Populated chat | Opened an existing conversation, checked transcript and code styling, opened its message menu and native Select text screen, and returned without editing or sending. |
| Settings | General, Interface, Data Controls, and Trash; theme options, reasoning toggle from the whole row, expiration/retention menus, storage details, and bulk-delete confirmation cancellation. |
| Account | Account overview, profile editing, password form, passkey empty state, two-factor status, instance details, and account-deletion form. No production profile/security/deletion changes were submitted. |
| Compact/large text | 320 dp width and 200% text: account values wrap, profile email stacks, form instructions remain readable, and Save can be reached by scrolling above the keyboard. Restored normal size and scale. |
| Authentication | Signed out and back into the authorized test account; inspected alternate login, signup, password reset, and server-change pages and returned using system Back. No signup, reset email, or server switch was submitted. |
| iOS comparison | Existing expiry/temporary behavior and complete Favorites menu remain functional after the shared style refactor; iOS bundle exports successfully. |

This is a screen-quality pass, not a renewed claim of exhaustive end-to-end coverage. Successful release-signed passkey ceremonies, full TalkBack/VoiceOver traversal, physical-device haptics/camera, and successful production Agent provisioning remain outside the verified scope documented in the earlier interaction audit.

## Validation

- **61 mobile test files / 376 tests passed**, including the new keyboard-action regressions.
- Mobile TypeScript, repository lint, whitespace validation, and Android/iOS exports passed.
- The installed native Android build exercised these JavaScript changes; no native rebuild was required.
- [Device layout regression](android-badge-layout.py) checks actual model and composer bounds through all five badge states. Run on an authenticated, empty chat with both toggles initially off and automatic expiration configured:

```sh
python3 apps/mobile/e2e/android-badge-layout.py --model 'GPT-5.6 Terra'
```

The model argument is the selected model’s visible name. The script changes only unsent draft flags and finishes with both off. Bounds from this review are saved in [layout-regression.json](evidence/android-quality/layout-regression.json).

## Evidence

### Dropdown trigger spacing follow-up

The shared Android menu stretched its label with Compose `weight(1)` inside a full-width button. This separated short labels from their chevrons in the model selector, generation presets, and lab filter. The button now wraps its native content within its available slot. A trailing 26 dp inset reserves an 18 dp chevron plus an 8 dp gap without allowing long text to push the chevron out. The 48 dp touch target is retained. Compact presets also use the available composer width instead of truncating early.

On Android 17, UI Automator measured a 21 px / 8 dp label-to-chevron gap at 420 dpi for both model and generation menus. Checks covered GPT-5.6 Luna, DeepSeek V4 Flash, GLM-5.3 Flash, short and combined preset labels, 320 dp width, and 200% text. At 320 dp, `Low · Fast` fits completely; long model labels ellipsize with the arrow visible. Model selection and opening/dismissing menus worked. Device size and font scale were restored. Targeted menu interaction tests, mobile TypeScript, lint, and the production-configured Release build passed.

![Stable layout with animated expiry and temporary states](evidence/android-quality/badge-motion.gif)
![Live dark appearance with the draft retained](evidence/android-quality/live-dark.png)
![Live return to light appearance with the same draft](evidence/android-quality/live-light.png)
![Android interface settings](evidence/android-quality/interface.png)
![Android two-factor screen](evidence/android-quality/two-factor.png)
