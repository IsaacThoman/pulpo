# Android native parity validation

Validated on September 5, 2026, on branch `feat-mobile-android-native`.

## Devices and fixture

- Android 17 / API 37, Google APIs ARM64 emulator `pulpo_android_17`.
- Phone viewport: 1080 × 2400, density 420. Wide-layout check: 1600 × 2560,
  density 240 on the same emulator. Original display settings restored afterward.
- Pulpo iPhone 17 Pro simulator, iOS 26.5.
- Both clients used an isolated local API at `http://localhost:8091`, disposable
  database `pulpo_mobile_android_e2e`, separate Redis on port 6392, and the
  deterministic queue provider on port 8092. No production chat data or model
  credits were used.
- Android uses `adb reverse` for ports 8091 and 8081; Metro runs on port 8081.

## Observed interaction results

| Area | Result |
| --- | --- |
| Authentication | Password sign-in succeeded on both platforms with the disposable account. Native Android email input retained the exact text. |
| Conversation | Android sent a held prompt, displayed the pending indicator, and received completed responses. |
| Queue | Queued two messages, edited one, moved the second above the first, and released the provider. The transcript completed in the selected order. |
| Synchronization | The Android-created conversation and queued-message edit appeared on iOS. |
| History | Opened the sliding history panel and contextual action menu; renamed the chat and reopened it. |
| Folders | Created a folder through the native dialog and moved the chat using the folder chooser. A server read confirmed both the folder and the saved chat association. |
| Models | Opened the toolbar dropdown and centered search dialog, filtered by “alternate,” selected Queue Alternate, and dismissed with Android Back/close. |
| Message actions | Long-pressed an assistant response and opened Android's text sharesheet. |
| Images | Opened the system photo picker and document picker, selected a fixture PNG, previewed it, and opened the sharesheet with an image thumbnail. Removed the draft afterward. |
| Documents | Selected a fixture PDF, opened it in Android's native PDF viewer, returned to Pulpo, and removed the draft. |
| Settings | Opened Account, General, and Interface entry points; selected dark appearance, inspected native switches, and verified system Back returns from Interface to Settings. |
| Layout | Inspected phone light/dark views, keyboard positioning, and the persistent sidebar at the wide viewport. |

Native Android components include Material 3 Expressive buttons, icon buttons,
switches, segmented choices, outlined fields with autofill semantics, dropdown
menus, list rows, dialogs, and the morphing progress indicator.
Material Symbols replace the previously invisible SF-only icons. Shared chat,
cache, queue, server, and account logic remains common to iOS and Android.

## Fixes found during evaluation

- Replaced Android's attachment button with working camera/photo/file actions.
- Replaced nonfunctional model, folder, queue, and rename fallbacks.
- Corrected a native text-field synchronization race during rapid entry.
- Bounded form dialogs to their content and available screen size.
- Prevented the hidden chat drawer from intercepting settings Back navigation.
- Corrected dark-mode icon contrast and the new-chat button's width.
- Replaced text-only local image sharing and unavailable file previews with
  actual file sharing and Android viewer intents with read-only URI grants.
- Replaced the shared folder store's prototype IDs with UUIDs accepted by the
  server, with a regression test for optimistic and persisted identity.

## Interaction revision after review

Removed the Android-only overlay drawer. The conversation now translates and
scales aside with the same spring and gesture handling as iOS. Folder groups
and their chats disclose inline. Toolbar models, generation choices, attachment
actions, and message/history actions use native anchored dropdowns. Search,
move-to-folder, and preference choices use centered dialogs; no application
bottom-sheet component remains in the Android UI layer.

Rechecked the Android 17 phone after this revision: model dropdown/search and
selection, folder disclosure, history and message popups, moving a chat, popup
Back dismissal, preference choice dialogs, and navigation into settings. iOS still launches successfully.
Mobile's 361 tests, TypeScript, lint, and both platform exports pass.

## Automated validation

- Android native debug APK compiled and installed, targeting API 37.
- iOS simulator debug build compiled and installed.
- Both platform bundles exported successfully.
- Mobile TypeScript check and repository lint passed.
- Mobile: 56 test files, 361 tests passed.
- Server: 145 test files passed, 1 skipped; 688 tests passed, 13 skipped.
- `git diff --check` passed.

## Release and validation boundaries

Native Android passkeys and verified HTTPS App Links require a real release
signing certificate, the server's certificate allow-list, and Digital Asset
Links hosted on each configured domain. The HTTP fixture cannot exercise that
association. Domain selection, certificate normalization, and ceremony origin
scoping have automated coverage; unconfigured instances retain browser PKCE.
See [Android configuration](../README.md#android-passkeys-and-verified-links).

This run did not publish to Google Play, sign a production Android release,
exercise a physical camera/biometric sensor, or perform a full TalkBack audit.
The fixture model does not support Agent execution; its Android control remains
disabled. Shared Agent logic and generation preset selection are retained.

The Android 17 emulator stopped responding once during native rebuilding and
showed a System UI timeout after reboot. Restarting without snapshots and
relaunching the app restored operation; the file and final layout checks above
were completed afterward. No Pulpo JavaScript or Android runtime crash was
reported during that investigation.
