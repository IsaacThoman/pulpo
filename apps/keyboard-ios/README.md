# Pulpo Keyboard

Pulpo Keyboard is a native iOS keyboard (iOS 18 and later, iPhone) with slide-to-type,
on-device autocorrect and next-word prediction, emoji, and Pulpo dictation. It is a
separate app from Pulpo Mobile and is written in Swift with no React Native, because
keyboard extensions get a small memory budget (roughly 50–70 MB) and must start instantly.

## Layout

| Path | What it is |
| --- | --- |
| `PulpoKeyboardKit/Sources/KeyboardCore` | Platform-free engine: dictionary reader, spell correction, language model, swipe decoder, typing state machine, layouts, emoji catalog, settings, and the dictation bridge. Tested on macOS with `swift test`. |
| `PulpoKeyboardKit/Sources/KeyboardUI` | UIKit keyboard: key grid and touch handling, popups, swipe trail, suggestion bar, emoji and dictation panels. Shared by the extension and the app's in-app preview. |
| `PulpoKeyboardKit/Sources/PulpoServices` | Pulpo API client (login, account, dictation upload) and Keychain session storage. App only. |
| `Extension/` | The keyboard extension (`com.isaacthoman.pulpo.keyboard.extension`). |
| `App/` | The companion app: setup, sign-in, settings, Try It, and the dictation recorder. |
| `LanguageData/` | English, Spanish and bilingual dictionaries and emoji catalog (`emoji.json`). |
| `UITests/` | Simulator UI tests, including Settings automation that enables the keyboard. |
| `scripts/` | Data build script and a stub Pulpo server for dictation tests. |

The Xcode project is generated with [XcodeGen](https://github.com/yonaskolb/XcodeGen) from
`project.yml` and is not checked in.

## Develop

```bash
brew install xcodegen
cd apps/keyboard-ios
xcodegen generate
open PulpoKeyboard.xcodeproj
```

From the repository root, `npm run keyboard:test` runs the engine tests and
`npm run keyboard:build` builds the app for the simulator.

The app icon references the shared `apps/mobile/assets/PulpoKeyboard.icon`
Icon Composer asset. Build with Xcode 26 or later and XcodeGen 2.45.1 or later;
Xcode also generates raster icon variants for iOS 18 from this asset.

The app opens a setup guide on first launch. It checks each step live, explains Full
Access and privacy, and confirms setup when you switch to Pulpo Keyboard in its field.
Reopen it from Setup on the home screen. To set the keyboard up manually on a simulator
or device, run the app, then in Settings go to
General › Keyboard › Keyboards › Add New Keyboard, pick Pulpo Keyboard, open it and
turn on Allow Full Access. The app's Try It screen also has an in-app preview that runs
the same keyboard inside the app without enabling it.

## Install a Release build on an iPhone

From the repository root, explicitly select the keyboard target:

```bash
PULPO_IOS_APP=keyboard npm run deploy:iphone
```

This builds the standalone `PulpoKeyboard` scheme in Release, verifies the app
and embedded keyboard identifiers plus current emoji/dictionary resources, then
installs and opens `com.isaacthoman.pulpo.keyboard`. Set `PULPO_IOS_DEVICE` to a
paired device name or UDID to override the default `Isaac iphone`. Build output
uses a separate keyboard cache; logs are printed only if deployment fails.

## How it works

**Touch routing.** The extension paints an opaque keyboard background. Transparent
pixels in its remote view otherwise swallow gap taps before UIKit receives them.
The grid resolves gaps and outer margins by distance to the nearest visible key cap,
and unused suggestion-bar space and the preview's bottom bezel forward to the grid.

**Typing.** `KeyboardEngine` owns shift and caps lock, sentence capitalization, the
double-space period, curly quotes, automatic spaces after swipes and suggestions, and
autocorrection. It edits through a small `TextDocument` protocol, so it runs the same
against `UITextDocumentProxy`, a `UITextView`, or a test double.

Sliding left from delete selects whole words. The suggestion bar previews them,
lifting deletes them, and an Undo chip restores them. A delete that would undo an
autocorrection waits for the lift, so a swipe that starts there never teaches the
typo. Long-press strips open away from the screen edge with the first option over
the key. Phone fields get a `+*#` page, and holding 0 types `+`.

**Autocorrect and prediction.** The dictionary is a memory-mapped trie of 160k words.
`SpellCorrector` runs a weighted Damerau-Levenshtein search over it where substitution
costs come from how far each touch landed from the intended key. An unknown token can
be split into two words when a space was missed or landed on the letter row above the
space bar. A space tap at the top edge of the space bar can be read back as the
bottom-row letter above it. Per-key tap offsets learned from kept words adapt the
typo model to the person; they are cleared with learned words. `Suggester` combines
that with an interpolated bigram/trigram language model and the person's learned words; a typed word is only
replaced when the correction is clearly more likely. Deleting right after an
autocorrection restores the typed word and stops correcting it. Contacts' names and iOS
text replacements come from `UILexicon`. Apostrophes, accents, internal capitals, and
low-confidence names are preserved. Contextual continuations also feed completions;
unknown histories fall back to frequent safe words.
Known names and acronyms are valid regardless of case. Changing a valid word
requires directed touch evidence; centered or absent touches keep it literal,
with alternatives still available in the suggestion strip.

**Slide to type.** `GlideDecoder` picks candidate words by the letters nearest the start
and end of the swipe, rejects any whose letters the finger never passed in order, and
scores the rest on letter alignment, how much of the path the word explains in order, unexplained
sharp turns, extra length, and the language model.
Frequency-ordered endpoint buckets are merged by endpoint likelihood and word
frequency, so a noisy endpoint cannot exhaust the budget before nearby buckets
are searched. Letter alignment is calibrated for word length. Touch timestamps add timing
evidence: letters are expected where the finger slowed, not in fast transit,
and unexplained pauses count against a word. Without usable times the decoder
is purely spatial. A fast lift may overshoot the last letter along the final stroke.

**Learning.** Words the person types twice, or keeps by undoing a correction or picking
the quoted literal, become valid. Learned words and word pairs are stored on device in
the App Group and can be cleared in the app. Decoder choices are learned only when
accepted by another edit or keyboard dismissal, so undo and swipe alternatives do not
reinforce discarded results. Nothing is learned in password, username,
one-time code, email, URL, or other private fields. A dictionary word typed once
is already offered as a completion, and habitual sentence openers replace the
default ones. `I` and names keep their capitals when learned.

**Emoji.** The picker keeps full glyphs inside its grid in portrait and compact
landscape, with recent choices and remembered skin tones. The suggestion bar also
matches English Unicode names, prefixes and CLDR keywords: `pizza`, `happy`,
`thanks`, `thumbsup` and `red heart`, for example. One emoji choice shares the bar
with the typed word and its strongest correction; space never applies an emoji.
Tapping replaces only the matching unfinished phrase. After a committed space,
it appends the emoji while preserving the words. Names and keywords are indexed
once off the typing thread, using only glyphs supported by the current OS.
Private, email, URL, numeric and identifier contexts suppress these suggestions.
Choices from earlier edits or fields cannot replace newer text while the bar
refreshes. Keyword sources and licenses are in [LanguageData/README.md](LanguageData/README.md).
Search Emoji in the picker opens a search row above the letter keys. The query stays
in the keyboard until a result is tapped, multi-word queries narrow in any order,
and recent then popular emoji break ties.

**One-handed keyboard.** Touch and hold the emoji key, slide to a layout docked left or
right and lift. Docked keys keep about 82% of the width, at least 332 points; side controls
expand the keyboard or move it to the other edge. The choice is remembered and is also
in the app's settings. Landscape always uses the full width. Key geometry, swipe decoding
and tap correction all come from the narrowed grid.

**Dictation.** iOS doesn't let keyboard extensions use the microphone, so the mic key
opens the app, which records, uploads the audio to Pulpo's
`/api/dictation/transcriptions`, and hands the transcript back through the App Group
(`DictationBridge`, with Darwin notifications as wake-ups). The person returns to their
app with the system back button and sees a live level meter in the keyboard. Afterwards
the app keeps the microphone running on standby (5 minutes by default, configurable) so
the next dictation starts without leaving the current app. The session token stays in
the app's Keychain; the keyboard extension never makes network requests.

**Full Access** is needed for dictation, haptics, and reading shared settings. Without
it the keyboard still types, corrects, predicts and swipes using defaults (English).

Choose English (the default), Español, or English + Español in the app's Typing
Language setting. Bilingual mode
accepts both vocabularies; Spanish mode gives stronger Spanish-only suggestions.
Accents and ñ are available by holding a letter. All three modes work offline;
the choice does not change dictation. Source attribution, reproducible data builds,
bundle costs and known ranking limits are in [the multilingual data notes](LanguageData/MULTILINGUAL.md).

## Tests

```bash
cd apps/keyboard-ios/PulpoKeyboardKit && swift test -c release --no-parallel
```

The suites run serially so their timing checks do not compete with other swipe
benchmarks. Covers dictionary loading, spelling and literal-preservation cases, contextual predictions,
the typing state machine, a full personal dictionary, and independent noisy swipe sets.
For the reproducible quality audit and Gboard comparison, see
[the keyboard quality audit](QUALITY_AUDIT.md).

UI tests run on a simulator:

```bash
cd apps/keyboard-ios
# Headless simulators can report an attached hardware keyboard and hide all
# software keyboards. Target only the test simulator (use its actual UDID).
python3 scripts/simulator_keyboard.py YOUR_SIMULATOR_UDID
xcodebuild -project PulpoKeyboard.xcodeproj -scheme PulpoKeyboard \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro' test
```

The preparation helper uses CoreSimulator on the Mac and does not ship in the
app. Add `--enable-hardware` to restore the simulator's hardware keyboard.

`KeyboardSetupTests` enables the keyboard with Full Access through the Settings app
(run it once per simulator first). `TypingTests` types, swipes, long-presses and picks
suggestions on real key views in the in-app preview; `InstalledKeyboardTests` does the
same through the installed extension in a system text field. `KeyTouchTests` drives
UIKit touch callbacks with deterministic overlapping contacts to cover rolling typing,
spaces, delete ordering, batched events, drift after a key has committed, and routing
gaps and empty keyboard padding to the closest visible key. Preview and installed
keyboard tests also tap between caps and in the surrounding margins.
`AppearanceTests` saves
screenshots of every page and field layout. `DictationTests` and `BounceDictationTests`
need the stub server (`python3 scripts/stub_pulpo_server.py`) and microphone permission
(`xcrun simctl privacy <device> grant microphone com.isaacthoman.pulpo.keyboard`).
Set `TEST_RUNNER_PK_SCREENSHOT_DIR` to also write the screenshots as PNGs.

Swipes in UI tests use XCTest's event synthesizer (`UITests/Support.swift`) because
`XCUICoordinate` only drags in straight lines.

To compare slide-to-type with another keyboard, `SwipeBenchmarkTests` decodes a JSON
file of swipe paths (`PK_BENCH_PATHS=paths.json swift test --filter SwipeBenchmark`)
so the same paths can be replayed into, for example, Gboard on an Android emulator.

Recorded human gestures are audited separately from synthetic center paths.
Download `swipelogs.zip` from [How-We-Swipe](https://osf.io/sj67f/) to a directory
outside the checkout, then prepare fixed participant-disjoint samples:

```bash
python3 apps/keyboard-ios/scripts/prepare_human_swipes.py /tmp/swipelogs.zip /tmp/human-swipes
cd apps/keyboard-ios/PulpoKeyboardKit
PK_HUMAN_SWIPES=/tmp/human-swipes/verify.json \
  PK_HUMAN_REPORT=/tmp/human-swipes/result.json \
  swift test -c release --filter HumanSwipeAuditTests
```

Use `develop.json` for experiments, freeze the implementation, then evaluate
`verify.json`. `PK_HUMAN_BASELINE` optionally asserts that an identically ordered
gesture set does not lose first-choice or top-three accuracy. Keep archives,
prepared gestures, per-case reports, screenshots, and build products outside Git.
The checked-in audit records source checksums, aggregate results and tradeoffs.

## Language data

`LanguageData/` is generated by `scripts/build_language_data.py` from:

- AOSP LatinIME `en_US_wordlist.combined.gz` (Apache 2.0): words, frequencies and spelling shortcuts.
- Tatoeba English sentences, `eng_sentences.tsv.bz2` (CC-BY 2.0 FR): next-word statistics.
- Almeida & Hidalgo, [SMS Spam Collection](https://doi.org/10.24432/C5CC84), UCI (CC BY 4.0):
  optional conversational n-grams. Only deduplicated ham messages are used; a stable
  20% holdout is excluded from training. The compiled dictionary uses this input.
- [Amazon Topical-Chat](https://github.com/alexa/Topical-Chat) `conversations/train.json`
  (CDLA-Sharing 1.0): aggregate statistics from human conversation. Only the published
  training partition is used, with validation/test partitions reserved for evaluation.
- Unicode `emoji-test.txt` (Unicode License v3): emoji, order and skin tones.

`scripts/extra_words.tsv` and `scripts/extra_shortcuts.tsv` add newer words and safe
contraction fixes. `LanguageData/en_US.validwords.txt` adds accepted literal spellings
from the pinned American ESDB spelling list. This supplement adds no word IDs,
language-model priors, correction targets, predictions, or glide buckets. Personal
learning still applies to words the user accepts.
The full builder includes this resource by default; `--validation-wordlist` can select
a different spelling-list input. To rebuild:

```bash
python3 scripts/build_language_data.py \
  --wordlist en_US_wordlist.combined.gz \
  --sentences eng_sentences.tsv.bz2 \
  --emoji emoji-test.txt --messages SMSSpamCollection \
  --conversations train.json
```

Source versions and checksums are recorded in [LanguageData/README.md](LanguageData/README.md).
To append the literal-only section without rebuilding any existing language tables:

```bash
python3 scripts/build_validation_words.py \
  --dictionary LanguageData/en_US.pkdict --words LanguageData/en_US.validwords.txt \
  --output /tmp/en_US.pkdict
```

The appender preserves every existing section payload and replaces the output
atomically. Review the output before replacing the bundled dictionary.
Test the importer with `python3 -m unittest discover -s scripts -p 'test_language_data.py'`.
Test the literal-only importer with `python3 -m unittest discover -s scripts -p 'test_validation_words.py'`.
Export an independent prediction corpus with
`python3 scripts/prepare_prediction_holdout.py --input test_freq.json --exclude train.json --output /tmp/keyboard-test.json`.
From `PulpoKeyboardKit`, evaluate with
`PK_PREDICTION_HOLDOUT=/tmp/keyboard-test.json swift test -c release --filter evaluateExternalPredictionHoldout`.
Use `PK_HOLDOUT_DICTIONARY` to compare an earlier binary and `PK_HOLDOUT_REPORT` to
export per-case results outside the checkout.
