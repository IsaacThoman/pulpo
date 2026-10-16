#!/usr/bin/env python3
"""Build an external SwiftPM client against an explicitly pinned source checkout."""
import argparse,json,pathlib,shutil,subprocess
p=argparse.ArgumentParser();p.add_argument('--source',type=pathlib.Path,required=True);p.add_argument('--out',type=pathlib.Path,required=True);a=p.parse_args()
s=pathlib.Path(__file__).resolve().parent
out=a.out.resolve();out.mkdir(parents=True,exist_ok=True)
pkg=out/'engine-client';(pkg/'Sources/Replay').mkdir(parents=True,exist_ok=True)
source=a.source.resolve()
(pkg/'Package.swift').write_text('// swift-tools-version: 6.2\nimport PackageDescription\nlet package = Package(name: "MultilingualReplay", platforms: [.macOS(.v15)], dependencies: [.package(path: '+json.dumps(str(source/'apps/keyboard-ios/PulpoKeyboardKit'))+')], targets: [.executableTarget(name: "Replay", dependencies: [.product(name: "KeyboardCore", package: "PulpoKeyboardKit")])])\n')
shutil.copyfile(s/'EngineReplay.swift',pkg/'Sources/Replay/main.swift')
dirty=subprocess.check_output(['git','-C',str(source),'status','--porcelain','--','apps/keyboard-ios/PulpoKeyboardKit','apps/keyboard-ios/LanguageData'],text=True)
if dirty:raise RuntimeError('Engine/dictionary checkout has uncommitted files; revision would be misleading')
revision=subprocess.check_output(['git','-C',str(source),'rev-parse','HEAD'],text=True).strip()
(out/'engine-revision.txt').write_text(revision+'\n')
subprocess.run(['swift','run','-c','release','--package-path',str(pkg),'Replay',str(s/'cases.json'),str(source/'apps/keyboard-ios/LanguageData'),str(out/'pulpo.json')],check=True)
