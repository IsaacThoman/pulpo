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

## Literal-only spelling vocabulary

`en_US.validwords.txt` contains 5,784 additional accepted spellings from the
[English Speller Database (ESDB)](https://github.com/en-wl/wordlist/tree/1e5b7d3a72f47a71da5d28686c1dd4b397178485),
revision `1e5b7d3a72f47a71da5d28686c1dd4b397178485`. The export uses size 60,
American English, variant level 1, and excludes abbreviation parts of speech:
`./scowl word-list 60 A 1 --wo-poses=abbr`. ESDB recommends size 60 for spelling
dictionaries and deliberately excludes some valid but easily confused rare forms.
The applicable copyright and permission notice is retained in [ESDB-LICENSE.txt](ESDB-LICENSE.txt).

The importer keeps only exact lowercase ASCII spellings of at least three letters.
It excludes all existing display spellings case-insensitively, including AOSP
`not_a_word` entries, and all explicit shortcut sources. Uppercase names and
abbreviations from the export are excluded. Apostrophes remain significant:
an existing `diff's` entry does not claim that `diffs` is already accepted.
No per-word exceptions are applied. The filtered UTF-8 resource has SHA-256
`271ef667373f216e12a3eea5a992f52499c90190de21cafd98b5b4c6175d27bb`.

The optional `VWRD` PKD1 section contains this list. It accepts and preserves typed
literals, including their casing, while existing alternatives remain available.
The supplement adds no calibrated language probabilities, correction targets,
predictions, or glide candidates; personal learning still applies to accepted
words. Older dictionaries without
the section remain readable. The appender leaves every original section payload,
word ID, and language statistic unchanged.

To reproduce the filtered resource from the pinned upstream source, outside the checkout:

```bash
git clone https://github.com/en-wl/wordlist.git /tmp/pulpo-esdb
git -C /tmp/pulpo-esdb checkout 1e5b7d3a72f47a71da5d28686c1dd4b397178485
cd /tmp/pulpo-esdb
make
./scowl word-list 60 A 1 --wo-poses=abbr > /tmp/pulpo-esdb-american60.txt
```

From `apps/keyboard-ios`, run:

```bash
python3 scripts/build_validation_words.py \
  --dictionary LanguageData/en_US.pkdict --words /tmp/pulpo-esdb-american60.txt \
  --filtered-output /tmp/en_US.validwords.txt --output /tmp/en_US.pkdict
```

A frozen audit of 571 clear English literals reduced rejected spellings from 16 to
6 and unwanted replacements from two to zero. All 42 curated typo controls retained
their previous outputs. Of 3,787 independently generated unknown typing errors,
four became valid spellings (`rial`, `ens` twice, and `wold`). Exact target correction
recall changed from 3,324 to 3,323: preserving the valid noun `wold` also preserves
that spelling when the intended word was `would`. The other three outputs had
previously been unrelated corrections. A broad CMUdict import was rejected because
names such as `Thier` and `Wich` would disable useful spelling corrections.
