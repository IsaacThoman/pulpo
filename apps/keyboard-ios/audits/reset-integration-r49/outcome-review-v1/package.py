from pathlib import Path
import json,hashlib,shutil,tarfile
O=Path(__file__).resolve().parent;W=Path('/tmp/pulpo-r48-r49-final-v3');A=Path('/Users/isaacthoman/.t3/worktrees/pulpo/t3-a3218df3/apps/keyboard-ios/audits/reset-integration-r49')
def cp(src,dst):dst.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(src,dst)
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def js(p):return json.loads(p.read_text())
E=O/'evidence';shutil.copytree(A,E/'audit',dirs_exist_ok=True)
for n in ['config.json','prepared.json','execution.json','evaluations.json','RUN-STARTED']:cp(W/n,E/'work'/n)
for n in js(A/'execution-freeze-v3.json')['authorFiles']:cp(W/'author'/n,E/'work/author'/n)
for r in js(W/'prepared.json')['records']:
 v=r['name'];root=E/'work'/v
 for n in ['environment.json','source-manifest.json','raw.json','runner.stdout','runner.stderr','evaluation-normal.stdout','evaluation-normal.stderr','evaluation-optimized.stdout','evaluation-optimized.stderr']:cp(W/v/n,root/n)
 for n in js(W/v/'source-manifest.json'):
  cp(W/v/n,root/n);suffix=n.split('/Sources/KeyboardCore/')[1];cp(W/v/'PulpoKeyboardKit/Sources/KeyboardCore'/suffix,root/'PulpoKeyboardKit/Sources/KeyboardCore'/suffix)
 for n in ['PulpoKeyboardKit/Package.swift','client/Package.swift','client/Sources/BoundaryRunner/Runner.swift']:cp(W/v/n,root/n)
 cp(W/r['binary'],E/'work'/r['binary']);(root/'empty-cwd').mkdir(exist_ok=True)
for s in js(O/'store-ledger.json'):
 for f in s['files']:cp(Path(s['directory'])/f['path'],E/'stores'/s['variant']/s['session']/f['path'])
print('copied exact inputs, raw, real binaries, sources, gates, prior approvals and 30 final stores; no build logs copied/read')
