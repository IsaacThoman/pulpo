#!/usr/bin/env python3
"""Public-path separate-process/fault/namespace development gates. No product hooks."""
import importlib.util, json, os, pathlib, select, signal, sqlite3, subprocess, sys, tempfile, time
ROOT=pathlib.Path(__file__).parent
spec=importlib.util.spec_from_file_location('driver',ROOT/'run-v5.py');driver=importlib.util.module_from_spec(spec);spec.loader.exec_module(driver)
WORKER,GATE,FAULTS,OUT=sys.argv[1:5];OUT=pathlib.Path(OUT);OUT.mkdir(parents=True,exist_ok=True)
OK={'accepted':True,'result':'ok'}; NEW={'dictionary':'ok','touch':'ok'}; BOTH={'completed':True,'dictionary':'ok','touch':'ok'}
def a(op,actor='writer',**kw): return dict(op=op,actor=actor,**kw)
def case(name,actions): return {'id':name,'description':name,'actions':actions}
def new(actor='writer'): return a('new',actor,expected=NEW)
def seed(): return [a('learn',word='r33seed',after='r33antecedent',pinned=True,expected=OK),a('touch',word='agrimony',dx=.12,dy=.18,expected=OK)]
def zero(actor='reader'): return [a('check',actor,field='count',word='r33seed',expected=0),a('check',actor,field='touchWeight',expected=0)]
cases=[]
for store in ('dictionary','touch'):
 cases.append(case('outside-acquisition-'+store,[new(),*seed(),new('resetter'),a('arm',gate='beforeTransaction',expected={'armed':True}),a('background',store=store,expected={'enqueued':True}),a('waitGate'),a('clear','resetter',store='both',expected={'completed':True,'result':'ok'}),new('reader'),*zero(),a('release'),a('save',store='both',expected=BOTH),a('learn',word='r33renewed',after='r33posterior',pinned=True,expected=OK),a('touch',word='rue',dx=0,dy=.1,expected=OK),a('save',store='both',expected=BOTH),new('fresh'),a('check','fresh',field='count',word='r33seed',expected=0),a('check','fresh',field='count',word='r33renewed',expected=1),a('check','fresh',field='touchWeight',expected=3)]))
 cases.append(case('inside-transaction-stop-'+store,[new(),*seed(),new('resetter'),a('arm',gate='beforeCommit',expected={'armed':True}),a('background',store=store,expected={'enqueued':True}),a('waitGate'),a('stop'),a('clear','resetter',store='both',expected={'completed':False,'result':'busy'}),a('learn','resetter',word='r33refused',expected={'accepted':False,'result':'busy'}),a('resume'),a('release'),a('save',store='both',expected=BOTH),a('clear','resetter',store='both',expected={'completed':True,'result':'ok'}),new('reader'),*zero()]))
 cases.append(case('killed-transaction-'+store,[new(),*seed(),new('resetter'),a('arm',gate='beforeCommit',expected={'armed':True}),a('background',store=store,expected={'enqueued':True}),a('waitGate'),a('clear','resetter',store='both',expected={'completed':False,'result':'busy'}),a('kill'),a('clear','resetter',store='both',expected={'completed':True,'result':'ok'}),new('reader'),*zero()]))
for phase in ('failCommit','reportCommitError','afterCommitBeforeAck'):
 actions=[new(),*seed(),new('resetter'),a('arm',gate=phase,expected={'armed':True})]
 if phase=='afterCommitBeforeAck': actions += [a('background',store='both',expected={'enqueued':True}),a('waitGate'),a('clear','resetter',store='both',expected={'completed':False,'result':'busy'}),a('release')]
 elif phase=='failCommit': actions += [a('save',store='dictionary',expected={'completed':False,'dictionary':'io'}),new('beforeRetry'),*zero('beforeRetry')]
 actions += [a('save',store='both',expected=BOTH),a('save',store='both',expected=BOTH),new('reader'),a('check','reader',field='count',word='r33seed',expected=1),a('check','reader',field='pair',word='r33seed',after='r33antecedent',expected=1),a('check','reader',field='touchWeight',expected=8)]
 cases.append(case('retry-'+phase,actions))
for kind in ('dictionary','touch'):
 learning=a('learn',word='r33admission',expected=OK) if kind=='dictionary' else a('touch',word='fenugreek',dx=.1,dy=.1,expected=OK)
 failed=dict(learning,expected={'accepted':False,'result':'io'})
 cases.append(case('failed-admission-'+kind,[new(),a('arm',gate='failAdmission',expected={'armed':True}),failed,a('check',field='total' if kind=='dictionary' else 'touchWeight',expected=0),learning,a('save',store='both',expected=BOTH),new('reader'),a('check','reader',field='count',word='r33admission',expected=1) if kind=='dictionary' else a('check','reader',field='touchWeight',expected=9)]))
slots=[]
for i in range(8): slots += [new('owner'+str(i)),a('pin','owner'+str(i),word='r33owner'+str(i),expected=OK)]
slots += [new('ninth'),a('pin','ninth',word='r33capacity',expected={'accepted':False,'result':'capacity'}),a('clear','ninth',store='both',expected={'completed':True,'result':'ok'}),a('save','owner0',store='both',expected=BOTH),a('pin','owner0',word='r33epochAfterCapacity',expected=OK),a('save','owner0',store='both',expected=BOTH),a('kill','owner1'),a('pin','ninth',word='r33reclaimed',expected=OK),a('save','ninth',store='both',expected=BOTH),new('reader'),a('check','reader',field='count',word='r33owner0',expected=0),a('check','reader',field='count',word='r33reclaimed',expected=1),a('check','reader',field='count',word='r33epochAfterCapacity',expected=1)]
cases.append(case('full-lifetime-slots-reset-and-death-reclamation',slots))
nul_a='r33nul\u0000alpha';nul_b='r33nul\u0000beta';nul_leading='\u0000r33leading'
cases.append(case('nul-keys-cross-process-forget-distinction',[new(),new('forgetter'),a('learn',word=nul_a,after='r33nullHistory',pinned=True,expected=OK),a('pin',word=nul_b,expected=OK),a('pin',word=nul_leading,expected=OK),a('forget','forgetter',word='r33nul',expected=OK),a('save',store='both',expected=BOTH),new('reader'),a('check','reader',field='count',word=nul_a,expected=1),a('check','reader',field='count',word=nul_b,expected=1),a('check','reader',field='count',word=nul_leading,expected=1),a('check','reader',field='pair',word=nul_a,after='r33nullHistory',expected=1),a('learn',word=nul_a,after='r33nullHistory',expected=OK),a('learn',word=nul_b,after='r33nullHistory',expected=OK),a('forget','forgetter',word=nul_a,expected=OK),a('save',store='both',expected=BOTH),a('save',store='both',expected=BOTH),new('fresh'),a('check','fresh',field='count',word=nul_a,expected=0),a('check','fresh',field='count',word=nul_b,expected=2),a('check','fresh',field='pair',word=nul_a,after='r33nullHistory',expected=0),a('check','fresh',field='pair',word=nul_b,after='r33nullHistory',expected=1)]))
(OUT/'schedules.json').write_text(json.dumps(cases,indent=2)+'\n')
driver.validate(cases)
schedules=[driver.run_case(c,WORKER,GATE) for c in cases]
results=[]
def finish(actor):
 if actor.p.poll() is None:
  actor.p.stdin.close();actor.p.wait(timeout=5)
 error=actor.p.stderr.read();actor.close();return error

def fixture(name,body,dylib=FAULTS):
 events=[];actors=[];checks=[];unavailable=None;error=''
 with tempfile.TemporaryDirectory(prefix='r33-fixture-') as directory:
  def actor():
   value=driver.Actor(WORKER,dylib,directory,False);actors.append(value);events.append({'op':'new','actual':value.initial});checks.append(driver.matches(value.initial,NEW));return value
  def call(value,command,expect):
   actual=value.command(command);events.append({'command':command,'actual':actual,'expected':expect});checks.append(driver.matches(actual,expect));return actual
  try: body(pathlib.Path(directory),actor,call,checks,events)
  except Exception as e: unavailable=type(e).__name__+': '+str(e)
  finally:
   for value in actors:
    try: error+=finish(value)
    except Exception as e: unavailable=unavailable or str(e)
 results.append({'id':name,'available':unavailable is None,'unavailable':unavailable,'pass':unavailable is None and all(checks),'checks':checks,'events':events,'faultStderr':error})

for fault in ('uncertainCommit','rollbackStuck','failJournalWrite','partialJournal','failJournalSync'):
 def run(path,actor,call,checks,events,fault=fault):
  value=actor();call(value,{'op':'learn','word':'r33fault','after':'r33faultHistory','pinned':True},OK)
  call(value,{'op':'touch','word':'hyssop','dx':.1,'dy':.1},OK)
  call(value,{'op':'arm','gate':fault},{'armed':True})
  call(value,{'op':'save','store':'dictionary'},{'completed':False,'dictionary':'uncertain' if fault in ('uncertainCommit','rollbackStuck') else 'io'})
  call(value,{'op':'save','store':'both'},BOTH)
  read=actor();call(read,{'op':'check','field':'count','word':'r33fault'},1)
  call(read,{'op':'check','field':'pair','word':'r33fault','after':'r33faultHistory'},1)
  call(read,{'op':'check','field':'touchWeight'},6)
 fixture('filesystem-or-uncertain-save-'+fault,run)
for kind in ('dictionary','touch'):
 def run(path,actor,call,checks,events,kind=kind):
  value=actor();call(value,{'op':'arm','gate':'uncertainCommit'},{'armed':True})
  command={'op':'learn','word':'r33uncertain'} if kind=='dictionary' else {'op':'touch','word':'anise','dx':.1,'dy':.1}
  call(value,command,{'accepted':False,'result':'uncertain'})
  call(value,{'op':'check','field':'total' if kind=='dictionary' else 'touchWeight'},0)
  call(value,{'op':'save','store':'both'},BOTH)
  read=actor();call(read,{'op':'check','field':'total' if kind=='dictionary' else 'touchWeight'},0)
  call(value,command,OK);call(value,{'op':'save','store':'both'},BOTH)
  read=actor();call(read,{'op':'check','field':'total' if kind=='dictionary' else 'touchWeight'},1 if kind=='dictionary' else 5)
 fixture('uncertain-admission-cancel-'+kind,run)

def namespace(path,actor,call,checks,events):
 value=actor();call(value,{'op':'pin','word':'r33namespace'},OK);call(value,{'op':'save','store':'both'},BOTH)
 db=path/'PersonalDictionary.json.learning-v2.sqlite'; marker=pathlib.Path(str(db)+'.initialized')
 marker.unlink();call(value,{'op':'reload','store':'both'},{'dictionary':{'result':'invalid'},'touch':{'result':'invalid'}})
 checks.append(not marker.exists())
fixture('warm-marker-loss-fails-closed',namespace)

def cleanup(path,actor,call,checks,events):
 value=actor();call(value,{'op':'pin','word':'r33cleanup'},OK);call(value,{'op':'save','store':'both'},BOTH)
 (path/'TouchModel.json').mkdir()
 call(value,{'op':'clear','store':'both'},{'completed':False,'result':'cleanup'})
 read=actor();call(read,{'op':'check','field':'total'},0);call(read,{'op':'check','field':'touchWeight'},0)
 (path/'TouchModel.json').rmdir();call(value,{'op':'clear','store':'both'},{'completed':True,'result':'ok'})
fixture('postcommit-legacy-cleanup-failure',cleanup)

def corrupt(path,actor,call,checks,events):
 value=actor();db=path/'PersonalDictionary.json.learning-v2.sqlite'
 con=sqlite3.connect(db);con.execute('UPDATE meta SET version=99');con.commit();con.close()
 call(value,{'op':'reload','store':'both'},{'dictionary':{'result':'invalid'},'touch':{'result':'invalid'}})
fixture('warm-unsupported-version-fails-closed',corrupt)

report={'schedules':schedules,'fixtures':results,'summary':{'uniqueSchedules':len(schedules),'availableSchedules':sum(c['available'] for c in schedules),'passedSchedules':sum(c['pass'] for c in schedules),'scheduleOracles':sum(len(c['checks']) for c in schedules),'passedScheduleOracles':sum(x['pass'] for c in schedules for x in c['checks']),'uniqueFixtures':len(results),'availableFixtures':sum(c['available'] for c in results),'passedFixtures':sum(c['pass'] for c in results)}}
(OUT/'results.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report['summary'],sort_keys=True))
sys.exit(0 if all(c['pass'] for c in schedules+results) else 1)
