#!/usr/bin/env python3
"""Compact exact-document paired report; process success does not imply accuracy acceptance."""
import collections, hashlib, json, pathlib, sys
base_path, candidate_path, destination = map(pathlib.Path, sys.argv[1:])
a, b = (json.loads(p.read_text()) for p in [base_path, candidate_path])
assert [(r['id'],r['timing']) for r in a] == [(r['id'],r['timing']) for r in b]
rows=[]
for x,y in zip(a,b):
 assert all(x.get(k)==y.get(k) for k in ['id','expected','expectedCaret','category','language','ambiguous','timing'])
 def compact(r):
  return {k:r[k] for k in ['actual','actualCaret','actualSelectionLength','passed','unavailable','personalCount','lagReports','externalChanges','primitiveCount','queuedRequests','queuedApplied','conservationFailures'] if k in r}
 rows.append({**{k:y[k] for k in ['id','timing','language','category','ambiguous','expected']},'expectedCaret':y.get('expectedCaret'),'baseline':compact(x),'candidate':compact(y)})
scored=[r for r in rows if not r['ambiguous']]
def counts(rs):
 return dict(total=len(rs),baseline=sum(r['baseline']['passed'] for r in rs),candidate=sum(r['candidate']['passed'] for r in rs),gains=sum(not r['baseline']['passed'] and r['candidate']['passed'] for r in rs),regressions=sum(r['baseline']['passed'] and not r['candidate']['passed'] for r in rs),unavailable=sum('unavailable' in r['baseline'] or 'unavailable' in r['candidate'] for r in rs),conservationFailures=sum(len(r[s].get('conservationFailures',[])) for r in rs for s in ['baseline','candidate']))
report=dict(hashes={str(p.name):hashlib.sha256(p.read_bytes()).hexdigest() for p in [base_path,candidate_path]},counts=counts(scored),allCases=counts(rows),diagnosticCounts=counts([r for r in rows if r["ambiguous"]]),diagnostics=len(rows)-len(scored),byTiming={t:counts([r for r in scored if r['timing']==t]) for t in sorted({r['timing'] for r in scored})},byLanguage={t:counts([r for r in scored if r['language']==t]) for t in sorted({r['language'] for r in scored})},rows=rows)
destination.write_text(json.dumps(report,indent=2,ensure_ascii=False)+'\n')
print(json.dumps({k:v for k,v in report.items() if k!='rows'},indent=2))
