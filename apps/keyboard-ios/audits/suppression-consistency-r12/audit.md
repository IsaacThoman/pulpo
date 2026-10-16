# R12 parent decision: REJECT the compiler and resource candidate

Keep the current production compiler and dictionaries. R12's proposed suppression
rule removes correct bilingual swipes for ordinary Spanish words. Its existing
reports demonstrate these losses; no new inference or policy experiment was
needed for this parent decision.

| Target | Original evidence | Baseline output | Rejected output |
| --- | --- | --- | --- |
| `lo` | Development, bilingual, paths 0/1/2 | `we dijimos lo` on all three | `we dijimos look`, `we dijimos look`, `we dijimos loo` |
| `mes` | Held-out, bilingual, paths 0/2 | `we dijimos mes` | `we dijimos mess` on both |
| `chino` | Held-out, bilingual, paths 0/1/2 | `we dijimos chino` on all three | `we dijimos ciñó`, `we dijimos ciñó`, `we dijimos vino` |
| `cajones` | Held-out, bilingual, paths 0/1/2 | `we dijimos cajones` on all three | `we dijimos vagones` on all three |

The table shows immediate committed documents; the reports also retain the final
engine-inserted space, returned alternatives, slots and personal state. The other
held-out `mes` path already misses in both versions and is not counted as a new
loss. These synthetic paths are correlated observations, not independent users
or a population accuracy estimate.

## Why the original acceptance decision does not serve the UX objective

The original experiment deliberately selects entries with both `neverSuggest`
and `glide`. It then rewards removing those targets from returned candidates,
committed text and slots. That establishes an inconsistency between the merged
suppression bit and the monolingual compiler's static glide exclusion. It does
not establish that suppressing every such spelling improves typing.

Its "neutral" controls require **neither source to flag the spelling**, so they
exclude the very source-collision cases where neutral Spanish senses are lost.
The observed losses above are therefore classified as suppression successes,
outside the no-neutral-regression gate. An independently authored held-out set
does not fix that objective mismatch: it uses the same metadata-based selection
and gate. There is no demonstrated neutral-accuracy gain from this candidate.

The five-line compiler patch is general and internally consistent with the
existing merge predicate. It preserves a genuine suppression flag from either
source and additionally clears static glide eligibility. But source flags are
not a contextual sense classifier. The 57 affected entries include `ya`, `lo`,
`mes`, `negro`, `chino`, `mango`, `mariposa` and `mariposas`, as well as legitimate
medical and identity vocabulary. Common-word impact is not hypothetical for
`lo`, `mes`, `chino` and `cajones`: correct baseline outputs are recorded above.

For example, the pinned [AOSP English wordlist](https://android.googlesource.com/platform/packages/inputmethods/LatinIME/+/refs/heads/main/dictionaries/en_US_wordlist.combined.gz)
(archive SHA-256 `0f78dd455b532be169a23f233227b811fabced4b5bd7fc9c40cc05839793bcbd`)
contains `word=lo,f=0,flags=,originalFreq=95,possibly_offensive=true`.
The existing English compiler maps that marker to `neverSuggest`; its compiled
`lo` has flags 1, while Spanish `lo` has flags 2 and frequency 190. The source
encodes no explanation or sense for that marker. Extending its effect to Spanish
swipe entry is a product tradeoff, not an inevitable correctness requirement.
No new censorship requirement is inferred from an imported dictionary flag.

Typed literals remain available, and the learned-target controls preserve their
targets. Those learned controls explicitly pin each target before replay. These
routes demonstrate preserved exceptions; they do not show unchanged ordinary
swipe UX or justify requiring people to teach common Spanish words first.

No replacement policy or per-word exception is selected from the revealed
held-out data. Any future proposal needs a separately frozen accuracy workload
that includes ordinary intended senses within the conflicting-source group,
alongside ambiguous/sensitive uses and unflagged controls. The revealed R12
cases may remain regression evidence, but cannot become another blind test.

## What the evidence does establish

All four original reports contain 360 observations: 108 unlearned conflicts,
108 learned conflicts, 54 unflagged neutral controls, 36 typed literals,
18 novel personal words, 18 learning-off controls and 18 secure controls.
Each split contains 144 cases. Unlearned bilingual target return/document/slot
counts are development **23/20/23 → 0/0/0** and held-out **32/29/32 → 0/0/0**,
each out of 36. These are measured removals, not a neutral-accuracy improvement.
English and Spanish semantic outputs are unchanged. The original literal,
personal and privacy preservation results are valid for their tested routes.
Secure engine glide rejection is intentional and is kept distinct from decoder
target recall.

Parent review recomputed the scores from complete decoder, document and slot
outputs and verified all 69 original manifest artifacts. Development and held-out
targets are disjoint. The held-out authorship receipt, candidate freeze and reveal
hashes agree, and the recorded freeze precedes reveal. Independence/noninspection
claims remain author attestation rather than a filesystem-enforced secrecy proof.

The proposed binary change clears exactly 57 glide bits and removes exactly
those 57 IDs from the glide index. Only `WFLG`, `GLOF` and `GLID` payloads differ;
word IDs, spellings, frequencies, trie, language-model, shortcut and literal
payloads remain identical. Both recorded regenerations yield SHA-256
`62d70c17513c7d84403942815c391a93bbf0dac004992bd98f0f2b4d31d7f210`,
27,391,424 bytes, a 224-byte reduction. English and Spanish assets are unchanged.
The small size reduction and passing structural tests do not outweigh the
observed accuracy losses.

The original source review approved the candidate against its suppression gates.
The parent rejects its **product retention**, not the integrity of that evidence.
Historical submissions under [`original/`](original/) retain their original
"retain" decisions and acceptance flags verbatim. They are not the final decision.

## Retained scope and validation

This directory contains only synthetic frozen inputs, the original protocol and
harness, compressed original paired reports, historical provenance/decision
records, a rejected patch as text, and portable verification/replay tools.
No runtime/compiler/test change, dictionary binary, build cache, log or generated
dense path blob is retained in the repository. Full original evidence remains in
`/Users/isaacthoman/.t3/artifacts/pulpo-r12-53439f72.tar.gz`; its original member
manifest is preserved here. The portable replay regenerates paths from the
unchanged harness and checks their frozen hashes.

Artifact-only integration verified retained bytes and decompressed original
report hashes, all 1,440 observations and frozen identity bindings, both splits'
comparisons, script syntax, patch applicability in a disposable compiler copy,
and whitespace checks. It ran no compilation, inference, simulator or device
operation. See [README.md](README.md) for read-only verification and reproduction
commands. Reproduction of the rejected variant belongs only in a temporary
checkout/output directory; it is not a production recommendation.
