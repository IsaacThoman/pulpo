# Parent inherited-text protection regression

`KeyboardEngineTests.repeatedSuffixHostMoveDoesNotCorrectInheritedWord` extracts
R16's observable moved-caret failure into one small always-on core regression,
using the existing MockDocument and all three actual language stacks. It checks
the full physical document, caret and zero deletion primitives on explicit Space.
No abstract experimental oracle, candidate source or modified fuzzer is imported.

Current production passes all three parameter cases. Full parent Release gates
pass **439 core + three service tests**, retaining the same five known issues.
The identical test is also compiled against immutable rejected engine
`1b6fc872` in `/tmp/pulpo-r16-parent-negative/`, exported from `f17109e7` plus
only that engine and the current test file. It fails with **four assertions**:
unwanted deletions and wrong full documents in English and bilingual; Spanish
passes. This causal red replay exits1; original source is never applied to the
working tree. No fresh accuracy gain or native coverage is claimed.

R16's 36 sealed cases remain unread and unexecuted. The independent artifact
verifier checks all retained hashes/counts and source/fuzzer restoration; the
new negative replay is additional behavioral evidence, not a replacement for
the original failed acceptance gates. Logs/build products remain external.
