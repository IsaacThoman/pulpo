#!/usr/bin/env python3
"""Static result/schema/control validation. Never executes Core or prints payload."""
import hashlib, json, math, pathlib, sys
RESULTS={'ok','busy','capacity','invalid','io','uncertain','cleanup'}
CONTROL={'waitGate','release','stop','resume','kill'}
FIELDS={'count','known','blocked','pair','history','total','dirty','touchWeight','offsetX','offsetY'}
SPECS={
 'new':({'memory'},set()), 'learn':({'word','after','pinned'},{'word'}),
 'pin':({'word'},{'word'}),'forget':({'word'},{'word'}),
 'touch':({'word','dx','dy'},{'word','dx','dy'}),'transient':({'words'},{'words'}),
 'save':({'store'},{'store'}),'background':({'store'},{'store'}),'reload':({'store'},{'store'}),
 'clear':({'store'},{'store'}),'arm':({'gate'},{'gate'}),
 'check':({'field','word','after'},{'field'}), 'send':({'action'},{'action'}),
 'receive':(set(),set()), **{c:(set(),set()) for c in CONTROL}
}
def need(ok,msg):
 if not ok: raise ValueError(msg)
def result(value): need(value in RESULTS if isinstance(value,str) else False,'result enum')
def selected(a): return ['dictionary','touch'] if a['store']=='both' else [a['store']]
def expected(a,e):
 op=a['op']
 if op=='check':
  field=a['field']; need(field in FIELDS,'field')
  args=({'word'} if field in {'count','known','blocked','offsetX','offsetY'} else {'word','after'} if field=='pair' else {'after'} if field=='history' else set())
  need(set(a)=={'op','actor','field','expected'}|args,'query arguments')
  if field in {'known','blocked','dirty'}: need(type(e) is bool,'boolean oracle')
  elif field in {'touchWeight','offsetX','offsetY'}: need(type(e) in (int,float) and math.isfinite(e),'finite oracle')
  else: need(type(e) is int and e>=0,'integer oracle')
  if field in {'offsetX','offsetY'}: need(len(a['word'])==1 and 'a'<=a['word']<='z','offset letter')
  return
 need(isinstance(e,dict),'result object')
 if op=='new':
  need(set(e)=={'dictionary','touch'},'constructor results')
  for r in e.values(): result(r)
 elif op in {'learn','pin','forget','touch'}:
  need(set(e)=={'accepted','result'} and type(e['accepted']) is bool,'admission result')
  result(e['result']); need(e['accepted']==(e['result']=='ok'),'admission consistency')
 elif op=='save':
  need(set(e)=={'completed'}|set(selected(a)) and type(e['completed']) is bool,'save result')
  for k in selected(a): result(e[k])
  need(e['completed']==all(e[k]=='ok' for k in selected(a)),'save consistency')
 elif op=='clear':
  need(set(e)=={'completed','result'} and type(e['completed']) is bool,'clear result')
  result(e['result']); need(e['completed']==(e['result']=='ok'),'clear consistency')
 elif op=='reload':
  need(set(e)==set(selected(a)),'reload stores')
  for v in e.values():
   need(isinstance(v,dict) and set(v) in ({'result'},{'result','changed'}),'reload fields'); result(v['result'])
   if 'changed' in v: need(type(v['changed']) is bool,'changed bool')
 elif op=='background': need(e=={'enqueued':True},'enqueue result')
 elif op=='arm': need(e=={'armed':True},'arm result')
 elif op=='transient': need(e=={'accepted':True},'transient result')
 else: need(False,'unexpected expected')
def arguments(a,nested=False):
 need(isinstance(a,dict) and a.get('op') in SPECS,'operation')
 op=a['op']; optional,required=SPECS[op]
 base={'op'} if nested else {'op','actor'}
 if not nested and op not in CONTROL|{'send'}: base|={'expected'}
 need(base|required<=set(a) and set(a)<=base|optional,'argument fields')
 for f in ('word','after'):
  if f in a:
   need((f=='after' and a[f] is None and op=='learn') or isinstance(a[f],str),f+' string')
   if isinstance(a[f],str): need(len(a[f].encode())<=16384,'input byte bound')
 if 'memory' in a: need(type(a['memory']) is bool,'memory bool')
 if 'pinned' in a: need(type(a['pinned']) is bool,'pinned bool')
 if 'words' in a: need(isinstance(a['words'],list) and len(a['words'])<=100 and all(isinstance(w,str) and len(w.encode())<=16384 for w in a['words']),'transient words')
 if 'store' in a: need(a['store'] in {'dictionary','touch','both'},'store')
 if op=='touch':
  for f in ('dx','dy'): need(type(a[f]) in (int,float) and math.isfinite(a[f]) and -1<=a[f]<=1,'numeric offset')
 if not nested and 'expected' in a and op!='receive': expected(a,a['expected'])
def validate(cases):
 need(isinstance(cases,list) and 1<=len(cases)<=40,'case size')
 ids=set(); counts={'cases':len(cases),'actions':0,'oracles':0,'barriers':0}
 for case in cases:
  need(isinstance(case,dict) and set(case)=={'id','description','actions'},'case fields')
  need(isinstance(case['id'],str) and case['id'] and case['id'] not in ids,'id'); ids.add(case['id'])
  need(isinstance(case['description'],str) and case['description'],'description')
  need(isinstance(case['actions'],list) and 1<=len(case['actions'])<=240,'actions size')
  actors={}; queries=0
  for a in case['actions']:
   arguments(a); counts['actions']+=1; op=a['op']; n=a['actor']
   need(isinstance(n,str) and n,'actor name')
   if op=='new':
    need(n not in actors,'duplicate actor'); actors[n]={'live':True,'armed':False,'gated':False,'stopped':False,'pending':None}
   else: need(n in actors and actors[n]['live'],'actor not live')
   state=actors[n]
   if state['stopped']: need(op in {'resume','kill'},'stopped actor command')
   if state['pending']: need(op in CONTROL|{'receive'},'outstanding response')
   if op=='send':
    need(state['pending'] is None,'two sends'); nested=a['action']; arguments(nested,True)
    need(nested['op'] in {'learn','pin','forget','touch','clear','save','reload'},'nested kind')
    state['pending']=dict(nested,actor=n)
   if op=='receive':
    need(state['pending'] is not None,'receive without send')
    expected(state['pending'],a['expected']); state['pending']=None
   if op=='arm':
    need(not state['armed'],'multiple arms')
    need(a['gate'] in {'beforeTransaction','beforeCommit','failCommit','failAdmission','afterCommitBeforeAck','reportCommitError'},'gate kind')
    state['armed']=True; state['gate']=a['gate']
   if op=='waitGate':
    need(state['armed'] and not state['gated'] and state['gate'] in {'beforeTransaction','beforeCommit','afterCommitBeforeAck'},'gate wait')
    state['gated']=True; counts['barriers']+=1
   if op=='release': need(state['gated'] and not state['stopped'],'release'); state['gated']=False
   if op=='stop': need(state['gated'],'stop ungated'); state['stopped']=True
   if op=='resume': need(state['stopped'],'resume'); state['stopped']=False
   if op=='kill': state['live']=False
   if op=='check': queries+=1
   if 'expected' in a: counts['oracles']+=1
  need(queries>0,'no public query oracle')
  need(all(not s['live'] or not s['gated'] and not s['stopped'] and s['pending'] is None for s in actors.values()),'unfinished control state')
 return counts
if __name__=='__main__':
 data=pathlib.Path(sys.argv[1]).read_bytes(); report=validate(json.loads(data)); report['sha256']=hashlib.sha256(data).hexdigest(); print(json.dumps(report,sort_keys=True))
