# iOS composer height — September 10, 2026

## Reproduction

Tested the actual mobile composer on an iPhone simulator running iOS 27.0.
The original JavaScript was built from `a9f42f58`.

1. Connect the simulator and a second Socket.IO client to the same disposable local account.
2. Populate the `new` draft with twelve lines through `composer.write`.
3. Type a character in the simulator so the native field expands to its limit.
4. Clear the draft from the second client using its current revision.

The original composer displayed its empty placeholder but retained the expanded
height. This confirms that clearing the content and remeasuring the native field
can get out of step; a local delete handler alone would not cover the failure.

## Fix and verification

When the controlled draft is empty on iOS, explicitly size the existing input to
one line, respecting its minimum height and capped font scaling. Nonempty drafts
retain automatic sizing and the existing maximum height. The input stays mounted.

- The reproduced remote clear now returns the composer to its starting height,
  with the software keyboard and caret still present.
- Select All → Delete clears an expanded draft and restores the starting height.
- Typing eight lines on the software keyboard, then backspacing through all of
  them, expands and collapses correctly. The composer can expand again afterward.
- The same keyboard grow/delete cycle passes at the first accessibility text-size
  category. The normal and temporary placeholders fit at the capped font size.
- Mobile tests: 618 passed. Mobile TypeScript and repository lint passed.

The sync check used the existing disposable local signup QA instance. No model
requests or physical-device deployment were performed. Raw screenshots, bundles,
and build logs are excluded from the repository.
