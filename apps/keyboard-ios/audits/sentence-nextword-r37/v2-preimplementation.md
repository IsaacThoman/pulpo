# V2 pair-aware local source backoff: pre-implementation contract

V1 is rejected on development usefulness: 0 top3 gains, 0 losses across 16 BI
prompts (10/16 both versions), 4 activated, 3 changed; the archive preserves its
exact inactive patch and all 48 engine outputs. Original development cases all
have exact trigrams. There has been no fresh author or reveal.

This is a new candidate rule, recorded before its production edits. The v1
preimplementation contract, domain clarifications, resource/cost/usefulness/
safety/freshness gates all remain binding except the following source-hint
definition. The interpolation coefficient, Q/B/personal formula, shared previous
history requirement, no-exact-trigram requirement, both-source candidate pool,
source section conservation and explicit-mode isolation stay EXACTLY the same.

V1's assumption that exact spelling membership gives enough local context is
too restrictive: loanwords, names and shared forms can appear in both large
dictionaries even when the local pair has single-source evidence. V2 preserves
the general observed preceding→previous pair's source membership as a bounded
signal, and uses strong relative unigram evidence as a fallback for the earlier
word. Neither is a semantic word list or target-derived exception.

For an eligible shared previous-word history, resolve precedingWord with the
existing lexicon ID lookup. Find previousWord in the existing <=48 successor
row of precedingWord. If that exact stored pair was present in exactly one
source's bounded bigram table, choose that source. If the pair is absent,
truncated, or present in both sources, use the earlier word's source hint:
exclusive exact-spelling membership chooses that source; for shared spellings,
choose a source ONLY if its original calibrated monolingual unigram probability
is >=8 times the other's. Otherwise no hint and exact original behavior. Do not
use the previous word's popularity as a hint or infer from text beyond the pair.

Data: retain BMEM low two bits as exact spelling membership. Bits 2–3 encode
the shared-spelling unigram hint (0 ambiguous,1 English,2 Spanish); no other
bits. Original calibrated source log probabilities determine the >=log(8)
threshold at compile time, before any fresh outputs. Unique spelling bytes stay
1 or 2. Add BPMS one byte per ORIGINAL bilingual BGID entry, encoding whether
the pair occurred in source1/source2/both (1,2,3). Bilingual sentence-start rows
may be encoded but cannot activate a preceding-word hint. BPMS length equals
BGID; invalid masks/lengths reject the resource. Membership, <=605 sparse rows,
and BPMS should add <850 KB total, within the unchanged 1 MiB asset/storage
gates. No new stacks/cache/lexicon scan. Metadata version2 identifies this data.

This candidate undergoes another independent pre-implementation domain review.
Existing exposed pilot targets are now development only, cannot be broadened
based on outputs. Additional development cases must be authored before their
first execution and remain exposed; no new fresh benchmark is spent until a
complete reviewed executable contract/schema and candidate show real utility.
If this rule still lacks useful development evidence, reject it honestly and
preserve the evidence; never relabel grammatical appearance as an accuracy gain.
