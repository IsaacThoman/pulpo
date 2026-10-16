#!/usr/bin/env python3
"""Evaluator mutation tests using exposed actual baseline rows and synthetic candidate states.
These are evaluator tests, not evidence that any production candidate passes.
"""
import copy,importlib.util,json,pathlib,subprocess,sys,tempfile
p=pathlib.Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('check',p/'check.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
packet=json.loads((p/'development-schema2.json').read_text());baseline=json.loads((p/'development-baseline-preedit.json').read_text())
candidate=copy.deepcopy(baseline)
ix={(r['id'],r['index']):r for r in candidate};bi={(r['id'],r['index']):r for r in baseline}
for rel in packet['relations']:
 if rel['kind']=='parity':
  e,s=tuple(rel['external']),tuple(rel['space'])
  for k in ('weight','offsets'):ix[e][k]=copy.deepcopy(bi[s][k])
for rel in packet['relations']:
 if rel['kind']=='hold':
  a,z=tuple(rel['from']),tuple(rel['to'])
  for k in ('weight','offsets'):ix[z][k]=copy.deepcopy(ix[a][k])
# Every source-independent exact assertion remains checked; fix any expected selection fixture errors separately.
report=m.evaluate(packet,baseline,candidate)
m.require(report['status']=='PASS','synthetic passing fixture failed: '+str(report['failures'][:3]))
results=[]
def mutation(name,change):
 q,b,c=copy.deepcopy(packet),copy.deepcopy(baseline),copy.deepcopy(candidate)
 try:
  change(q,b,c);r=m.evaluate(q,b,c);rejected=r['status']!='PASS'
 except Exception:rejected=True
 m.require(rejected,'mutation escaped: '+name);results.append(name)
mutation('offset-only',lambda q,b,c:c[1]['offsets'][25].__setitem__(1,.001))
mutation('wrong-second-increment',lambda q,b,c:next(r for r in c if r['id']=='dev-en_US-full' and r['index']==8).__setitem__('weight',9))
mutation('follow-on-duplicate',lambda q,b,c:c[2].__setitem__('weight',6))
mutation('missing-row',lambda q,b,c:c.pop())
mutation('extra-row',lambda q,b,c:c.append(copy.deepcopy(c[-1])))
mutation('reordered-row',lambda q,b,c:c.reverse())
mutation('duplicate-row',lambda q,b,c:c.__setitem__(1,copy.deepcopy(c[0])))
mutation('wrong-operation',lambda q,b,c:c[0].__setitem__('op','callback'))
mutation('wrong-language',lambda q,b,c:c[0].__setitem__('language','es'))
mutation('wrong-word-count',lambda q,b,c:c[1]['counts'].__setitem__('music',8))
mutation('wrong-total',lambda q,b,c:c[1].__setitem__('total',8))
mutation('wrong-policy',lambda q,b,c:c[1].__setitem__('learns',False))
mutation('scalar-replaced-text',lambda q,b,c:c[1].__setitem__('text','café🎉'))
mutation('nan-offset',lambda q,b,c:c[0]['offsets'][0].__setitem__(0,float('nan')))
mutation('infinite-weight',lambda q,b,c:c[0].__setitem__('weight',float('inf')))
mutation('short-offsets',lambda q,b,c:c[0]['offsets'].pop())
mutation('missing-field',lambda q,b,c:c[0].pop('counts'))
mutation('unknown-expect-watch',lambda q,b,c:q['cases'][0]['expect'][0].__setitem__('counts',{'missing':None}))
mutation('vacuous-positive',lambda q,b,c:q['relations'][0].__setitem__('samples',0))
mutation('wrong-reference-history',lambda q,b,c:q['cases'][1]['ops'][0].__setitem__('text','other'))
def rollback(q,b,c):
 rel=next(r for r in q['relations'] if r['kind']=='hold' and r['to']==['dev-en_US-full',2])
 rel['from'][1]=0
 row=next(r for r in c if r['id']=='dev-en_US-full' and r['index']==2)
 row['weight']=0;row['offsets']=[[0,0] for _ in range(26)]
mutation('hold-plan-rollback',rollback)
def missing_zero(q,b,c):
 q['relations']=[r for r in q['relations'] if r['kind']!='zero']
 for row in b+c:
  if row['id']=='dev-control-decline':row['offsets'][25][1]=.001
mutation('missing-zero-plan-both-variants-offset-drift',missing_zero)
mutation('missing-second-occurrence-coverage',lambda q,b,c:[r.__setitem__('witness','first') for r in q['relations'] if r['kind']=='parity' and r['witness']=='second-occurrence'])
mutation('missing-second-word-coverage',lambda q,b,c:[r.__setitem__('witness','first') for r in q['relations'] if r['kind']=='parity' and r['witness']=='second-word'])
mutation('missing-follow-on-plan',lambda q,b,c:q['relations'].remove(next(r for r in q['relations'] if r['kind']=='hold')))
# Stale full raw output cannot turn a failed process into a passing gate.
with tempfile.TemporaryDirectory(prefix='pulpo-r47-check-') as td:
 t=pathlib.Path(td)
 for name,data in [('input',packet),('baseline',baseline),('candidate',candidate),('process',{'baseline':{'exit':0,'stderr':''},'candidate':{'exit':1,'stderr':'unavailable'}})]: (t/(name+'.json')).write_text(json.dumps(data))
 r=subprocess.run([sys.executable,str(p/'check.py'),str(t/'input.json'),str(t/'baseline.json'),str(t/'candidate.json'),str(t/'process.json'),str(t/'report.json')],capture_output=True,text=True)
 m.require(r.returncode!=0 and json.loads((t/'report.json').read_text())['status']=='WHOLE_GATE_ERROR','failed process escaped')
 results.append('failed-process-with-stale-complete-output')
 for name,record in [('boolean-exit',{'exit':False,'stderr':''}),('float-exit',{'exit':0.0,'stderr':''}),('explicit-unavailable',{'exit':0,'stderr':'','unavailable':True}),('unknown-process-key',{'exit':0,'stderr':'','unknown':False})]:
  (t/'process.json').write_text(json.dumps({'baseline':{'exit':0,'stderr':''},'candidate':record}))
  r=subprocess.run([sys.executable,str(p/'check.py'),str(t/'input.json'),str(t/'baseline.json'),str(t/'candidate.json'),str(t/'process.json'),str(t/'report.json')],capture_output=True,text=True)
  m.require(r.returncode!=0 and json.loads((t/'report.json').read_text())['status']=='WHOLE_GATE_ERROR',name+' escaped');results.append(name)
 r=subprocess.run([sys.executable,str(p/'run-pair.py'),str(t/'input.json'),str(t/'missing-binary'),str(t/'missing-binary'),str(t),str(t/'launch-failure')],capture_output=True,text=True)
 m.require(r.returncode!=0 and json.loads((t/'launch-failure/report.json').read_text())['status']=='WHOLE_GATE_ERROR','launch failure not retained')
 m.require(json.loads((t/'launch-failure/process.json').read_text())['candidate']['unavailable'] is True,'launch unavailable missing');results.append('launch-failure-portable-receipt')
print(json.dumps({'syntheticGoodPacket':report['status'],'mutationCount':len(results),'rejected':results},sort_keys=True))
