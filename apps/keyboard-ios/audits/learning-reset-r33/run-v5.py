#!/usr/bin/env python3
import json, os, pathlib, select, signal, subprocess, sys, tempfile, time, threading, queue
import importlib.util
spec=importlib.util.spec_from_file_location('schema_validator',pathlib.Path(__file__).with_name('validate-v3.py')); module=importlib.util.module_from_spec(spec); spec.loader.exec_module(module); validate=module.validate

class Actor:
 def __init__(self, worker, dylib, directory, memory):
  self.notify_r,notify_w=os.pipe(); release_r,self.release_w=os.pipe()
  env=dict(os.environ,DYLD_INSERT_LIBRARIES=dylib,R33_NOTIFY_FD=str(notify_w),R33_RELEASE_FD=str(release_r))
  self.p=subprocess.Popen([worker,directory]+(['--memory'] if memory else []),stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,pass_fds=(notify_w,release_r),env=env,text=True,bufsize=1)
  os.close(notify_w); os.close(release_r)
  try: self.initial=self.read()
  except Exception:
   self.close();raise
 def read(self):
  if not select.select([self.p.stdout],[],[],5)[0]: raise TimeoutError('worker response deadline')
  line=self.p.stdout.readline()
  if not line: raise RuntimeError('worker closed stdout: '+self.p.stderr.read())
  return json.loads(line)['value']
 def command(self,a):
  self.p.stdin.write(json.dumps(a,ensure_ascii=False)+'\n'); self.p.stdin.flush(); return self.read()
 def close(self):
  if self.p.poll() is None: self.p.kill(); self.p.wait(timeout=5)
  os.close(self.notify_r); os.close(self.release_w)
  self.p.stdin.close(); self.p.stdout.close(); self.p.stderr.close()

def matches(actual,expected):
 if isinstance(expected,dict): return isinstance(actual,dict) and all(k in actual and matches(actual[k],v) for k,v in expected.items())
 return type(actual) is type(expected) and actual==expected

def busy_only(value):
 if not isinstance(value,dict): return False
 results=[]
 def visit(v):
  if isinstance(v,dict):
   for k,item in v.items():
    if k=='result' or k in {'dictionary','touch'} and isinstance(item,str): results.append(item)
    elif isinstance(item,dict): visit(item)
 visit(value)
 return bool(results) and 'busy' in results and all(v in {'ok','busy'} for v in results)

def contains_busy(value):
 return isinstance(value,dict) and any(v=='busy' or contains_busy(v) for v in value.values())

class RetryInterrupted(Exception):
 def __init__(self,cause,retries):
  super().__init__(type(cause).__name__+": "+str(cause));self.retries=retries

class BusyDeadline(TimeoutError):
 def __init__(self,retries):
  super().__init__("confirmed-busy retry deadline");self.retries=retries

def await_expected(actor, command, actual, expectation, initial=False):
 retries=[]; deadline=time.monotonic()+5
 try:
  while busy_only(actual) and not contains_busy(expectation) and not matches(actual,expectation):
   retries.append({'command':command,'actual':actual})
   if len(retries)>=5000 or time.monotonic()>=deadline: raise BusyDeadline(retries)
   os.sched_yield()
   if initial:
    response=actor.command({'op':'reload','store':'both'})
    actual={k:response[k]['result'] for k in ('dictionary','touch')}
   else: actual=actor.command(command)
 except Exception as error:
  if isinstance(error,BusyDeadline): raise
  raise RetryInterrupted(error,retries) from error
 return actual,retries

def run_case(c,worker,dylib):
 actors={}; checks=[]; events=[]; unavailable=None; start=time.monotonic_ns()
 with tempfile.TemporaryDirectory(prefix='pulpo-r33-') as directory:
  try:
   for index,a in enumerate(c['actions']):
    n=a['actor']; op=a['op']; actual=True; retries=[]; t=time.monotonic_ns()
    if op=='new':
     actors[n]=Actor(worker,dylib,directory,a.get('memory',False)); actual=actors[n].initial
     actual,retries=await_expected(actors[n],{'op':'new'},actual,a['expected'],True)
    else:
     actor=actors[n]
     if op=='send':
      actor.last_sent=a['action']; actor.p.stdin.write(json.dumps(a['action'],ensure_ascii=False)+'\n'); actor.p.stdin.flush()
     elif op=='receive':
      actual=actor.read(); actual,retries=await_expected(actor,actor.last_sent,actual,a['expected'])
     elif op=='waitGate':
      if not select.select([actor.notify_r],[],[],5)[0]: raise TimeoutError('gate barrier deadline')
      if os.read(actor.notify_r,1)!=b'G': raise RuntimeError('invalid gate byte')
     elif op=='release': os.write(actor.release_w,b'R')
     elif op=='stop':
      q=queue.Queue()
      def wait_stopped(): q.put(os.waitpid(actor.p.pid,os.WUNTRACED))
      threading.Thread(target=wait_stopped,daemon=True).start()
      os.kill(actor.p.pid,signal.SIGSTOP)
      _,status=q.get(timeout=5)
      if not os.WIFSTOPPED(status): raise RuntimeError('stop not acknowledged')
     elif op=='resume': os.kill(actor.p.pid,signal.SIGCONT)
     elif op=='kill': actor.p.kill(); actor.p.wait(timeout=5)
     else:
      actual=actor.command(a)
      if op not in {'check','background','arm','transient'} and 'expected' in a: actual,retries=await_expected(actor,a,actual,a['expected'])
    elapsed=(time.monotonic_ns()-t)/1e6
    events.append({'index':index,'op':op,'actor':n,'actual':actual,'milliseconds':elapsed,'confirmedBusyRetries':retries})
    if 'expected' in a:
     expected=a['expected']; ok=matches(actual,expected)
     if a.get('field') in {'touchWeight','offsetX','offsetY'}: ok=type(actual) in (int,float) and abs(actual-expected)<=1e-9
     checks.append({'index':index,'op':op,'field':a.get('field'),'expected':expected,'actual':actual,'pass':ok})
  except Exception as e:
   unavailable=type(e).__name__+': '+str(e)
   history=getattr(e,'retries',[])
   events.append({'index':index,'op':op,'actor':n,'command':a,'actual':history[-1]['actual'] if history else None,'confirmedBusyRetries':history,'unavailable':unavailable})
  finally:
   for actor in actors.values(): actor.close()
 return {'id':c['id'],'available':unavailable is None,'unavailable':unavailable,'pass':unavailable is None and all(x['pass'] for x in checks),'checks':checks,'events':events,'milliseconds':(time.monotonic_ns()-start)/1e6}

if __name__=='__main__':
 cases=json.load(open(sys.argv[3])); validated=validate(cases)
 results=[run_case(c,sys.argv[1],sys.argv[2]) for c in cases]
 report={'validated':validated,'results':results,'summary':{'uniqueCases':len(cases),'available':sum(r['available'] for r in results),'passed':sum(r['pass'] for r in results),'checksRun':sum(len(r['checks']) for r in results),'checksPassed':sum(x['pass'] for r in results for x in r['checks'])}}
 print(json.dumps(report,ensure_ascii=False,indent=2)); sys.exit(0 if all(r['pass'] for r in results) else 1)
