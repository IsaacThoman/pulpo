# R25 blind author validation

Status: PASS_STATIC_BLIND_VALIDATION. The sealed UTF-8 JSON array contains 36 newly authored cases: 30 scored and 6 explicitly ambiguous diagnostics. Each of en, es, and bilingual has 12 cases (10 scored, 2 diagnostic).

The received contract bytes match SHA256 `79ccef3f6d12c39cdd6b8289b3319aa1aa4b4346c17d1ba2d0d09ccab2422644`; the exact bytes are copied to `/private/tmp/pulpo-r25-sealed/contract-received.txt`. The heldout array is sealed at `/private/tmp/pulpo-r25-sealed/heldout.json`, SHA256 `6a497c16237d5de26e09759b08707dfa3fe54a80b3239e8c266e9e01633016a9`. Author metadata is private beside it and reproduced without lexical payload in `heldout-seal.json`.

Validation used an independent primitive string simulator and Swift Foundation Character segmentation. All 36 schemas, unique IDs, action field types, operation `kind` discriminators, action bounds, full expected documents, required carets, and authored selections passed. The simulator includes a final flush for every row. Multi-scalar inherited graphemes occur in both prefix and suffix; every physical string edit is rechecked for grapheme segmentation. Default initial capitalization, manual Shift, and double Shift expectations were checked explicitly.

Twelve intended fresh-word correction paths were checked for contiguous direct-tap ownership at a whitespace/start boundary and scalar-exact inherited prefix/suffix conservation during deletion and insertion. Three immediate Undo paths remove the correction plus exactly one ASCII separator, restore the original typed source, preserve inherited contexts at every primitive, and end with the caret directly after the restored source. These checks validate authored oracles, not keyboard implementation behavior.

Controls cover inherited-prefix/midword source, literal inserted text, nonzero selection, reported cursor movement, silent current-destination movement, reported identical host replacement, changed host context with and without callback, password/email/URL field policy, non-Space Return, and valid-word caps lock. Two diagnostic rows per language remain outside the scored 30. The case operations require no unsupported swipe synthesis or device state.

All intended typo/correction target pairs were privately checked against exclusions and the sealed R16 lexical vocabulary. No targets overlap. R16 SHA256 matches the requested seal; its input is incompatible with the new required full-caret contract, so no R16 rows were reused or adapted. R16 contents remain undisclosed.

No production/development/results files were read and no keyboard, model, corrector, decoder, fuzzer, native app, or device was executed. This is static author validation only: actual lexical acceptance, timing implementations, and candidate/gate approval remain for the parent after its required freeze. Public audit artifacts contain no lexical payload. No commit, push, or deploy was performed.
