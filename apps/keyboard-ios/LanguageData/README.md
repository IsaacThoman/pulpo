# English dictionary sources

The compiled `en_US.pkdict` contains 160,767 entries, 40,000 bounded trigram histories,
and interpolated conversational bigrams. It was built on October 13, 2026 using the
following inputs. Source text and downloaded archives are not checked in.

| Input | Source and attribution | SHA-256 |
| --- | --- | --- |
| `en_US_wordlist.combined.gz` | [Android Open Source Project, LatinIME](https://android.googlesource.com/platform/packages/inputmethods/LatinIME/+/refs/heads/main/dictionaries/en_US_wordlist.combined.gz), Apache 2.0 | `0f78dd455b532be169a23f233227b811fabced4b5bd7fc9c40cc05839793bcbd` |
| `eng_sentences.tsv.bz2` | [Tatoeba contributors, English export](https://downloads.tatoeba.org/exports/per_language/eng/), October 10, 2026 export, CC BY 2.0 FR | `0eabb52f54350bbb39807190920bfddaf9fee2ba50ca75af67e11a22ec475c29` |
| `SMSSpamCollection` | [Almeida, T. & Hidalgo, J. (2011), SMS Spam Collection, UCI](https://doi.org/10.24432/C5CC84), [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) | `7d039a24a6083ed9ef0f806ebad56bbb976e3aeb8de05669173bfdc4996c239d` |

The messaging input contributes 3,633 deduplicated, non-spam training messages.
The first byte of SHA-256 of the stripped, case-folded message, modulo five, assigns
the evaluation partition: zero is held out, other values are training. Only existing
lexicon forms enter the model; raw messages and numeric identifiers are not embedded.
Conversational interpolation is capped at 45% and decreases for sparse histories.

The build adapts these inputs into a memory-mapped trie and quantized language
statistics. AOSP `not_a_word` flags remain distinct from valid literals, and safe
spelling shortcuts are retained. Trigram histories require at least three observations,
with at most 24 successors per history. The original emoji catalog is unchanged.

Rebuild with the command in the parent README. Match these input checksums to
reproduce this dictionary; upstream downloads can change.
