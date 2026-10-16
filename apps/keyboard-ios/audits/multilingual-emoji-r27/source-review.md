# R27 independent source review — REJECT

Verdict frozen before sealed reveal: REJECT. Do not activate/import the candidate; preserve frozen evidence and restore production exactly. No source edit or oracle widening is proposed in this round. This review did not read or hash the sealed payload, only its already-public metadata.

Candidate: `0d46d60b213b337b9f597d8eceddfa803ecf7590`; production base: `5e5153664a97b5aafe4995efc47836470043cb1b`.
Source manifest SHA-256: `84cbd5721d7522802f342974cafac3fc1e529a3845f88b3ef4c53e043db52812`. All nine manifest paths verified. Contract/schema/development bytes match preinspection commit `e78b2840`; their SHA-256 values match independent seal metadata (`cd5c3ef2…`, `f04a1ccc…`, `f4f1790a…`).

## Decisive findings

1. **Blocking frozen-control violation, newly introduced:** one-character `q` returns 29 -> 31 results, appending 🤟 and 🧀; `z` returns 40 -> 46, appending 🦊 🥕 👞 👟 👠 🩰. The frozen contract explicitly says one-character queries retain baseline behavior and ordering, and the schema defines baseline as the entire ordered sequence. Existing first results are retained, so these examples do not prove first-screen semantic harm; they do prove a forbidden control change. Development `c` was insufficient to cover less-saturated result lists. Source cause: translated postings enter `collect(prefix:)` for every length, with no preservation branch for one-character search.
2. **Additional frozen-contract failure, inherited rather than introduced:** token order changes ordered output for `cat face` vs `face cat`, moving 🐱 from rank 1 to 6; `smiling face` vs `face smiling` also differs. Both baseline and candidate behave this way. The contract/schema require order invariance; retaining the prior phrase-priority path leaves that promise unfulfilled. This is not counted as a newly introduced production regression.
3. **Contract interaction, not the decisive rejection:** `ñ`/`Ñ` produce baseline 48 -> candidate 0 because baseline folds ñ to n and candidate deliberately preserves it. That is coherent with the explicit ñ-preservation requirement, while conflicting with blanket first-character preservation if read literally. The decisive q/z violations do not depend on resolving this interaction.

## Scope, provenance, and costs

Production changes are confined to explicit emoji search, its model/resource, and resource builder. `KeyboardEngine`, cursor/lifecycle/spacing, word dictionaries, swipe and contextual suggestion ranking are untouched. English contextual index and methods remain unchanged; localized `s` data does not enter their term index. `Emoji` gains an optional property, which also participates in synthesized Equatable/Hashable, but no misuse or regression was demonstrated.

Both pinned Spanish CLDR XML SHA-256 values match README. Running `add_emoji_search_names` on baseline catalog using those files reproduces candidate emoji.json byte for byte (`fe2c8a292b877c267080c1741b80f9467d1a57917a83f9b7a0d6b8ff6dad7886`). Removing only `s` restores baseline JSON structure exactly: same 1,923 entries, ordering, English fields, tones and versions. No hand-picked target additions found. Resource grows 48,572 bytes to 290,657 (+20.1%).

There is a second picker index plus literal-name postings and precomputed per-entry word sets. Independent optimized executions measured baseline index construction ~25–26ms and candidate ~229–246ms, consistent with the reported ~26->238ms. This is material one-time CPU work and unquantified additional memory, not a latency improvement. `KeyboardController.emojiResources` builds once per process in a detached utility task; actual iOS/native initialization latency and memory were not measured.

The term index still retains only 12 matches per term. Conjunctive fallback considers a catalog-order-sorted union capped at 800, only if the initial phrase path returns fewer than the requested count. Consequently this is bounded retrieval, not exhaustive boolean lookup. No additional independently demonstrated cap-specific regression is claimed; the source architecture limits coverage and broader usefulness claims. Added translated aliases can be truncated when competing for the same term. The present rejection does not rely on conjectured omissions.

## Actual API and privacy/empty behavior

The core API has no language setting, document context, history or network input. The UI uses one static catalog/index and `EmojiSearch.results`, so EN/ES/mixed labels are content strata, not actual mode-stack testing. No claim of independent EN/ES/bilingual engine behavior is justified or needed for this shared search.

The wrapper intentionally uses popular/recent preferences and selected tones. Empty/whitespace queries intentionally browse recents/popular. This is compatible with the contract's explicit allowance for separate panel browsing, and development notes accurately disclose the boundary. Core explicit-query tests establish a context-free local search; they do not establish that the entire wrapper is independent of recents. The wrapper is unchanged. Unknown/private-looking queries remain empty, while the fixture-only `año` row has different core fixture vs real-catalog strip output; those must not be conflated.

Case/NFC/NFD examples and selective vowel folding behave as intended in tested queries, including AÑO/año -> 🔞 in actual catalog and CAFÉ/café -> ☕. Arbitrary punctuation remains literal: coffee() changes from baseline ☕ to candidate [], as intended by the contract. Dog plus combining overlay yields [] rather than stripping it to dog. No blanket ñ/n conflation found in the candidate. No device, mode toggling, rendering/unsupported glyph filtering, Gboard or keystroke-cost comparison was performed.

## Complete changed development-row review

All 11 changed raw rows were inspected, including controls and empty-to-empty metric fields. Development totals agree with notes: useful <=8 8->15 and top3 8->15 across 15 useful rows; seven gained rows are correlated across three target families. Four useful families total; no unavailable accepted target, no useful-row regression and no lost accepted top8 alternative. These results do not rescue source-contract rejection.

Raw arrays below include every changed core result. Wrapper differences are noted separately where applicable. Unchanged rows were also checked for unchanged sequences/metrics.

- `es-heart` query "corazón": baseline []; candidate ["😍","😻","💘","💝","💖","💗","💓","💟","❣️","💔","❤️‍🔥","❤️‍🩹","💞","❤️","🩷","🧡","💛","💚","💙","🩵","💜","🤎","🖤","🩶","🤍","🫀","🥰","💕","♥️"]. First accepted rank None -> 3; accepted top8 0 -> 6.
  Wrapper baseline []; candidate ["😍","😻","💘","💝","💖","💗","💓","💟","❣️","💔","❤️‍🔥","❤️‍🩹","❤️","💞","🩷","🧡","💛","💚","💙","🩵","💜","🤎","🖤","🩶","🤍","🫀","🥰","💕","♥️"].

- `es-heart-plain` query "corazon": baseline []; candidate ["😍","😻","💘","💝","💖","💗","💓","💟","❣️","💔","❤️‍🔥","❤️‍🩹","💞","❤️","🩷","🧡","💛","💚","💙","🩵","💜","🤎","🖤","🩶","🤍","🫀","🥰","💕","♥️"]. First accepted rank None -> 3; accepted top8 0 -> 6.
  Wrapper baseline []; candidate ["😍","😻","💘","💝","💖","💗","💓","💟","❣️","💔","❤️‍🔥","❤️‍🩹","❤️","💞","🩷","🧡","💛","💚","💙","🩵","💜","🤎","🖤","🩶","🤍","🫀","🥰","💕","♥️"].

- `mixed-heart` query "red corazón": baseline []; candidate ["❤️","🫀"]. First accepted rank None -> 1; accepted top8 0 -> 1.

- `en-cat` query "cat": baseline ["🐈","😺","😽","🙀","😿","😾","🐈‍⬛","🐱","😼","😸","😹","😻","🫴","🤾","🤾‍♂️","🤾‍♀️","🪝"]; candidate ["🐈","😺","😽","🙀","😿","😾","🐈‍⬛","🐱","😼","😸","😹","😻","🫴","🤾","🤾‍♂️","🤾‍♀️","🪝","🇶🇦"]. First accepted rank 1 -> 1; accepted top8 3 -> 3.

- `es-cat` query "gato": baseline []; candidate ["🐈","😺","😸","😹","😻","😼","😽","🙀","😿","😾","🐱","🐈‍⬛"]. First accepted rank None -> 1; accepted top8 0 -> 1.

- `mixed-cat` query "gato cat": baseline []; candidate ["🐈","😺","😽","🙀","😿","😾","🐈‍⬛","🐱","😼","😸","😹","😻"]. First accepted rank None -> 1; accepted top8 0 -> 3.

- `es-party` query "fiesta": baseline []; candidate ["🥳"]. First accepted rank None -> 1; accepted top8 0 -> 1.

- `mixed-party` query "party fiesta": baseline []; candidate ["🥳"]. First accepted rank None -> 1; accepted top8 0 -> 1.

- `heart-nfd` query "corazón": baseline []; candidate ["😍","😻","💘","💝","💖","💗","💓","💟","❣️","💔","❤️‍🔥","❤️‍🩹","💞","❤️","🩷","🧡","💛","💚","💙","🩵","💜","🤎","🖤","🩶","🤍","🫀","🥰","💕","♥️"]. First accepted rank None -> None; accepted top8 0 -> 0.
  Wrapper baseline []; candidate ["😍","😻","💘","💝","💖","💗","💓","💟","❣️","💔","❤️‍🔥","❤️‍🩹","❤️","💞","🩷","🧡","💛","💚","💙","🩵","💜","🤎","🖤","🩶","🤍","🫀","🥰","💕","♥️"].

- `mixed-order` query "  cat\t gato  ": baseline []; candidate ["🐈","😺","😽","🙀","😿","😾","🐈‍⬛","🐱","😼","😸","😹","😻"]. First accepted rank None -> None; accepted top8 0 -> 0.

- `enye` query "año": baseline ["☀️","🌙"]; candidate ["🌙"]. First accepted rank None -> None; accepted top8 0 -> 0.
  Wrapper baseline []; candidate ["🔞"].

Interpretation: Spanish heart gains six accepted hearts in top8, although heart-eyes faces lead and plain ❤️ is rank14 (wrapper13). Mixed red corazón accepts ❤️, not anatomical heart. English cat retains full baseline order and all three accepted top8 choices but appends Qatar via Spanish Catar at rank18. Spanish gato has one accepted top8 choice with cat face rank11, black cat rank12; mixed gato cat has three. Fiesta finds only 🥳: no credit for unavailable-in-output 🎉/🎊/🪅/🪩. The heart NFD and token-order controls gain the same correlated outputs, not additional independent useful families. The fixture ñ row fixes a pre-existing n/ñ conflation. No changed useful fail->fail row was omitted.

## Independent diagnostic raw evidence

These are source-review counterexamples, not a fresh blinded benchmark or a replacement oracle. Both existing frozen optimized measurement executables were used without edits. Artifacts: `/tmp/pulpo-r27-review-{queries,baseline,candidate}.json` and `/tmp/pulpo-r27-review-extra{,-baseline,-candidate}.json`.

- Query "q" baseline ["🌓","🌗","🌛","🌜","⁉️","❓","❔","🇶🇦","🫢","🤫","🤐","😶","🙊","🙋","🙋‍♂️","🙋‍♀️","👸","🏃","🏃‍♂️","🏃‍♀️","🏃‍➡️","🏃‍♀️‍➡️","🏃‍♂️‍➡️","🌈","👑","🔇","🔕","🧯","🏳️‍🌈"]; candidate ["🌓","🌗","🌛","🌜","⁉️","❓","❔","🇶🇦","🫢","🤫","🤐","😶","🙊","🙋","🙋‍♂️","🙋‍♀️","👸","🏃","🏃‍♂️","🏃‍♀️","🏃‍➡️","🏃‍♀️‍➡️","🏃‍♂️‍➡️","🌈","👑","🔇","🔕","🧯","🏳️‍🌈","🤟","🧀"].

- Query "z" baseline ["🤪","🤐","💤","🧟","🦓","🧟‍♂️","🧟‍♀️","🇿🇲","🇿🇼","🇳🇿","😌","😴","🥱","🤌","👧","🧘","🧘‍♂️","🧘‍♀️","🛌","🦁","🐅","🐆","🐂","🐃","🐏","🐐","🐊","🐍","🐟","🦀","🦂","🍋‍🟩","🏺","🏎️","⚡","🩴","📥","🏹","⚖️","0️⃣"]; candidate ["🤪","🤐","💤","🧟","🦓","🧟‍♂️","🧟‍♀️","🇿🇲","🇿🇼","🇳🇿","😌","😴","🥱","🤌","👧","🧘","🧘‍♂️","🧘‍♀️","🛌","🦁","🐅","🐆","🐂","🐃","🐏","🐐","🐊","🐍","🐟","🦀","🦂","🍋‍🟩","🏺","🏎️","⚡","🩴","📥","🏹","⚖️","0️⃣","🦊","🥕","👞","👟","👠","🩰"].

- Query "ñ" baseline ["😐","🤢","🤓","💅","👃","🥷","🪺","🪆","🏞️","🌃","🕘","🕤","🌑","🌚","👔","📔","📓","📰","🪍","🔩","🧿","⛔","🚳","🚭","🚯","🚱","🚷","📵","🔞","⏭️","📛","🆕","🆖","🙈","🙉","🙊","🐽","🪹","🥅","🪡","⏳","🎵","🎶","✒️","🗒️","🔢","🈶","🈵"]; candidate [].

- Query "cat face" baseline ["🐱","😺","😽","🙀","😿","😾","😼","😸","😹","😻"]; candidate ["🐱","😺","😽","🙀","😿","😾","😼","😸","😹","😻"].

- Query "face cat" baseline ["😺","😽","🙀","😿","😾","🐱","😼","😸","😹","😻"]; candidate ["😺","😽","🙀","😿","😾","🐱","😼","😸","😹","😻"].

- Query "smiling face" baseline ["☺️","🙂","😊","😇","🥰","😍","🥲","🤗","😎","😈","😄","😁","😙","😀","😋","😻","😃","😅","😸"]; candidate ["☺️","🙂","😊","😇","🥰","😍","🥲","🤗","😎","😈","😄","😁","😙","😀","😋","😻","😃","😅","😸"].

- Query "face smiling" baseline ["☺️","😇","🥰","🥲","😎","😈","😄","😁","😊","😍","😙","😀","🙂","🤗","😋","😻","😃","😅","😸"]; candidate ["☺️","😇","🥰","🥲","😎","😈","😄","😁","😊","😍","😙","😀","🙂","🤗","😋","😻","😃","😅","😸"].

- Query "red heart" baseline ["❤️","🫀"]; candidate ["❤️","🫀"].

- Query "heart red" baseline ["❤️","🫀"]; candidate ["❤️","🫀"].

- Query "cara sonriente" baseline []; candidate ["☺️","🥲","😄","😁","😊","😙"].

- Query "sonriente cara" baseline []; candidate ["☺️","🥲","😄","😁","😊","😙"].

- Query "dog" baseline ["🐕","🦮","🐕‍🦺","🌭","🐶","🦴","🐩"]; candidate ["🐕","🦮","🐕‍🦺","🌭","🐶","🦴","🐩"].

- Query "dog̸" baseline ["🐕","🦮","🐕‍🦺","🌭","🐶","🦴","🐩"]; candidate [].

- Query "d̸og" baseline ["🐕","🦮","🐕‍🦺","🌭","🐶","🦴","🐩"]; candidate [].

- Query "persona pelo blanco" baseline []; candidate ["🧑‍🦳"].

- Query "blanco pelo persona" baseline []; candidate ["🧑‍🦳"].

- Query "mano izquierda" baseline []; candidate ["👈","🫲","🫷"].

- Query "izquierda mano" baseline []; candidate ["👈","🫲","🫷"].

- Query "AÑO" baseline []; candidate ["🔞"].

- Query "año" baseline []; candidate ["🔞"].

- Query "CAFÉ" baseline ["☕"]; candidate ["☕"].

- Query "café" baseline ["☕"]; candidate ["☕"].

- Query "coffee()" baseline ["☕"]; candidate [].

- Query "\t  " baseline []; candidate [].

Diagnostic workload: 85 query executions per version, 78 unique query strings; repeated/case/order/normalization variants are correlated. Useful-row success counts are deliberately not invented for these diagnostic-only rows. No fresh target acceptance sets were changed.

## Verification boundary

I did not duplicate the full test suite. Parent reports authoritative candidate `swift test -c release --no-parallel` exit0: 442 core tests across 65 suites with the existing five known issues and three service tests passing; 63 focused emoji tests and four Python annotation tests passing. These are parent-supplied results, not independently rerun here. They do not supersede frozen-contract counterexamples.

No repo edits, commits, device operations, network access, PR changes or subdelegation in this review. Parent must independently verify any future import. Verdict remains REJECT before hidden reveal, irrespective of any later hidden score.

Review completed UTC 2026-10-16T07:02:58.423783+00:00
