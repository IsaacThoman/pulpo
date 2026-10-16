"""Compile only made-up inert Swift sources; never execute either built binary."""
from pathlib import Path
import hashlib,io,json,subprocess,sys,tarfile,tempfile
home=Path('/tmp/pulpo-r48-executor-review-v2');audit=home/'inert-audit'
work=Path(tempfile.mkdtemp(dir='/tmp',prefix='pulpo-r48-inert-prepare-')).resolve();work.rmdir()
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def archive(path,files):
 with tarfile.open(path,'w') as tar:
  for name,data in files.items():
   entry=tarfile.TarInfo(name);entry.size=len(data);entry.mode=0o644;tar.addfile(entry,io.BytesIO(data))
author={'Runner.swift':b'import Foundation\nimport CryptoKit\nimport KeyboardCore\n@main struct InertRunner { static func main() {} }\n','fixtures.json':b'{"inert":true}\n','evaluate.py':b'# Inert placeholder; never executed\n'}
archive(audit/'inert-author.tar',author)
corepath='apps/keyboard-ios/PulpoKeyboardKit/Sources/KeyboardCore/Inert.swift'
archive(audit/'inert-core.tar',{corepath:b'public enum InertCore { public static let value = 1 }\n'})
versions=[{'name':name,'archive':'inert-core.tar','archiveSHA256':sha(audit/'inert-core.tar'),'files':{corepath:hashlib.sha256(b'public enum InertCore { public static let value = 1 }\n').hexdigest()}} for name in ['first','second']]
config={'author':{'archive':'inert-author.tar','archiveSHA256':sha(audit/'inert-author.tar'),'root':'.','files':{name:hashlib.sha256(data).hexdigest() for name,data in author.items()}},'versions':versions}
configpath=audit/'inert-prepare-config.json';configpath.write_text(json.dumps(config,indent=2)+'\n')
result=subprocess.run([sys.executable,'-B',str(audit/'paired-executor.py'),'prepare',str(configpath),str(work)],capture_output=True,text=True,timeout=180)
if result.returncode:
 print(json.dumps({'scope':'inert generated Swift sources only; no product/Core sources or author workload read; no binary invoked','driverSHA256':sha(audit/'paired-executor.py'),'configSHA256':sha(configpath),'work':str(work),'returncode':result.returncode,'python':sys.version,'stdout':result.stdout,'stderr':result.stderr,'productExecutions':0,'successfulBuildLogsRead':False},indent=2));raise SystemExit(result.returncode)
ledger=json.loads((work/'prepared.json').read_text());records=ledger['records']
if len(records)!=2 or any(r['buildExit']!=0 or r['productExecutions']!=0 for r in records):raise ValueError('inert prepare ledger')
required={'compiler','architecture','productSourceSHA256','runnerSHA256','fixturesSHA256','versionLabel'}
for record in records:
 if set(json.loads((work/record['environment']).read_text()))!=required:raise ValueError('environment inventory')
 if (work/record['name']/'raw.json').exists():raise ValueError('unexpected output')
 if sorted(p.name for p in (work/record['name']/'client/Sources/BoundaryRunner').iterdir())!=['Runner.swift']:raise ValueError('unexpected source')
print(json.dumps({'scope':'inert generated Swift sources only; compilation only; no built binary invoked; no product/Core sources or author workload read','driverSHA256':sha(audit/'paired-executor.py'),'configSHA256':sha(configpath),'preparedSHA256':sha(work/'prepared.json'),'work':str(work),'builds':2,'productExecutions':0,'exactSixEnvironmentFields':True,'runnerOnlyClientSources':True,'successfulBuildLogsRead':False,'stdout':result.stdout},indent=2))
