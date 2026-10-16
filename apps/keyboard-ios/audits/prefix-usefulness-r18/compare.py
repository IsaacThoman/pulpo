#!/usr/bin/env python3
"""Pair complete synthetic outputs; never discard misses or missing targets."""
import json, math, pathlib, statistics, sys
baseline, candidate, destination, corpus = map(pathlib.Path, sys.argv[1:])
a, b = (json.loads(p.read_text()) for p in (baseline, candidate))
inputs = json.loads(corpus.read_text())['cases']
assert len({i['id'] for i in inputs}) == len(inputs)
expected = {(i['id'],stack):i for i in inputs for stack in ['en_US','es','en_es']}
for rows in (a,b):
    assert len(rows) == len(expected)
    assert len({(r['input']['id'],r['stack']) for r in rows}) == len(expected)
    assert {(r['input']['id'],r['stack']) for r in rows} == set(expected)
    assert all(r['input'] == expected[(r['input']['id'],r['stack'])] for r in rows)
assert [(r['input']['id'],r['stack']) for r in a] == [(r['input']['id'],r['stack']) for r in b]

def summarize(rows):
    out = {}
    for stack in ['all','en_US','es','en_es']:
        selected = [r for r in rows if (stack == 'all' or r['stack'] == stack) and r['input']['kind'] == 'completion']
        def timing(key):
            values = sorted(v for r in selected for v in (r[key] if isinstance(r[key],list) else [r[key]]))
            return dict(n=len(values),median=statistics.median(values),p95=values[math.ceil(len(values)*.95)-1],maximum=max(values)) if values else {}
        out[stack] = dict(n=len(selected),targetInLexicon=sum(r['targetInLexicon'] for r in selected),displayed=sum(r['displayedTarget'] for r in selected),accepted=sum(r['acceptedTarget'] for r in selected),useful=sum(r['useful'] for r in selected),saved=sum(r['saved'] for r in selected),unwantedSpaceOutcomes=sum(r['spaceUnwantedReplacement'] for r in selected),firstMicroseconds=timing('firstMicroseconds'),warmMicroseconds=timing('warmMicroseconds'))
    return out
pairs = [dict(id=x['input']['id'],stack=x['stack'],baseline=x,candidate=y,displayChanged=[(c['text'],c['kind'],c['automatic']) for c in x['choices']]!=[(c['text'],c['kind'],c['automatic']) for c in y['choices']],automaticChanged=x.get('automatic')!=y.get('automatic'),savedDelta=y['saved']-x['saved']) for x,y in zip(a,b)]
def controls(rows):
    return [dict(id=r['input']['id'],stack=r['stack'],kind=r['input']['kind'],targetDisplayed=r['displayedTarget'],targetAccepted=r['acceptedTarget'],automatic=r.get('automatic'),spaceDocument=r['spaceDocument'],backspaceDocument=r['backspaceDocument'],personalCount=r['personalCount'],choiceUndoFailures=[c['text'] for c in r['choices'] if not c['deletionUndoRestores']],privateChoiceLearning=[c['text'] for c in r['choices'] if r['input']['kind']=='private' and c['personalCount']!=0],literalChoices=[c for c in r['choices'] if c['kind']=='literal']) for r in rows if r['input']['kind']!='completion']
regressions=[]
for x,y in zip(a,b):
    key=x['input']['id']+'/'+x['stack']
    for field in ['automatic','spaceDocument','backspaceDocument']:
        if x.get(field)!=y.get(field): regressions.append(key+': '+field+' changed')
    if x['acceptedTarget'] and not y['acceptedTarget']: regressions.append(key+': accepted target lost')
    if y['saved']<x['saved']: regressions.append(key+': saved effort lost')
    for c in y['choices']:
        if not c['deletionUndoRestores']: regressions.append(key+': selected deletion Undo failed: '+c['text'])
        if y['input']['kind']=='private' and c['personalCount']: regressions.append(key+': private selection learned')
    if y['input']['kind']=='private' and y['personalCount']: regressions.append(key+': private commit learned')
result = dict(baseline=summarize(a),candidate=summarize(b),baselineControls=controls(a),candidateControls=controls(b),regressions=regressions,paired=pairs)
destination.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({k:v for k,v in result.items() if k not in ('paired','baselineControls','candidateControls')},ensure_ascii=False,indent=2))
if regressions: sys.exit(2)
