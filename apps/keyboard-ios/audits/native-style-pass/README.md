# Native iOS keyboard style pass

Built on `eb54d465`, including the user's move of language selection to app Settings.
The comparison uses Apple's English keyboard and Pulpo in the same Try It editor
on one fresh iPhone 16 simulator running iOS 27.0.

The pass changes three rendering files:

- Match the sampled light keyboard background (`226, 227, 232`) and soften
  continuation text to the native prediction-strip gray in each appearance.
- Use 22pt uppercase and 24pt lowercase letters in modern portrait layouts;
  retain existing landscape and legacy letter sizes and all grid dimensions.
- Give the modern `#+=` switch its smaller 14pt label, retaining 16pt on legacy iOS.
- Fill the Delete symbol while pressed, keep action-return text white on blue
  while held, and fade blank key caps during the space-bar trackpad interaction.

Key geometry, hit targets, gestures, language selection, engine behavior and
Pulpo's emoji/dictation controls remain in place. This is a visual approximation
using public UIKit fonts and symbols, rather than a pixel-equality assertion
against private system keyboard rendering.

## Validation

`final-light-summary.json` records 51 passing tests with no skips or runtime
warnings: the three new state checks, real app page transitions, native reference
captures, and existing key-touch, Shift and accent-strip checks.
`final-dark-summary.json` records five passing tests with no skips or runtime
warnings. These runs overlap; their counts are not unique test totals.
The final source build also passed all three state tests plus simulator Settings
setup (four tests). `installed-settled-summary.json` records three passing tests:
the real installed extension accepting taps, autocorrection and a multi-point
swipe, followed by the revised explicit native-reference and Pulpo page drivers.
No tests were skipped and no runtime warnings were reported in these runs.
The installed-extension tap/autocorrect/swipe test also passed in dark appearance
(`installed-dark-summary.json`, one test, no skips or runtime warnings).

The state tests explicitly resolve UIKit's light and dark traits. Screenshots
include uppercase and number pages for both keyboards in each appearance. The
native trackpad reference was captured externally while a real seven-second
space-key hold was active; its original diagnostic test also verified that the
field text stayed `hello`. Pulpo's fade/restore transitions have a separate
component regression test.

The native-reference driver explicitly selects English if Pulpo is active and
verifies Apple's `more` key plus the absence of Pulpo's key identifier before
labeling a capture as native. The installed driver dismisses the iOS input-mode
menu before taking coordinates, preventing a tap from landing on that menu.

`validation.json` binds source hashes and lists retained diagnostic attempts.
Full xcresults, exported attachments, opaque build logs and temporary typography
probe results remain in `/tmp/pulpo-native-style`. Successful build logs were not
read. Screenshot captures are review artifacts, not an accuracy benchmark or a
physical-device usability study.
