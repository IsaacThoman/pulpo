#!/usr/bin/env python3
"""Exposed regression only. Rebuild exact retained public sources, never model mocks."""
import argparse, hashlib, json, subprocess, tarfile
from pathlib import Path
ap=argparse.ArgumentParser();ap.add_argument("root",type=Path);ap.add_argument("--derived",type=Path);args=ap.parse_args()
audit=Path(__file__).resolve().parent
args.root.mkdir(parents=True,exist_ok=False)
records=[]
versions=[("baseline305",audit/"evidence/baseline305-core-source.tar.gz"),("original-a9e",audit/"evidence/original-a9e-core-source.tar.gz")]
if args.derived:versions=[("derived",args.derived)]
for name,source in versions:
 work=args.root/name;work.mkdir()
 if source.is_file():
  with tarfile.open(source) as tf:
   for item in tf.getmembers():
    target=(work/item.name).resolve()
    if work.resolve() not in target.parents or item.issym() or item.islnk():raise ValueError("Unsafe archive member")
   tf.extractall(work)
  core=work/"apps/keyboard-ios/PulpoKeyboardKit/Sources/KeyboardCore"
 else:core=source/"apps/keyboard-ios/PulpoKeyboardKit/Sources/KeyboardCore"
 lib=work/"PulpoKeyboardKit";lib.mkdir()
 import shutil
 shutil.copytree(core,lib/"Sources/KeyboardCore")
 (lib/"Package.swift").write_text('// swift-tools-version: 6.2\nimport PackageDescription\nlet package=Package(name:"PulpoKeyboardKit",platforms:[.macOS(.v15)],products:[.library(name:"KeyboardCore",targets:["KeyboardCore"])],targets:[.target(name:"KeyboardCore")])\n')
 client=work/"client";(client/"Sources/Witness").mkdir(parents=True)
 original=(audit/"evidence/parent-witness/baseline/Sources/Witness/main.swift").read_bytes()
 (client/"Sources/Witness/main.swift").write_bytes(original)
 (client/"Package.swift").write_text('// swift-tools-version: 6.2\nimport PackageDescription\nlet package=Package(name:"Witness",platforms:[.macOS(.v15)],dependencies:[.package(path:'+json.dumps(str(lib))+')],targets:[.executableTarget(name:"Witness",dependencies:[.product(name:"KeyboardCore",package:"PulpoKeyboardKit")])])\n')
 with (work/"build.log").open("wb") as f:
  build=subprocess.run(["swift","build","-c","release","--package-path",str(client)],stdout=f,stderr=subprocess.STDOUT)
 record={"version":name,"buildExit":build.returncode,"clientSHA256":hashlib.sha256(original).hexdigest()}
 if build.returncode==0:
  cwd=work/"empty-cwd";cwd.mkdir()
  run=subprocess.run([str(client/".build/release/Witness")],cwd=cwd,capture_output=True)
  (work/"stdout.json").write_bytes(run.stdout);(work/"stderr").write_bytes(run.stderr)
  record.update(exit=run.returncode,rows=json.loads(run.stdout) if run.returncode==0 else None,cwdFiles=sorted(str(x.relative_to(cwd)) for x in cwd.rglob("*")))
 records.append(record)
(args.root/"results.json").write_text(json.dumps(records,indent=2)+"\n")
print(json.dumps(records))
