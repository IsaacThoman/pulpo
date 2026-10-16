# R22 sealed heldout authorship

Independent author prepared 12 synthetic, pairwise target-disjoint cases: 6 ordinary closing-punctuation cases and 6 safety cases. Targets comprise 6 everyday English and 6 everyday Spanish words, all absent under casefold from the supplied exclusion targets. All 12 cases are intended for each actual EN/ES/BI lexicon, yielding 36 required rows; unavailable suggestions remain in the full denominator. No dictionary availability was inspected or assumed.

Only protocol.md and exclusions.json at the assigned completion-punctuation-r22 audit directory were read. No source, dictionary, tests, development cases, outcomes, results, or history were inspected. The supplied exclusions intentionally over-exclude; freshness is bounded by their listed artifacts and is not an absolute novelty claim. File names listed inside exclusions were not opened.

The schema carries exact expectedAfter and expectedCaret; all strings are simple NFC, so Python code-point caret counts equal Unicode grapheme counts for these documents. Prefix and suffix preservation is explicit. Closing punctuation joins only with whitespace/end or an entirely closing run. Punctuation-led following tokens and an ambiguous quote keep a separator; existing whitespace is kept without an added separator. One end-selection task includes exact insertion and backspace expectations.

Heldout SHA256: 8f2f103888fd6426e69c554b064252645eb5da1735faa14b8e08b477884a1686
Protocol SHA256: e3d2f3f7ed80094b1805a9640c94805548809b8de39bc7be32718128e02b97b1
Exclusions SHA256: 23ef61ed64a0db885838c64b407186fc2adf2c8b9917be10070d6b0b582a92bf

Sealed JSON: /private/tmp/r22-sealed-heldout.json
Authorship: /private/tmp/r22-sealed-authorship.md

Contents and target names are withheld until the parent explicitly requests reveal after candidate and runner freeze. No source edits, devices, deployment, or commits were performed.

Supplemental exclusion verification: reread only the updated assigned protocol and exclusions plus own sealed JSON/authorship. All 12 targets were checked case-insensitively against all recursively collected JSON string values in the expanded exclusions. Zero collisions. The sealed JSON was retained byte-for-byte; no heldout execution or source/dictionary/test/results/history inspection occurred. Updated exclusions SHA256: 15741750b3c0ea4596865eafef62461c1cd0b37662bb46d1899e7cf4fb238f1f.
