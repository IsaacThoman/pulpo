import sys,json,hashlib,re
from pathlib import Path
root=Path('/Users/isaacthoman/.t3/worktrees/pulpo/t3-53439f72')
sys.path.insert(0,str(root/'apps/keyboard-ios/scripts'))
from build_validation_words import read_sections,dictionary_displays
out=Path('/tmp/pulpo-r12-53439f72')
old=Path('/Users/isaacthoman/.t3/worktrees/pulpo/t3-0a5d507e/apps/keyboard-ios/audits/swipe-eligibility-r10')
excluded=set()
def walk(x):
 if isinstance(x,dict):
  for k,v in x.items():
   if k in ('target','word','literal','expectedWord') and isinstance(v,str): excluded.add(v.casefold())
   else: walk(v)
 elif isinstance(x,list):
  for v in x: walk(v)
for name in ('dev.json','heldout.json','old-r7-exclusions.json'): walk(json.loads((old/name).read_text()))
# String-only lists in the prior exclusion document are also exclusion targets.
def strings(x):
 if isinstance(x,str): excluded.add(x.casefold())
 elif isinstance(x,list):
  for v in x: strings(v)
 elif isinstance(x,dict):
  for v in x.values(): strings(v)
strings(json.loads((old/'old-r7-exclusions.json').read_text()))
meta={}
for lang in ('en_US','es','en_es'):
 p=root/f'apps/keyboard-ios/LanguageData/{lang}.pkdict'; sec=dict(read_sections(p.read_bytes()))
 meta[lang]={w:{'id':i,'flags':f} for i,(w,f) in enumerate(zip(dictionary_displays(sec.items()),sec[b'WFLG']))}
conflicts=[w for w,m in meta['en_es'].items() if m['flags']&3==3 and w.casefold() not in excluded]
order=lambda seed,ws: sorted(ws,key=lambda w:hashlib.sha256((seed+w).encode()).hexdigest())
devconf=order('r12-development:',conflicts)[:12]
used=set(excluded)|set(devconf); cases=[]
for lang,context,personal in [('en_US','we said ',['velunaro','dexumali']),('es','dijimos ',['torivane','mexulora']),('en_es','we dijimos ',['zanifelo','lumavero'])]:
 neutral=[w for w,m in meta['en_US'].items() if w in meta['es'] and re.fullmatch('[a-z]{4,10}',w) and w not in used and all(meta[l][w]['flags']&2 and not meta[l][w]['flags']&33 for l in ('en_US','es'))]
 neutral=order('r12-neutral:'+lang+':',neutral)[:6]; used.update(neutral)
 for target in devconf:
  for kind in ('conflict','learnedConflict','literal'):
   cases.append(dict(id=f'{lang}-{kind}-{target}',language=lang,context=context,target=target,kind=kind))
 for target in neutral: cases.append(dict(id=f'{lang}-neutral-{target}',language=lang,context=context,target=target,kind='neutral'))
 for target in personal:
  assert all(target not in m for m in meta.values()); used.add(target)
  for kind in ('personal','privacy','secure'):cases.append(dict(id=f'{lang}-{kind}-{target}',language=lang,context=context,target=target,kind=kind))
(out/'dev.json').write_text(json.dumps(cases,ensure_ascii=False,indent=2)+'\n')
(out/'exclusions.json').write_text(json.dumps(sorted(used),ensure_ascii=False,indent=2)+'\n')
(out/'metadata.json').write_text(json.dumps(meta,ensure_ascii=False))
(out/'freeze.json').write_text(json.dumps({'base':__import__('subprocess').check_output(['git','rev-parse','HEAD'],cwd=root,text=True).strip(),'cases':len(cases),'conflictsSelected':len(devconf),'availableFreshConflicts':len(conflicts),'hashes':{str(p):hashlib.sha256(p.read_bytes()).hexdigest() for p in [out/'dev.json',out/'exclusions.json',root/'apps/keyboard-ios/audits/suppression-consistency-r12/protocol.md',*[root/f'apps/keyboard-ios/LanguageData/{l}.pkdict' for l in meta]]}},indent=2)+'\n')
print((out/'freeze.json').read_text())
