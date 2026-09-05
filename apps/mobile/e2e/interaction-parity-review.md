# Android / iOS interaction audit

**Correction:** The model-selector shortcut and preset presentation described in this earlier pass were not functionally equivalent to iOS. The [selector follow-up review](selector-parity-review.md) documents the shared implementation, corrected controls, and paired-device verification that supersede those portions of this report.

Audited September 5, 2026 on the Android 17 / API 37 emulator (1080 × 2400, density 420) and iPhone 17 Pro / iOS 26.5 simulator. This extends the [layout review](android-layout-review.md) and [initial functional validation](android-parity-validation.md). Android uses Material controls and the same sliding history interaction as iOS.

Most mutations used an isolated API, database, queue provider, and disposable account. Both devices also signed into the authorized production test account. One new, automatically expiring production conversation tested Agent behavior; existing production conversations were not edited or deleted. Credentials and recovery secrets are omitted from this report.

## Defects reproduced and fixed

1. **iOS history crash:** pinning a conversation while its native context preview dismissed crashed Fabric during row reordering. Defer native actions until dismissal completes. Rebuilt the native app and reran pin/unpin, duplicate, folder moves, trash, restore, and permanent deletion.
2. **Android edit dialog error:** selecting Edit response immediately after an anchored menu reset an Expo Compose host property to null. Separate host identities and keep keyboard-inset props consistent. Repeated edits now save without a native error overlay.
3. **Security forms unexpectedly signed out:** a wrong current password returned 401 even with a valid bearer session. Security requests now verify the session before logging out. Wrong-password passkey and 2FA forms retain the session on both devices; genuine session expiration still signs out.
4. **Hidden queued replies:** Android could remain on an optimistic parent after the server completed subsequent queued turns. Reconciliation now accepts a server leaf descended from that local turn while still protecting against unrelated stale branches. Repeated HOLD/queue/release displayed both completed replies.
5. **Truncated offline draft:** a lost acknowledgement after a partial draft write made restart discard later local typing. Persist the unacknowledged mutation identity and rebase only over that exact server mutation, retaining conflict protection for another device's edits. Verified full offline editing, force-stop/restart, cached reopening, and reconnection.
6. **Attachment removal inaccessible on iOS:** nested preview/removal buttons hid removal from the accessibility tree. Make them siblings with full 44-point hit areas. Both devices can independently preview/remove; Android preview also opens on the first tap with the keyboard present. Decorative Android symbol wrappers no longer intercept taps directly on the removal icon.
7. **Android field/back/accessibility polish:** separate security fields, label native switches and expose their checked state, use safe-area-aware deletion forms, and route system Back through local auth/security subpages.
8. **Android composer overlap:** give the composer dock an opaque themed surface so scrolling transcript text cannot appear beneath its margins and navigation inset.

9. **Pending-account deletion retained signup fields:** remount the auth form when moving between pending approval and signed-out state, while preserving the normal login keyboard handoff. Repeated registration/deletion with a second fresh disposable account returned to a clean login screen with empty fields.

## Device coverage

“Both” means the stated interaction was exercised on each platform; additional tests on only one platform are identified explicitly. This is a bounded device audit, not proof of every possible state combination.

| Area | Exercised behavior and outcome |
| --- | --- |
| Server and sign-in | Both: change instance, local password login, production password login, sign-out confirmation. iOS: invalid-password error followed by successful login. Android: recovery-code login after enrollment on iOS. |
| Disposable account lifecycle | Android: submitted registration, reached Approval needed, refreshed approval status, then permanently deleted that newly created account. Confirmation reported access ended and returned to sign-in. No production account was deleted. |
| Auth navigation | Both: create-account and forgot-password forms and return navigation. Android: system Back through login options, forgot-password, signup, and security subforms; reset-link submission reached Check your email (actual email delivery unverified). |
| Conversation lifecycle | Both: send, streamed response, stop, retry/regenerate, prior/next assistant versions. Android: suggestion submission and actual user edit/resend, including attachment removal and restoring the original branch. |
| Message menus | Both: copy, reply, edit cancellation, regeneration, delete cancellation, and branch navigation. Android: saved assistant edits, committed assistant deletion, and native text selection. iOS: committed assistant deletion and user-message cascade deletion on disposable conversations. |
| Queue | Both: queued-message visibility, editing and order synchronization. Completion tested through the deterministic HOLD provider. Android regression verifies both queued replies remain visible after completion. |
| History | Both: sliding history, chat opening, pin/unpin, rename flows (save on Android, cancel on iOS), duplication, folder assignment/removal, expiration enable/disable, trash, restore, permanent deletion, and native chat sharing. Android additionally saved a rename and created the fixture folder. iOS search/no-results/clear exercised by the saved Maestro flow. |
| Models and presets | Both: model menu and generation menus; synchronized model/preset state. Android: full catalog, search, alternate selection, lab filter, favorites filter and empty state, reasoning/verbosity choices. iOS: native preset choices, temporary and expiration controls. Android additionally sent a temporary conversation, saved it, and verified its history entry. |
| Rich transcript | Both: headings, emphasis, inline code, fenced code, list, table, quote, and external-link handoff. Android uses platform monospace. |
| Attachments | Both: native photo/file picking, upload, image preview, image sharing, PDF content viewer, attachment removal, and image send. iOS PDF send is correctly blocked without an Agent-capable model. Android: camera permission denial/retry, capture, retake, accept, send, and subsequent attached-message editing. |
| Preview controls | Android: fullscreen preview, hide-controls action, Back dismissal, and first-tap preview with keyboard. iOS: native preview and share-sheet image payload, PDF QuickLook, and dismiss. |
| Profile and security | Both: profile save, empty password-form disabled state, empty passkey list, add-passkey form, wrong-password validation without logout. iOS: complete TOTP enrollment, recovery-code display/copy/regeneration, replacement form, and disabling 2FA. Fixture 2FA was disabled again after testing. |
| Preferences | Both: Light/Dark/System, reasoning and haptic toggles, memory toggle and synchronization, automatic expiration choices, trash-retention selection, and destructive bulk-action cancellation. Android: all retention choices and account/instance status. Haptics remain device-local intentionally. |
| Offline and cross-device | Both: synchronized draft/control changes and queue changes. Android: cached history/transcript, full offline draft, process restart, and reconnect without truncation. Real Socket.IO acceptance test verifies multiple accepted offline submission receipts and preservation of an unrelated remote draft. |
| Agent | Both: production Agent conversation, workspace-failure disclosure, reasoning, tool rows, expanded arguments/error output. The production workspace service returned `fetch failed`; no generated file was produced. |
| Adaptive layout | Android phone, compact 200% text, short landscape, and wide window checks are detailed in the linked layout review. These are emulator size overrides, not separate physical devices. |

## Automated and build validation

- Mobile: **58 files / 370 tests passed**, plus TypeScript.
- Shared client core: **3 files / 53 tests passed**, plus package build. Lost-acknowledgement regression was reproduced before the fix; both own-write recovery and preservation of another writer pass afterward.
- Web: **106 files / 420 tests passed**, plus production build. The initial Node run failed 11 tests because experimental global storage shadowed jsdom storage; rerunning with `NODE_OPTIONS=--no-experimental-webstorage` passed without web source changes.
- Real Socket.IO composer-recovery acceptance script passed against the local API.
- Repository lint and whitespace validation passed.
- Android native debug build installed on API 37; iOS native incremental build passed after the Swift fix and was installed on the iPhone simulator.
- Android/iOS JavaScript exports passed. Earlier server validation was 145 files / 688 tests passed with 13 skips; this audit did not modify server code.

The [Maestro reproductions](parity/README.md) document explicit fixture prerequisites. They are stateful audit flows, not a clean-install unattended suite. Native system password dialogs sometimes disappear from automation accessibility trees; those were dismissed separately before continuing.

## Remaining limits

- Successful Agent workspace provisioning/execution and generated-file delivery are blocked by the production workspace failure. Error presentation is verified on both platforms.
- Native passkey enrollment/sign-in, biometric interaction, verified links, and certificate/domain association require configured release signing and a suitable credential environment. Form validation is covered; successful ceremonies are not claimed.
- iOS Simulator camera could open/dismiss but did not return a captured photo. Real iPhone capture, full TalkBack/VoiceOver traversal, physical haptics, pinch-zoom/multi-image paging, and all external share targets remain unverified.
- Actual password replacement, email reset delivery, invite redemption, timed expiration after waiting the full period, and background cleanup/payment side effects were not exercised end to end. No production account deletion or bulk production deletion was attempted.
