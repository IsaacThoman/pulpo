# R37 public executor contract, version 1

This document, `public-schema.json`, and `public-api-map.json` are the complete
author-facing interface. Their exact SHA-256 values must be sealed together after
executable smoke admission and before fresh authoring. A draft or static-schema
pass is not executable admission. Authors receive these three exact files only;
implementation, dictionaries, model outputs, development fixtures/results and
comparison internals are not author inputs. Parent supplies any opaque exclusion
material independently. No post-reveal runner/schema/input/gold repair is allowed.

## Input and exactness

Supply one UTF-8 JSON object satisfying the closed JSON Schema. All fields listed
as required are mandatory; unknown keys, duplicate keys, nulls, wrong types,
unsupported enums/actions and out-of-range indices are errors. Top-level fields
are `schemaVersion:1`, `cohort:development|smoke|fresh`, `cases`, and `equivalences`
(an array, normally empty, of `{left:caseID,right:caseID}`). Case IDs are unique.
An equivalence asserts equal final full document/range/logical context/composition,
policy, personal counters, and displayed suggestion values across two independent
cases in each mode; runtime object/generation/document UUIDs are scoped identities.

Every case supplies `id`, `familyId`, `contentLabel:en|es|mixed|control`, `prefix`,
`selected`, `suffix`, `route:nextword|completion|control`, `typed`,
`acceptableByMode` with exactly `en_US`, `es`, `en_es`, `oracle:scored|ambiguous|control`,
`rationale`, and `actions`. String matching for documents and semantic gold uses
exact UTF-8 bytes, with no case, accent, canonical-equivalence or whitespace
normalization. Character offsets use Swift extended grapheme clusters, not bytes,
Unicode scalars or UTF-16 code units. Initial prefix/selection/suffix seams must
be actual Character boundaries. A selected range begins at caret and extends
forward by selectionLength; the caret is the range's start.

Scored rows require 1–6 unique exact single acceptable words in EACH mode.
Ambiguous/control rows require three empty sets; they never count as successes.
Nextword/completion rows have empty selected text, prefix ending ASCII space,
and exactly `actions:[{"action":"observe"}]`. `typed` is empty except on completion
rows, where it must be nonempty and is dispatched one Character at a time through
`insertCharacter` before the observation. Completion execution is a separate
reported route, not part of the fresh nextword cohort. No acceptable word is ever
inserted or used to construct a suggestion.

Controls use route/oracle `control`. Every control action MUST include `expect`
with the complete `document`, `caret`, `selectionLength`, and exact number of
actual engine document primitives `primitiveCount` for that action. Optional
`slotCount`, `personalCount`, `personalDirty` add exact assertions. A control
observe requires slotCount so capture bounds can be checked before execution.
Control hostMove bounds are preflighted against the preceding complete expected
document. hostReplace ranges are preflighted against its supplied full document.
All fields, enums, static ranges, expectations and established capture indices
are admitted for the ENTIRE workload before constructing any document or model.
Runtime hostMove/capture/available-slot bounds are also checked immediately before
that action mutates; a missing actual slot is an explicit failure, never skipped
or substituted. All actual rows remain in raw output after execution failures.

## Execution and state

Every case executes independently in all three modes, in listed order. Each mode
starts a fresh real engine, matching real LanguageStack, empty nil-URL personal
and touch models, and a concrete mutable Character document. No disk personal
history, contacts, text replacements or emoji suggester are installed. Settings:
predictions=true, learnWords=false, autoCapitalization=false,
smartPunctuation=false, doubleSpacePeriod=false; trait capitalization=.none.
Autocorrection retains the actual default. Initial documentDidChange establishes
prefix/selected/suffix. There is no feature toggle or language fallback.

Execution requires an explicit absolute resource directory containing
`en_US.pkdict`, `es.pkdict`, `en_es.pkdict` for BOTH baseline and candidate.
Invalid/missing assets fail. All resources are SHA-256 hashed; path and hash are
recorded for each snapshot and checked again after execution. Each snapshot
records explicit mode, full document/range and identity, logical context before
cursor, composing text, policy, predictions/learning settings, personal counts
and hasUnsavedChanges, model/stack/lexicon/personal/corrector/suggester/glide/touch
object identities, and separately labelled @testable engine languageContext
diagnostics. Object addresses may be reused after release; stackOrdinal is scoped
to one session. Mode switching shares personal/touch state through the real stack
sharing initializer and replaces the engine stack; it does not accumulate stacks.

## Actions

The exact keys and required arguments are in the schema/API map.

- observe: read engine.suggestions once WITHOUT refresh/reconcile/callback.
  Capture every actual Suggestion value in display order, retaining hidden
  sourceContext. Captures form a flattened, zero-based array across observes.
  Report text, kind, isAutocorrection, accessibilityLabel, sourceContext,
  SuggestionSet.autocorrection, display index, model rank and elapsed milliseconds.
- type(text): split text into Swift Characters and call insertCharacter once per
  Character. A space/newline in this text still uses insertCharacter; explicit
  space/return actions use their distinct engine APIs.
- space, return, backspace: actual insertSpace, insertReturn, deleteBackward.
- setMode(mode): raw en_US/es/en_es, real matching resource/stack sharing,
  matching settings.language, then useLanguageStack. No inference-based switch.
- hostMove(caret,selectionLength,callback): mutate the concrete host document
  range; callback=true calls documentDidChange. This is a host fixture operation,
  not an engine cursor API.
- hostReplace(document,caret,selectionLength,callback,newDocumentID?): replace the
  host's complete document/range; true newDocumentID creates a new UUID (omitted
  or false retains it). callback alone determines documentDidChange delivery.
- setPolicy(policy,predictions,learnWords): assign actual traits/settings.
  normal=.standard; private=isSecure true; url=.url; numeric=.numberPad.
  Capitalization stays .none. Predictions/learnWords are both explicit booleans.
  No writable engine.policy setter is invented.
- acceptSlot(index): actual current displayed slot 0..2, same returned object
  into engine.select. This read does not append captures. Missing slot fails.
- replayCapturedSlot(capture): exact stored Suggestion value into engine.select.
  Never reconstruct the value or repair a silent host mutation before selecting.

Every action records full before/after state, arguments, errors and actual
insertText/deleteBackward primitives. Each primitive records full before/after
document and range, actual insertion, actual deleted/replaced text, affected
Character range and UTF-16 insertion endpoint. Independently replay all primitives
and verify destination, removed text, final document/caret/selection; conservation
alone is insufficient. Host mutations are separate recorded actions and cause
zero engine primitives. After insertion, determine caret from its UTF-16 endpoint
in the resulting String, advancing to the first actual Character boundary at or
after that endpoint. This handles combining sequences/emoji joins across either
edge, rather than adding inserted.count. No Unicode normalization is applied.

## Primary observation and independent acceptance

Semantic scoring reads the initial actual bar before acceptance. Each nextword or
completion mode row also runs THREE fresh independent branches with identical
initial input/settings, each observing its own real bar and selecting its actual
object at index 0, 1 or 2. Compare initial values across branches, preserving each
branch's own generation UUID. Each branch retains staging trace, observation,
chosen full object metadata, full before/after state and actual primitive trace.
Every missing index remains a full-denominator mechanical failure.

The independent mechanical oracle is exact: original prefix + chosen actual
text + one ASCII space iff suffix does not begin whitespace + UNCHANGED suffix;
full caret is the valid Character boundary after insertion, selection length zero.
A completion replaces the actual composing text. A literal choice keeps it and
only inserts the owed space. Expected primitive count is composition.count deletes
plus one insertion for nonliteral choices; literal count is one iff space is
owed, otherwise zero. Empty personal counters/dirty state must remain unchanged.
All controls additionally assert their supplied concrete full expected states and
primitive counts. Exact source context is captured through admitted @testable
access; no primary call scores a reconstructed choice or injects model histories.

## Frozen scoring and denominators

Fresh input has 36 families: 12 en, 12 es, 12 mixed. Each has two distinct prompts
sharing the exact last word, for 72 prompts x three modes =216 rows/version.
Ambiguous prompts remain in all denominators and add no successes. Top3 hit uses
any of the actual displayed strings in that row's exact authored acceptable set.
The strongest/center slot is index1 when >=2 slots, index0 when one. Reciprocal
rank follows center,left,right (two slots: index1,index0; one: index0), never the
left-to-right display order. Empty bars have hit=false and RR=0 for scored rows.

The primary BI percentage-point gain uses the fixed denominator 72, including
ambiguous prompts as non-successes. Require >=10pp BI top3 gain; >=6 improved
families; zero scored top3 hit-to-miss losses in ALL modes; zero mechanical/safety
failures; and strict unchanged observable outputs for en-labelled/en_US and
es-labelled/es strata. An improved family has >=1 BI top3 miss-to-hit and no
scored top3 loss in any mode; count each family once. Center/RR losses are fully
reported but do not independently block. Retain both full raw JSON files, paired
gains/losses and EVERY changed failed output. Separate ordinary, native, resource,
storage and quiet latency admissions remain mandatory and are not implied by a
utility comparison.

## Explicit restrictions

No prelearned learn/pin/forget author capability, personal-history injection,
manual gold replacement, direct model scoring/predictions, native Undo,
VoiceOver/controller event delivery, withheld/lagging proxy context, emoji/glide,
clock manipulation, corpus/network access or resource mutation is exposed.
These optional/broad proposal capabilities are not simulated. Real traits model
private policy while retaining the fixture's authored visible contexts; this does
not simulate a host withholding proxy context. Costs are elapsed execution/load
milliseconds only: the engine exposes neither per-slot ranking cost/probability
nor its full model candidate pool. The executor does not fabricate either field.
No device, native-extension latency or population-accuracy claim is supported by
this contract. Original development v2 supplies gold for one mode only; conversion
preserves that supplied gold verbatim in rationale/receipt and uses nonasserting
three-mode replay until independently authored mode-specific sets exist.
