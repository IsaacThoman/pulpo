R27 development evidence, before sealed reveal

Contract/schema/development committed at e78b2840 before relevant source reads.
Base production: 5e5153664a97b5aafe4995efc47836470043cb1b. Independent author
verified all exact input hashes; seal metadata is recorded separately.

API scope: measure.swift calls the actual EmojiSuggester.search and additionally
records EmojiSearch.results(EmojiSearchQuery, history:nil) strips. The former has
no language/context/history input; KeyboardController's static emojiResources and
refreshSearchResults use the same catalog/index for EN/ES/bilingual. We therefore
measure three query CONTENT strata, not pretend to exercise three search modes.
No KeyboardEngine or language-stack change. No device, Gboard, network runtime,
native rendering, unsupported-glyph filtering, or keystroke typing test claimed.
The panel query buffer and wrapper are unchanged. Empty core search yields [],
whereas the empty UI strip is an intentional recents/popular browse operation.
That existing wrapper also uses recents for tie-breaking and tone selection;
contract privacy/empty controls apply to the context-free search API, not a
request to remove the established personalized browse wrapper.

Development: 27 rows, 15 useful rows, 4 distinct target families, 12 controls.
Useful <=8: 8 -> 15; first3: 8 -> 15. Gains are 7 correlated rows across 3 new
families (heart/cat/party); coffee already worked through English cafe. All four
families retain prior useful results. No acceptable emoji unavailable. Controls:
8/9 applicable semantic controls -> 9/9, plus 3 unchanged baseline controls;
ñ discrimination was broken at baseline. No known-issue allowance added.

Every changed raw row was inspected (both entire sequences and top8): Spanish
heart (accented/plain/NFD) adds hearts but places heart-eye faces first and the
ordinary red heart at rank14. Mixed red corazón is [red heart, anatomical heart]
and uses only one frozen acceptable result; anatomical red heart is an extra,
not credited. Spanish gato puts cat first but cat-face rank11; bilingual gato cat
has three accepted alternatives in top8. Fiesta/party fiesta only find partying
face; no party-popper or confetti credit. English cat appends Qatar at rank18
(Spanish Catar prefix); its complete original ordering/top8 are retained. No
changed fail-to-fail useful row, lost accepted alternative, or useful regression
in development. Target families and variants are not independent samples.

Implementation: Spanish CLDR speech names only, +48,572 bytes (+20.1% resource,
no new base emoji); full keyword corpus avoided. New picker index keeps translated
aliases out of suggestions and places them after English terms. It intentionally
preserves ñ, requires all query words (including stopwords), and treats arbitrary
punctuation literally. Candidate normalization is not offered as a general
Unicode/transliteration policy. Whole source frozen before independent review.

Observed optimized index construction (single run): baseline 26ms -> candidate
238ms; extra index and precomputed word sets increase one-time work/memory.
KeyboardController constructs this once in a detached utility task, not on the
first-keystroke path. This is a material cost, not a speed improvement. Small
benchmarks cannot establish broad ranking quality or superiority to Gboard.
