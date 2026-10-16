# R37 pre-implementation contract

Recorded before candidate production edits or engine inference. The discovery
proposal and its original receipts are preserved beside this file. They are
development material, not blind evidence. Baseline commit: 975c5f83.

## Public behavior and scope

After a completed word plus space, the actual KeyboardEngine suggestion bar
should offer useful next words for the visible sentence. Bilingual mode permits
both languages. This feature adds a local backoff signal, never translation,
automatic mode switching, persistent language state, or new learned text.
Existing caller context is used without Engine changes. Production scope is
LanguageModel, Lexicon/binary sections, bilingual compilation and provenance.
English/Spanish resources, IDs, flags and display forms remain byte-identical;
all existing bilingual sections except additive metadata remain byte-identical.
Global logProbability, corrections, completions and glide scoring stay unchanged.

## Frozen candidate rule (development pilot allowed, no target tuning)

An optional membership byte per bilingual word records exact display-spelling
presence in the pinned English (bit 1) and Spanish (bit 2) dictionaries. Use the
existing lexicon ID lookup for the immediately preceding word. Only an exclusive
membership (1 or 2), a previous-word bigram history present with nonempty rows in
both sources, and absence of an exact trigram activate the feature. Unknown,
shared, absent preceding words, sentence starts, and single-source histories use
the original result exactly. No word-specific exceptions.

Preserve both source rows for shared histories, with their original quantized
conditional probabilities and backoff bytes remapped to existing bilingual IDs.
Source quantization must match bilingual quantization (otherwise reject build).
For the preferred row Q, listed candidates use its probability. Omitted
candidates use the existing Lexicon.unlistedLogProbability rule with that row's
listed probability mass, bilingual unigram mass, weakest listed score and stored
source backoff. This is a bilingual backoff prior, not an assertion that omitted
words occurred in a source. Let B be the unchanged bilingual static bigram
probability, w the unchanged personalWeight, and P the unchanged final
logProbability exponentiated. Prediction-only score is
log(max(exp(floor), P + (1-w)*0.75*(Q-B))). This replaces 75% of static evidence
with the preferred component while preserving all personal probability mass.
The candidate pool adds BOTH component rows (at most 96 entries), retaining the
original bigram, personal and global fallback candidates. Both languages stay
eligible. Filtering, tie order, limit and centered display order are unchanged.
Exact-trigram paths do not consult component data at all.

No adjustment after fresh authoring/reveal. A development pilot may reject this
rule for lack of utility; any different feature requires another explicit
pre-implementation contract and domain review, not silent revision.

## Resources, provenance and costs

Only existing pinned monolingual binaries are inputs. Their SHA-256 values are
in proposal-receipt.json and LanguageData/MULTILINGUAL.md; existing Apache and
CC BY attribution applies. Rebuilding BI from those binaries requires no new
corpus/network. Expected 605 shared histories, 14,835 component successors;
membership plus sparse rows should occupy about 480 KB. Optional sections are
all-or-none, validated for lengths, bounds, monotonic offsets, source masks,
sorted shared history IDs and successor IDs before runtime use. Old resources
stay readable. Data is memory mapped, no per-query full vocabulary scan, no
unbounded cache, and no second active LanguageStack.

Hard gates: additional BI bytes <=1 MiB; additional active explicit storage
<=1 MiB; post-warm RSS increase <=2 MiB; EN/ES bytes unchanged. At least 30
paired Release warm measurements per prompt, alternating baseline/candidate
order, retain every sample and p50/p95/p99. Warm p95 <=20 ms and
<=baseline+max(1 ms,15%); p99 <=50 ms. Cold stack load and first actual suggestions
separate; first-result delta <=max(10 ms,15%). Thirty real mode switches must
release old stacks and return RSS within 2 MiB of post-warm baseline. Host RSS
is not a physical extension guarantee. Coordinate quiet timing with parent.

## Executor and fresh evaluation

The complete public capability prose in proposal.txt is adopted as a required
implementation target, subject to real API validation BEFORE authoring. An
immutable exact schema and executable API map must replace any unsupported
proposal field with an explicitly documented restriction BEFORE the final
author contract is sealed. Unsupported actions are rejected, never simulated.
Every supported action and arbitrary Unicode fixtures must smoke successfully.
All primary rows use real engines and real matching LanguageStacks in en_US,
es and en_es, empty nil-URL personal data, predictions on, learning off,
capitalization/smart punctuation off. Capture exact returned Suggestion values,
including hidden generation, and accept via engine.select. Preserve complete
document, Character caret/selection, actual primitive trace, source context,
mode/resource/model identities, all slot text/kind/autocorrection and costs.
No reconstruction of choices, direct model scoring as primary execution, weak
replacement oracles, silent missing slots, or normalization of acceptable words.

Independent domain review precedes fresh authoring. Source-independent author
sees ONLY immutable public contract/schema/API capabilities and opaque exclusion
material, never sources, models, outputs, or development results. Another agent
reviews grammar, ambiguity and syntactic/communicative novelty before sealing.
36 communicative intent families: 12 EN,12 ES,12 genuine code-switch, two prompts
per family sharing last word, all three modes =216 rows/version. Supply 1–6
exact acceptable words per mode before execution. Ambiguous rows are explicit,
nonasserting and not successes. All 216 denominators remain visible. BI top3
across 72 prompts is primary; center and reciprocal rank secondary. EN-only EN
and ES-only ES strata must remain unchanged. Repeated modes/timing samples do
not create independent families or humans. No population/Gboard claim.

Freeze candidate source, runner, comparison, data and author/reviewer artifacts
before ONE reveal, after development, ordinary core/services and native safety
admission. Gates: >=10 percentage-point BI top3 gain, >=6 improved fresh
families, zero scored target losses and zero required safety regressions. Keep
all outputs, gain/loss and every changed failed row. Preserve the same five
known ordinary failures and every existing ordinary/fuzzer oracle unchanged.
Fresh promised controls must actually execute complete document/range/privacy/
staleness/silent-host-change expectations. Native verification uses an assigned
device only, actual bar/acceptance/language/private policy, after core admission.

Failure means archive exact inactive patch, negative evidence and restoration;
no failing production feature or tests hidden/disabled. Parent verifies and
pushes. This checkout will not push, merge, deploy or touch protected paths.
