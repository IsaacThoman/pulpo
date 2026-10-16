#!/usr/bin/env python3
"""Static operation/oracle validation. Does not execute Core or print payload."""
import json, math, sys, hashlib

BASE = {'op', 'actor'}
SPECS = {
 'new': ({'memory'}, set()), 'learn': ({'word','after','pinned'}, {'word'}),
 'pin': ({'word'}, {'word'}), 'forget': ({'word'}, {'word'}),
 'touch': ({'word','dx','dy','repeat'}, {'word','dx','dy','repeat'}),
 'transient': ({'words'}, {'words'}), 'save': ({'store','expected'}, {'store','expected'}),
 'background': ({'store'}, {'store'}), 'reload': ({'store'}, {'store'}),
 'clear': ({'store','expected'}, {'store','expected'}), 'arm': ({'gate'}, {'gate'}),
 'waitGate': (set(),set()), 'release': (set(),set()), 'stop': (set(),set()),
 'resume': (set(),set()), 'kill': (set(),set()),
 'check': ({'field','word','after','expected'}, {'field','expected'})
}
def ensure(ok, msg):
 if not ok: raise ValueError(msg)
def validate(cases):
 ensure(isinstance(cases,list) and 1 <= len(cases) <= 40, 'cases array size')
 ids=set(); counts={'cases':len(cases),'actions':0,'checks':0,'barriers':0}
 for c in cases:
  ensure(isinstance(c,dict) and set(c)=={'id','description','actions'},'case fields')
  ensure(isinstance(c['id'],str) and c['id'] and c['id'] not in ids,'case id'); ids.add(c['id'])
  ensure(isinstance(c['description'],str) and c['description'],'description')
  ensure(isinstance(c['actions'],list) and 1 <= len(c['actions']) <= 240,'actions size')
  actors={}; checks=0
  for a in c['actions']:
   counts['actions']+=1
   ensure(isinstance(a,dict) and a.get('op') in SPECS,'op')
   op=a['op']; allowed,required=SPECS[op]
   ensure(set(a)<=BASE|allowed and BASE|required<=set(a),'action fields')
   n=a['actor']; ensure(isinstance(n,str) and n,'actor')
   if op=='new':
    ensure(n not in actors,'new duplicate'); actors[n]={'live':True,'armed':False,'gated':False,'stopped':False}
   else: ensure(n in actors and actors[n]['live'],'actor not live')
   s=actors[n]
   if s['stopped']: ensure(op in {'resume','kill'},'command on stopped actor')
   if 'memory' in a: ensure(type(a['memory']) is bool,'memory')
   if 'word' in a: ensure(isinstance(a['word'],str) and 1<=len(a['word'])<=40,'word')
   if 'after' in a: ensure(isinstance(a['after'],str) or a['after'] is None,'after')
   if 'pinned' in a: ensure(type(a['pinned']) is bool,'pinned')
   if 'words' in a: ensure(isinstance(a['words'],list) and len(a['words'])<=100 and all(isinstance(w,str) for w in a['words']),'words')
   if 'store' in a: ensure(a['store'] in {'dictionary','touch','both'},'store')
   if op=='touch':
    ensure(a['word'].isascii() and a['word'].islower() and a['word'].isalpha() and len(a['word'])>=2,'touch word')
    ensure(type(a['repeat']) is int and 1<=a['repeat']<=200,'repeat')
    for f in ('dx','dy'): ensure(type(a[f]) in (int,float) and math.isfinite(a[f]) and -1<=a[f]<=1,'offset')
   if op in ('save','clear'): ensure(type(a['expected']) is bool,'result expectation'); checks+=1
   if op=='check':
    field=a['field']; value=a['expected']
    ensure(field in {'count','known','blocked','pair','history','total','dirty','touchWeight','offsetX','offsetY'},'field')
    args=({'word'} if field in {'count','known','blocked','offsetX','offsetY'} else {'word','after'} if field=='pair' else {'after'} if field=='history' else set())
    ensure(set(a)==BASE|{'field','expected'}|args,'check arguments')
    if 'after' in args: ensure(isinstance(a['after'],str),'history string')
    if field in {'known','blocked','dirty'}: ensure(type(value) is bool,'bool oracle')
    elif field in {'touchWeight','offsetX','offsetY'}: ensure(type(value) in (int,float) and math.isfinite(value),'finite oracle')
    else: ensure(type(value) is int and value>=0,'count oracle')
    if field in {'offsetX','offsetY'}: ensure(len(a['word'])==1 and 'a'<=a['word']<='z','offset byte')
    checks+=1
   if op=='arm':
    ensure(not s['armed'] and not s['gated'],'only one gate per process')
    ensure(a['gate'] in {'beforeLock','beforeRename','failRename'},'gate')
    s['armed']=True; s['gate']=a['gate']
   if op=='waitGate':
    ensure(s['armed'] and s['gate']!='failRename' and not s['gated'],'wait not armed'); s['gated']=True; counts['barriers']+=1
   if op=='release': ensure(s['gated'] and not s['stopped'],'release not gated'); s['gated']=False
   if op=='stop': ensure(s['gated'],'stop not gated'); s['stopped']=True
   if op=='resume': ensure(s['stopped'],'resume not stopped'); s['stopped']=False
   if op=='kill': s['live']=False
  ensure(checks>0,'no oracle'); counts['checks']+=checks
  ensure(all(not s['live'] or not s['gated'] for s in actors.values()),'unreleased live gate')
 return counts
if __name__=='__main__':
 data=open(sys.argv[1],'rb').read(); result=validate(json.loads(data)); result['sha256']=hashlib.sha256(data).hexdigest(); print(json.dumps(result,sort_keys=True))
