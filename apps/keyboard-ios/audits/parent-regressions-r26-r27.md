# Parent regression guards from R26/R27 review

Two informed controls are retained in normal core discovery. Neither changes
production or establishes a fresh accuracy gain.

`EmojiSearchTests.englishDiacriticAliasesKeepUsefulResults` protects established
English retrieval of llama (`vicuna`/`vicuña`), São Tomé (`sao`/`são`) and the
coconut alternative (`pina`/`piña`), including uppercase and decomposed variants.
The target must remain among the first eight choices. It does not define how a
Spanish query should be interpreted or require a frozen entire result list.
Current source passes the one parameterized method / three cases. In an isolated
archive of the exact rejected R27 commit `0d46d60b`, with only this current test
file copied in, it compiles successfully then fails all three cases with six
assertion failures: each unmarked lowercase/uppercase query loses its target.
The marked variants still work. This is stronger than the original append-only
short-query compatibility objection and is exposed development evidence.

`PostInsertionDestinationTests` uses a small forwarding TextDocument around the
existing MockDocument. After a comma physically inserts, the host silently
replaces its text with `FOREIGN|supplies`, keeping the same identifier and visible
suffix, without sending documentDidChange. The test requires no later engine
edits, exact text/caret and unchanged suffix. It uses actual EN/ES/bilingual
LanguageStacks and does not reference any rejected phrase enum or assume a new
transcript separator. Current source passes all three cases. An isolated exact
R26 archive at `f3921a48`, with only the new test file copied in, compiles then
fails all three cases / twelve assertions: the additional automatic space yields
`FOREIGN |supplies`, caret eight. This visible prefix change is distinguishable
from an identical stale proxy snapshot.

Both candidate commands exit one after successful compilation; neither candidate
was applied to the parent. Temporary locations and full compiler/test output are
recorded outside Git in `/tmp/pulpo-parent-negative-regressions.json` and each
listed directory's `result.txt`. Build times were 43.06s and 45.61s respectively;
filtered execution times were 0.342s and 0.001s. Current focused executions were
0.031s and 0.001s. These timings are verification costs, not product latency.

R26's original frozen result (48→93/120) remains valid only for its implemented
matrix; the new silent-interruption counterexample rejects its source. R27's
Spanish utility results likewise do not override its legacy retrieval losses or
initialization cost. Their original oracles, unavailable cases and failed gates
remain unchanged. These controls protect future independently evaluated fixes;
they do not approve either rejected implementation.
