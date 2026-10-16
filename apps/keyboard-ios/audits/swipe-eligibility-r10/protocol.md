# Spanish/bilingual eligibility round 10 preregistration

Frozen before reading compiler/decoder code or the prior method failure audit.
Development: 32 natural gesture scenarios (16 ES, 8 bilingual, 8 EN) and eight
literal safety scenarios. Every expected result is the **full document**, including
the original context and the engine's trailing gesture separator. Expected spelling
and accents are exact; case/accent-folded matches are diagnostics only.

Run each sampled gesture through KeyboardEngine.insertGlide with bundled language
assets. Code inspection before baseline establishes that sampling is a controller
concern; the core has no begin/append/end API. Its trailing space is owed via
phantomSpace, rather than immediately inserted. Capture the raw document and owed
space, then call the normal engine.insertSpace delimiter to materialize it. Primary
success requires both raw document == context + target with phantomSpace == true,
and final document == expectedDocument. No scorer-side space insertion or trimming.
This boundary clarification is frozen before any baseline inference.
Four deterministic profiles per case:
320pt ideal, 390pt ideal, 390pt small fixed sinusoidal jitter, 430pt small fixed
sinusoidal jitter (maximum 0.12 key widths). Freeze the implemented generator before
baseline and never tune it to a target. No context-dependent target hints. Literal
cases use normal engine typing and delimiters; measure them separately from swipe
ranking. Verify document expectations with a small harness smoke test first.

An independent author in an isolated checkout receives only this protocol and
excluded targets (development plus old R7). They create 32 new target-disjoint
natural cases, balanced 16 ES / 8 bilingual / 8 EN, and eight literal cases, without
inspecting compiler/decoder/assets or running inference. Their heldout file must
remain unread by the implementer until candidate and source hashes are frozen.
They may return input path, SHA256 and counts, but no targets or results beforehand.

Baseline reports all per-case documents and accuracy; lexicon existence, frequency,
eligibility and API candidate coverage are separate from ranking. All OOV and
variants count as primary failures. No per-word exceptions or prior-word fixes.
Only general compiler/merge/data rules using existing pinned sources are eligible.
English asset bytes and suppression/privacy flags must be preserved. Select at
most one candidate on development; absent a defensible general improvement retain
an honest no-change audit. Do not make candidate changes after heldout reveal.

Acceptance: development exact document improves, heldout exact improves, neither
ES/bilingual nor EN subgroup regresses; literals remain exact. Report every failure,
OOV and variant; warm p95 inference <= 50ms and candidate <= baseline * 1.15 + 1ms;
cold first inference <= 1500ms and <= baseline * 1.15 + 10ms. Measure construction,
first inference (including lazy initialization), and warm inference separately.
Use three fresh-process cold samples/language, and all case/profile warm samples.
Asset growth <= 10%; deterministic regeneration and core/data regressions pass.
Any changed production source receives an independent review before retention.

No push, deploy or devices. Small versioned reports only; no raw corpora or giant
generated output. Preserve all baseline/final denominators and report limitations.
