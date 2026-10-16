# R49 — fresh authorship after reviewed filesystem correction

R48 remains failed and unchanged. Its one-shot results, full denominator,
independent outcome/root-cause reviews and synthetic store snapshots are in
`../reset-integration-r48/`. No product workload was replayed to rescue it.

R49 changes only benchmark mechanics so far. `filesystem-seam-v1/` retains the
proposed generic inventory and first-error correction. `seam-review-v1/` approves
the exact runner (`8f50f13e…`): all 28 supplied real-filesystem probes and five
independent counterchecks pass, without product or native execution. Both path
representations are canonicalized; component containment and link/type/size/count
checks precede content reads. The first blocked cause is retained without
recursive expansion, with every downstream unavailable row still explicit.
The compiled probe helper is byte-identical to the helper embedded in the runner.
These are bounded mechanics checks, not hostile-concurrency or product acceptance.

After that approval, a new source-blind author started from only the approved
public-domain-v3 document, clean Foundation reference, `author-protocol.md` and
the exact reviewed runner. Fresh inputs, oracles and evaluator are not yet
available. No R49 product build or execution has occurred. Independent semantic
review and a new binary/environment/input/source freeze are still required.

Product and ordinary-test files remain byte-identical to the merged `82165e7f`
reference that passed R48's source, ordinary and native gates. Their limits,
including five normal/two AX5 runtime priority warnings, remain attached. The
integration is unpublished; PR #782 still has published head `e503e5a6`.
