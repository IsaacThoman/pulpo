# English dictionary sources

The compiled `en_US.pkdict` contains 160,767 entries, 40,000 bounded trigram histories,
and interpolated conversational bigrams and trigrams. It was built on October 13, 2026 using the
following inputs. Source text and downloaded archives are not checked in.

| Input | Source and attribution | SHA-256 |
| --- | --- | --- |
| `en_US_wordlist.combined.gz` | [Android Open Source Project, LatinIME](https://android.googlesource.com/platform/packages/inputmethods/LatinIME/+/refs/heads/main/dictionaries/en_US_wordlist.combined.gz), Apache 2.0 | `0f78dd455b532be169a23f233227b811fabced4b5bd7fc9c40cc05839793bcbd` |
| `eng_sentences.tsv.bz2` | [Tatoeba contributors, English export](https://downloads.tatoeba.org/exports/per_language/eng/), October 10, 2026 export, CC BY 2.0 FR | `0eabb52f54350bbb39807190920bfddaf9fee2ba50ca75af67e11a22ec475c29` |
| `SMSSpamCollection` | [Almeida, T. & Hidalgo, J. (2011), SMS Spam Collection, UCI](https://doi.org/10.24432/C5CC84), [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) | `7d039a24a6083ed9ef0f806ebad56bbb976e3aeb8de05669173bfdc4996c239d` |
| Topical-Chat `conversations/train.json` | [Amazon.com, Inc. or its affiliates, Topical-Chat](https://github.com/alexa/Topical-Chat/tree/7c939229cbcf6f55f6977b341a5a2f2fe982d53f/conversations), [CDLA-Sharing 1.0](https://github.com/alexa/Topical-Chat/blob/7c939229cbcf6f55f6977b341a5a2f2fe982d53f/DATALICENSE) | `39a079d8464ea5f44f0fd78dbc85fd4eed96303347cbf4f9301f823e3c0f437f` |

The messaging input contributes 3,633 deduplicated, non-spam training messages.
The first byte of SHA-256 of the stripped, case-folded message, modulo five, assigns
the evaluation partition: zero is held out, other values are training. Only existing
lexicon forms enter the model; raw messages and numeric identifiers are not embedded.
Topical-Chat contributes 183,511 deduplicated training turns from the published
8,628-conversation training split. Its validation and test splits are never used
for training. Reading sets, URLs, speaker IDs and other metadata are excluded.
The dictionary contains aggregate quantized n-gram statistics, not source turns.
The source dataset is licensed under CDLA-Sharing 1.0; the compiled statistics are
computational results (section 3.5). Amazon's attribution and license link are
retained here and in the binary metadata.

The general-English, topical-conversation and SMS distributions are kept separate.
Each conversational domain receives at most 45% interpolation weight, decreasing
with its observed support. The general model is mixed with topical conversation,
then SMS, so the larger topical corpus cannot drown out short-message evidence.

The build adapts these inputs into a memory-mapped trie and quantized language
statistics. AOSP `not_a_word` flags remain distinct from valid literals, and safe
spelling shortcuts are retained. Trigram histories require at least three observations,
in general English or two observations within a conversational domain, with at most
24 successors per history. Supported SMS histories and up to 20,000 frequent
topical histories are reserved within the 40,000-history cap. The original emoji
catalog is unchanged.

Evaluation uses unseen turns from the published splits; exact training-turn
duplicates are excluded after case/whitespace normalization. Evaluation source
SHA-256 checksums (these inputs are **not** used by the builder):

- `valid_freq.json`: `d14e8bde94fa5556d4aad8fd3fb666df674e4fef8b4193c8c3c06c72822a366b`
- `test_freq.json`: `3c65693d59e40a1fb58ead35dcfe85fbcc88ea93a4d74557df620996f72c8f08`
- `test_rare.json`: `4f21a18be16e310840280678e7bb4646852573b239b69183ddf8898f40119567`

Rebuild with the command in the parent README. Match these input checksums to
reproduce this dictionary; upstream downloads can change.
