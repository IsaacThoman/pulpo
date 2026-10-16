#!/usr/bin/env python3
"""Pair unchanged exact oracles and independently replay full-document primitives."""
import argparse, collections, json, pathlib
p=argparse.ArgumentParser()
p.add_argument('suite');p.add_argument('baseline');p.add_argument('candidate');p.add_argument('output')
a=p.parse_args()
cases=json.loads(pathlib.Path(a.suite).read_text())['cases']
b=json.loads(pathlib.Path(a.baseline).read_text());c=json.loads(pathlib.Path(a.candidate).read_text())
assert [x['id'] for x in cases]==[x['id'] for x in b]==[x['id'] for x in c]
def replay(case, result):
    # Suites deliberately use uncomplicated NFC scalars, also single Swift Characters.
    text=case['prefix']+case['selected']+case['suffix']
    cursor=len(case['prefix']);selected=case['selected']
    for op in result['primitives']:
        assert cursor==op['cursor'], (case['id'],'primitive cursor')
        assert selected==op['selected'], (case['id'],'selection')
        assert text[cursor:cursor+len(selected)]==selected
        if op['kind']=='insert':
            assert op['removed']==selected
            text=text[:cursor]+op['text']+text[cursor+len(selected):]
            cursor+=len(op['text'])
        elif op['kind']=='delete':
            if selected:
                assert op['removed']==selected
                text=text[:cursor]+text[cursor+len(selected):]
            elif cursor:
                assert op['removed']==text[cursor-1]
                text=text[:cursor-1]+text[cursor:];cursor-=1
        else: raise AssertionError(op['kind'])
        selected=''
        assert text.startswith(case['prefix']) and text.endswith(case['suffix']), (case['id'],'host conservation')
        assert len(case['prefix'])<=cursor<=len(text)-len(case['suffix'])
    assert text==result['actual'] and cursor==result['actualCaret'], (case['id'],'final replay')
    assert result['conserved']
    oracle=case.get('availability')!='ambiguous'
    assert result['oracleDefined']==oracle
    assert result['exact']==(oracle and result['completed'] and text==case['expected'] and cursor==case['caret'])
rows=[]
for case,left,right in zip(cases,b,c):
    replay(case,left);replay(case,right)
    if not left['oracleDefined']: outcome='ambiguous'
    elif left['exact'] and not right['exact']: outcome='regression'
    elif not left['exact'] and right['exact']: outcome='gain'
    elif not left['completed'] or not right['completed']: outcome='unavailable'
    elif right['exact']: outcome='pass'
    else: outcome='failure'
    rows.append({'case':case,'baseline':left,'candidate':right,'outcome':outcome})
summary={'total':len(rows),'oracleDefined':sum(x['baseline']['oracleDefined'] for x in rows),
 'baselineExact':sum(x['baseline']['exact'] for x in rows),'candidateExact':sum(x['candidate']['exact'] for x in rows),
 'baselineUnavailable':sum(not x['baseline']['completed'] for x in rows),
 'candidateUnavailable':sum(not x['candidate']['completed'] for x in rows),
 'outcomes':dict(collections.Counter(x['outcome'] for x in rows)),
 'regressionIDs':[x['case']['id'] for x in rows if x['outcome']=='regression'],
 'failureIDs':[x['case']['id'] for x in rows if x['outcome'] in ('failure','unavailable')],
 'ambiguousChangedIDs':[x['case']['id'] for x in rows if x['outcome']=='ambiguous' and (x['baseline']['actual'],x['baseline']['actualCaret'])!=(x['candidate']['actual'],x['candidate']['actualCaret'])],
 'primitiveReplay':'all full documents/carets/selection replacements/conservation verified'}
pathlib.Path(a.output).write_text(json.dumps({'schema':1,'summary':summary,'pairs':rows},ensure_ascii=False,indent=2)+'\n')
print(json.dumps(summary,ensure_ascii=False,indent=2))
