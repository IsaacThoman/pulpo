#!/usr/bin/env python3
import json, os, pathlib, select, signal, subprocess, sys, tempfile, time, threading, queue
from validate import validate

class Actor:
 def __init__(self, worker, dylib, directory, memory):
  self.notify_r,notify_w=os.pipe(); release_r,self.release_w=os.pipe()
  env=dict(os.environ,DYLD_INSERT_LIBRARIES=dylib,R33_NOTIFY_FD=str(notify_w),R33_RELEASE_FD=str(release_r))
  self.p=subprocess.Popen([worker,directory]+(['--memory'] if memory else []),stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,pass_fds=(notify_w,release_r),env=env,text=True,bufsize=1)
  os.close(notify_w); os.close(release_r); self.read()
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

def run_case(c,worker,dylib):
 actors={}; checks=[]; events=[]; unavailable=None; start=time.monotonic_ns()
 with tempfile.TemporaryDirectory(prefix='pulpo-r33-') as directory:
  try:
   for index,a in enumerate(c['actions']):
    n=a['actor']; op=a['op']; actual=True; t=time.monotonic_ns()
    if op=='new': actors[n]=Actor(worker,dylib,directory,a.get('memory',False))
    else:
     actor=actors[n]
     if op=='send':
      actor.p.stdin.write(json.dumps(a['action'],ensure_ascii=False)+'\n'); actor.p.stdin.flush()
     elif op=='receive': actual=actor.read()
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
     else: actual=actor.command(a)
    elapsed=(time.monotonic_ns()-t)/1e6
    events.append({'index':index,'op':op,'actor':n,'actual':actual,'milliseconds':elapsed})
    if 'expected' in a:
     expected=a['expected']; ok=(type(actual)==type(expected) and actual==expected)
     if a.get('field') in {'touchWeight','offsetX','offsetY'}: ok=type(actual) in (int,float) and abs(actual-expected)<=1e-9
     checks.append({'index':index,'op':op,'field':a.get('field'),'expected':expected,'actual':actual,'pass':ok})
  except Exception as e: unavailable=type(e).__name__+': '+str(e)
  finally:
   for actor in actors.values(): actor.close()
 return {'id':c['id'],'available':unavailable is None,'unavailable':unavailable,'pass':unavailable is None and all(x['pass'] for x in checks),'checks':checks,'events':events,'milliseconds':(time.monotonic_ns()-start)/1e6}

if __name__=='__main__':
 cases=json.load(open(sys.argv[3])); validated=validate(cases)
 results=[run_case(c,sys.argv[1],sys.argv[2]) for c in cases]
 report={'validated':validated,'results':results,'summary':{'uniqueCases':len(cases),'available':sum(r['available'] for r in results),'passed':sum(r['pass'] for r in results),'checksRun':sum(len(r['checks']) for r in results),'checksPassed':sum(x['pass'] for r in results for x in r['checks'])}}
 print(json.dumps(report,ensure_ascii=False,indent=2)); sys.exit(0 if all(r['pass'] for r in results) else 1)
