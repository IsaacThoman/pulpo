# English dictionary sources

Spanish and English + Español typing resources, source attribution, checksums,
reproduction and limitations are documented in [MULTILINGUAL.md](MULTILINGUAL.md).

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
topical histories are reserved within the 40,000-history cap. Emoji names,
sequences, order and skin tones are preserved; the English annotations below
add search keywords.

Evaluation uses unseen turns from the published splits; exact training-turn
duplicates are excluded after case/whitespace normalization. Evaluation source
SHA-256 checksums (these inputs are **not** used by the builder):

- `valid_freq.json`: `d14e8bde94fa5556d4aad8fd3fb666df674e4fef8b4193c8c3c06c72822a366b`
- `test_freq.json`: `3c65693d59e40a1fb58ead35dcfe85fbcc88ea93a4d74557df620996f72c8f08`
- `test_rare.json`: `4f21a18be16e310840280678e7bb4646852573b239b69183ddf8898f40119567`

Rebuild with the command in the parent README. Match these input checksums to
reproduce this dictionary; upstream downloads can change.

The bundled file preserves the original language-table payloads and appends the
literal vocabulary below. The current full builder additionally caps saturated
trigram interpolation bytes at 254: it normalizes 72 legacy values of 255. The
runtime already applies that same cap, so this full-rebuild difference is
semantically equivalent, but those 72 bytes will not be identical to this bundle.
The literal-section appender reproduces the bundle without changing those tables.

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

## Emoji search annotations

`emoji.json` retains its Unicode 18.0 catalog of 1,923 base emoji and adds English
keywords from [Unicode CLDR 48](https://github.com/unicode-org/cldr/tree/acd6d88ae493633240e19a87a721076a8a75c310),
revision `acd6d88ae493633240e19a87a721076a8a75c310` (the `release-48` tag),
under [Unicode License v3](UNICODE-LICENSE.txt). The original catalog had SHA-256
`48dcbaaf05396140fdc2d5e0c88c678bbbc6728e112b3f373b29c58dab591704`.
The source XML files remain outside the repository:

| Input | SHA-256 |
| --- | --- |
| [`common/annotations/en.xml`](https://raw.githubusercontent.com/unicode-org/cldr/acd6d88ae493633240e19a87a721076a8a75c310/common/annotations/en.xml) | `8511aadd046fdba2f0ffe590266ced8bbf48175ad139b2675d85d7141057b235` |
| [`common/annotationsDerived/en.xml`](https://raw.githubusercontent.com/unicode-org/cldr/acd6d88ae493633240e19a87a721076a8a75c310/common/annotationsDerived/en.xml) | `d76bd041c8c9e7b00b716aff8b7d9dbf509877010e191d5efd068be2553e066e` |

The importer merges keyword annotations and CLDR speech names by emoji sequence,
ignoring variation selector U+FE0F for lookup. Only sequences already in the
catalog are retained. Keywords are deduplicated and sorted deterministically;
inherited placeholders are excluded. It annotates 1,914 base emoji. Nine newer
emoji remain searchable by their existing Unicode names. The compact optional
`k` field adds 128,570 bytes, bringing the resource to 242,085 bytes with SHA-256
`2085015d3bd75b7046aecd244b1961230b37fd25ac8aca475c7bc4afabba8117`.
Old catalogs without `k` still decode and support name matching.

For a full language-data rebuild, repeat `--emoji-annotations` for both XML files
in the builder command from the parent README. To reproduce only the keyword
enrichment from the original or current catalog, run from `apps/keyboard-ios`
after downloading and checking the two inputs above:

```bash
PYTHONPATH=scripts python3 - <<'PY'
import json
from pathlib import Path
from build_language_data import add_emoji_keywords

path = Path('LanguageData/emoji.json')
catalog = json.loads(path.read_text(encoding='utf-8'))
add_emoji_keywords(catalog, [Path('/tmp/cldr-en.xml'), Path('/tmp/cldr-derived-en.xml')])
path.write_text(json.dumps(catalog, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
PY
python3 -m unittest discover -s scripts -p 'test_emoji_keywords.py'
```

Search builds a sorted index of complete names, name words, suffix phrases and
CLDR terms, retaining at most 12 ranked emoji per term. It finds prefixes by
binary search without storing every possible prefix. Names precede keywords;
prefixes follow exact matches; catalog order breaks ties. Case and accents are
folded for lookup, compounds also support spellings such as `thumbsup`, and
queries need at least three characters. Emoji suggestions are explicitly chosen
alternatives and do not change spelling-correction probabilities or decisions.

Spanish explicit emoji search also includes CLDR 48 speech names (`s`), from the
same pinned revision `acd6d88ae493633240e19a87a721076a8a75c310` (Unicode License v3):

| Source | SHA-256 |
| --- | --- |
| [`common/annotations/es.xml`](https://raw.githubusercontent.com/unicode-org/cldr/acd6d88ae493633240e19a87a721076a8a75c310/common/annotations/es.xml) | `fe8384e9cd2ee0998eb00ddf5549272eb5b56739e539ef33fedcd727fce5026a` |
| [`common/annotationsDerived/es.xml`](https://raw.githubusercontent.com/unicode-org/cldr/acd6d88ae493633240e19a87a721076a8a75c310/common/annotationsDerived/es.xml) | `ea9b3abc0a2c73a815faec1034764b6a503d14638ad4fb9556d8a7341838672c` |

Pass both files through repeated `--emoji-spanish-annotations` arguments when
building the catalog. The importer takes only `tts` speech names, joins sequences
ignoring VS16, rejects conflicting names/non-Spanish inputs, and retains only
existing base emoji. All original English fields and ordering stay intact.
There are 1,914 names; nine Unicode 18 entries have no CLDR48 Spanish name.

Explicit search accepts Spanish and mixed English/Spanish word prefixes, with
vowel accents folded and ñ distinct. Tokens are unique and canonical before
localized ranking/caps. Existing English matches remain first, and contextual
suggestions remain English. A conservative English reservation can leave unused
slots or suppress a localized match at tight caps; it makes the localized subset
stable when inherited English phrase ordering changes. ASCII one-letter searches,
recents and tone behavior retain their existing policy. No growing query cache or
network lookup is used. The R34 audit records the exact policy and acceptance gates.
