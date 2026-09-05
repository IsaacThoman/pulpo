# Android layout and interaction review

**Correction:** The model-selector shortcut and preset presentation described in this earlier pass were not functionally equivalent to iOS. The [selector follow-up review](selector-parity-review.md) documents the shared implementation, corrected controls, and paired-device verification that supersede those portions of this report.

Reviewed September 5, 2026, using the authorized production test account on
`https://pulpo.baby`. This supplements the earlier isolated-fixture functional
checks in [Android parity validation](android-parity-validation.md).

## Review matrix

| Configuration | Checks completed |
| --- | --- |
| Android 17 / API 37, 1080 × 2400, density 420, normal text | Production sign-in; model quick switching, catalog search and lab filter; real conversation reading and scrolling; generation choices; message menu; text-selection handles; history; settings and profile keyboard layout. |
| Compact 840 × 1800, density 420 (320 dp wide), 200% text | Header icons, expiration badge, scrollable landing content, composer, multi-line history titles and dates, New chat button, short model menu, catalog with keyboard. |
| Wide 1600 × 2560, density 240 (1067 dp wide) | Persistent history, conversation text and tables, vertical scrolling, contextual message actions, full-screen text selection, bounded settings and profile form with split keyboard. |
| Short landscape 2400 × 1080, density 420 | Persistent history, landing content, full-screen catalog, reachable list and filter controls. |
| iPhone 17 Pro / iOS 26.5 | Launch and visual smoke check against the existing isolated fixture; iOS bundle export. |

The display-size overrides exercise responsive breakpoints on one Android
emulator; they do not represent testing on separate physical devices. Normal
phone size, density, and text scale were restored after the review.

## Improvements made

- Replaced Android icon-font rendering with native vector symbols. Icons keep
  their geometry at large text sizes and no longer expose glyph code points as
  accessibility labels. Resolved semantic resource colors before passing them
  to the Compose bridge.
- Limited quick model switching to the current selection and ordered favorites,
  with five choices maximum and a first-position catalog action. The complete
  catalog supports search, lab filtering, and favorites filtering.
- Used a full-screen catalog on phones, short windows, and large-text layouts.
  Its results remain above the keyboard. Wider windows retain bounded dialogs.
  Disabled native child clipping in the catalog list to prevent missing rows
  inside dialog hosts.
- Made buttons grow with their labels, increased history touch targets, and
  stacked dates below multi-line chat titles at large text sizes. Long settings
  values also stack instead of competing with their labels.
- Moved the Android expiration badge into the landing layout and made short or
  large-text landing content scrollable. Compact generation controls leave room
  for attachment, Agent, and Send controls.
- Retained the sliding conversation/history interaction. The fully closed
  history panel is removed from layout and the accessibility tree. Verified
  toolbar opening and swipe closing; Android's system edge Back gesture retains
  its normal behavior.
- Added a message-menu Select text page with Android selection handles and
  Copy/Share/Select all. Normal message rendering leaves text selection to that
  explicit action. Verified vertical scrolling after navigation settled.
- Used Android's monospace font for code. Disabled the composer's fullscreen
  IME extraction mode so landscape typing can retain the app's own controls.
- Added keyboard avoidance to Android authentication and settings forms.
  Profile editing now uses a normal Android screen, with separated field/Save
  controls and an empty-name disabled state. Its covered account screen is no
  longer exposed underneath a form-sheet route.

## Validation

- Mobile: 58 test files, 364 tests passed, including quick-model ordering,
  dialog sizing, and semantic icon-color regressions.
- Mobile TypeScript, repository lint, and `git diff --check` passed.
- Final Android and iOS bundles exported successfully.
- Android JavaScript changes were exercised in the installed native debug app.
- Existing production conversations were read without sending, editing,
  deleting, or regenerating their messages. Profile changes were not saved.

This pass does not replace physical-device testing, a complete TalkBack audit,
or release-signed passkey/App Link validation. The new landscape IME option was
typechecked and bundled; the final keyboard checks cover portrait and
wide layouts. Generation and queue lifecycle checks remain documented in the
earlier fixture report.
