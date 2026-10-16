#!/usr/bin/env python3
"""Run an immutable R19 input through the opt-in Swift replay and retain metadata."""
import argparse, hashlib, json, os, pathlib, subprocess, time
p=argparse.ArgumentParser()
p.add_argument('--package', required=True)
p.add_argument('--input', required=True)
p.add_argument('--report', required=True)
a=p.parse_args()
input_path=pathlib.Path(a.input).resolve()
report=pathlib.Path(a.report).resolve()
if report.exists(): raise SystemExit('Refuse to overwrite an existing report; preserve every run')
package=pathlib.Path(a.package).resolve()
cases=json.loads(input_path.read_text())['cases']
case_keys={'id','category','before','after','operations','expected','expectedByMode','notes'}
op_keys={'op','text','count','offset','start','end','enabled','expectDocument','expectDocumentByMode','expectNoLearning','expectNoAutocorrection','expectAutocorrection','expectCursor','expectSelection','expectUndoAvailable','expectLearns','expectAutocorrects','expectLearningUnchanged'}
schema_errors=[]
for item in cases:
 for key in item.keys()-case_keys: schema_errors.append(f"{item['id']}: unknown case key {key}")
 for i,op in enumerate(item['operations']):
  for key in op.keys()-op_keys: schema_errors.append(f"{item['id']}/{i}: unknown operation key {key}")
if schema_errors: print(json.dumps({'schemaErrors':schema_errors,'templates':len(cases),'denominator':3*len(cases)}))
def digest(p): return hashlib.sha256(p.read_bytes()).hexdigest()
engine_hash=digest(package/'Sources/KeyboardCore/Input/KeyboardEngine.swift')
runner_hash=digest(package/'Tests/KeyboardCoreTests/AnchoredGrammarReplayTests.swift')
env=dict(os.environ, PK_R19_CASES=str(input_path),PK_R19_REPORT=str(report))
command=['swift','test','--package-path',str(package),'-c','release','--filter','AnchoredGrammarReplayTests']
start=time.monotonic()
result=subprocess.run(command,env=env,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True)
elapsed=time.monotonic()-start
# Output remains ephemeral, never a versioned raw build log.
lines=result.stdout.splitlines()
summary=[s for s in lines if any(k in s for k in ['Build complete','R19 exact','Test run with','error:','warning:'])]
if result.returncode: print(result.stdout)
else: print('\n'.join(summary))
metadata={'schemaErrors':schema_errors,'command':command,'inputSHA256':digest(input_path),'engineSHA256':engine_hash,'runnerSHA256':runner_hash,'sourceStableDuringRun':engine_hash==digest(package/'Sources/KeyboardCore/Input/KeyboardEngine.swift') and runner_hash==digest(package/'Tests/KeyboardCoreTests/AnchoredGrammarReplayTests.swift'),'templates':len(cases),'denominator':3*len(cases),'exitCode':result.returncode,'wallSeconds':elapsed,'summary':summary}
report.with_suffix('.metadata.json').write_text(json.dumps(metadata,indent=2)+'\n')

if report.exists():
 rows=json.loads(report.read_text())
 expected={(c['id'],m) for c in cases for m in ['en','es','bi']}
 actual=[(r['id'],r['mode']) for r in rows]
 if set(actual)!=expected or len(actual)!=len(expected): raise SystemExit('Incomplete/duplicate report pairing')
else:
 unavailable=[{'id':c['id'],'mode':m,'category':c['category'],'expected':c.get('expectedByMode',{}).get(m,c['expected']),'output':'','correct':False,'oracleErrors':['unavailable: runner did not produce report'],'snapshots':[],'keyMilliseconds':[],'finalState':None,'unavailable':'runner did not produce report'} for c in cases for m in ['en','es','bi']]
 report.write_text(json.dumps(unavailable,indent=2)+'\n')
 raise SystemExit(f'Unavailable report: retained {len(cases)*3} unavailable rows')
raise SystemExit(result.returncode)
