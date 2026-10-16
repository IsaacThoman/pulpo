import json,hashlib,math,csv,statistics
from pathlib import Path
out=Path('/tmp/pulpo-r12-53439f72');root=Path('/Users/isaacthoman/.t3/worktrees/pulpo/t3-53439f72');audit=root/'apps/keyboard-ios/audits/suppression-consistency-r12'
read=lambda n:json.loads((out/n).read_text())
comparisons={s:read(f'{s}-comparison.json') for s in ('dev','heldout')}
rows={(mode,s):read(f'{mode}-{s}.json') for mode in ('baseline','candidate') for s in ('dev','heldout')}
cold=read('cold.json');timings={}
for lang in ('en_US','es','en_es'):
 timings[lang]={}
 for mode in ('baseline','candidate'):
  cc=[r for r in cold if r['mode']==mode and r['language']==lang]
  rr=[r for s in ('dev','heldout') for r in rows[mode,s] if r['language']==lang and r['kind']!='literal']
  p95=lambda field:sorted(r[field] for r in rr)[math.ceil(len(rr)*.95)-1]
  timings[lang][mode]={'constructionColdMs':[r['constructionMs'] for r in cc],'firstDecodeColdMs':[r['decodeMs'] for r in cc],'engineColdMs':[r['engineMs'] for r in cc],'warmDecodeP95Ms':p95('decodeMs'),'warmEngineP95Ms':p95('engineMs')}
 a=timings[lang]['baseline'];b=timings[lang]['candidate']
 timings[lang]['coldGate']=max(b['firstDecodeColdMs'])<=1500 and max(b['firstDecodeColdMs'])<=max(a['firstDecodeColdMs'])*1.15+10
 timings[lang]['warmGate']=b['warmDecodeP95Ms']<=50 and b['warmDecodeP95Ms']<=a['warmDecodeP95Ms']*1.15+1
reg=read('regeneration.json')
summary={'decision':'retain sole frozen compiler candidate','development':{k:v for k,v in comparisons['dev'].items() if k not in ('changes','subgroups')},'heldout':{k:v for k,v in comparisons['heldout'].items() if k not in ('changes','subgroups')},'timings':timings,'regeneration':{k:v for k,v in reg.items() if k!='changedFlags'},'resourceByteDelta':reg['runs'][0]['bytes']-(out/'baseline-data/en_es.pkdict').stat().st_size,'tests':{'core':436,'services':3,'python':28,'knownIssues':5,'native':'not rerun; devices prohibited','installedAX':'four excluded; not run'},'unavailable':{'secureEngineRowsPerSplit':18,'renderedUI':'not observed; engine slots only','native':'not rerun'},'acceptanceFailures':[]}
assert all(comparisons[s]['behaviorGate'] and comparisons[s]['warmTimingGate'] for s in comparisons)
assert all(t['coldGate'] and t['warmGate'] for t in timings.values())
(out/'summary.json').write_text(json.dumps(summary,indent=2)+'\n')
# Machine-readable full per-case evidence remains outside Git, including every miss.
with (out/'per-case.csv').open('w') as f:
 fields=['split','mode','id','language','target','kind','profile','candidateTarget','exactDocument','slotTarget','rawDocument','phantomSpace','finalDocument','expectedFinal','decoder','engineCandidates','slots','initialPersonalCount','finalPersonalCount','constructionMs','decodeMs','engineMs']
 writer=csv.DictWriter(f,fieldnames=fields);writer.writeheader()
 for (mode,split),rr in rows.items():
  for r in rr:
   row={k:r[k] for k in fields if k in r};row.update(split=split,mode=mode)
   for k in ('decoder','engineCandidates','slots'):row[k]=json.dumps(row[k],ensure_ascii=False)
   writer.writerow(row)
failures={}
for (mode,s),rr in rows.items():
 failures[f'{mode}-{s}']={'allTargetDocumentMisses':[r for r in rr if not r['exactDocument']],'unavailableSecureEngine':[r for r in rr if r['kind']=='secure'],'oovExactDisplay':[r for r in rr if not any(e['text']==r['target'] for e in r['targetEntries'])]}
(out/'all-failures-and-unavailable.json').write_text(json.dumps(failures,ensure_ascii=False,indent=2)+'\n')
for name in ('summary.json','heldout-reveal.json'):(audit/name).write_bytes((out/name).read_bytes())
# Manifest covers input and output evidence; excludes enormous scratch compiler caches.
files=sorted(p for p in out.rglob('*') if p.is_file() and not p.is_relative_to(out/'swift-build') and p.name!='artifact-manifest.json')
manifest={str(p.relative_to(out)):{'sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'bytes':p.stat().st_size} for p in files}
(out/'artifact-manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
(audit/'artifact-manifest.json').write_bytes((out/'artifact-manifest.json').read_bytes())
print(json.dumps({'timings':timings,'assetDelta':summary['resourceByteDelta'],'oovCounts':{k:len(v['oovExactDisplay']) for k,v in failures.items()},'manifestFiles':len(files)},indent=2))
