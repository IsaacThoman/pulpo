#!/usr/bin/env python3
"""Compare frozen full-document reports. Exit status is an explicit accuracy gate."""
import argparse,collections,hashlib,json,pathlib
p=argparse.ArgumentParser();p.add_argument('baseline');p.add_argument('candidate');p.add_argument('output');a=p.parse_args()
def read(path):
 rows=json.loads(pathlib.Path(path).read_text())
 indexed={(x['id'],x['timing']):x for x in rows}
 assert len(indexed)==len(rows), 'duplicate rows'
 return indexed
b=read(a.baseline);c=read(a.candidate)
assert b.keys()==c.keys(), 'different denominator'
summary={};results=[]
for key in b:
 x,y=b[key],c[key]
 for field in ['id','category','language','timing','expected','ambiguous']:assert x[field]==y[field],(key,field)
 outcome='stable-pass' if x['passed'] and y['passed'] else 'gain' if y['passed'] else 'regression' if x['passed'] else 'stable-failure'
 row={k:y.get(k) for k in ['id','timing','category','language','ambiguous','expected','actual','unavailable','personalCount']}
 row.update(baseline=x['actual'],outcome=outcome,baselinePassed=x['passed'],candidatePassed=y['passed'])
 results.append(row)
 if y['ambiguous']:continue
 for group in ['all','timing:'+y['timing'],'category:'+y['category'],'language:'+y['language']]:
  s=summary.setdefault(group,collections.Counter())
  s.update(total=1,before=int(x['passed']),after=int(y['passed']),gains=int(outcome=='gain'),regressions=int(outcome=='regression'),unavailable=int(x.get('unavailable') is not None or y.get('unavailable') is not None))
# No claim based on a successful test process or report write.
gate=summary['all']['gains']>0 and summary['all']['regressions']==0 and summary['all']['unavailable']==0
report=dict(raw_sha256={str(q):hashlib.sha256(pathlib.Path(q).read_bytes()).hexdigest() for q in [a.baseline,a.candidate]},summary=summary,accuracyGate=gate,rows=results)
pathlib.Path(a.output).write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
print(json.dumps(summary,indent=2));print('ACCURACY GATE',gate)
raise SystemExit(0 if gate else 1)
