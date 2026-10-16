# R36 — emoji query editing contract

This narrow public-API experiment concerns `EmojiSearchQuery`, not catalog search
ranking, language models, document insertion or the separate R34 emoji candidate.
The existing public maximum is 40 Swift `Character` values (extended grapheme
clusters). It is a character limit, not a byte/scalar memory bound.

Public operations are `init(String)`, `append(String)`, `deleteBackward()`,
`deleteWordsBackward(Int)`, `clear()`, and read-only `text` / `isEmpty`.
Initialization starts empty and applies the append behavior below.

Append iterates the incoming String's Swift Characters as segmented before this
append. For an incoming Character with `isWhitespace == true`, use exactly U+0020;
skip it only when stored text is empty or its last whole Character is exactly
`Character(" ")`, not merely whitespace. Otherwise use the incoming Character's
exact scalar sequence. Form a tentative whole-string concatenation; accept if its
newly segmented Character count is at most 40, even if the current count is already
40. On the first nonfitting Character, stop this call; never split it or inspect
later input. A later append is a new operation. Do not retroactively normalize
existing storage. Capacity holds after every operation. Initialization is one
append to empty; arbitrary chunking need not be equivalent because incoming
Character boundaries can differ. Whitespace plus a mark in one incoming Character
may normalize away the mark; a separately appended mark remains stored.

Backspace removes one whole final Character, and is inert on empty text.
Delete-words repeats `max(0, count)` times: remove suffix Characters exactly equal
to U+0020, then the maximal suffix not exactly equal to U+0020, then any remaining
exact-U+0020 suffix. Negative/zero counts do nothing; an exhausted buffer stays
empty. Clear empties the buffer. Neither operation
has document, history or catalog side effects; those integrations are outside
this experiment.

The executable input is `schema.json`. Each case supplies initial text, its exact
expected initial buffer, and a nonempty ordered action list. Every action includes
an exact expected buffer; comparison uses Unicode scalar sequences, not merely
Swift's canonically equivalent String equality. Expected emptiness is derived
from that literal buffer. All initial/action checkpoints stay in the denominator.
Case identifiers are unique. `append` alone has `value`; `deleteWords` alone has
integer `count`; other actions have neither.

An independent author sees only these exact contract/schema bytes, public operation
names and runtime semantics; no implementation, candidate, development inputs or
results. Author 12–18 small, distinct stateful cases spanning capacity/recovery,
normalization, word deletion, empty operations, and Unicode boundary composition.
Avoid a collection consisting solely of case or accent variants. Save immutable
payload outside the repository and report only its SHA256/counts before reveal.
Smoke the executor using separate arbitrary public examples. Freeze the candidate,
executor and comparison after independent source review, then reveal once. Do not
retune production or expectations afterward. Retain all paired outcomes, including
failures/unavailability and any oracle ambiguity. Repeated checkpoints/language
examples are not independent users or accuracy observations.

Acceptance requires exact candidate buffers at every checkpoint and no regression
from any baseline passing checkpoint; no catalog or host-text behavior changes.
This checks query editing correctness, not Spanish retrieval, overall typing
accuracy, Gboard superiority, native latency or physical-device usability.
