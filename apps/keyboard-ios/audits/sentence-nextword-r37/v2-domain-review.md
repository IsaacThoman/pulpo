# Independent NEW R37 V2 preimplementation domain review

Disposition: admit the frozen V2 rule to a bounded, exposed development experiment. No domain objection requires changing its source priority, 8:1 threshold, 0.75 coefficient, or score formula before implementation. This is not fresh-evaluation, production, or usefulness admission. Fresh authoring remains blocked by the pending executable capability/schema admission and the required useful development evidence. Resource feasibility is conditional on actual section sizes and the unchanged measurement gates.

This review establishes no empirical accuracy, loss, latency, memory, source-conservation, or safety result.

## Evidence and independence

I read the five requested files under `apps/keyboard-ios/audits/sentence-nextword-r37/`: `preimplementation.md`, `domain-review.md`, `domain-clarifications.md`, `v2-preimplementation.md`, and `fallback-development-summary.json`. I read the current production `LanguageModel.swift`, `Lexicon.swift`, `BilingualBackoff.swift`, and `build_multilingual_data.py`; I also inspected the relevant production `Input/KeyboardEngine.swift` and `Correction/Suggester.swift` interfaces and prediction/selection paths to assess actual API reachability.

The current source is the V1 implementation: the compiler emits metadata version 1 and low-bit-only BMEM, and the loader/hint selector has no BPMS support. That is consistent with a V2 preimplementation review; it is not a finding that V2 is already implemented. The supplied contract says V2 was recorded before its production edits and no fresh author exists; I cannot independently establish that chronology from file contents.

I did not open other audits, target fixtures, hidden files, model binaries, payloads, tests, imported Python modules, or the additional builder wrapper. I ran no inference, build, test, device, network, or production mutation. Only this `/tmp` report was written. Resource counts below are supplied assertions from the permitted review, not independently inspected binary contents. Source access makes me ineligible as a fresh author or fresh semantic reviewer.

The supplied exposed V1 summary reports 0 gains/0 losses on 16 BI prompts, with 10 hits in each version, 4 activations and 3 changes. That is negative development usefulness evidence for V1, not a V2 result. It neither establishes V2 utility nor permits relaxing the user's useful-feature and zero-loss requirements.

## Pair priority and calibrated-unigram fallback

The rule has a determinate implementation using existing IDs and bounded tables:

1. Preserve sentence-start, unknown-history, missing earlier-token, missing shared nonempty component history, and exact-trigram bypasses. The earlier token is `precedingWord`, two tokens before the cursor; `previousWord` is the history whose next word is predicted.
2. Resolve both tokens with the existing exact-then-case-insensitive `Lexicon.id(of:)`. Scan the earlier token's ORIGINAL bilingual successor row for the resolved previous ID; read the corresponding BPMS position if found.
3. A mask of 1 or 2 chooses that source, even if the earlier word's unigram hint favors the other source. Mask 3 or a missing bilingual entry proceeds to the earlier word's fallback. Do not substitute the preferred source's component row for this pair lookup.
4. Low BMEM bits 1 or 2 choose the exclusive source. For low bits 3, use the encoded shared-spelling hint only if the original calibrated source log-probability difference reaches the frozen threshold. Otherwise retain the original behavior exactly.

This priority is coherent. Pair evidence is more local than a unigram cue, but it is evidence of stored-table presence, not proof of language exclusivity, grammaticality, or a user's intended next language. A source may omit the pair because its table is truncated or its corpus lacks the example. Likewise, an absent bilingual pair can have source evidence discarded by the original top-48 merge. Those cases intentionally use the fallback; do not interpret absence as negative source evidence or enlarge BGID to recover them.

Compute shared hints from each source's own `unigramIntercept + unigramSlope * WFRQ[sourceID]`, before bilingual recalibration, max-frequency selection, clipping, or requantization. Select English when `logP_EN - logP_ES >= log(8)`, Spanish for the reverse inequality, and neither otherwise. Require finite source calibration and values and a fixed numerical comparison; no output-driven epsilon, alternate calibration, posterior language interpretation, previous-word popularity, or special vocabulary rules. The source priors derive from different training resources, so the ratio is a frozen heuristic, not an independently validated language posterior or an 8:1 confidence guarantee.

Keep exact display-spelling provenance at compile time and the existing case-insensitive entry resolution at runtime. Do not introduce accent-folded membership or combine all normalized-key variants. The 8:1 rule and pair priority can plausibly broaden activation beyond V1 without expanding caller context; natural activation and useful gains remain unknown.

## Score, candidate coverage, and real scope

The existing V1 score implementation already addresses the prior review's candidate-domain issue: `predictionLogProbability` is called for both static and personal-successor candidates, uses the original personal spelling, and leaves nil-ID candidates unchanged (`LanguageModel.swift:97–104,111–139`). Preserve this under V2. Do not implement the hint by modifying global `logProbability` or by changing the history/trigram used by other consumers.

For an eligible no-trigram candidate, let the unfloored original mixture be `T=(1-w)B+wR`, and let `d=P-T>=0` represent the original floor/fallback residual. The pre-floor adjustment is

    P + 0.75(1-w)(Q-B) = (1-w)(0.25B+0.75Q) + wR + d.

It preserves personal probability mass and is nonnegative for valid finite inputs. Keep the outer floor and use exactly the same normalized-omission B as the original call. Q retains the preferred component's original quantized listed scores/backoff and the existing bilingual-unigram omission rule. This is a ranking score, not a proof of normalized total mass. In particular, `unlistedLogProbability` takes a maximum with stored backoff; its cap on the other branch does not prove every omitted candidate lies below every listed candidate.

Both component rows must enter the pool, alongside original bigram, personal, and fallback candidates, with existing flags, block checks, max-by-string merge, tie order, limit and centered display behavior. At most 96 added source entries does not mean only 96 total candidates. Omitted words receiving Q support are not new source observations. The bounded pool can still omit an acceptable next word, even when its conceptual Q score would be useful; do not silently scan the vocabulary or add output-derived candidates to fix coverage.

Actual reachability exists: `KeyboardEngine.languageContext` supplies the local pair; an empty composition calls `Suggester.predictions`, which invokes `model.predictions(limit: 3)` and centers its result. This is a local nextword ranking feature within the engine's existing token/boundary extraction, not wider sentence understanding, translation, automatic mode switching, or persistent language state. Exact trigrams bypass component lookup. EN/ES resources without extension data must take their original paths. Output equivalence and correction/completion/glide safety still require the retained gates; source inspection alone proves neither.

## Representation, conservation, and resource admission

BPMS can be generated while the compiler still has both remapped source rows. For each original emitted bilingual BGID position, OR source-presence bits for that exact remapped `(history, successor)` pair across the original source tables. Derive presence before equal-mixture truncation/rounding; never infer it from the merged score. Preserve BGID position order, including sentence-start entries if encoded, and keep sentence-start entries unable to activate a hint.

Loader work is necessary, not an optional weakening of validation. Current `BilingualBackoff.swift:33–36` accepts only BMEM bytes 1–3 and tests shared-history membership using byte equality. V2 must mask low bits for membership and validate the full allowed byte combinations: exclusive entries remain 1/2; shared entries are 3, 7, or 11; hint code 3, unused high bits, zero membership, and hints on exclusive entries reject. Shared-history checks must use `(byte & 3)==3`. Preserve all existing bounds, source-successor membership, sorted-ID, nonempty-row and <=48-row checks.

Validate BPMS length against actual original BGID entry count, masks in 1–3, complete version-appropriate sections, and metadata version consistency. V2 data missing BPMS must reject rather than downgrade. All extension sections absent must preserve old resources. If V1 extension resources remain supported, decode them explicitly as V1; never interpret their absent BPMS as V2 evidence. Validate the referenced BGOF/BGID ranges before scanning for hints. Positive finite equal score quantization and finite unigram calibration remain required.

Storage is plausible but not demonstrated. Using the supplied 392,087 words, 605 shared histories and 14,835 component entries, the V1 sparse payload arithmetic is 474,736 bytes before directory/alignment/metadata. V2 adds `N_BGID` bytes for BPMS and no extra membership array. Thus the unchanged 1 MiB asset gate requires

    474,736 + N_BGID + extension overhead <= 1,048,576.

That leaves at most 573,840 BPMS entries before overhead. The claimed <850 KB estimate is tighter and needs its units and actual count; with decimal KB it leaves only 375,264 bytes before overhead. None of the permitted artifacts establishes N_BGID. Do not claim the estimate is verified. If the real additive payload exceeds 1 MiB, reject this representation/candidate under the frozen contract; do not trim source rows, alter original tables, or relax the gate.

A mapped BPMS byte per existing entry, sparse binary history search and <=48-entry pair scan need no second stack, per-word source index, or growing cache. Current Q scoring rescans a component row per candidate, and B is computed again for the adjustment. Work remains bounded, but bounded does not establish the p95/p99 or cold-load gates. Include temporary candidate arrays, any new persistent summaries, loader validation, mapped-page RSS and stack release in their appropriate existing measurements. Distinguish mapped resource bytes from explicit allocations.

Conservation must compare every prefeature BI section payload and complete EN/ES files against pinned inputs/baseline. V2 explicitly changes the BMEM high-bit encoding and extension metadata and adds BPMS; that permission does not authorize modifying the low membership bits, original bilingual vocabulary/IDs/displays/flags, BG/TG sections, original unigram calibration, shortcuts, literals, or retained component `(ID, score)` associations/backoffs. Metadata additions may move container offsets; unchanged payloads are the relevant original-section invariant. Maintain input hashes and attribution.

`build_multilingual_data.py` has suitable remaps/source rows, but its main still rebuilds Spanish from corpus inputs. Do not invoke that main as a binary-only rebuild. A pinned-binary entry point with pre-write input digest verification is still required; the uninspected wrapper is not verified by this review. No binary conservation or resource digest comparison was performed here.

## Actual API and freshness blockers

The permitted artifacts still say the immutable executable schema/API smoke is pending. This blocks sealing or sending the fresh author contract. The production API inspection confirms that a review cannot replace that admission:

- `Suggestion` returns text, kind, autocorrection status and accessibility label; `SuggestionSet` returns slots and autocorrection. Per-slot model costs and the full pool are not engine-returned fields. Costs must mean measured execution/storage; separately labeled diagnostics cannot replace engine outputs.
- `Suggestion.sourceContext` is internal, and its public initializer clears it. Retain the exact engine-returned value for `engine.select`; generation serialization requires an explicitly admitted test-access mechanism. Reconstructing an apparently identical suggestion invalidates the stale-selection oracle.
- `TextDocument` supplies contexts, identity, selection and insert/delete primitives. Host range/caret/document replacement operations belong to a real mutable fixture, not a nonexistent engine cursor API. Complete document state and primitive traces must come from that fixture, with Character-safe mutation when combining/emoji sequences change grapheme boundaries.
- Reading `engine.suggestions` refreshes only when marked stale; it does not reconcile a silent host change. The preserved `observe` definition must remain a read. Silent-change controls must reach actual `select` before a callback/reconciliation; do not repair their setup first.
- `settings` and `traits` are public setters; `policy` is private(set). Exact private, URL, numeric, prediction, learning, and mode/stack mappings still need the promised API map and smoke execution. I did not inspect their type definitions or claim those mappings validated.

Unsupported fields/actions must be rejected or publicly restricted before authoring. All supported actions and the promised arbitrary-Unicode fixtures must pass that admission first. This review does not authorize reading hidden targets or executing those checks in this review task.

V2 is an explicitly new development hypothesis after exposed V1 failure, which the contract discloses. Freeze pair priority, threshold, coefficient, mask derivation, eligibility, pool and all gates before V2 execution. Existing pilot targets remain exposed and fixed. Author any added development cases and exact acceptable sets before their first execution; keep inactive cases and changed failed rows visible. Do not broaden targets after seeing a bar, select cases by demonstrated gains, or call repeated modes independent families. Development iteration does not create fresh evidence.

Fresh evaluation must retain 36 families, two prompts each, all three modes, 216 rows/version and the 72-prompt BI primary denominator. Preserve exact strings and the clarified top3 gain/loss and family definitions. The >=10 percentage-point BI gain plus zero losses requires at least eight added BI hits, spread over >=6 improved families. Zero scored top3 losses applies across ALL THREE modes; secondary center/RR losses remain reported. Ambiguous/control rows remain visible without success credit. EN-on-EN and ES-on-ES invariance, ordinary failures/oracles, safety controls, native admission, resource/timing gates and one frozen fresh reveal all remain binding.

The new source hint may expand coverage, but no reviewed evidence establishes that it produces any useful V2 improvement or can pass the fresh gate. Failure of utility or any hard gate means preserve the inactive candidate and negative evidence and restore the production baseline. Grammatical-looking changes, broader activation and unchanged exposed hit count are insufficient to fulfill the requested feature.

## Input receipt

SHA-256 values at review time:

- preimplementation.md: `2027ec9657f47881195a6527bf2ea06025e61a7aff378d026f2b71aa82aafd3d`
- domain-review.md: `ab8acd074b28c746a4938b40b8dfa8075ccb233fa2bd9064e52cfb5c91dba82c`
- domain-clarifications.md: `607c454b0d69c9ce3d02ebdf196694c9d40e0a106629e5053f6f43e5af0b56ca`
- v2-preimplementation.md: `33e65203f9fbed3be1199c49d44639adaa5011083555ea1ea68fbc0b7df5f224`
- fallback-development-summary.json: `abc16b8abf8dd0aaf5ca610a835c2b58fbc4a21ad6ee4349aa8d19a9463bad87`
- LanguageModel.swift: `e48f19b2e53ff496f983a1ebe31dbf1ac60dce7292754f29098b2100bebd8b26`
- Lexicon.swift: `749832eea96e4cb7d5d8a4e504b0a668bd33b9f3ef7532d965c76154e3e1150d`
- BilingualBackoff.swift: `6de106a5d00933b2f89efc5a802114ca20a7f53b8450ed297517fc5dfe1264b0`
- build_multilingual_data.py: `e772e5499f519bebea36a0bae0d4bdfcc1be3345c6a929550c42f28f8af33322`
- KeyboardEngine.swift (relevant paths inspected): `3f0987051ff0f176a5e1ef6396d415b0f8fe0fc2088735c75fef87f75158de97`
- Suggester.swift (relevant paths inspected): `0608da9f8a2308ff71aaadf5cd2a59eaad856871ea299f56ec9b2200e14a3d65`
