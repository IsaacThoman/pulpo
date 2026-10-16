"""Mechanical diagnostics only: fake ledgers, Python stubs, no product source/API."""
from pathlib import Path
import contextlib,hashlib,importlib.util,io,json,os,subprocess,sys,tarfile,tempfile,types,uuid
HOME=Path('/tmp/pulpo-r48-executor-review')
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
  binary.write_text('#!'+sys.executable+'\n'+'''import json,sys,time
from pathlib import Path
root=Path(__file__).parent
with (root/'calls.jsonl').open('a') as stream: stream.write(json.dumps(sys.argv[1:])+'\\n')
mode='''+repr(mode)+'''
print('inert stdout',flush=True)
print('inert stderr',file=sys.stderr,flush=True)
if mode=='sleep': time.sleep(1.0)
if mode=='nonzero': raise SystemExit(7)
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
w,f=setup('normal');r=invoke(w,f)
need(r['error'] is None and len(r['records'])==2,'normal inert transport')
for name in ['first','second']:
 args=json.loads((w/name/'calls.jsonl').read_text().splitlines()[0]);need(args==[str(w/'author/fixtures.json'),str(w/name/'raw.json'),str(w/name/'environment.json')],'CLI order')
again=invoke(w,f);need(again['error']['type']=='FileExistsError' and all(len((w/n/'calls.jsonl').read_text().splitlines())==1 for n in ['first','second']),'run-once guard')
results.append({'case':'normal-and-repeat','work':str(w),'twoChildren':True,'CLIOrderMatchesMap':True,'repeatRejectedWithoutNewCalls':True})
w,f=setup('binary-corruption');(w/'first/stub.py').write_text('CORRUPT')
r=invoke(w,f);need(r['error'] is not None and not r['markerExists'] and not (w/'second/calls.jsonl').exists(),'hash corruption failed to stop execution')
results.append({'case':'binary-corruption','work':str(w),'rejectedBeforeMarker':True})
w,f=setup('spawn-error');(w/'first/stub.py').chmod(0o600)
r=invoke(w,f);need(r['error']['type']=='PermissionError' and r['markerExists'] and len(r['records'])==1 and not (w/'second/calls.jsonl').exists(),'spawn-error witness changed')
repeat=invoke(w,f);need(repeat['error']['type']=='FileExistsError','partial launch failure allows retry')
results.append({'case':'spawn-error','work':str(w),'markerConsumed':True,'firstLedgerItemHasNoLaunchErrorOrExit':not any(k in r['records'][0] for k in ['exit','launchError','timeout']),'secondNotAttempted':True,'repeatRejected':True,'exception':r['error']})
w,f=setup('stale-raw',('nonzero','normal'));dump(w/'first/raw.json',{'staleBeforeRun':True});stale=sha(w/'first/raw.json')
r=invoke(w,f);need(r['error'] is None and len(r['records'])==2 and r['records'][0]['exit']==7 and r['records'][0]['rawSHA256']==stale,'stale raw witness changed')
results.append({'case':'stale-raw','work':str(w),'firstExit':7,'stalePreexistingRawAttributedToRun':True,'secondAttempted':True,'driverPrintedTransportComplete':True})
w,f=setup('timeout',('sleep','normal'));original=m.subprocess
m.subprocess=types.SimpleNamespace(TimeoutExpired=subprocess.TimeoutExpired,run=lambda command,**kwargs:subprocess.run(command,**{**kwargs,'timeout':0.3 if command[0].endswith('/first/stub.py') else kwargs['timeout']}))
try:r=invoke(w,f)
finally:m.subprocess=original
need(r['error'] is None and len(r['records'])==2 and r['records'][0].get('timeout') is True,'timeout witness changed')
need((w/'first/runner.stdout').read_bytes() and (w/'first/runner.stderr').read_bytes(),'timeout did not retain nonempty streams')
results.append({'case':'timeout','work':str(w),'inertTimeoutSeconds':0.3,'realTimeoutException':True,'streamsRetained':True,'streamHashesMissing':not any(k in r['records'][0] for k in ['stdoutSHA256','stderrSHA256']),'secondAttempted':True})
for name,kind in [('traversal','traversal'),('symlink','symlink'),('hardlink','hardlink')]:
 w=Path(tempfile.mkdtemp(dir='/tmp',prefix='pulpo-r48-inert-archive-'));archive=w/'bad.tar';destination=w/'extract'
 with tarfile.open(archive,'w') as tar:
  member=tarfile.TarInfo('../escape' if kind=='traversal' else 'entry')
  if kind=='symlink':member.type=tarfile.SYMTYPE;member.linkname='../escape'
  if kind=='hardlink':member.type=tarfile.LNKTYPE;member.linkname='../escape'
  tar.addfile(member)
 try:m.unpack(archive,destination)
 except ValueError:results.append({'case':'archive-'+name,'rejected':True,'work':str(w)})
 else:raise ValueError('unsafe archive accepted')
output={'scope':'mechanics only; fake prepared ledgers and inert Python scripts; no product or author bundle read/executed','driverSHA256':sha(DRIVER),'optimized':not __debug__,'cases':results}
print(json.dumps(output,indent=2))
