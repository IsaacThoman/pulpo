# R36 independent domain/preflight review — approved for authoring

Disposition: APPROVE the revised exact contract/schema for independent authoring and a later candidate/executor review. This is not candidate acceptance, an executed benchmark, or authorization to reinterpret any prior rejected round.

Approved/re-read SHA-256 identities:

- contract.md: `83e53e1cf51c34475b9dbab283a15f8fabc48b70d046f8b1f20ec475f2ae6c43`
- schema.json: `d648a8e11f09c4eeff093fc07bdd6330cea7f52e6f5d00a204b50e5e019eb92e`

## Pre-author chronology

The initial proposed contract `aab88bc0ebfabbbe05744e825e9cf3df36f99304154b1c7acd4bb58b7ecf3d59` and the same schema were read/hash-confirmed against current public `EmojiSearchQuery` source and existing query-editing tests, before any production candidate, independent authoring or sealed input. Source review identified an ambiguity involving joined whitespace graphemes. Small standalone Foundation/Swift segmentation commands confirmed the language behavior below; no keyboard/core package or native build was run.

The reviewer reported the ambiguity rather than selecting an expectation after a candidate result. Root accepted preserving the exact existing normalized-input versus joined-storage semantics, clarified the contract before authoring, and returned the revised hash. The reviewer re-read the full revised bytes and approved them. Schema bytes did not change. No candidate implementation/executor or sealed case was created/read in this review. All witnesses here are now exposed development controls.

## Decisive exposed witnesses

Swift Character segmentation/property observations:

- `" \u{0301}"` has one Character, scalars U+0020/U+0301, and `Character.isWhitespace == true`; it is not the plain ASCII-space Character.
- Standalone U+0301 has one nonwhitespace Character.
- CRLF is one whitespace Character, so incoming normalization can consume both scalars as one ASCII space.
- Three regional indicators A/B/C segment into two Characters: AB and C. Incoming BC alone segments into one Character. Appending a presegmented incoming Character across an existing boundary can therefore resegment the whole string; scalar-wise acceptance or assuming counts simply add is incorrect.
- ASCII space followed by a separately appended ZWJ can be one whitespace Character with two preserved scalars. Normalizing incoming whitespace is different from retroactively normalizing storage.

Source-derived public-API witness (not a production execution): initialize `"x "`, append standalone U+0301, then append tab. Current suppression compares the last whole Character to exactly plain ASCII space, so the joined decorated space does not suppress the next normalized space: stored scalars are x, SPACE, acute, SPACE. Word deletion likewise recognizes only an exact plain-space Character as separator. Initializing `"x \u{0301}"` in one call instead normalizes the incoming whitespace-plus-mark Character to plain space, dropping its mark. These behaviors expose ambiguity in an unqualified “collapse repeated whitespace” requirement and disprove arbitrary chunking equivalence; they are explicitly resolved by the approved contract.

## Approved executable semantics

Iterate the incoming String's Characters as segmented before the append. Normalize an incoming whitespace Character to U+0020 and suppress it only for empty storage or a last whole Character exactly equal to plain ASCII space. Otherwise retain the incoming Character's exact scalars. Check the tentative entire concatenation's freshly segmented Character count before accepting it. Allow fitting extensions at current capacity; stop the current append at its first nonfitting Character without splitting it or consulting later input. A later append is a separate operation. Never normalize existing storage retroactively.

Initialization is exactly one such append to empty. Backspace removes one final whole Character. Each deleteWords iteration removes exact-ASCII-space suffix Characters, then the maximal non-exact-space suffix, then any remaining exact-space suffix. Nonpositive counts and exhausted buffers are inert; clear empties. The cap is 40 extended grapheme clusters after every operation, not a byte/scalar memory bound.

## Remaining implementation/executor obligations and limits

The schema correctly separates append/value, deleteWords/count and the other two operations, disallows extra fields, requires initial/action oracles and bounds case/action counts. Semantic checks still require an actual strict validator/decoder: unique IDs, exact operation-specific fields/types (including rejecting JSON booleans as integer counts), allowed count range, every required initial/action checkpoint, capacity and scalar-exact text plus derived isEmpty. Swift String canonical-equivalence equality alone is insufficient. Use matching Swift runtime segmentation for baseline/candidate and independently validate authored expected grapheme counts; record runtime identity.

No constructor-versus-arbitrary-chunk equivalence is required. No linguistic word segmentation, catalog retrieval/ranking, Spanish utility, host-document conservation/insertion, native cursor/Undo, latency, memory bound, Gboard or physical-device conclusion follows. Existing R34 catalog work is separate. Candidate changes must remain scoped to the buffer bug and preserve all baseline-passing checkpoints. Freeze/review the executor and candidate before the single reveal; do not retune after reveal. The reviewer remains available for that subsequent source/executor review.

No ROOT writes, Git actions, production/test edits, devices, package/core builds, or sealed input access occurred. This report is the only authorized temporary review artifact.
