import collections
import hashlib
import json
import re
from pathlib import Path

ROOT = Path('/tmp/pulpo-r12-53439f72/heldout-author')
SEED = 'pulpo-r12-independent-heldout-20261016-53439f72-v1'
PROTOCOL = Path('/Users/isaacthoman/.t3/worktrees/pulpo/t3-53439f72/apps/keyboard-ios/audits/suppression-consistency-r12/protocol.md')
EXCLUSIONS = Path('/tmp/pulpo-r12-53439f72/exclusions.json')
METADATA = Path('/tmp/pulpo-r12-53439f72/metadata.json')

def sha(b):
    return hashlib.sha256(b).hexdigest()

def rank(domain, spelling):
    return sha((SEED + ':' + domain + ':' + spelling).encode()), spelling

source_bytes = {str(p): p.read_bytes() for p in (PROTOCOL, EXCLUSIONS, METADATA)}
exclusion_list = json.loads(source_bytes[str(EXCLUSIONS)])
metadata = json.loads(source_bytes[str(METADATA)])
excluded = {s.casefold() for s in exclusion_list}
# The protocol names development-only synthetic controls, independently excluded.
protocol_personal = {'velunaro', 'dexumali', 'torivane', 'mexulora', 'zanifelo', 'lumavero'}
used = set(excluded) | protocol_personal
conflict_pool = [s for s, entry in metadata['en_es'].items() if entry['flags'] & 3 == 3 and s.casefold() not in used]
conflicts = []
for spelling in sorted(conflict_pool, key=lambda s: rank('conflict', s)):
    if spelling.casefold() not in used:
        conflicts.append(spelling)
        used.add(spelling.casefold())
    if len(conflicts) == 12:
        break
assert len(conflicts) == 12
langs = ['en_US', 'es', 'en_es']
contexts = {'en_US': 'we said ', 'es': 'dijimos ', 'en_es': 'we dijimos '}
neutral_pool = [s for s, entry in metadata['en_US'].items()
                if re.fullmatch('[a-z]{4,10}', s)
                and entry['flags'] & 2 and not entry['flags'] & 33
                and s in metadata['es']
                and metadata['es'][s]['flags'] & 2
                and not metadata['es'][s]['flags'] & 33]
neutral = {}
for lang in langs:
    chosen = []
    for spelling in sorted(neutral_pool, key=lambda s: rank('neutral:' + lang, s)):
        if spelling.casefold() not in used:
            chosen.append(spelling)
            used.add(spelling.casefold())
        if len(chosen) == 6:
            break
    assert len(chosen) == 6
    neutral[lang] = chosen

all_known = {s.casefold() for lexicon in metadata.values() for s in lexicon}
consonants, vowels = 'bcdfghjklmnprstvz', 'aeiou'
personal = {}
for lang in langs:
    chosen = []
    i = 0
    while len(chosen) < 2:
        digest = hashlib.sha256((SEED + ':personal:' + lang + ':' + str(i)).encode()).digest()
        spelling = ''.join((consonants if j % 2 == 0 else vowels)[digest[j] % len(consonants if j % 2 == 0 else vowels)] for j in range(8))
        i += 1
        if spelling.casefold() in used or spelling.casefold() in all_known:
            continue
        chosen.append(spelling)
        used.add(spelling.casefold())
    personal[lang] = chosen

rows = []
def add(lang, kind, spelling, index):
    rows.append({'id': f'heldout-{lang}-{kind}-{index:02d}', 'language': lang,
                 'context': contexts[lang], 'target': spelling, 'kind': kind})
for lang in langs:
    for kind in ['conflict', 'learnedConflict', 'literal']:
        for i, spelling in enumerate(conflicts, 1):
            add(lang, kind, spelling, i)
    for i, spelling in enumerate(neutral[lang], 1):
        add(lang, 'neutral', spelling, i)
    for kind in ['personal', 'privacy', 'secure']:
        for i, spelling in enumerate(personal[lang], 1):
            add(lang, kind, spelling, i)

# Validate the exact exported schema, target disjointness, flags, novelty and coverage.
assert len(rows) == 144 and len({r['id'] for r in rows}) == 144
assert all(set(r) == {'id', 'language', 'context', 'target', 'kind'} for r in rows)
assert not ({r['target'].casefold() for r in rows} & excluded)
assert len({r['target'].casefold() for r in rows}) == 36
assert all(metadata['en_es'][s]['flags'] & 3 == 3 for s in conflicts)
assert len({s.casefold() for s in conflicts}) == 12
for lang in langs:
    assert len([r for r in rows if r['language'] == lang]) == 48
    for kind in ['conflict', 'learnedConflict', 'literal']:
        assert [r['target'] for r in rows if r['language'] == lang and r['kind'] == kind] == conflicts
    assert all(re.fullmatch('[a-z]{4,10}', s) for s in neutral[lang])
    for s in neutral[lang]:
        for mono in ['en_US', 'es']:
            flags = metadata[mono][s]['flags']
            assert flags & 2 and not flags & 33
    for s in personal[lang]:
        assert s.isascii() and s.isalpha() and s == s.lower()
        assert s.casefold() not in all_known
assert len({s for chosen in neutral.values() for s in chosen}) == 18
assert len({s for chosen in personal.values() for s in chosen}) == 6
assert all(r['context'].endswith(' ') for r in rows)

heldout_bytes = (json.dumps(rows, ensure_ascii=False, indent=2) + '\n').encode()
(ROOT / 'heldout.json').write_bytes(heldout_bytes)
counts = {
    'rows': len(rows), 'unique_targets_casefolded': 36, 'conflict_targets': 12,
    'neutral_targets': 18, 'synthetic_personal_targets': 6,
    'by_language': dict(collections.Counter(r['language'] for r in rows)),
    'by_kind': dict(collections.Counter(r['kind'] for r in rows)),
    'by_language_and_kind': {lang: dict(collections.Counter(r['kind'] for r in rows if r['language'] == lang)) for lang in langs},
}
authorship = {
    'role': 'independent sealed held-out author',
    'selection_seed': SEED,
    'seed_declared_before_target_selection': True,
    'selection_algorithm': {
        'conflicts': 'First 12 casefold-distinct remaining en_es flags&3==3 entries sorted by SHA256(seed + :conflict: + exact spelling), with spelling as tie-breaker.',
        'neutral': 'For each language in en_US, es, en_es order: first six unused lowercase ASCII length 4..10 exact shared EN/ES entries with flags&2 and no flags&33 in both; sort by SHA256(seed + :neutral: + language + : + spelling), with spelling tie-breaker.',
        'synthetic': 'Per language, increment counter from zero; SHA256(seed + :personal: + language + : + decimal counter); map first eight bytes alternately to bcdfghjklmnprstvz and aeiou; accept first two unused and casefold-absent across every metadata dictionary.',
    },
    'heldout_path': str(ROOT / 'heldout.json'),
    'heldout_sha256': sha(heldout_bytes),
    'counts': counts,
    'read_provenance': [{'path': p, 'sha256': sha(b), 'bytes': len(b)} for p, b in source_bytes.items()],
    'exclusions_validation': {
        'source_entries': len(exclusion_list),
        'source_unique_casefolded': len(excluded),
        'selected_target_overlap_casefolded': 0,
        'casefold_unique_selected_targets': 36,
        'neutral_groups_mutually_disjoint': True,
        'target_categories_mutually_disjoint': True,
        'synthetic_unknown_in_all_metadata_casefolded': True,
        'protocol_development_synthetic_controls_also_excluded': True,
        'all_assertions_passed': True,
    },
    'conflict_metadata_exact_spelling_absence_by_language': {lang: sum(s not in metadata[lang] for s in conflicts) for lang in langs},
    'independence': {
        'permitted_inputs_only': True,
        'ranking_or_compiler_implementation_read': False,
        'development_inputs_or_outputs_read': False,
        'proposed_fixes_read': False,
        'parent_implementation_history_inspected': False,
        'inference_run': False,
        'git_or_other_checkout_edits': False,
        'targets_or_context_content_returned_to_implementer': False,
        'seal': 'Do not reveal heldout.json until implementer freezes at most one candidate or explicit no-change decision with source/resource hashes.',
    },
}
authorship_bytes = (json.dumps(authorship, ensure_ascii=False, indent=2) + '\n').encode()
(ROOT / 'authorship.json').write_bytes(authorship_bytes)
print(json.dumps({'heldout_path': str(ROOT / 'heldout.json'), 'heldout_sha256': sha(heldout_bytes), 'authorship_path': str(ROOT / 'authorship.json'), 'authorship_sha256': sha(authorship_bytes), 'counts': counts}, indent=2))
