#!/usr/bin/env python3
"""Aggregate compiler/index evidence; never changes vocabulary or eligibility."""
import collections
import hashlib
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
from build_language_data import normalize_key
from build_validation_words import dictionary_displays, read_sections, uints


def inspect(path):
    data = path.read_bytes()
    sections = dict(read_sections(data))
    words = dictionary_displays(sections.items())
    flags, frequencies = sections[b'WFLG'], sections[b'WFRQ']
    metadata = json.loads(sections[b'META'])
    reasons = collections.Counter()
    valid = eligible = 0
    for word, flag, frequency in zip(words, flags, frequencies):
        if flag & 33:
            continue
        valid += 1
        eligible += bool(flag & 2)
        if flag & 2:
            continue
        key = normalize_key(word)
        reason = ('short_or_non_ascii_key' if not re.fullmatch('[a-z]{2,}', key)
                  else 'uppercase' if word.isupper() else 'frequency_below_20')
        reasons[reason] += 1
    bucket_ids = uints(sections[b'GLID'])
    offsets = uints(sections[b'GLOF'])
    expected = {i for i, flag in enumerate(flags) if flag & 2}
    assert set(bucket_ids) == expected and len(bucket_ids) == len(expected)
    assert len(offsets) == 677 and offsets[-1] == len(bucket_ids)
    for bucket, (lo, hi) in enumerate(zip(offsets, offsets[1:])):
        for i in bucket_ids[lo:hi]:
            key = normalize_key(words[i])
            assert bucket == (ord(key[0]) - 97) * 26 + ord(key[-1]) - 97
    entries = {word: (frequency, flag) for word, frequency, flag in zip(words, frequencies, flags)}
    return dict(bytes=len(data), sha256=hashlib.sha256(data).hexdigest(), words=len(words),
                valid=valid, validGlideEligible=eligible, excludedValidReasons=dict(reasons),
                glideBucketIDs=len(bucket_ids), bucketFlagIdentity=True,
                unigramIntercept=metadata['unigramIntercept'], unigramSlope=metadata['unigramSlope']), entries


def main():
    report, entries = {}, {}
    for language in ['en_US', 'es', 'en_es']:
        report[language], entries[language] = inspect(ROOT / f'LanguageData/{language}.pkdict')
    for language in ['en_US', 'es']:
        lost = [word for word, (_, flags) in entries[language].items()
                if flags & 2 and not entries['en_es'][word][1] & 2]
        assert not lost
        report[language]['glideFlagsLostInBilingualMerge'] = len(lost)
    # Pinned source word shapes/frequency and corpus lifts determine eligibility;
    # the merge unions the flags rather than reapplying a quantized threshold.
    json.dump(report, sys.stdout, indent=2, sort_keys=True)
    print()


if __name__ == '__main__':
    main()
