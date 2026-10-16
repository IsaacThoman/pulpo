# REJECT R15 for publication

Retain production baseline. Do not import candidate `ce44c06b`, its normal tests,
or a revised predicate under this experiment. The narrow anchored-path policy
has worthwhile gains, but four post-review ordinary-document regressions violate
its unchanged strict ordinary-regression gate. No post-reveal tuning or silent
relaxation of that gate is accepted.

Original frozen heldout outcomes remain **EN 21→31/44, ES 31→31/44,
bilingual 27→37/44**, with zero passing-case regressions in that specific set.
The twenty gains are ten templates repeated across two modes, including shared
targets in state-transition variants; they are not twenty independent language
improvements. No Spanish-only heldout improvement is established. Original
development, independent-author provenance, every outcome, raw-reference checks
and all known oracle defects remain preserved unchanged.

The later exposed diagnostic has four templates × three actual language modes:
**EN 4→2/4, ES 0→0/4, bilingual 4→2/4**. On EN/BI, `say //` + `teh ` changes
from `say //the ` to `say //teh `, and `/tmp/file;` + `teh ` changes from
`/tmp/file;the ` to `/tmp/file;teh `. Spaces and newlines after paths retain
correction. All twelve original observations and supplied ordinary oracles are
kept. This is post-review diagnostic evidence, not fresh blind/heldout evidence.

The independent reviewer initially favored retaining the change as a deliberate
literal-policy tradeoff: both prefixes satisfy the selected anchored-token
contract and can be legitimate path syntax. The parent rejects publication under
the predeclared strict gate rather than reclassifying these failures as passes.
The historical reviewer assessment and the stricter parent decision are distinct.

The [original agent audit](agent-audit.md) is verbatim history, including its
superseded retention recommendation. Its hash is preserved through that alias.
The [parent review, validator and reproduction](../technical-preservation-r15-parent/README.md)
document integrity checks, archived source/tests, exact rejected patch, native and
oracle limitations. No runtime source, assets, native fixture or compiled test
target was changed by this curation. Any future delimiter/component experiment
must be separate, use these exposed cases only for development and obtain fresh
independent heldout inputs.
