#!/usr/bin/env python3
"""Pair complete synthetic outcomes without excluding failed or unavailable rows."""
import argparse,json,pathlib,statistics
p=argparse.ArgumentParser();p.add_argument('baseline');p.add_argument('candidate');p.add_argument('prefix');p.add_argument('--input',required=True);a=p.parse_args()
b=json.loads(pathlib.Path(a.baseline).read_text());c=json.loads(pathlib.Path(a.candidate).read_text())
key=lambda r:(r['id'],r['mode'])
bm={key(r):r for r in b};cm={key(r):r for r in c}
if len(bm)!=len(b) or len(cm)!=len(c): raise SystemExit('Duplicate report row')
inputs=json.loads(pathlib.Path(a.input).read_text())['cases']
expected_keys=[(r['id'],m) for r in inputs for m in ['en','es','bi']]
keys=list(dict.fromkeys([*expected_keys,*bm,*cm]))
if len(set(expected_keys))!=len(expected_keys) or not expected_keys: raise SystemExit('Empty/duplicate input')
def timing(rows):
 values=sorted(v for r in rows for v in r['keyMilliseconds'])
 return {'keys':len(values),'medianMs':statistics.median(values) if values else None,'p95Ms':values[min(len(values)-1,int(.95*len(values)))] if values else None,'maxMs':max(values) if values else None}
def state(row):
 return {'output':row['output'],'finalState':row.get('finalState'),'snapshots':[{k:v for k,v in s.items() if k!='milliseconds'} for s in row['snapshots']]}
summary={'inputTemplates':len(inputs),'expectedDenominator':len(expected_keys),'unexpectedRows':[k for k in keys if k not in set(expected_keys)],'baselineRows':len(b),'candidateRows':len(c),'denominator':len(keys),'missingBaseline':[k for k in keys if k not in bm],'missingCandidate':[k for k in keys if k not in cm],'infrastructureErrors':[(r['id'],r['mode'],e) for r in b+c for e in r['oracleErrors'] if e.startswith(('schema:', 'malformed:', 'unsupported', 'unavailable:'))],'modes':{},'timings':{'baseline':timing(b),'candidate':timing(c)}}
paired=[]
for k in keys:
 x=bm.get(k);y=cm.get(k)
 paired.append({'id':k[0],'mode':k[1],'baseline':x,'candidate':y})
for mode in ['en','es','bi']:
 rows=[(bm[k],cm[k]) for k in keys if k[1]==mode and k in bm and k in cm]
 summary['modes'][mode]={'denominator':sum(k[1]==mode for k in keys),'baselinePass':sum(x['correct'] for x,y in rows),'candidatePass':sum(y['correct'] for x,y in rows),'gains':[y['id'] for x,y in rows if not x['correct'] and y['correct']],'regressions':[y['id'] for x,y in rows if x['correct'] and not y['correct']],'remainingMisses':[y['id'] for x,y in rows if not y['correct']],'oracleErrorsBaseline':{x['id']:x['oracleErrors'] for x,y in rows if x['oracleErrors']},'oracleErrorsCandidate':{y['id']:y['oracleErrors'] for x,y in rows if y['oracleErrors']},'ordinaryStateChanges':[y['id'] for x,y in rows if y['category']=='ordinary' and state(x)!=state(y)],'changedOutputs':[y['id'] for x,y in rows if x['output']!=y['output']]}
 summary['modes'][mode]['categories']={category:{'rows':sum(y['category']==category for x,y in rows),'baselinePass':sum(x['correct'] for x,y in rows if y['category']==category),'candidatePass':sum(y['correct'] for x,y in rows if y['category']==category),'regressions':[y['id'] for x,y in rows if y['category']==category and x['correct'] and not y['correct']]} for category in sorted({y['category'] for x,y in rows})}
prefix=pathlib.Path(a.prefix)
prefix.with_suffix('.summary.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2)+'\n')
prefix.with_suffix('.paired.jsonl').write_text(''.join(json.dumps(r,ensure_ascii=False,separators=(',',':'))+'\n' for r in paired))
print(json.dumps(summary,ensure_ascii=False,indent=2))
