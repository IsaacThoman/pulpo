# Pre-fresh domain clarifications

The independent review is preserved as domain-review.md. It permits a bounded
development experiment, not fresh admission or any empirical claim. Before
first inference, these definitions complete the original rule without changing
its 0.75 coefficient or activation conditions:

- Personal-only candidates with no lexicon ID retain their original score
  exactly. Every ID-bearing candidate uses the same prediction adjustment,
  including personal successors; the original string supplies personal terms.
- Earlier token means precedingWord (second token before cursor); previousWord
  is the shared-history token. Existing case-insensitive ID lookup is retained.
- Sparse source successors are stored in strictly increasing remapped ID order;
  every original ID/score pair and backoff byte is conserved. This is an added
  table ordering choice, not a change to original BI tables or ranking policy.
- Primary gain/loss means BI scored top3 miss-to-hit/hit-to-miss. An improved
  family contains >=1 such gain and no scored top3 loss in any mode; count once.
  Zero scored target losses applies to top3 hit-to-miss in ALL THREE modes.
  Secondary center/RR losses are fully reported but do not independently block.
  RR ranks center,left,right for three slots, index1,index0 for two, index0 for
  one; exact display strings only. Ambiguous/control rows never add successes.
- Costs mean measured execution time/storage, not inaccessible per-slot engine
  ranking scores. All actual displayed suggestions are captured. Optional
  model-level pool diagnostics, if collected, are separately labelled and do
  not stand in for Engine outputs. The final public API/schema must say this.
- observe reads engine.suggestions without reconciling silent host changes.
  Stale selection tests must reach real engine.select before any reconciliation
  or callback; the primitive trace proves whether it mutated the destination.

The required final schema/API smoke remains pending. Fresh authoring is blocked
until it passes review and all supported actions/Unicode fixtures execute.
