import json,sys,math,collections
from pathlib import Path
out=Path('/tmp/pulpo-r12-53439f72')
name=sys.argv[1]
a=json.loads((out/f'baseline-{name}.json').read_text());b=json.loads((out/f'candidate-{name}.json').read_text())
assert [(r['id'],r['profile']) for r in a]==[(r['id'],r['profile']) for r in b]
regressions=[];changes=[]; subgroups={}
for x,y in zip(a,b):
 fields=['decoder','engineCandidates','rawDocument','finalDocument','phantomSpace','slots','candidateTarget','slotTarget','exactDocument','initialPersonalCount','finalPersonalCount']
 changed=[f for f in fields if x[f]!=y[f]]
 if changed:changes.append({'id':x['id'],'profile':x['profile'],'kind':x['kind'],'fields':changed,'baselineFinal':x['finalDocument'],'candidateFinal':y['finalDocument'],'baselineCandidates':x['decoder'],'candidateCandidates':y['decoder'],'baselineSlots':x['slots'],'candidateSlots':y['slots']})
 if x['kind'] in ('neutral','learnedConflict','personal','literal'):
  for field in ('candidateTarget','exactDocument','slotTarget'):
   if x[field] and not y[field]:regressions.append({'id':x['id'],'profile':x['profile'],'field':field})
 if x['kind'] in ('privacy','secure') and y['initialPersonalCount']!=y['finalPersonalCount']:regressions.append({'id':x['id'],'profile':x['profile'],'field':'learning'})
 key=f"{x['language']}/{x['kind']}/path{x['profile']}"
 g=subgroups.setdefault(key,{'n':0,'baselineRecall':0,'candidateRecall':0,'baselineExact':0,'candidateExact':0,'baselineSlot':0,'candidateSlot':0})
 g['n']+=1
 for pref,r in [('baseline',x),('candidate',y)]:
  g[pref+'Recall']+=r['candidateTarget'];g[pref+'Exact']+=r['exactDocument'];g[pref+'Slot']+=r['slotTarget']
confA=[x for x in a if x['language']=='en_es' and x['kind']=='conflict'];confB=[x for x in b if x['language']=='en_es' and x['kind']=='conflict']
p95=lambda rows: sorted(x['decodeMs'] for x in rows if x['kind']!='literal')[math.ceil(sum(x['kind']!='literal' for x in rows)*.95)-1]
r={'rows':len(a),'regressions':regressions,'changedRows':len(changes),'subgroups':subgroups,'bilingualConflict':{k:[sum(x[f] for x in confA),sum(x[f] for x in confB)] for k,f in [('returned','candidateTarget'),('committed','exactDocument'),('slots','slotTarget')]},'p95DecodeMs':[p95(a),p95(b)],'warmTimingGate':p95(b)<=50 and p95(b)<=p95(a)*1.15+1,'changes':changes}
r['behaviorGate']=not regressions and r['bilingualConflict']['returned'][1]<r['bilingualConflict']['returned'][0] and all(r['bilingualConflict'][k][1]<=r['bilingualConflict'][k][0] for k in ('committed','slots')) and all(x['exactDocument'] for x in b if x['kind']=='literal')
(out/f'{name}-comparison.json').write_text(json.dumps(r,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({k:v for k,v in r.items() if k not in ('changes','subgroups')},indent=2))
