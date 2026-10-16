# Independent R37 preimplementation domain review

Disposition: the statistical idea is coherent and implementable as a bounded development experiment, but this is not approval to seal the fresh author/executor contract. Resolve the candidate-score domain clarification below before candidate implementation, and complete the promised executable capability/schema admission before fresh authoring. No empirical usefulness, latency, memory, or safety result is established by this review.

## Evidence boundary

I read only the five permitted R37 artifacts and the permitted current LanguageModel.swift, Lexicon.swift, LanguageStack.swift, KeyboardEngine.swift, Suggester.swift, build_multilingual_data.py, and LanguageData/MULTILINGUAL.md. I did not read other audits, tests, targets, results, binaries, imported Python modules, settings/policy implementation files, or KeyboardController. I ran no inference, builds, tests, compiler, device, network, Git mutation, or production edit. This report is the only file I wrote.

All six current Swift/Python source hashes listed in the receipt that are within this review's permitted source set match the receipt. KeyboardController was not read or hashed. The monolingual/bilingual resource digests agree between the permitted receipt and documentation, but I did not read/hash the actual binaries or independently count their contents.

The parent's additional development-only structural disclosure is treated as supplied evidence: all original v2 nextword contexts have exact trigrams; 605 shared nonempty source histories contain 14,835 total successors; membership occupies 392,087 bytes. I did not inspect another artifact to verify these counts. Under the frozen rule, those original nextword cases must remain unchanged and cannot establish utility. A new exposed fallback pilot may examine usefulness without output-derived targets. There is no fresh author yet.

Having inspected exact source, I am ineligible as the source-independent fresh author or fresh semantic reviewer.

## Blocking clarifications and admission conditions

### 1. Define the score for personal candidates with no lexicon ID, and apply it consistently to every prediction candidate

LanguageModel.predictions has two scoring paths: the local add(id) function, and a separate personal.successors loop (LanguageModel.swift:96 and :112). The latter legitimately receives id == nil, and preserves personal spelling even when an ID resolves case-insensitively. The contract defines Q through bilingual unigram and component data indexed by lexicon ID, so Q and B are currently undefined for a personal-only word. Merely changing add(id) would also leave known-ID personal candidates on the old score; their old value could win the existing max merge and defeat the intended replacement.

Minimal correction before implementation: explicitly freeze that candidates with id == nil return their original logProbability exactly (equivalently, define B = Q = 0 for this adjustment). For every candidate with a resolved ID, apply the same prediction-only adjustment regardless of whether it came from the original row, either component, fallback, or personal successors. Preserve the exact candidate string for personal probability/blocking/display, and use its resolved ID only for static terms. Keep existing deduplication, suppression, and maximum-by-string behavior. This completes the formula's domain without changing its coefficient or widening eligibility.

### 2. The promised executor is a specification, not a validated existing interface

The explicitly required schema/API map and smoke evidence do not exist in the allowed artifacts. This blocks sealing/sending the fresh author contract, as preimplementation.md:73–78 already requires; it is not an architectural objection to developing the candidate.

Concrete capability limits from current source:

- TextDocument exposes text contexts, selection, document identity, insertText and deleteBackward. A mutable harness can implement hostMove/hostReplace by mutating its own document, and optionally invoke documentDidChange. Those are host fixture operations, not engine cursor movement APIs.
- Engine methods support the proposed character/space/return/backspace, matching-stack switch, observe, and exact-object selection operations. A capture must retain the actual Suggestion struct; reconstruction through its public initializer drops sourceContext. sourceContext is internal (Suggester.swift), so serializing the actual UUID requires an explicitly admitted @testable build or equivalent permitted test access. Optional internal languageContext inspection is also test-only.
- Suggestion exposes text, kind, isAutocorrection and accessibilityLabel; SuggestionSet additionally exposes autocorrection. Neither exposes per-slot ranking cost/probability or the full candidate pool. Contract language about capturing “costs” and proposal language about candidate pools must distinguish measured execution costs from unavailable engine-returned ranking data. Restrict unavailable fields before sealing, or explicitly identify separately obtained diagnostics and their access mechanism. Do not fabricate fields or describe diagnostic model calls as engine outputs.
- observe through engine.suggestions does not automatically reconcile silent host mutations; it refreshes only when marked stale (KeyboardEngine.swift:78). Selection of a generated suggestion does reconcile first (:742). Freeze whether observe simply reads or invokes the public reconcileHostChanges method. Silent-change controls must really omit their callback and must not be repaired by the harness before exercising the intended stale-selection protection.
- Engine has public settings and traits setters, but the precise InputTraits/KeyboardSettings enum/setter definitions are outside the permitted source set. This review cannot attest every proposed private/url/numeric/predictions/learning mapping. The executor must demonstrate the exact mappings instead of inventing a writable policy setter; engine.policy is private(set).

Minimal correction: deliver the promised immutable schema and executable action-to-API map with strict field/bounds rejection; smoke every supported action before authoring. Include real Unicode grapheme-boundary mutation cases (combining sequences, emoji sequences, non-ASCII letters, and selection replacement), and document how Character caret offsets are maintained after insertion changes grapheme boundaries. A simple cursor += insertedString.count is not a general Unicode caret implementation. This is an admission requirement, not a claim that the current engine fails those cases.

### 3. Freeze the remaining scoring-gate definitions before fresh authoring

“Improved fresh family,” “zero scored target losses,” and reciprocal rank need mechanical definitions. Minimal correction: define primary hit gain/loss as paired acceptable-set top3 miss-to-hit/hit-to-miss on scored BI rows; explicitly state the scope of the zero-loss gate across modes, whether any secondary-rank loss also blocks, and how a family counts once. Keep ambiguous/control rows visible without treating them as semantic successes. Define reciprocal rank in model rank order, not display order: with three displayed slots the rank order is center, left, right; with two it is index 1, then 0. Preserve all stated denominators and thresholds. These definitions must not be chosen after outputs are available.

## Real caller reachability and scope

The proposed signal reaches the actual nextword path without changing Engine. KeyboardEngine.languageContext reads the previous two tokens from the cursor window and supplies precedingWord to model.context (KeyboardEngine.swift:1303). LanguageModel.context currently resolves that token only to find an exact trigram and otherwise discards it (LanguageModel.swift:28–35). With empty composition, refreshSuggestions calls Suggester.predictions, which calls model.predictions(limit: 3), centers the result, and Engine stamps the actual generation (KeyboardEngine.swift:1362–1410; Suggester.swift, final predictions method).

Clarify terminology in the contract: “preceding word” for membership means the earlier token passed as precedingWord, the second word before the cursor; the immediately previous token is the component-row history. The source-membership byte describes the stored display entry. Lexicon.id(of:) first checks exact spelling and then case-insensitive spelling (:259–265); thus an input capitalization variant can legitimately inherit a resolved entry's membership. Do not silently replace that lookup with normalized-key membership, accent folding, or a scan.

Engine's existing punctuation/newline extraction bounds the supplied pair; the model does not acquire a wider sentence parser. If the earlier token is absent because of a boundary, or either required history condition is missing, take the original path exactly. Sentence-start history is the wordCount sentinel and must never receive a membership lookup. An exact trigram is ineligible based on the existing context.trigram lookup, not whether a particular candidate happens to be listed in its row.

Keeping the change entirely inside prediction scoring and prediction candidate gathering is an appropriate isolation boundary. Suggester uses global model.logProbability for corrections, completion and joined/split readings. Changing that method to implement the hint would violate the contract even if nextword results appeared good. Adding a context hint must not change the existing history/trigram resolution used by those callers.

## Mathematical assessment

For an eligible lexicon candidate, no trigram contributes. Write the unfloored existing mixture as T = (1-w)B + wR, with R the existing personal term and F = exp(floor). On the existing positive-probability path P = max(F,T); its zero-probability fallback also gives P >= T. Let d = P-T >= 0. Before the final floor, the proposed adjustment equals

    P + 0.75(1-w)(Q-B)
      = (1-w)(0.25B + 0.75Q) + wR + d.

Thus it is nonnegative for valid finite static inputs, preserves the existing personal term, and retains the existing floor residual. The outer floor remains necessary for exact specified behavior. The floor means this is not literally an exact normalized mixture of source distributions; it is a ranking score. There is no subtraction-induced negative-probability defect on the defined eligible path. Use precisely the same unchanged normalized-omission B that contributed to the original prediction logProbability; substituting a stored-only backoff B breaks the identity.

Lexicon.unlistedLogProbability (:325–330) takes the maximum of stored backoff and a capped omitted-mass estimate. Together with quantization and the bilingual unigram prior, this is not a proof that probabilities sum to one or that every unlisted candidate is below the weakest listed word: the stored-backoff branch can exceed the capped branch. The contract correctly specifies reuse of that function; implementation/documentation must not add stronger normalization/order claims. Q's omitted words are bilingual backoff support, not source observations. Listed Q values and backoff bytes can remain exact source bytes when quantization matches.

The 0.75 coefficient is a substantial preference. In the idealized case B = 0.5E + 0.5S and Q = E, the static result is 0.875E + 0.125S. Actual truncation, omission handling, and quantization prevent assuming that equality everywhere. Both languages remain eligible, but their rankings need not be stable; zero-loss admission must be measured, not deduced from eligibility.

## Bounded representation and source conservation

The sparse representation is plausible. Taking the supplied counts literally, one possible layout needs 392,087 membership bytes, 74,175 successor bytes (UInt32 ID + score byte), 2,420 history-ID bytes, 4,844 offsets bytes for 1,210 source rows plus endpoint, and 1,210 backoff bytes: 474,736 bytes before section directory, alignment, provenance, and optional summaries. This arithmetic supports the estimate, not a measured asset size or RSS claim. There is no reason to allocate a per-word component offset array or another full LanguageStack.

Before using mapped component pointers, enforce the promised all-or-none validation with exact element widths, membership length == wordCount, masks in {1,2,3} for this merged vocabulary, strictly increasing unique shared-history IDs, source association/order fixed, monotonic offsets beginning at zero and ending at successor count, score/ID length agreement, IDs within vocabulary, strictly increasing unique successor IDs per source row, and both rows nonempty. Explicitly enforce <=48 successors per component row to substantiate the <=96 additional entries promise; do not silently truncate source rows to make the bound true. Exclude the sentence-start sentinel from word membership. Source quantization must be positive/finite as well as equal. Partial/malformed extension data should reject the resource rather than quietly pretending to be an old resource; all sections absent preserves old-resource behavior.

Binary-searching the sparse history list and scanning bounded rows is sufficient. Computing omission summaries once per query is bounded; any persistent summaries/indexes must be included in the active-storage budget. The existing trigram omission cache is unrelated baseline storage; avoid creating a new growing cache. Additional mapped bytes, explicit allocations, touched-page RSS and one-active-stack lifetime remain separate measurements.

Current merge_dictionaries already accepts compiled EN/ES byte strings and creates display-based remaps (build_multilingual_data.py:113–142), so preserving original score/backoff bytes in extra sections is feasible. Its current main, however, requires corpus inputs and rebuilds Spanish (:217–235). The proposed binary-only rebuild needs a dedicated invocation path or wrapper around merge_dictionaries; do not use current main and describe it as binary-only. Pin and verify both actual binary digests before writing output.

Conservation must compare every original BI section payload against the pinned baseline, permitting only additive metadata/sections, and compare complete EN/ES asset bytes. Re-encoding the container can move section offsets, so distinguish unchanged section payloads from unchanged file offsets. Preserve original bilingual vocabulary ordering, flags, displays, original bigram/trigram mixtures, shortcuts, literal supplement and unigram calibration; do not regenerate these from newly selected inputs or alter the old equal-mixture algorithm while adding components. Original source successor order can be sorted by remapped ID for lookup while preserving every (ID, score) association and backoff byte. Existing provenance and attribution remain required. No independent license verification or actual byte comparison was performed here.

## Narrowness and likely utility

This is a principled source-conditioned backoff heuristic with a credible integration path. It recovers source evidence the equal-mixture compiler otherwise discards, using a local observed cue without persistent language state or a code-switch corpus. It is not a general sentence or syntax model. For eligible contexts sharing the same last word and the same exclusive earlier-token membership, Q and the adjustment are identical even if communicative intents differ. All exact-trigram contexts, unknown/absent/shared earlier tokens, unknown previous histories and single-source histories remain unchanged.

The supplied development disclosure makes the original nextword scenarios entirely unchanged controls. They cannot validate even one active adjustment. A pre-output authored, exposed natural fallback pilot is appropriate to decide whether to continue. It should report structural eligibility alongside usefulness, retain inactive cases and changed failures, and use no ranking-derived gold. It must not tune the frozen coefficient, membership policy, exceptions, or candidate pool. Lack of useful coverage is a valid rejection of this rule.

With 72 BI prompts and a >=10 percentage-point absolute hit-rate gain gate, at least eight net additional top3 hits are required. With zero losses, at least eight previously missed eligible prompts must become hits, across at least six families under the sealed definition. The number 605 says nothing about natural frequency, eligible prompt coverage, baseline misses, or achievable gains. A source-independent author cannot guarantee those opportunities. Do not choose or repair fresh cases by inspecting activation/results after sealing, and do not present repeated modes/timings as independent intent evidence.

I find no source-backed basis to claim the feature will pass that gate. It is plausible enough for the narrowly specified development pilot after clarification, and narrow enough that a negative result would be unsurprising. If it fails, retain the inactive patch and negative evidence as required; a broader signal requires a new contract/review.

## Input receipt

SHA-256 of reviewed preimplementation.md:
2027ec9657f47881195a6527bf2ea06025e61a7aff378d026f2b71aa82aafd3d

Other reviewed R37 artifacts:

- proposal.txt: a952c830ed70232351a904e72677fa1894788afedfd76208c15c94e43a937cc4
- intent.txt: fb465290f8cc575a363e9ef0de0960a5b460dceb3edcc1cae7cbbdecfb36579d
- development-intents-v2.json: 0f8bc87dd2cca71ea8670f251e3b0c1e6dc5d11267f6fe1fdac7b6c3f07ec570
- proposal-receipt.json: 9a100d37082eda8909a853aee3cb1444e2936e27753730d269018ab6ac2f3234
