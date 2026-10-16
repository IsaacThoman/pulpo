#!/usr/bin/env python3
"""EXPOSED development only, never fresh or accuracy evidence."""
import json
from pathlib import Path
cases=[];relations=[]
def op(kind,**kw):return {'op':kind,**kw}
def add(id,lang,ops,initial='',watch=None):
 c={'id':id,'language':lang,'initial':initial,'cursor':len(initial),'watch':watch or [],'pairs':[], 'ops':ops,'expect':[{'index':i,'selection':0} for i in range(len(ops))]}; cases.append(c); return c
def positive(id,lang,word,samples,typing=None):
 typing=typing or [op('type',text=word,dx=.08,dy=.11)]
 ops=typing+[op('external',text='🎉'),op('callback'),op('callback'),op('external',text='🎊'),op('space'),op('reset')]+typing+[op('external',text='🎉')]
 e=add(id,lang,ops,watch=[word]);s=add(id+'-space',lang,json.loads(json.dumps(ops)),watch=[word])
 a=len(typing);z=len(ops)-1
 for i in (a,z):
  s['ops'][i]=op('space'); relations.append({'kind':'parity','external':[id,i],'space':[s['id'],i],'samples':samples})
 for cid in (id,s['id']):
  for i in range(a+1,z):relations.append({'kind':'hold','from':[cid,a],'to':[cid,i]})
 e['expect'][a-1]['valid']={word:True};s['expect'][a-1]['valid']={word:True}
 e['expect'][a]['counts']={word:1};e['expect'][z]['counts']={word:2}
for lang,word in [('en_US','music'),('es','casa'),('en_es','mundo')]:
 positive('dev-'+lang+'-full',lang,word,len(word))
 positive('dev-'+lang+'-delete',lang,word,len(word),[op('type',text=word+'x',dx=.08,dy=.11),op('delete')])
positive('dev-en-sparse','en_US','canoe',2,[op('type',text='ca',dx=.07,dy=.09),op('type',text='noe',taps=False)])
positive('dev-es-alternate','es','niño',3,[op('type',text='ni',dx=.07,dy=.09),op('type',text='ñ',taps=False),op('type',text='o',dx=.07,dy=.09)])
positive('dev-bi-alternate','en_es','café',3,[op('type',text='caf',dx=.07,dy=.09),op('type',text='é',taps=False)])
for n,suffix in enumerate(['s','.com','_name','@host','/path','-like',"'s",'’s','’','#fragment','*part','🏽','\u0301','\ufe0f','\u200d','']):
 c=add('dev-continuation-'+str(n),'en_US',[op('type',text='music',dx=.08),op('external',text=suffix)],watch=['music'])
 for i in range(len(c['ops'])):relations.append({'kind':'zero','at':[c['id'],i]})
for control in ['identity','identity-callback','private','decline','queued','hiddenBefore','hiddenAfter','hidden','lag','shifted','tapless','unknown','url','email','numberPad','off','touch-off','selection','interior','replaced']:
 ops=[op('type',text='qzxvplmk' if control=='unknown' else 'music',dx=.08)]
 initial=''
 if control=='shifted':initial='mu';ops=[op('type',text='sic',dx=.08)]
 if control=='tapless':ops=[op('type',text='music',taps=False)]
 if control in ['decline','queued']:ops.append(op('document',**{control:True}))
 if control in ['hidden','hiddenBefore','hiddenAfter']:ops.append(op('document',**{control:True}))
 if control=='lag':ops.append(op('document',beforeOverride='musi'))
 if control in ['url','email','numberPad']:ops.append(op('field',keyboard=control))
 if control=='off':ops.append(op('settings',learns=False))
 if control=='touch-off':ops.append(op('settings',touchLearning=False))
 if control=='selection':ops.append(op('host',cursor=2,selection=2))
 if control=='interior':ops.append(op('host',cursor=2))
 if control=='replaced':ops.append(op('host',text='music music',cursor=11))
 ops.append(op('external',text='🎉',**({'transition':control} if control in ('identity','identity-callback','private') else {})))
 if control=='queued':ops.extend([op('document',queued=False),op('flush',callback=True)])
 if control in ['lag','hiddenBefore','hiddenAfter','hidden']:ops.extend([op('document',clearOverride=True,hidden=False,hiddenBefore=False,hiddenAfter=False),op('callback')])
 c=add('dev-control-'+control,'en_US',ops,initial,watch=['music','qzxvplmk'])
 if control=='unknown':c['expect'][0]['valid']={'qzxvplmk':False}
 if control=='selection':
  for i in range(1,len(ops)-1):c['expect'][i]={'index':i,'selection':2}
 for i in range(len(ops)):relations.append({'kind':'zero','at':[c['id'],i]})
# Real second-word contribution, with pre-existing ordinary touch history.
for lang,w1,w2 in [('en_US','good','music'),('es','buena','tarde'),('en_es','blue','cielo')]:
 eid='dev-second-'+lang; sid=eid+'-space'
 ops=[op('type',text=w1,dx=.05),op('space'),op('type',text=w2,dx=-.06,dy=.1),op('external',text='🎉'),op('callback')]
 e=add(eid,lang,ops,watch=[w1,w2]);s=add(sid,lang,json.loads(json.dumps(ops)),watch=[w1,w2]);s['ops'][3]=op('space')
 e['pairs']=s['pairs']=[[w1,w2]]
 relations.append({'kind':'parity','external':[eid,3],'space':[sid,3],'samples':len(w2)})
 for cid in (eid,sid):relations.append({'kind':'hold','from':[cid,3],'to':[cid,4]})
packet={'version':1,'cases':cases,'relations':relations}
Path(__file__).with_name('development.json').write_text(json.dumps(packet,indent=2,ensure_ascii=False)+'\n')
print(len(cases),sum(len(c['ops']) for c in cases),len(relations))
