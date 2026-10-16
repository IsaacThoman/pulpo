#!/usr/bin/env python3
"""Independent primitive replay + full matrix paired comparison. Never rewrites oracles."""
import json, pathlib, sys
suite_path, baseline_path, candidate_path, output_path = map(pathlib.Path,sys.argv[1:])
suite=json.loads(suite_path.read_text()); bs=json.loads(baseline_path.read_text()); cs=json.loads(candidate_path.read_text())
# Swift Character segmentation via Swift, avoiding Python scalar/UTF16 assumptions.
import subprocess
strings=sorted({s for r in bs+cs for p in r['primitives'] for s in [p['before'],p['after'],p['value'],p['removed']]} | {s for c in suite['cases'] for s in [c['prefix'],c['selected'],c['suffix'],c['prefix']+c['selected']+c['suffix']]})
script='''import Foundation
let strings = try JSONDecoder().decode([String].self, from: FileHandle.standardInput.readDataToEndOfFile())
let arrays = strings.map { $0.map(String.init) }
FileHandle.standardOutput.write(try JSONEncoder().encode(arrays))
'''
script_path=pathlib.Path('/tmp/pulpo-r26-graphemes.swift');script_path.write_text(script)
r=subprocess.run(['swift',str(script_path)],input=json.dumps(strings).encode(),stdout=subprocess.PIPE,stderr=subprocess.PIPE,check=True)
gr=dict(zip(strings,json.loads(r.stdout)))
langs={'en_US','es','en_es'}
expected={(c['id'],l) for c in suite['cases'] for l in langs}
assert {(r['id'],r['language']) for r in bs}==expected and len(bs)==len(expected)
assert {(r['id'],r['language']) for r in cs}==expected and len(cs)==len(expected)
def replay(r,case):
    errors=[]
    state=case['prefix']+case['selected']+case['suffix']; cursor=len(gr[case['prefix']]); selection=len(gr[case['selected']])
    for i,p in enumerate(r['primitives']):
        before=gr[p['before']];cur=p['caretBefore'];n=p['selectionBefore'];v=gr[p['value']]
        if not 0<=cur<=len(before) or not 0<=n<=len(before)-cur: errors.append([i,'bounds']);continue
        if p['before']!=state or cur!=cursor or n!=selection: errors.append([i,'chain'])
        if p['kind']=='hostMove':
            removed=[];after=before;caret=p['caretAfter']
        elif p['kind']=='hostReplace':
            removed=before;after=v;caret=p['caretAfter']
        elif p['kind']=='insert':
            removed=before[cur:cur+n];after=before[:cur]+v+before[cur+n:];caret=cur+len(v)
        elif n:
            removed=before[cur:cur+n];after=before[:cur]+before[cur+n:];caret=cur
        else:
            removed=before[max(0,cur-1):cur];after=before[:max(0,cur-1)]+before[cur:];caret=max(0,cur-1)
        if ''.join(after)!=p['after'] or caret!=p['caretAfter'] or ''.join(removed)!=p['removed']:errors.append([i,'replay'])
        if not p['conserved'] or not p['bounded']:errors.append([i,'conservation'])
        state=p['after'];cursor=p['caretAfter'];selection=p['selectionAfter']
    if (state,cursor,selection)!=(r['actual'],r['actualCaret'],r['actualSelection']): errors.append(['final','chain'])
    return errors
bmap={(r['id'],r['language']):r for r in bs}; cmap={(r['id'],r['language']):r for r in cs}
rows=[]
for case in suite['cases']:
    for lang in sorted(langs):
        key=(case['id'],lang);b=bmap[key];c=cmap[key]
        assert b['expected']==c['expected']==case['expected'] and b['expectedCaret']==c['expectedCaret']==case['caret']
        for x in [b,c]:
            assert x['dictionary']==lang+'.pkdict' and x['modelMode']==x['settingsLanguage']==lang and x['modelIdentityVerified']
        assert b['dictionarySHA256']==c['dictionarySHA256']
        changed=(b['actual'],b['actualCaret'],b['actualSelection'])!=(c['actual'],c['actualCaret'],c['actualSelection'])
        rows.append({'id':case['id'],'language':lang,'input':case,'baseline':b,'candidate':c,'outputChanged':changed,'gain':not b['exact'] and c['exact'],'regression':b['exact'] and not c['exact'],'changedFailure':changed and not b['exact'] and not c['exact'],'baselineReplayErrors':replay(b,case),'candidateReplayErrors':replay(c,case)})
summary={
 'cases':len(suite['cases']),'executionsPerVersion':len(rows),'asserted':sum(r['candidate']['oracleDefined'] for r in rows),
 'ambiguous':sum(not r['candidate']['oracleDefined'] for r in rows),
 'baselineExact':sum(r['baseline']['exact'] for r in rows),'candidateExact':sum(r['candidate']['exact'] for r in rows),
 'gains':sum(r['gain'] for r in rows),'regressions':sum(r['regression'] for r in rows),
 'changedFailures':[(r['id'],r['language']) for r in rows if r['changedFailure']],
 'baselineUnavailable':sum(not r['baseline']['completed'] for r in rows),'candidateUnavailable':sum(not r['candidate']['completed'] for r in rows),
 'replayFailures':sum(bool(r['baselineReplayErrors'] or r['candidateReplayErrors']) for r in rows),
 'conservationFailures':sum(not r['baseline']['conserved'] or not r['candidate']['conserved'] for r in rows)
}
pathlib.Path(output_path).write_text(json.dumps({'summary':summary,'rows':rows},ensure_ascii=False,separators=(',',':'))+'\n')
print(json.dumps(summary,ensure_ascii=False,indent=2))
assert not summary['replayFailures']
