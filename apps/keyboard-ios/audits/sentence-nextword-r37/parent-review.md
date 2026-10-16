# Parent disposition

Both backoff candidates remain rejected. Only the original evidence commit was
imported; neither inactive source/resource patch was applied. Parent review
independently verified all 57 original manifest entries, recomputed both strict
paired comparisons, checked every exact top-three target hit and the three real
acceptance branches, and matched the 12 restored source/resource files to the
current parent before importing this archive. No fresh workload was authored or
executed, and no device, latency or population accuracy claim follows.

The independent development cohort retains 108 rows/version, BI 12/36 both;
the exposed fallback cohort retains 48 rows/version, BI 10/16 both, including
both changed failed outputs. Activation and rank changes did not earn utility.
The 39-row mechanical smoke is separate from semantic accuracy and admission.

The original `verify_rejection.py` remains unchanged for provenance. Its checks
use Python assertions and current working-tree restoration, so do not use it
under `-O` or assume it verifies later production revisions. Use the parent
verifier for the immutable archive instead:

```sh
python3 apps/keyboard-ios/audits/sentence-nextword-r37/verify_parent.py
python3 -O apps/keyboard-ios/audits/sentence-nextword-r37/verify_parent.py --git .
```

The latter additionally checks historical baseline blobs, without requiring
future production files to remain unchanged. Neither command runs a model or
opens a holdout. Manifest hashes detect byte changes; they are not signed
execution attestations. Original comparison and execution limitations in the
README still apply.
