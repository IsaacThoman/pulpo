#!/usr/bin/env python3
"""Post-review evidence assertions; does not execute either keyboard variant."""
import pathlib,hashlib,json,gzip,subprocess
p=pathlib.Path(__file__).resolve().parent
root=p.parents[1]
fixtures=json.loads((p/'development.json').read_bytes())
verified={}
for side in ['baseline','candidate']:
 d=p/side;raw=gzip.decompress((d/'raw.json.gz').read_bytes())
 assert hashlib.sha256(raw).hexdigest()==(d/'raw.sha256').read_text().strip()
 rows=json.loads(raw);assert [x['id'] for x in rows]==[x['id'] for x in fixtures]
 counted=[x for f,x in zip(fixtures,rows) if f['action']=='select' and x['saved']>0]
 assert all(x['fired'] and x.get('fullTextPass') is True for x in counted)
 verified[side]={'verifiedUsefulActions':len(counted),'verifiedCharactersSaved':sum(x['saved'] for x in counted),'rawSHA256':hashlib.sha256(raw).hexdigest()}
base=json.loads((p/'baseline/bindings.json').read_bytes())
assert all(hashlib.sha256((root/k).read_bytes()).hexdigest()==v for k,v in base.items() if k.startswith('PulpoKeyboardKit/Sources/KeyboardCore/'))
assert verified['baseline']['verifiedUsefulActions']==verified['candidate']['verifiedUsefulActions']==36
assert verified['baseline']['verifiedCharactersSaved']==verified['candidate']['verifiedCharactersSaved']==90
subprocess.run(['git','diff','--exit-code','--','apps/keyboard-ios/PulpoKeyboardKit/Sources'],cwd=root.parents[1],check=True,capture_output=True)
(p/'verification.json').write_text(json.dumps(verified,sort_keys=True,indent=2)+'\n')
print(json.dumps(verified,sort_keys=True))
