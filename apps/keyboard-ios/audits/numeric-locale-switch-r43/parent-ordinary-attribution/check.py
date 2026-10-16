from pathlib import Path
from collections import Counter
import json,hashlib,subprocess
W=Path('/Users/isaacthoman/.t3/worktrees/pulpo/t3-b262ad7a')
R=Path('/tmp/pulpo-r43-v1');A=W/'apps/keyboard-ios/audits/numeric-locale-switch-r43/accepted-v3'
O=Path('/tmp/pulpo-r43-ordinary-attribution')
def need(ok,msg):
 if not ok:raise ValueError(msg)
def sha(raw):return hashlib.sha256(raw).hexdigest()
def git(ref,args):return subprocess.check_output(['git',*args],cwd=W)
archive=json.loads((A/'ordinary-validation.json').read_bytes())
summary={'scope':'historical ordinary event-count attribution only; no app/build/device or stable packet change','runs':{}}
functions={};allids={}
for variant,ref,scratch in [('baseline','b5451e42','core-baseline-native'),('candidate','6781665e','core-candidate')]:
 path=R/f'core-{variant}.events.jsonl';records=[json.loads(l) for l in path.read_text().splitlines() if l]
 tests=[r['payload'] for r in records if r['kind']=='test'];events=[r['payload'] for r in records if r['kind']=='event']
 byid={t['id']:t for t in tests};need(len(byid)==len(tests),'duplicate test IDs')
 allids[variant]=byid;functions[variant]={t['id'] for t in tests if t['kind']=='function'}
 endings=[e for e in events if e['kind']=='runEnded'];issues=[e for e in events if e['kind']=='issueRecorded']
 need(len(endings)==1 and endings[0]==archive[f'core-{variant}']['runEnded'],'archived runEnded linkage')
 need(issues==archive[f'core-{variant}']['issues'],'archived issues linkage')
 modules={}
 for module in ['KeyboardCoreTests','PulpoServicesTests']:
  defs=[t for t in tests if t['id'].startswith(module+'.')];functions_in_module={t['id'] for t in defs if t['kind']=='function'}
  starts={e['testID'] for e in events if e['kind']=='testStarted' and e['testID'] in functions_in_module}
  ends={e['testID'] for e in events if e['kind']=='testEnded' and e['testID'] in functions_in_module}
  skips={e['testID'] for e in events if e['kind']=='testSkipped' and e['testID'] in functions_in_module}
  need(starts==ends and starts|skips==functions_in_module and not starts&skips,'function inventory partition')
  modules[module]={'functionDefinitions':len(functions_in_module),'suites':sum(t['kind']=='suite' for t in defs),'functionStarted':len(starts),'functionEnded':len(ends),'functionSkipped':len(skips),'functionIDs':sorted(functions_in_module),'skipIDs':sorted(skips)}
 desc_path=R/scratch/'arm64-apple-macosx/release/description.json';desc=json.loads(desc_path.read_bytes())
 metadata={}
 for module in ['KeyboardCoreTests','PulpoServicesTests']:
  command=next(c for c in desc['swiftCommands'].values() if c['moduleName']==module)
  actual={str(Path(s).relative_to(W)) for s in command['sources']}
  prefix=f'apps/keyboard-ios/PulpoKeyboardKit/Tests/{module}'
  expected={s for s in git(ref,['ls-tree','-r','--name-only',ref,'--',prefix]).decode().splitlines() if s.endswith('.swift')}
  need(actual==expected,'build description source file inventory '+module)
  metadata[module]={'sourceFiles':len(actual),'matchesGitFileInventory':True,'compiler':command['executable'],'sourceRoot':str(W),'sourceFilesSHA256':sha('\n'.join(sorted(actual)).encode())}
 summary['runs'][variant]={'ref':ref,'eventStream':str(path),'eventStreamObservedSHA256':sha(path.read_bytes()),'eventStreamContemporaneousArchivedHashFound':False,'archivedOrdinaryValidationSHA256':sha((A/'ordinary-validation.json').read_bytes()),'archivedRunEndedAndIssuesExactlyMatch':True,'modules':modules,'runEndedMessages':endings[0]['messages'],'runStartedCount':sum(e['kind']=='runStarted' for e in events),'runEndedCount':len(endings),'issueCount':len(issues),'allIssuesKnown':all(e['issue']['isKnown'] and not e['issue']['isFailure'] for e in issues),'buildDescription':str(desc_path),'buildDescriptionObservedSHA256':sha(desc_path.read_bytes()),'sourceFileInventory':metadata}
summary['candidateAddedFunctionIDs']=sorted(functions['candidate']-functions['baseline'])
summary['candidateRemovedFunctionIDs']=sorted(functions['baseline']-functions['candidate'])
summary['serviceFunctionIDsIdentical']=summary['runs']['baseline']['modules']['PulpoServicesTests']['functionIDs']==summary['runs']['candidate']['modules']['PulpoServicesTests']['functionIDs']
summary['noNativePrivacyTestIDs']=not any('NativeContentTypePrivacy' in i for variant in allids.values() for i in variant)
(O/'attribution.json').write_text(json.dumps(summary,indent=2)+'\n')
print(json.dumps({'counts':{v:{m:{k:x for k,x in d.items() if k not in ['functionIDs','skipIDs']} for m,d in r['modules'].items()} for v,r in summary['runs'].items()},'added':summary['candidateAddedFunctionIDs'],'removed':summary['candidateRemovedFunctionIDs'],'serviceIDs':summary['runs']['baseline']['modules']['PulpoServicesTests']['functionIDs'],'noNativePrivacyTestIDs':summary['noNativePrivacyTestIDs']},indent=2))
