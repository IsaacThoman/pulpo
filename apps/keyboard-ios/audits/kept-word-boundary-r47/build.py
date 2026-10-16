#!/usr/bin/env python3
"""Compile actual Engine from an immutable per-build copy; retain full source/command receipts."""
import datetime,hashlib,json,pathlib,subprocess,sys
root=pathlib.Path(__file__).resolve().parents[4];audit=pathlib.Path(__file__).resolve().parent
out=pathlib.Path(sys.argv[1]);out.mkdir(parents=True,exist_ok=False)
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
selector=sys.argv[2] if len(sys.argv)>2 else '--candidate'
if selector not in ('--baseline','--candidate','--engine'):raise SystemExit('unknown engine selector')
engine=(audit/'baseline-KeyboardEngine.swift.txt') if selector=='--baseline' else pathlib.Path(sys.argv[3]) if selector=='--engine' else root/'apps/keyboard-ios/PulpoKeyboardKit/Sources/KeyboardCore/Input/KeyboardEngine.swift'
sources=[];hashes={}
for original in sorted((root/'apps/keyboard-ios/PulpoKeyboardKit/Sources/KeyboardCore').rglob('*.swift')):
 rel=original.relative_to(root);actual=engine if original.name=='KeyboardEngine.swift' else original
 target=out/'sources'/rel;target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(actual.read_bytes())
 sources.append(target);hashes[str(rel)]=sha(target)
main=out/'sources'/'Runner.swift';main.write_bytes((audit/'Runner.swift.txt').read_bytes());hashes['Runner.swift']=sha(main)
command=['swiftc','-O','-parse-as-library',*map(str,sources),str(main),'-o',str(out/'runner')]
receipt={'started':datetime.datetime.now(datetime.timezone.utc).isoformat(),'selector':selector,'engineInput':str(engine),'sourceHashes':hashes,'compiler':subprocess.check_output(['xcrun','--find','swiftc'],text=True).strip(),'toolchain':subprocess.check_output(['swiftc','--version'],text=True),'command':command,'buildScriptSHA256':sha(pathlib.Path(__file__))}
with (out/'build.log').open('w') as log:r=subprocess.run(command,stdout=log,stderr=log)
receipt.update(exit=r.returncode,finished=datetime.datetime.now(datetime.timezone.utc).isoformat())
if r.returncode==0:receipt['binarySHA256']=sha(out/'runner')
(out/'build-receipt.json').write_text(json.dumps(receipt,indent=2)+'\n')
if r.returncode:print((out/'build.log').read_text());sys.exit(r.returncode)
print(out/'runner')
