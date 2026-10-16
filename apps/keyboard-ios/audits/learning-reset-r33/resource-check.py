#!/usr/bin/env python3
import importlib.util,json,os,pathlib,select,signal,sqlite3,subprocess,sys,tempfile,time
spec=importlib.util.spec_from_file_location('driver',pathlib.Path(__file__).with_name('run-v3.py'));driver=importlib.util.module_from_spec(spec);spec.loader.exec_module(driver)
worker,gate,out=sys.argv[1:4];out=pathlib.Path(out);out.mkdir(parents=True,exist_ok=True)
events=[];checks=[];cycles=[]
def call(actor,command,expected):
 actual=actor.command(command)
 if driver.busy_only(actual) and not driver.contains_busy(expected): actual,retries=driver.await_expected(actor,command,actual,expected)
 else: retries=[]
 ok=driver.matches(actual,expected);checks.append(ok);events.append({'command':command,'actual':actual,'expected':expected,'pass':ok,'busyRetries':retries});return actual
NEW={'dictionary':'ok','touch':'ok'};OK={'accepted':True,'result':'ok'};SAVE={'completed':True,'dictionary':'ok','touch':'ok'}
def actor(directory,memory=False):
 value=driver.Actor(worker,gate,str(directory),memory);checks.append(driver.matches(value.initial,NEW));return value
with tempfile.TemporaryDirectory(prefix='r33-resources-') as tmp:
 directory=pathlib.Path(tmp);db=directory/'PersonalDictionary.json.learning-v2.sqlite'
 a=actor(directory)
 for i in range(1000):
  call(a,{'op':'learn','word':'r33resource'+str(i%50),'after':'r33resourceHistory'},OK)
  con=sqlite3.connect(db);count=con.execute('SELECT count(*) FROM tokens').fetchone()[0];con.close();checks.append(count<=256)
 call(a,{'op':'save','store':'both'},SAVE)
 call(a,{'op':'pin','word':'r33queued'},OK)
 call(a,{'op':'arm','gate':'beforeCommit'},{'armed':True})
 call(a,{'op':'background','store':'both'},{'enqueued':True})
 if not select.select([a.notify_r],[],[],5)[0]: raise TimeoutError('resource barrier')
 assert os.read(a.notify_r,1)==b'G'
 def rss(pid): return int(subprocess.check_output(['ps','-o','rss=','-p',str(pid)],text=True).strip())*1024
 before=rss(a.p.pid);start=time.monotonic_ns()
 for _ in range(5000): call(a,{'op':'background','store':'both'},{'enqueued':True})
 after=rss(a.p.pid);enqueue_ms=(time.monotonic_ns()-start)/1e6
 os.write(a.release_w,b'R');call(a,{'op':'save','store':'both'},SAVE)
 read=actor(directory);call(read,{'op':'check','field':'total'},1001);read.close();a.close()
 resetter=actor(directory)
 for cycle in range(20):
  value=actor(directory)
  call(value,{'op':'pin','word':'r33crash'+str(cycle)},OK)
  call(value,{'op':'touch','word':'marjoram','dx':.12,'dy':.18},OK)
  call(value,{'op':'arm','gate':'beforeCommit'},{'armed':True})
  call(value,{'op':'background','store':'both'},{'enqueued':True})
  if not select.select([value.notify_r],[],[],5)[0]: raise TimeoutError('crash barrier')
  assert os.read(value.notify_r,1)==b'G'
  held=[{'name':p.name,'bytes':p.stat().st_size} for p in directory.iterdir()]
  value.p.kill();value.p.wait(timeout=5);value.close()
  call(resetter,{'op':'clear','store':'both'},{'completed':True,'result':'ok'})
  fresh=actor(directory);call(fresh,{'op':'check','field':'total'},0);call(fresh,{'op':'check','field':'touchWeight'},0);fresh.close()
  files=[{'name':p.name,'bytes':p.stat().st_size} for p in directory.iterdir()]
  checks.append(len(files)<=12);checks.append(all(not p['name'].endswith('-journal') for p in files))
  cycles.append({'repetition':cycle+1,'held':held,'afterRecovery':files})
 resetter.close()
with tempfile.TemporaryDirectory(prefix='r33-memory-resources-') as tmp:
 a=actor(tmp,True);call(a,{'op':'pin','word':'r33ephemeral'},OK);call(a,{'op':'touch','word':'caraway','dx':.1,'dy':.2},OK);call(a,{'op':'clear','store':'both'},{'completed':True,'result':'ok'});a.close()
 memory_files=len(list(pathlib.Path(tmp).iterdir()));checks.append(memory_files==0)
report={'pass':all(checks),'checks':checks,'events':events,'coalescedBackground':{'requests':5000,'sameHeldTransaction':True,'rssBeforeBytes':before,'rssAfterBytes':after,'rssGrowthBytes':after-before,'enqueueTotalMilliseconds':enqueue_ms},'crashRecovery':{'uniqueSchedules':1,'repetitions':20,'cycles':cycles},'memoryDomainFiles':memory_files}
(out/'results.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps({'pass':report['pass'],'checks':len(checks),'backgroundRequests':5000,'rssGrowthBytes':after-before,'crashRepetitions':20,'memoryFiles':memory_files},sort_keys=True));sys.exit(0 if report['pass'] else 1)
