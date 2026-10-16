# REJECT R18 ranking; retain production unchanged

The ranking experiment was rejected **before heldout reveal** because it evicted
the useful `for` alternative for supplemental literal `fir` under strong context
and directed touch. Keeping the literal and conservative automatic behavior did
not compensate for losing that alternative. The decision was unconditional:
later diagnostic gains could not promote this patch. Production Sources and
LanguageData were restored byte-for-byte to `d50d2a4e` before the selected run,
and remained unchanged at the completed candidate worktree tip.

All original heldout **36 stack/task observations** remain primary: baseline,
selected unchanged repeat and rejected patch each have **10 displayed targets,
six exact accepted/useful outcomes and 20 saved keystrokes**. There is no gain.
Four visible targets fail exact full-document acceptance because of added spaces:
appointment before comma in EN/BI, bicicleta before period in ES/BI. Retrieval,
visible targets and successful document acceptance are distinct. No punctuation
repair was imported; a separate parent followup owns that policy.

Hold-01's `blanket` was previously exposed. The supplied exclusion collector missed
historical scalar-string lists; independent authorship does not establish target
novelty. Preserve the contaminated primary denominator, exact inputs and scores.
Secondary accounting excluding its three stack rows is **33 observations, eight
displayed targets, four accepted/useful outcomes, 16 saved**, unchanged between
versions. This is provenance qualification, not a replacement primary evaluation
or a claim of complete novelty. Twelve tasks crossed with three actual language
stacks are correlated observations, not 36 independent prompts.

The [original agent audit](agent-audit.md), authorship, freezes, rejected patch,
all reports and all original expected-document oracles are preserved verbatim.
Large paired reports use deterministic gzip; `manifest.json` records original
decompressed hashes. The runner is archived as `.swift.txt` outside test discovery.
No production source, dictionaries, registered tests, native targets, logs, caches
or downloaded corpora were imported. Existing product and oracle limitations,
including NFD completion normalization and unavailable private selection paths,
remain unresolved.

## Verification and limits

```sh
python3 apps/keyboard-ios/audits/prefix-usefulness-r18/verify.py
python3 -O apps/keyboard-ios/audits/prefix-usefulness-r18/verify.py
```

`verify.py` uses explicit checks, verifies retained hashes and exact case×stack
sets, binds complete inputs, reconstructs the frozen expected documents, and
recomputes displayed/accepted/useful/saved outcomes from captured choices. It also
checks recorded aggregates and the contaminated secondary accounting. Displayed
target matching reproduces Swift's canonical Unicode equality; acceptance uses
exact UTF-8 documents. Effort derivation supports these frozen Latin/apostrophe
fragments only, rejecting unsupported scripts instead of pretending to implement
general Unicode grapheme segmentation. The three-grapheme suffix threshold and
one acceptance tap are frozen opportunity accounting, not measured human KSR.

Observed lexicon membership, correction validity, engine Undo execution and
learning counters cannot be independently rederived from text reports alone.
Their types/recorded relationships and artifact hashes are checked; this verifier
does not run the engine, prove author noninspection, certify every useful
alternative or establish device/privacy-selection coverage. Static prefix seeding
is host-context recovery, not complete typing or touch replay.

The original `compare.py` is **historical report-only code, NOT an integrity
validator**. It trusts score/choice flags and its structural `assert` checks
disappear under `python -O`. Independent review demonstrated that normal Python
accepts a tampered `saved=999` flag and reports 1,017 saved, while optimized Python
accepts 35/36 rows. Original stored rows were separately checked and are consistent;
these helper defects do not alter their frozen outcomes. Do not use its empty
regression list or a successful opt-in runner exit as acceptance certification.

Historical reproduction instructions in `agent-audit.md` temporarily apply a
rejected patch. Any such exposed replay must use a separate temporary checkout;
the archive does not authorize patching the working production tree. No build,
engine inference or device run occurred during curation.
