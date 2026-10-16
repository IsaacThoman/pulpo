#!/usr/bin/env python3
"""Read-only audit of existing R49 JSON/files; never launches product/compiler.
Usage: python3 audit.py [work-root] [audit-root]
Outputs only to the script directory. Source build logs are never opened.
"""
from pathlib import Path
import sys,json,hashlib,collections,shutil,subprocess,tarfile
OUT=Path(__file__).resolve().parent
WORK=Path(sys.argv[1]) if len(sys.argv)>1 else Path('/tmp/pulpo-r48-r49-final-v3')
AUDIT=Path(sys.argv[2]) if len(sys.argv)>2 else Path('/Users/isaacthoman/.t3/worktrees/pulpo/t3-a3218df3/apps/keyboard-ios/audits/reset-integration-r49')
def sha(p):return hashlib.sha256(Path(p).read_bytes()).hexdigest()
def read(p):return json.loads(Path(p).read_text())
def write(n,x): (OUT/n).write_text(json.dumps(x,indent=2,ensure_ascii=False,allow_nan=False)+'\n')
checks=[]
def check(label,a,b):
 checks.append({'check':label,'expected':b,'actual':a,'pass':a==b})
 if a!=b:raise RuntimeError(label)
freeze=read(AUDIT/'execution-freeze-v3.json');config=read(WORK/'config.json');prep=read(WORK/'prepared.json');execution=read(WORK/'execution.json')
check('freeze SHA256',sha(AUDIT/'execution-freeze-v3.json'),'57fa7966b4d0f56424a2f1f4509ed0c29f7b93e8947eb79f7be79c5b3a577f90')
check('RUN-STARTED exact freeze', (WORK/'RUN-STARTED').read_text().strip(),sha(AUDIT/'execution-freeze-v3.json'))
for name,key in [('prepared.json','preparedSHA256'),('config.json','configSHA256')]:check(name,sha(WORK/name),freeze[key])
check('driver',sha(AUDIT/'paired-executor.py'),freeze['driverSHA256'])
check('author archive',sha(AUDIT/config['author']['archive']),freeze['authorArchiveSHA256'])
for n,h in freeze['authorFiles'].items():check('author/'+n,sha(WORK/'author'/n),h)
for g in freeze['gates'].values():check('gate/'+g['path'],sha(AUDIT/g['path']),g['sha256'])
for n,h in freeze['additionalMechanicsBindings'].items():check('mechanics/'+n,sha(AUDIT/n),h)
for v,pr,er in zip(config['versions'],prep['records'],execution):
 name=v['name'];check(name+' attempt',er['productAttempts'],1);check(name+' exit',er['exit'],0);check(name+' launched',er['launched'],True)
 check(name+' source archive',sha(AUDIT/v['archive']),v['archiveSHA256']);check(name+' sourceManifest',sha(WORK/pr['sourceManifest']),pr['sourceInventorySHA256'])
 check(name+' source map',read(WORK/pr['sourceManifest']),v['files'])
 for n,h in v['files'].items():
  check(name+'/archiveSource/'+n,sha(WORK/name/n),h)
  suffix=n.split('/Sources/KeyboardCore/')[1];check(name+'/compiledSource/'+suffix,sha(WORK/name/'PulpoKeyboardKit/Sources/KeyboardCore'/suffix),h)
 check(name+' source files',len(v['files']),25)
 check(name+' runner copied',sha(WORK/name/'client/Sources/BoundaryRunner/Runner.swift'),freeze['authorFiles']['Runner.swift'])
 check(name+' binary',sha(WORK/pr['binary']),pr['binarySHA256']);check(name+' launched binary hash',sha(Path(er['argv'][0]) if Path(er['argv'][0]).exists() else WORK/pr['binary']),pr['binarySHA256']);check(name+' environment',sha(WORK/pr['environment']),pr['environmentSHA256'])
 raw=read(WORK/name/'raw.json');env=read(WORK/pr['environment']);env['runtime']=freeze['runtime']['runnerRuntime'];check(name+' embedded environment',raw['environment'],env)
 check(name+' raw',sha(WORK/name/'raw.json'),er['rawSHA256']);check(name+' raw bytes',(WORK/name/'raw.json').stat().st_size,er['rawBytes'])
 for stream in ['stdout','stderr']:check(name+' runner '+stream,sha(WORK/name/('runner.'+stream)),er[stream+'SHA256']);check(name+' empty '+stream,(WORK/name/('runner.'+stream)).stat().st_size,0)
 check(name+' empty cwd',list((WORK/name/'empty-cwd').iterdir()),[])
 check(name+' frozen records',pr, next(x for x in freeze['preparedRecords'] if x['name']==name))
 check(name+' normal/-O exact stdout',(WORK/name/'evaluation-normal.stdout').read_bytes().hex(),(WORK/name/'evaluation-optimized.stdout').read_bytes().hex())
 for mode in ['normal','optimized']:check(name+' eval stderr '+mode,(WORK/name/('evaluation-'+mode+'.stderr')).stat().st_size,0)
# Invoke frozen evaluator as Python code only, without imports/cache/file mutation.
ns={'__file__':str(WORK/'author/evaluate.py'),'__name__':'frozen_evaluator'}
exec(compile((WORK/'author/evaluate.py').read_bytes(),str(WORK/'author/evaluate.py'),'exec'),ns)
fixture=read(WORK/'author/fixtures.json');oracle=read(WORK/'author/expectations.json');spec=oracle['operations'];ops=fixture['operations'];sessions={s['id']:s for s in oracle['sessions']}
ledger={};summaries={};store_ledger=[];families={};instances={};operation_evidence={}
for variant in ['comparison','candidate']:
 raw=read(WORK/variant/'raw.json');rows=raw['operations'];byid={r['id']:r for r in rows};events=[]
 def trace(frame,event,arg):
  if event=='call' and frame.f_code.co_name=='fail' and frame.f_code.co_filename==str(WORK/'author/evaluate.py'):
   msg=frame.f_locals['message'];caller=frame.f_back.f_locals
   aggregate='relation:'+str(caller['i']) if msg.startswith('relation ') else 'action:'+caller['id']
   events.append({'aggregate':aggregate,'message':msg})
  return trace
 sys.settrace(trace)
 try:code,report=ns['evaluate'](WORK/variant/'raw.json')
 finally:sys.settrace(None)
 check(variant+' frozen evaluator output exact object',report,read(WORK/variant/'evaluation-normal.stdout'))
 check(variant+' captured failures',[x['message'] for x in events],report['failures'])
 failed=collections.defaultdict(list)
 for ev in events:failed[ev['aggregate']].append(ev['message'])
 aggregate=[]
 for o in ops:
  sid=o.get('session');aggregate.append({'id':'action:'+o['id'],'kind':'action','operation':o['op'],'instances':[sid] if sid else [],'families':[sessions[sid]['family']] if sid else [],'passed':('action:'+o['id']) not in failed,'diagnostics':failed['action:'+o['id']]})
 for i,r in enumerate(oracle['relations']):
  ids=[r['record']] if 'record' in r else [r['left'],r['right']];sids=sorted({byid[id]['session'] for id in ids});aggregate.append({'id':'relation:'+str(i),'kind':'relation','relation':r,'operands':ids,'instances':sids,'families':sorted({sessions[sid]['family'] for sid in sids}),'passed':('relation:'+str(i)) not in failed,'diagnostics':failed['relation:'+str(i)]})
 ledger[variant]=aggregate
 # Independently calculate every relation predicate from raw complete projections.
 tol=oracle['tolerance'];close=lambda a,b:abs(a-b)<=tol['absolute']+tol['relative']*max(abs(a),abs(b))
 equal=lambda a,b:close(a['weight'],b['weight']) and all(close(a['offsets'][i][k],b['offsets'][i][k]) for i in range(26) for k in ['x','y'])
 zero=lambda a:close(a['weight'],0) and all(close(p[k],0) for p in a['offsets'] for k in ['x','y'])
 for a in aggregate[452:]:
  rel=a['relation'];r=byid[a['operands'][0]];s=r['state'];kind=rel['kind'];available=all(byid[id]['available'] and byid[id]['invoked'] and byid[id]['state'] is not None and byid[id]['status'] in ['ok','invalid'] for id in a['operands'])
  if kind=='equal':other=byid[a['operands'][1]];passed=equal(s,other['state']) and (not rel['files'] or r['files']==other['files'])
  elif kind=='changed':passed=not equal(s,byid[a['operands'][1]]['state'])
  elif kind=='zero':passed=zero(s)
  elif kind=='positive':passed=s['weight']>tol['absolute'] and any(abs(p[k])>tol['absolute'] for p in s['offsets'] for k in ['x','y'])
  elif kind=='all_keys_nonzero':passed=all(any(abs(p[k])>tol['absolute'] for k in ['x','y']) for p in s['offsets'])
  check(variant+' independently derived '+a['id'],available and passed,a['passed'])
 # Each full row retained separately, including all 26 offsets/files/inputs/outcomes.
 operation_evidence[variant]=rows
 for sid,s in sessions.items():
  assigned=[a for a in aggregate if sid in a['instances']];instances.setdefault(sid,{})[variant]={'assigned_aggregates':len(assigned),'failed_aggregate_ids':[a['id'] for a in assigned if not a['passed']],'pass':all(a['passed'] for a in assigned)}
 for fam in oracle['families']:
  assigned=[a for a in aggregate if fam['id'] in a['families']];families.setdefault(fam['id'],{})[variant]={'assigned_aggregates':len(assigned),'failed_aggregate_ids':[a['id'] for a in assigned if not a['passed']],'pass':all(a['passed'] for a in assigned)}
 for sid,s in sessions.items():
  if not s['persistent']:continue
  rs=[r for r in rows if r['session']==sid];directory=Path(next(r['resolvedInput']['url'] for r in rs if r['op']=='construct')).parent
  if not directory.exists():directory=OUT/'evidence/stores'/variant/sid
  actual=[{'path':str(p.relative_to(directory)),'bytes':p.stat().st_size,'sha256':sha(p)} for p in sorted(directory.rglob('*')) if p.is_file()]
  check(variant+' final store '+sid,actual,rs[-1]['files'])
  store_ledger.append({'variant':variant,'session':sid,'directory':str(directory),'canonicalDirectory':str(directory.resolve()),'finalRecord':rs[-1]['id'],'files':actual})
 summary={k:v for k,v in report.items() if k!='accounting'};summary.update({'evaluator_exit':code,'passed_aggregates':sum(a['passed'] for a in aggregate),'failed_aggregate_ids':[a['id'] for a in aggregate if not a['passed']],'failed_actions':sum(not a['passed'] for a in aggregate if a['kind']=='action'),'failed_relations':sum(not a['passed'] for a in aggregate if a['kind']=='relation'),'op_counts':dict(collections.Counter(o['op'] for o in rows)),'accounting':report['accounting'],'full26_model_projection_rows':sum(r['state'] is not None and len(r['state']['offsets'])==26 for r in rows),'persistent_inventory_rows':sum(bool(r['session']) and sessions[r['session']]['persistent'] for r in rows),'stateless_rows':sum(r['session'] is None for r in rows)})
 summaries[variant]=summary
bf={a['id'] for a in ledger['comparison'] if not a['passed']};cf={a['id'] for a in ledger['candidate'] if not a['passed']}
paired={'repaired':sorted(bf-cf),'losses':sorted(cf-bf),'common_failures':sorted(bf&cf),'common_passes':772-len(bf|cf),'comparison':summaries['comparison'],'candidate':summaries['candidate'],'families':families,'instances':instances,'allocation_note':'A cross-instance relation is assigned to every participating instance; instance assigned aggregate counts must not be summed. Aggregate denominator remains 772.'}
write('integrity-checks.json',checks);write('aggregate-ledger.json',ledger);write('paired-outcome.json',paired);write('operation-evidence.json',operation_evidence);write('store-ledger.json',store_ledger)
for entry in read(WORK/'evaluations.json'):
 check(entry['variant']+' recorded eval exit '+entry['mode'],entry['exit'],summaries[entry['variant']]['evaluator_exit'])
 for stream in ['stdout','stderr']:check(entry['variant']+' recorded eval '+stream+' '+entry['mode'],sha(WORK/entry['variant']/('evaluation-'+entry['mode']+'.'+stream)),entry[stream+'SHA256'])
write('integrity-checks.json',checks)
print(json.dumps({'checks':len(checks),'all_integrity_checks_pass':all(x['pass'] for x in checks),'comparison_passed':summaries['comparison']['passed_aggregates'],'candidate_passed':summaries['candidate']['passed_aggregates'],'repaired':paired['repaired'],'failed_instances':[i for i,v in instances.items() if not v['comparison']['pass']],'store_directories_verified':len(store_ledger)}))
