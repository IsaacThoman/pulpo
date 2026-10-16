# R12 suppression consistency preregistration

Frozen before ranking implementation inspection or inference. This is a
contract-targeted experiment, not wholly implementation-blind: compiled PKD1
flags select conflicts (neverSuggest=1 and glide=2). No conflict has yet been
observed returned or displayed. Do not infer output from membership or flags.
Prior R10 targets and R7 exclusions are excluded by case-folded display spelling.
Raw inputs, executables, reports and generated resources remain outside Git.

Development selects the first 12 remaining conflicts sorted by SHA256 of
`r12-development:` plus spelling. Each is exercised in EN, ES and bilingual,
unlearned and explicitly personally learned. For each language choose six fresh
neutral shared-spelling homographs, length 4..10, lowercase ASCII, present and
glide-eligible in both monolingual dictionaries with neither neverSuggest nor
notAWord flags; order by SHA256(`r12-neutral:` + language + `:` + spelling).
Language groups use distinct neutral targets. Add two unique synthetic personal
words per language (velunaro, dexumali; torivane, mexulora; zanifelo, lumavero),
and exact typed literals for all conflicts in all languages. Known dictionary
absence is reported, never removed. Context is `we said ` / `dijimos ` /
`we dijimos ` respectively. Autocapitalization is disabled.

Three genuinely different normalized QWERTY paths: dense straight centers with
consecutive repeated letters collapsed; fixed sinusoidal displacement (x=.12 sin
(i*1.7), y=.10 cos(i*1.3)); and rounded corners by a five-point moving average
plus a constant endpoint-inclusive x=.18,y=-.10 displacement. Interpolation step
<=.08 key widths; paths are frozen before inference, no nominal-width diversity.
No target hint is supplied to the decoder. No tuning paths after failures.

Independent held-out author receives only this contract, input schema, API rules,
metadata selection permission and excluded targets. It selects 12 other conflicts,
six other neutral homographs per language, two new synthetic words per language,
and matching literal/learned cases. It may inspect compiled metadata and API
signatures but no ranking implementation, development outputs or proposed fix.
Return only file location, SHA256, counts and authorship before reveal. Its inputs
remain sealed until at most one candidate or an explicit no-change decision is
frozen with source/resource hashes. Reveal once; no further candidate selection.

Record decoder's complete returned candidates (default limit), engine's immediate
full document and phantom-space state, engine's full document after insertSpace,
and engine suggestion slots immediately after glide, separately. Engine commit
uses insertGlide; no scorer-side trimming or spacing. UI rendering/device/AX is
unavailable under the task constraint; slot evidence is engine state, not pixels.
Literal typing uses insertCharacter then insertSpace. Personally learned controls
use PersonalDictionary.learn explicitly before inference; privacy cases use
learning disabled and secure traits, checking no learning-state change.

Acceptance for a retained candidate: establish documented contract and actual
unlearned conflict emission on development first. The correction must implement
an existing general merge/compiler/runtime rule, no per-word policy or blanket
neverSuggest runtime filter. Strict reduction in unlearned conflict returned
candidates on development and held-out; no increases in conflict committed text
or slots; all exact literals preserved, learned target candidate recall and
exact document/slot behavior must not regress; no neutral exact-document or
candidate-target recall regression in any language/path subgroup. Preserve all
misses, OOVs, unavailable cases and denominators. English bytes, privacy and
no-learning behavior must remain unchanged. If any gate fails retain no change.

Report baseline/candidate construction, first-decode and warm per-case timings;
warm p95 <=50ms and <=baseline*1.15+1ms; first-decode <=1500ms and
<=baseline*1.15+10ms (three fresh processes per language). Asset growth <=10%.
Compiler candidate requires pinned deterministic regeneration twice; meaningful
core/data regressions and independent source review required before retention.
No push, deploy, devices, parent edits or importing R10 commits. A no-change
result is acceptable; do not manufacture an issue from flags alone.
