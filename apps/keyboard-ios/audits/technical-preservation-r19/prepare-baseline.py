#!/usr/bin/env python3
"""Materialize unmodified parent package plus the frozen synthetic replay."""
import argparse,io,pathlib,shutil,subprocess,tarfile
p=argparse.ArgumentParser();p.add_argument('destination');a=p.parse_args()
repo=pathlib.Path(subprocess.check_output(['git','rev-parse','--show-toplevel'],text=True).strip())
dst=pathlib.Path(a.destination).resolve()
if dst.exists(): raise SystemExit('Destination must not exist')
dst.mkdir(parents=True)
base='apps/keyboard-ios/PulpoKeyboardKit'
blob=subprocess.check_output(['git','archive','c4a354f3',base+'/Package.swift',base+'/Sources',base+'/Tests'])
with tarfile.open(fileobj=io.BytesIO(blob)) as archive: archive.extractall(dst,filter='data')
package=dst/base
runner='Tests/KeyboardCoreTests/AnchoredGrammarReplayTests.swift'
shutil.copy2(repo/base/runner,package/runner)
for name in ['LanguageData','audits']:
 (package.parent/name).symlink_to(repo/'apps/keyboard-ios'/name,target_is_directory=True)
print(package)
