#!/usr/bin/env python3
import datetime,hashlib,json,pathlib,subprocess,sys,importlib.util
here=pathlib.Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('check',here/'check.py');check=importlib.util.module_from_spec(spec);spec.loader.exec_module(check)
input,baseline,candidate,resources,out=map(pathlib.Path,sys.argv[1:6])
out.mkdir(parents=True,exist_ok=False)
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
receipt={'process':{}}
try:
 check.preflight(json.loads(input.read_text()))
 receipt.update(input=sha(input),executables={'baseline':sha(baseline),'candidate':sha(candidate)},resources={p.name:sha(p) for p in sorted(resources.glob('*.pkdict'))})
 if len(sys.argv)>6:
  freeze=json.loads(pathlib.Path(sys.argv[6]).read_text());root=here.parents[3]
  fs=importlib.util.spec_from_file_location('freeze_gate',here/'freeze_gate.py');gate=importlib.util.module_from_spec(fs);fs.loader.exec_module(gate)
  gate.verify(freeze,input,receipt['executables'],receipt['resources'],root)
  receipt['freezeSHA256']=sha(pathlib.Path(sys.argv[6]))
 for name,binary in [('baseline',baseline),('candidate',candidate)]:
  start=datetime.datetime.now(datetime.timezone.utc).isoformat()
  try:
   r=subprocess.run([str(binary.resolve()),str(input.resolve()),str(resources.resolve()),str((out/(name+'.json')).resolve())],capture_output=True,text=True)
   rec={'exit':r.returncode,'stderr':r.stderr,'stdout':r.stdout}
  except Exception as error:rec={'exit':-1,'stderr':'','stdout':'','unavailable':True,'error':repr(error)}
  rec.update(started=start,finished=datetime.datetime.now(datetime.timezone.utc).isoformat());receipt['process'][name]=rec
except Exception as error:
 receipt['error']=repr(error)
 for name in ('baseline','candidate'):receipt['process'][name]={'exit':-1,'stderr':'','unavailable':True,'error':repr(error)}
(out/'receipt.json').write_text(json.dumps(receipt,indent=2)+'\n');(out/'process.json').write_text(json.dumps(receipt['process'],indent=2)+'\n')
r=subprocess.run([sys.executable,str(here/'check.py'),str(input),str(out/'baseline.json'),str(out/'candidate.json'),str(out/'process.json'),str(out/'report.json')])
print(json.dumps({k:v for k,v in json.loads((out/'report.json').read_text()).items() if k not in ('allChecks','failures')}))
sys.exit(r.returncode)
