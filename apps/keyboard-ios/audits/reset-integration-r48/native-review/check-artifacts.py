"""Bounded read-only parent accounting of completed R48 runs, not a native runner."""
from pathlib import Path
import collections,gzip,hashlib,json,re,subprocess
ROOT=Path('/Users/isaacthoman/.t3/worktrees/pulpo/t3-a3218df3')
P=Path('/tmp/pulpo-r48-parent-validation')
A=ROOT/'apps/keyboard-ios/audits/reset-integration-r48'
PIN='82165e7ffda344165fc9116027a4b6f3ffacd4f5'
def need(ok,msg):
 if not ok:raise ValueError(msg)
def sha(b):return hashlib.sha256(b).hexdigest()
def read(p):return json.loads(p.read_bytes())
def git(*args):return subprocess.check_output(['git',*args],cwd=ROOT)
def methods(x):
 out=[]
 def walk(n):
  if n.get('nodeType')=='Test Case':out.append(n)
  for c in n.get('children',[]):walk(c)
 for n in x['testNodes']:walk(n)
 return out
inventory={str(f.relative_to(ROOT))for d in ('App','AppTests','UITests','PulpoKeyboardKit/Sources')for f in(ROOT/'apps/keyboard-ios'/d).rglob('*.swift')}
results=[]
for label in ('merged-normal','merged-debug-normal','merged-debug-ax5'):
 outcome=read(P/(label+'-outcome.json'));summary=read(P/(label+'-summary.json'));tests=read(P/(label+'-tests.json'));receipt=read(P/(label+'-source-binaries.json'));command=read(P/(label+'-command.json'));fixture=read(P/(label+'-fixture.json'));session=read(P/(label+'-gate-session.json'))
 need(outcome['summary']==summary,'summary differs from outcome')
 request=[a.split(':',1)[1]for a in command if a.startswith('-only-testing:')]
 need(request==outcome['testsRequested'],'requested suite mismatch')
 rows=methods(tests);keys=[r['nodeIdentifier']for r in rows]
 need(len(set(keys))==len(keys)==(8 if label=='merged-debug-ax5' else 25),'method identity/denominator')
 need(set(k.split('/')[0]for k in keys)=={s.split('/')[1]for s in request},'suite coverage differs')
 expected=set()
 for cls in {s.split('/')[1]for s in request}:
  matches=[]
  for folder in ('AppTests','UITests'):
   for f in(ROOT/'apps/keyboard-ios'/folder).glob('*.swift'):
    txt=f.read_text()
    if re.search(r'\bclass '+re.escape(cls)+r'\b',txt):matches.append(txt)
  need(len(matches)==1,'source class not unique '+cls)
  expected|={cls+'/'+m+'()'for m in re.findall(r'\bfunc (test\w+)\s*\(',matches[0])}
 need(set(keys)==expected,'requested source method denominator differs')
 counts=dict(collections.Counter(r['result']for r in rows))
 need(counts.get('Passed',0)==summary['passedTests']and counts.get('Failed',0)==summary['failedTests']and counts.get('Skipped',0)==summary['skippedTests'],'method summary counts differ')
 need(set(receipt['sources'])==inventory,'recorded Swift source scope incomplete')
 for name,h in receipt['sources'].items():
  need(sha((ROOT/name).read_bytes())==h,'current source hash '+name)
  need(sha(git('show',PIN+':'+name))==h,'82165 source hash '+name)
 for name,h in receipt['binaries'].items():need(sha(Path(name).read_bytes())==h,'binary hash '+name)
 need(len(receipt['binaries'])==3,'binary denominator')
 markers=outcome['markers'];nonce=session['nonce'];root=Path(session['root'])
 need(markers['session.json']['fixtureReceiptSHA256']==sha((P/(label+'-fixture.json')).read_bytes()),'fixture binding')
 need(markers['session.json']['deviceUDID']==fixture['deviceUDID']=='0FD9B95B-D450-4276-A110-ECA608AB48E7','owned device binding')
 need(markers['session.json']['group']==fixture['groupContainer']==session['groupContainer'],'group binding')
 need(outcome['gateExit']==0,'gate exit')
 need(outcome['complete']==markers['complete.json'],'complete binding')
 need(markers['complete.json']['completed']==sorted(['busy-on','busy-off','io-on','forget-busy']),'gate cases')
 expected_names={'session.json','complete.json'}|{c+'.'+s+'.json'for c in('busy-on','busy-off','io-on','forget-busy')for s in('request','active','release','released')}
 need(set(markers)==expected_names,'marker inventory')
 for name,value in markers.items():
  need(value['nonce']==nonce,'marker nonce '+name)
  need(read(root/name)==value,'retained/live completed marker mismatch '+name)
 for case in('busy-on','busy-off','io-on','forget-busy'):
  need(markers[case+'.request.json']['caseKey']==case,'request binding')
  active=markers[case+'.active.json'];released=markers[case+'.released.json']
  need(active['active']is True and active['caseKey']==case and type(active['lockInode'])is int and type(active['lockDevice'])is int,'active binding')
  need(active['fault']==('directory-at-lock-path'if case=='io-on'else'held-flock'),'fault mismatch')
  need(released['active']is False and released['error']is None and released['caseKey']==case,'release restoration error')
 capture=read(A/'parent-validation'/(label+'-capture-manifest.json'))
 for e in capture:
  data=(A/'parent-validation'/e['retained']).read_bytes()
  need(sha(data)==e['retainedSHA256'],'retained capture hash')
  if e['retained'].endswith('.gz'):data=gzip.decompress(data)
  need(sha(data)==e['sourceSHA256'],'source capture hash')
  need(sha((root/e['sourceName']).read_bytes())==e['sourceSHA256'],'original session capture hash')
 results.append({'label':label,'exit':outcome['exit'],'gateExit':outcome['gateExit'],'methods':[{k:r[k]for k in('nodeIdentifier','result')}for r in rows],'counts':counts,'suiteCount':len(request),'runtimeWarnings':summary['runtimeWarnings'],'SwiftSourceHashesChecked':len(inventory),'binaryHashesChecked':len(receipt['binaries']),'receiptHead':receipt['head'],'matches82165':True,'hostFaultCases':4,'hostMarkersChecked':len(markers),'captureHashesChecked':len(capture),'fixtureSHA256':sha((P/(label+'-fixture.json')).read_bytes())})
R,D=map(lambda s:read(P/(s+'-source-binaries.json')),('merged-normal','merged-debug-normal'))
need(R['sources']==D['sources'],'Release vs Debug source differs')
AX=read(P/'merged-debug-ax5-source-binaries.json')
need(D['sources']==AX['sources'] and D['binaries']==AX['binaries'],'Debug normal vs AX bytes differ')
original=ROOT/'apps/keyboard-ios/audits/r33-ui-integration-r41/host_fault_gate.py.txt'
prov=read(A/'host-gate-provenance.json');derived=(A/'host_fault_gate.py').read_bytes()
need(sha(original.read_bytes())==prov['sourceSHA256']and sha(derived)==prov['derivedSHA256'],'gate source binding')
need(original.read_bytes().replace(b'R41-owned-test-store',b'R48-owned-test-store')==derived,'gate behavior diff beyond label')
core=read(P/'core-services-summary.json');events=(P/'swift-events.jsonl').read_bytes();need(sha(events)==core['eventSHA256'],'core event digest')
parsed=[json.loads(l)for l in events.splitlines()]
counts={};issues=[]
for module in('KeyboardCoreTests','PulpoServicesTests'):
 defs=[x['payload']for x in parsed if x['kind']=='test'and x['payload']['id'].startswith(module+'.')]
 ev=[x['payload']for x in parsed if x['kind']=='event'and x['payload'].get('testID','').startswith(module+'.')]
 observed={'definedFunctions':sum(x['kind']=='function'for x in defs),'definedSuites':sum(x['kind']=='suite'for x in defs),'startedFunctions':sum(x['kind']=='testStarted'and any(d['id']==x['testID']and d['kind']=='function'for d in defs)for x in ev),'endedFunctions':sum(x['kind']=='testEnded'and any(d['id']==x['testID']and d['kind']=='function'for d in defs)for x in ev),'skippedFunctions':sum(x['kind']=='testSkipped'and any(d['id']==x['testID']and d['kind']=='function'for d in defs)for x in ev)}
 need(observed==core[module],'structured ordinary counts '+module);counts[module]=observed
for x in parsed:
 if x['kind']=='event'and x['payload']['kind']=='issueRecorded':issues.append(x['payload'])
need(len(issues)==5 and all(x['issue']['isKnown'] is True and x['issue']['isFailure'] is False for x in issues),'ordinary known/nonfailure issue classification')
print(json.dumps({'scope':'completed native structured artifacts and byte checks; no native/build/product execution','runs':results,'releaseDebugSwiftSourceMapsIdentical':True,'hostHelperOnlyLabelChanged':True,'coreEventsRecomputed':counts,'knownIssues':len(issues),'sourceCommit':PIN,'currentSourceFilesChecked':len(inventory),'AXRunReviewedAfterParentTerminalNotice':True},indent=2))
