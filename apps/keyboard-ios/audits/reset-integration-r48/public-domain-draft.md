# R48 draft public domain for independent challenge

This is an unsealed semantic draft, not a payload or a product result. It must
be independently challenged and calibrated before a source-blind author uses
an approved version. Do not read old R45 cases to design new cases.

Use a standalone Swift executable importing public KeyboardCore and Foundation,
with fresh unique temporary directories and no dictionaries or devices.
Public API: `TouchModel(url: URL?)`, `weight: Double`, `offsets: [KeyPoint]`,
`persistenceResult: LearningPersistenceResult`, `isLearning: Bool`,
`learn(_: TypedWord, intended: String, geometry: LetterGeometry) -> Bool`,
`save(inBackground: Bool = false) -> Bool`, and
`reloadIfChangedOnDisk() -> Bool`. `LearningPersistenceResult` exposes
`rawValue`; `.ok`, `.invalid` and `.busy` are distinct observations.
`TypedWord(text: String, taps: [KeyPoint?])`, `KeyPoint(x:y:)`,
`LetterGeometry.qwerty.center(UInt8)` and `TextNormalizer.key(String)` are
public. Persistent models use a fresh `TouchModel.json` URL. No learning
result, count or zero projection is available unless its read status is `.ok`.

Normalization is lowercasing, compatibility decomposition, removal of ASCII
apostrophe and U+2019, and removal of Unicode nonspacing-mark scalars. It is
**not full Unicode case folding**. For all-ASCII input, lowercasing A-Z and
removing ASCII apostrophe suffices; other bytes, including NUL, remain. For
non-ASCII input, use Swift String lowercased() and Foundation compatibility
decomposition in that order, then the scalar removals just stated. Do not
replace this with locale-specific folding, canonical-only decomposition,
removal of every mark category, removal of all punctuation or an ASCII-only
output assumption. Normalization need not be idempotent for all Unicode.

Typed-word point alignment is by original Swift Character positions. For each
Character independently, its normalized UTF-8 bytes each receive that
Character's optional point; missing points stay nil. An intended target uses
normalization of the complete String. Alignment requires equal byte counts,
not equal spelling; contextual lowercasing can therefore matter. Only target
ASCII a-z bytes with an available aligned point and geometry center produce
samples. Nonletter bytes do not produce samples. Extra taps beyond original
Character positions are ignored. A Character which normalizes into several
bytes duplicates its point at those positions; do not assume each byte is an
ASCII letter. No unmeasured position invents a point.

Intent: local nil-URL models accept aligned, nonempty finite learning for
normalized target byte lengths at least two, with no global word-length cap.
Persistent operations accept at most 40 actual contributing samples, independent
of target length; zero samples and more than 40 reject. Only contributing
nonfinite displacements reject. Learning off, mismatch, too-short target and
empty/tapless contribution reject without teaching. Persistent rejection
must not modify settled prior state or files. Construction/migration and
earlier accepted work must be settled before measuring this boundary.

Successful durable operations save/reopen with the same full weight and 26
offsets as the equivalent local sequence. A fresh read must explicitly report
`.ok`; busy is unavailable, not an empty model. Save may flush previously
accepted work. Persistent operation capacity is per call, not per spelling or
model lifetime. Per-key weights decay at 300; do not assume arbitrary repeated
same-key learning has weight equal to sample count. Existing update formula,
clamp and final cap are conserved; prefer full-state equivalence relations
over inventing a new formula. The diagnostic status may change on rejection.
