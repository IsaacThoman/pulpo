#!/usr/bin/env python3
import pathlib, subprocess, json, hashlib, gzip, sys
root=pathlib.Path(__file__).resolve().parents[2]
audit=pathlib.Path(__file__).resolve().parent
label=sys.argv[1]
out=audit/label
out.mkdir(exist_ok=True)
sources=sorted((root/'PulpoKeyboardKit/Sources/KeyboardCore').rglob('*.swift'))+[audit/'main.swift']
manifest={str(p.relative_to(root)):hashlib.sha256(p.read_bytes()).hexdigest() for p in sources}
manifest['development.json']=hashlib.sha256((audit/'development.json').read_bytes()).hexdigest()
manifest['PUBLIC-CONTRACT.md']=hashlib.sha256((audit/'PUBLIC-CONTRACT.md').read_bytes()).hexdigest()
for lang in ['en_US','es','en_es']:
 p=root/f'LanguageData/{lang}.pkdict';manifest[str(p.relative_to(root))]=hashlib.sha256(p.read_bytes()).hexdigest()
(out/'bindings.json').write_text(json.dumps(manifest,sort_keys=True,indent=2)+'\n')
with (out/'build.log').open('wb') as log:
 result=subprocess.run(['swiftc','-O','-o',str(out/'runner')]+[str(p) for p in sources],stdout=log,stderr=subprocess.STDOUT)
print(json.dumps({'phase':'build','exit':result.returncode}))
if result.returncode: sys.exit(result.returncode)
r=subprocess.run([str(out/'runner'),str(root),str(audit/'development.json'),str(out/'raw.json')],capture_output=True)
print(json.dumps({'phase':'run','exit':r.returncode}))
if r.returncode: print(r.stderr.decode());sys.exit(r.returncode)
raw=(out/'raw.json').read_bytes(); rows=json.loads(raw)
(out/'raw.json.gz').write_bytes(gzip.compress(raw,mtime=0))
(out/'raw.sha256').write_text(hashlib.sha256(raw).hexdigest()+'\n')
print(json.dumps({'rows':len(rows),'visible':sum(x['targetVisible'] for x in rows),'useful':sum(x['saved']>0 for x in rows),'saved':sum(x['saved'] for x in rows),'fired':sum(x['fired'] for x in rows),'fullTextFailures':[x['id'] for x in rows if x.get('fullTextPass') is False]}))
