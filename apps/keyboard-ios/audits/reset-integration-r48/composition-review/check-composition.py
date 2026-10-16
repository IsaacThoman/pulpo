from pathlib import Path
import hashlib,json,subprocess,re
W=Path('/Users/isaacthoman/.t3/worktrees/pulpo/t3-a3218df3');O=Path('/tmp/pulpo-r48-composition-review')
HEAD='82165e7ffda344165fc9116027a4b6f3ffacd4f5';BASE='e503e5a6646208c6dc125271431bbb9d677b9bb8';R45='abafac5f0712e8132f0da36a66de4026a93cc790'
def need(ok,msg):
 if not ok:raise ValueError(msg)
def git(*args):return subprocess.check_output(['git',*args],cwd=W)
def blob(ref,path):return git('show',ref+':'+path)
def sha(x):return hashlib.sha256(x).hexdigest()
def lines_changed(patch):return [l for l in patch.decode().splitlines() if l[:1] in ['+','-'] and not l.startswith(('+++','---'))]
P='apps/keyboard-ios/'
store=[P+'PulpoKeyboardKit/Sources/KeyboardCore/'+s for s in ['Dictionary/PersonalDictionary.swift','Geometry/TouchModel.swift','Shared/LearnedDataPersistence.swift']]
ui=[P+'App/PulpoKeyboardApp.swift',P+'PulpoKeyboardKit/Sources/KeyboardUI/KeyboardController.swift',P+'PulpoKeyboardKit/Sources/KeyboardUI/SuggestionBarView.swift']
model=P+'App/AppModel.swift'
result={'reviewedHead':HEAD,'baseline':BASE,'sourceRuntimeExecution':False,'storageFinalR45':{},'uiR41Changes':{},'protectedFiles':{},'importMappings':{}}
for path in store:
 need(blob(HEAD,path)==blob(R45,path),'storage does not equal final R45 '+path)
 result['storageFinalR45'][path]=sha(blob(HEAD,path))
for path in ui:
 actual=git('diff',BASE,HEAD,'--',path);original=git('show','--format=','c156797b','--',path)
 need([l for l in lines_changed(actual) if l.startswith('+')]==[l for l in lines_changed(original) if l.startswith('+')],'R41 added UI source '+path)
 if path.endswith('KeyboardController.swift'):
  need(lines_changed(git('diff','c156797b',HEAD,'--',path))==lines_changed(git('diff','b5451e42','6781665e','--',path)),'Controller final R41 plus exact R43 block')
 else:
  need(blob(HEAD,path)==blob('c156797b',path),'R41 full UI file '+path)
 result['uiR41Changes'][path]={'sha256':sha(blob(HEAD,path)),'addedLinesEqualOriginalC156':True,'finalSourceExactR41PlusPreservedR43':True,'insertions':sum(s.startswith('+') for s in lines_changed(actual)),'deletions':sum(s.startswith('-') for s in lines_changed(actual))}
result['uiR41Totals']={'insertions':sum(x['insertions'] for x in result['uiR41Changes'].values()),'deletions':sum(x['deletions'] for x in result['uiR41Changes'].values())}
need(result['uiR41Totals']=={'insertions':22,'deletions':8},'UI22/8')
def split_model(data):
 before,tail=data.split(b'  // MARK: Learned words\n',1)
 clear,after=tail.split(b'  // MARK: Deep links\n',1)
 return before,clear,after
before,clear,after=split_model(blob(HEAD,model));oldbefore,_,oldafter=split_model(blob(BASE,model))
need(before==oldbefore and after==oldafter,'AppModel outside clear changed')
need(clear==split_model(blob(R45,model))[1],'clear section not exactR45')
result['AppModel']={'sha256':sha(blob(HEAD,model)),'outsideClearExactlyPreserved':True,'clearSectionExactR45':True,'outsideClearBeforeSHA256':sha(before),'outsideClearAfterSHA256':sha(after)}
source_prefixes=[P+'App',P+'Extension',P+'PulpoKeyboardKit/Sources']
source_changes=set(git('diff','--name-only',BASE,HEAD,'--',*source_prefixes).decode().splitlines())
need(source_changes==set(store+ui+[model]),'unexpected production source set')
protected_roots=[P+'App',P+'Extension',P+'LanguageData',P+'PulpoKeyboardKit/Sources',P+'PulpoKeyboardKit/Tests',P+'UITests']
paths=git('ls-tree','-r','--name-only',HEAD,'--',*protected_roots).decode().splitlines()
allowed_test_changes={P+'PulpoKeyboardKit/Tests/KeyboardCoreTests/'+n for n in ['LearningPersistenceSupport.swift','LearningPersistenceTests.swift','PersonalDictionaryPersistenceTests.swift','TouchCompatibilityTests.swift','TouchModelTests.swift']}
allowed_test_changes|={P+'UITests/'+n for n in ['DraftNavigationTests.swift','LearningClearScopeUITests.swift','LearningForgetControllerTests.swift','LearningForgetResultUITests.swift','LearningMessageReadability.swift','LearningResetResultUITests.swift','SettingsUsabilitySweepTests.swift','SuggestionForgetFeedbackTests.swift']}
changed=set(git('diff','--name-only',BASE,HEAD,'--',*protected_roots).decode().splitlines())
need(changed==source_changes|allowed_test_changes,'unexpected tests/assets/extension changes')
for path in paths:
 current=(W/path).read_bytes();expected=blob(HEAD,path)
 need(current==expected,'current worktree differs from reviewedHEAD '+path)
 if path not in changed:
  need(blob(BASE,path)==expected,'unrelated file changed '+path)
  result['protectedFiles'][path]=sha(expected)
result['unrelatedPreservedCount']=len(result['protectedFiles'])
result['protectedScopeCurrentWorktreeMatchesReviewedCommit']=True
for path in allowed_test_changes:
 if 'UITests/' not in path:
  need(blob(HEAD,path)==blob(R45,path),'ordinary R45 tests not exact '+path)
result['R45OrdinaryTestFilesExact']=5
# Restricted diff only; no R45 fixtures, runners, raw payloads or old seals are read.
origins={}
for commit in git('rev-list','--reverse',BASE+'..'+HEAD).decode().splitlines():
 body=git('show','-s','--format=%B',commit).decode();refs=re.findall(r'\(cherry picked from commit ([0-9a-f]{40})\)',body)
 if refs:origins[refs[-1]]=commit
r45=git('rev-list','--reverse','5e17ab9c..'+R45).decode().splitlines()
r41=[git('rev-parse',c).decode().strip() for c in ['c156797b','244566f6','82d1f164','508840da','561a6621','f3c410fc','5de06a60','b94f3b1e','48219fd0']]
need(len(r45)==16 and all(c in origins for c in r45),'R45 provenance16')
need(all(c in origins for c in r41),'R41 provenance9')
result['importMappings']={c:origins[c] for c in r45+r41}
result['R45ImportedCommits']=len(r45);result['R41ImportedCommits']=len(r41)
result['contractSHA256']={n:sha(blob(HEAD,P+'audits/reset-integration-r48/'+n)) for n in ['contract-before-integration.md','public-domain-draft.md']}
result['reviewReferences']={}
for path,wanted in [('/tmp/pulpo-r41-parent-review/review.md','5fbe90a7592c4ffabaae50b036cf2d3d4c73762ccb6c5e976e86061d4a24b424'),('/tmp/pulpo-r33-parent-source-review/review.md','3d4b0eac6cf64a21ff2b8fef03879383b5a4dd95e1f6d612b4892e38648e12e0')]:
 actual=sha(Path(path).read_bytes());need(actual==wanted,'review binding '+path);result['reviewReferences'][path]=actual
(O/'composition-checks.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps({k:v for k,v in result.items() if k not in ['protectedFiles','importMappings']},indent=2))
