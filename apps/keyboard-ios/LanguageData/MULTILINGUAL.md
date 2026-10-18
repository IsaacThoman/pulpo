# Spanish and bilingual typing data

`es.pkdict` contains 236,193 Spanish entries, 111,412 bigrams, 40,000 trigram
histories, and 95,062 trigram continuations. `en_es.pkdict` combines the existing
English resource and Spanish into 392,087 entries, 360,196 bigrams, and 79,993
trigram histories. These are bundled resources; no runtime download or content
upload is introduced. English mode still opens the original `en_US.pkdict`.

## Licensed inputs

- [AOSP LatinIME Spanish dictionary](https://android.googlesource.com/platform/packages/inputmethods/LatinIME/+/127336e9f29d69607eab55982324b210279ae8c5/dictionaries/es_wordlist.combined.gz),
  revision `127336e9f29d69607eab55982324b210279ae8c5`. Copyright 2008 The Android
  Open Source Project; Apache 2.0. Its notice and full license are retained in
  [AOSP-LICENSE.txt](AOSP-LICENSE.txt). Imported and compiled into Pulpo's PKD1
  format, with frequency calibration, normalization, trie and glide indexes.
- [Tatoeba Spanish sentences](https://downloads.tatoeba.org/exports/per_language/spa/),
  2026-10-10 export, 442,544 sentences by Tatoeba contributors,
  [CC BY 2.0 FR](https://creativecommons.org/licenses/by/2.0/fr/).
  The [terms of reuse](https://tatoeba.org/en/terms_of_use#section-6) describe the
  attribution requirement. [TATOEBA-SPANISH-AUTHORS.txt](TATOEBA-SPANISH-AUTHORS.txt)
  credits 1,952 named contributors from the matching detailed export; unowned
  sentences are also present. Only aggregate quantized n-gram statistics enter
  the binary, with sentence text, identifiers and timestamps omitted.
- English inputs and their attribution remain in [README.md](README.md).

The two Spanish exports must contain identical IDs, language fields and sentence
text in identical order. The builder checks this before generating contributor
attribution. Source archives stay outside the repository.

Pinned SHA-256 digests:

```text
889ad52bce2933e2a30a0560b8d5a76f5334500e776a7db7c7cb3e9e79fc2652  es_wordlist.combined.gz
d1f7aa997368571e8bbba341ab60f9145fefe14970f21065bd97be8e03c8e6fb  spa_sentences.tsv.bz2
3141acd2354ecbb65199268ec222f680a232ca494129ba77b53a16b3890a11e0  spa_sentences_detailed.tsv.bz2
168c21378b29aa7fd37838aed910d64348b5267389abfd2dacd0598247cf1e64  en_US.pkdict (existing English input)
66a256a487f451812ec53920b2a5f2dea9aafb77fbf8e50240a0b87d2729e7fb  es.pkdict
93d2d22d58e7e753771dd0e29b19036d74a5ec7aeafba703724c24a93e581237  en_es.pkdict
acc6388b3bff0048563d4a92256c59ed88f61d8ab385b3e81267f89318007980  TATOEBA-SPANISH-AUTHORS.txt
```

## Reproduction

Download the three pinned source inputs outside the checkout. Gitiles serves
the AOSP archive as base64 when `?format=TEXT` is appended to the source URL:

```sh
curl -L --fail 'https://android.googlesource.com/platform/packages/inputmethods/LatinIME/+/127336e9f29d69607eab55982324b210279ae8c5/dictionaries/es_wordlist.combined.gz?format=TEXT' | base64 --decode > /tmp/es_wordlist.combined.gz
curl -L --fail 'https://downloads.tatoeba.org/exports/per_language/spa/spa_sentences.tsv.bz2' -o /tmp/spa_sentences.tsv.bz2
curl -L --fail 'https://downloads.tatoeba.org/exports/per_language/spa/spa_sentences_detailed.tsv.bz2' -o /tmp/spa_sentences_detailed.tsv.bz2
```

From `apps/keyboard-ios`:

```sh
python3 scripts/build_multilingual_data.py \
  --wordlist /tmp/es_wordlist.combined.gz \
  --sentences /tmp/spa_sentences.tsv.bz2 \
  --detailed /tmp/spa_sentences_detailed.tsv.bz2
python3 -m unittest discover -s scripts -p 'test_multilingual_data.py'
```

The builder rejects changed inputs rather than silently accepting a newer
Tatoeba export. Retrieve the matching snapshot if upstream has rotated it.
`--output-dir` allows byte-for-byte reproduction in a separate directory.

## Model and scope

Spanish uses the existing compiler's corpus-calibrated unigram probabilities,
absolute-discount bigrams and bounded interpolated trigrams. English-specific
extra words, shortcuts, validation supplement and example-name exclusions are
not imported into Spanish. The original spelling, including accents and ñ, is
stored separately from the ASCII-normalized lookup/path key. `ano` and `año`
remain distinct entries sharing geometry. Existing correct-literal protection
preserves their spelling; unaccented unknowns can offer accented candidates.

The bilingual compiler remaps every word, history and continuation ID into a
single trie. Spanish unigrams are calibrated onto English's frequency scale,
then both languages share an equal unigram prior. Exact shared spellings are
deduplicated using the stronger prior. Histories present in both models mix
equally; histories present in one keep that model's probabilities. The existing
normalized backoff covers unlisted vocabulary. The English literal supplement
is preserved. No code-switching corpus or inferred language state is claimed.

Correction, completion and swipe share the selected trie and model. Accents use
base-key geometry, so swipe retains the dictionary's accented display form.
Both vocabularies are valid in bilingual mode, but ambiguous short inputs may
favor another language. In the frozen acceptance benchmark, bilingual `hols`
places `hola` sixth among correction candidates, behind English `hold` variants;
choose Español for stronger Spanish correction. Short-prefix `hel` → `hello`
is already weak in the original English model; bilingual `hol` also omits `hola`
from the bounded completion list. These misses are retained as known test issues
and are not presented as accepted benchmark cases.

The added dictionaries occupy 42,668,888 uncompressed bytes (15.3 MB Spanish,
27.4 MB bilingual). Only the active mode is cached, using memory mapping; living
overlapping controllers can temporarily retain earlier mappings. Real-device
extension memory/latency and broad dialect/noisy-swipe quality need further
measurement. This is general Spanish vocabulary with QWERTY accent holds, not
a dedicated regional layout, Spanish emoji search, UI translation or a change
to dictation. Learned vocabulary remains one shared, local personal dictionary,
with the existing privacy policy and learning switch.
