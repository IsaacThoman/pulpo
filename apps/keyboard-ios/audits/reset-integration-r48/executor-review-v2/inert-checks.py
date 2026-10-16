"""Mechanical diagnostics only: fake ledgers, Python stubs, no product source/API."""
from pathlib import Path
import contextlib,hashlib,importlib.util,io,json,os,subprocess,sys,tarfile,tempfile,types,uuid
HOME=Path('/tmp/pulpo-r48-executor-review-v2')
DRIVER=HOME/'inert-audit/paired-executor.py'
spec=importlib.util.spec_from_file_location('paired_executor_inert',DRIVER);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
def need(ok,msg):
 if not ok:raise ValueError(msg)
def sha(path):return hashlib.sha256(path.read_bytes()).hexdigest()
def dump(p,x):p.write_text(json.dumps(x,indent=2)+'\n')
def setup(case,modes=('normal','normal')):
 w=Path(tempfile.mkdtemp(dir='/tmp',prefix='pulpo-r48-inert-'+case+'-')).resolve()
 author=w/'author';author.mkdir();(author/'Runner.swift').write_text('// INERT; never compiled or executed\n');dump(author/'fixtures.json',{'inert':True})
 dump(w/'config.json',{'inertMechanicalFixture':True})
 records=[]
 for name,mode in zip(['first','second'],modes):
  d=w/name;d.mkdir();binary=d/'stub.py'
  binary.write_text('#!'+sys.executable+'\n'+'''import json,sys,time,os
from pathlib import Path
root=Path(__file__).parent
with (root/'calls.jsonl').open('a') as stream: stream.write(json.dumps(sys.argv[1:])+'\\n')
mode='''+repr(mode)+'''
print('inert stdout',flush=True)
print('inert stderr',file=sys.stderr,flush=True)
if mode=='sleep': time.sleep(1.0)
if mode=='nonzero': raise SystemExit(7)
if mode=='symlink':
 Path(sys.argv[2]).symlink_to(sys.argv[1]);raise SystemExit(0)
if mode=='hardlink':
 os.link(sys.argv[1],sys.argv[2]);raise SystemExit(0)
Path(sys.argv[2]).write_text(json.dumps({'inert':True,'arguments':sys.argv[1:]})+'\\n')
''')
  binary.chmod(0o700)
  environment=d/'environment.json';dump(environment,{'compiler':'INERT','architecture':'INERT','productSourceSHA256':'0'*64,'runnerSHA256':sha(author/'Runner.swift'),'fixturesSHA256':sha(author/'fixtures.json'),'versionLabel':name})
  records.append({'name':name,'buildExit':0,'binary':str(binary.relative_to(w)),'binarySHA256':sha(binary),'environment':str(environment.relative_to(w)),'environmentSHA256':sha(environment)})
 prepared={'driverSHA256':sha(DRIVER),'configSHA256':sha(w/'config.json'),'runnerSHA256':sha(author/'Runner.swift'),'fixturesSHA256':sha(author/'fixtures.json'),'authorRoot':'author','records':records}
 dump(w/'prepared.json',prepared)
 gates={g:{'path':g+'.json','sha256':sha(DRIVER.parent/(g+'.json'))} for g in ['authorSemanticReview','sourceComposition','ordinaryCore','nativeIntegration','executorReview']}
 freeze=w/'freeze.json';dump(freeze,{'verdict':'APPROVE_FOR_ONE_PAIRED_EXECUTION','gates':gates,'preparedSHA256':sha(w/'prepared.json')})
 return w,freeze

def invoke(w,freeze):
 stdout=io.StringIO();error=None
 try:
  with contextlib.redirect_stdout(stdout):m.run(freeze,w)
 except Exception as exc:error={'type':type(exc).__name__,'text':str(exc)}
 return {'error':error,'stdout':stdout.getvalue(),'records':json.loads((w/'execution.json').read_text()) if (w/'execution.json').exists() else [],'markerExists':(w/'RUN-STARTED').exists(),'work':str(w)}

results=[]
def record(case,w,**facts):results.append({'case':case,'work':str(w),**facts})
def streams_match(w,item):return all(item[key+'SHA256']==sha(w/'first'/('runner.'+suffix)) for key,suffix in [('stdout','stdout'),('stderr','stderr')])
w,f=setup('normal');r=invoke(w,f)
need(r['error'] is None and len(r['records'])==2 and all(x['exit']==0 and x['launched'] is True for x in r['records']),'normal transport')
for name in ['first','second']:
 args=json.loads((w/name/'calls.jsonl').read_text().splitlines()[0]);need(args==[str(w/'author/fixtures.json'),str(w/name/'raw.json'),str(w/name/'environment.json')],'CLI order')
again=invoke(w,f);need(again['error']['type']=='FileExistsError' and all(len((w/n/'calls.jsonl').read_text().splitlines())==1 for n in ['first','second']),'run-once guard')
record('normal-and-repeat',w,twoChildren=True,CLIOrderMatchesMap=True,repeatRejectedWithoutNewCalls=True)
w,f=setup('binary-corruption');(w/'first/stub.py').write_text('CORRUPT')
r=invoke(w,f);need(r['error'] is not None and not r['markerExists'] and not (w/'second/calls.jsonl').exists(),'hash corruption')
record('binary-corruption',w,rejectedBeforeMarker=True)
w,f=setup('spawn-error');(w/'first/stub.py').chmod(0o600);r=invoke(w,f)
need(r['error'] is None and r['markerExists'] and len(r['records'])==2,'spawn accounting')
item=r['records'][0];need(item['exit'] is None and item['launched'] is False and item['launchError']['type']=='PermissionError' and item['launchError']['errno']==13 and streams_match(w,item) and (w/'second/calls.jsonl').exists(),'spawn record')
need(invoke(w,f)['error']['type']=='FileExistsError','partial retry')
record('spawn-error',w,launchErrorRecorded=True,streamsHashed=True,secondAttempted=True,repeatRejected=True)
for kind in ['stale-raw','dangling-output']:
 w,f=setup(kind,('nonzero','normal'))
 if kind=='stale-raw':dump(w/'first/raw.json',{'staleBeforeRun':True})
 else:(w/'second/runner.stderr').symlink_to(w/'absent')
 r=invoke(w,f);need(r['error'] is not None and not r['markerExists'] and all(not (w/n/'calls.jsonl').exists() for n in ['first','second']),'contamination preflight')
 record(kind,w,rejectedBeforeMarkerAndBothCalls=True)
w,f=setup('timeout',('sleep','normal'));original=m.subprocess
m.subprocess=types.SimpleNamespace(TimeoutExpired=subprocess.TimeoutExpired,run=lambda command,**kwargs:subprocess.run(command,**{**kwargs,'timeout':0.3 if command[0].endswith('/first/stub.py') else kwargs['timeout']}))
try:r=invoke(w,f)
finally:m.subprocess=original
need(r['error'] is None and len(r['records'])==2 and r['records'][0].get('timeout') is True,'timeout transport')
need((w/'first/runner.stdout').read_bytes() and (w/'first/runner.stderr').read_bytes() and streams_match(w,r['records'][0]),'timeout stream hashes')
record('timeout',w,inertTimeoutSeconds=0.3,realTimeoutException=True,nonemptyStreamsHashed=True,secondAttempted=True)
for mode in ['symlink','hardlink']:
 w,f=setup('output-'+mode,(mode,'normal'));r=invoke(w,f)
 need(r['error'] is None and len(r['records'])==2 and r['records'][0]['rawSHA256'] is None and 'rawError' in r['records'][0] and (w/'second/calls.jsonl').exists(),'unsafe output accepted')
 record('output-'+mode,w,rawRejected=True,secondAttempted=True)
for kind in ['traversal','symlink','hardlink','duplicate','extra','missing','valid']:
 w=Path(tempfile.mkdtemp(dir='/tmp',prefix='pulpo-r48-inert-archive-')).resolve();archive=w/'test.tar';destination=w/'extract'
 with tarfile.open(archive,'w') as tar:
  count=2 if kind=='duplicate' else 0 if kind=='missing' else 1
  for _ in range(count):
   member=tarfile.TarInfo('../escape' if kind=='traversal' else 'extra' if kind=='extra' else 'entry');member.mode=0o777
   if kind=='symlink':member.type=tarfile.SYMTYPE;member.linkname='../escape'
   if kind=='hardlink':member.type=tarfile.LNKTYPE;member.linkname='../escape'
   tar.addfile(member)
 try:m.unpack(archive,destination,{'entry'})
 except ValueError:
  need(kind!='valid','valid archive rejected');need(not destination.exists(),'archive validation wrote before rejecting');record('archive-'+kind,w,rejectedBeforeWrites=True)
 else:
  need(kind=='valid' and (destination/'entry').is_file() and ((destination/'entry').stat().st_mode & 0o777)==0o600,'archive inventory/mode');record('archive-valid',w,acceptedExactInventory=True,fileMode0600=True)
output={'scope':'mechanics only; fake prepared ledgers and inert Python scripts; no product or author bundle read/executed','driverSHA256':sha(DRIVER),'optimized':not __debug__,'cases':results}
print(json.dumps(output,indent=2))
