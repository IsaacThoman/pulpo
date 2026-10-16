#!/usr/bin/env python3
r"""Verify this bounded rejected R26 archive; never execute a keyboard or build source.
Python 3 + Perl's core JSON::PP/Unicode \X are required. Historical Swift host uses
Character offsets; Perl grapheme splitting independently checks these retained data.
"""
import subprocess,json,hashlib,collections,pathlib,gzip,argparse
A=argparse.ArgumentParser();A.add_argument('--history',help='optional path within the source Git repository');args=A.parse_args()
AREA=pathlib.Path(__file__).resolve().parent
manifest=json.loads((AREA/'manifest.json').read_bytes())
def require(ok,msg):
 if not ok:raise ValueError(msg)
entries={e['path']:e for e in manifest['artifacts']}
require(len(entries)==len(manifest['artifacts'])==87,'artifact count/duplicates')
for e in entries.values():
 path=AREA/e['path'];require(path.resolve().is_relative_to(AREA),'archive path')
 packed=path.read_bytes();data=gzip.decompress(packed)if path.suffix=='.gz'else packed
 require(len(packed)==e['bytes']and hashlib.sha256(packed).hexdigest()==e['sha256'],e['path']+' stored hash')
 require(len(data)==e['originalBytes']and hashlib.sha256(data).hexdigest()==e['originalSHA256'],e['path']+' original hash')
 if path.suffix=='.gz':require(packed[4:8]==b'\0'*4,'gzip timestamp')
def data(path):
 p=AREA/path
 if not p.exists():p=AREA/(path+'.gz')
 return gzip.decompress(p.read_bytes())if p.suffix=='.gz'else p.read_bytes()
def raw(n):return data('original/'+n)
def load(n):return json.loads(raw(n))
freeze=load('candidate-runner-freeze-v1.json');receipt=load('sealed-receipt-v1.json')
require(hashlib.sha256(raw('heldout-v1.json')).hexdigest()==freeze['sealedHeldoutSHA256']==receipt['suiteSHA256'],'heldout author hash')
for n in ['contract','schema']:
 require(hashlib.sha256(raw(n+'-v1.'+('txt'if n=='contract'else 'json'))).hexdigest()==receipt[n+'SHA256'],'author '+n+' hash')
for old,h in freeze['frozenFiles'].items():
 name=old.split('/')[-1]
 retained='fixtures/'+name+'.txt'if name.endswith('.swift')and name!='KeyboardEngine.swift'and name!='AccuracyEditingTests.swift'else 'original/'+name
 if retained in entries or retained+'.gz'in entries:require(hashlib.sha256(data(retained)).hexdigest()==h,'frozen retained '+name)
if args.history:
 repo=subprocess.check_output(['git','-C',str(pathlib.Path(args.history).resolve()),'rev-parse','--show-toplevel'],text=True).strip()
 def git(*a):return subprocess.check_output(['git','-C',repo,*a])
 for e in entries.values():
  o=e['origin']
  if 'commit'in o:expected=git('show',o['commit']+':'+o['path'])
  elif 'diffBase'in o:expected=git('diff','--binary',o['diffBase'],o['diffCandidate'],'--',o['path'])
  else:continue
  require(hashlib.sha256(expected).hexdigest()==e['originalSHA256'],'Git original '+e['path'])
 for old,h in freeze['frozenFiles'].items():require(hashlib.sha256(git('show',manifest['candidateCommit']+':'+old)).hexdigest()==h,'Git frozen '+old)
 for key in ['baseline','candidate']:
  engine='apps/keyboard-ios/PulpoKeyboardKit/Sources/KeyboardCore/Input/KeyboardEngine.swift'
  require(hashlib.sha256(git('show',manifest[key+'Commit']+':'+engine)).hexdigest()==manifest[key+'EngineSHA256'],'Git engine '+key)
 for language,h in manifest['dictionarySHA256'].items():require(hashlib.sha256(git('show',manifest['candidateCommit']+':apps/keyboard-ios/LanguageData/'+language+'.pkdict')).hexdigest()==h,'Git dictionary')
 print('Git originals, inactive patches, engines, frozen files and dictionaries match')
files=['development-paired-v1.json','heldout-paired-v1.json','r20-development-paired-v1.json','r20-heldout-paired-v1.json','r20-source-controls-paired-v1.json','r5-development-paired-v1.json','r5-held-out-paired-v1.json']
qs={n:load(n) for n in files}; strings=set()
def collect(x):
 if isinstance(x,str):strings.add(x)
 elif isinstance(x,list):
  for v in x:collect(v)
 elif isinstance(x,dict):
  for v in x.values():collect(v)
for q in qs.values():collect(q)
strings=sorted(strings)
perl='use JSON::PP; local $/; my $s=decode_json(<STDIN>); print encode_json([map { [/(\\X)/g] } @$s]);'
r=subprocess.run(['perl','-e',perl],input=json.dumps(strings).encode(),stdout=subprocess.PIPE,check=True)
g=dict(zip(strings,json.loads(r.stdout)))
def graphemes(s):
 if s not in g:
  r=subprocess.run(['perl','-e',perl],input=json.dumps([s]).encode(),stdout=subprocess.PIPE,check=True);g[s]=json.loads(r.stdout)[0]
 return list(g[s])
def utf16(s):return len(s.encode('utf-16-le'))//2
schema=load('schema-v1.json')
def validate(x,s,path='root'):
 if '$ref'in s:return validate(x,schema['$defs'][s['$ref'].split('/')[-1]],path)
 if 'type'in s:
  typ={'object':dict,'array':list,'string':str,'integer':int,'boolean':bool}[s['type']];require(type(x)is typ,path+' type')
 if 'enum'in s:require(x in s['enum'],path+' enum')
 if 'const'in s:require(x==s['const'],path+' const')
 if 'minimum'in s:require(x>=s['minimum'],path+' minimum')
 if isinstance(x,dict):
  require(all(k in x for k in s.get('required',[])),path+' required');props=s.get('properties',{})
  if s.get('additionalProperties')is False:require(set(x)<=set(props),path+' extra')
  for k,v in x.items():
   if k in props:validate(v,props[k],path+'.'+k)
 if isinstance(x,list):
  require(len(x)>=s.get('minItems',0),path+' minItems')
  for i,v in enumerate(x):validate(v,s['items'],path+str(i))
hashes=manifest['dictionarySHA256']
primitiveCount=0; safetyDiff=[]
for fn,q in qs.items():
 main=fn in files[:2]; legacy20=fn.startswith('r20'); rows=q['rows']; cases={r['id']:r['input'] for r in rows}
 require(len(rows)==3*len(cases)==len({(r['id'],r['language'])for r in rows}),fn+' duplicate/coverage')
 require({(r['id'],r['language'])for r in rows}=={(c,l)for c in cases for l in hashes},fn+' matrix')
 if main:
  suite=load(fn.replace('-paired',''));validate(suite,schema)
  require(cases=={c['id']:c for c in suite['cases']},fn+' full input')
 stats=collections.Counter(); changedFailure=[]; gains=set();finalGains=set();snapChanges=set();badConservation=set()
 for row in rows:
  case=row['input'];require(case==cases[row['id']],fn+' case identity')
  exacts=[];final=[]
  for version in ['baseline','candidate']:
   x=row[version];require(all(type(x[k])is bool for k in ['completed','conserved']+(['exact','oracleDefined']if main or legacy20 else ['passed','bounded'])),'boolean fields');require(x['id']==row['id']and x['language']==row['language'],fn+' identity')
   require(x['expected']==case['expected'],fn+' expected')
   if main or legacy20:
    require(x['dictionary']==row['language']+'.pkdict'and x['dictionarySHA256']==hashes[row['language']]and x['modelMode']==row['language'],fn+' dictionary')
   if main:require(x['settingsLanguage']==row['language']and x['modelIdentityVerified']is True,fn+' mode')
   if not main and not legacy20:
    modes=[row['language']]+[{'en':'en_US','es':'es','bilingual':'en_es'}[a['text']]for a in case['actions']if a['kind']=='mode']
    require([d['mode']for d in x['dictionaries']]==modes and x['finalMode']==modes[-1],fn+' model transitions')
    for d in x['dictionaries']:require((d['filename'],d['sha256'])==(d['mode']+'.pkdict',hashes[d['mode']]),fn+' dictionary')
   prefix=case['prefix']if main or legacy20 else case['initialLeft'];selected=case['selected']if main or legacy20 else '';suffix=case['suffix']if main or legacy20 else case['initialRight']
   chars=graphemes(prefix+selected+suffix);cur=len(graphemes(prefix));sel=len(graphemes(selected));labels=[True]*len(graphemes(prefix))+[False]*sel+[True]*len(graphemes(suffix));conserved=True
   for i,p in enumerate(x['primitives']):
    primitiveCount+=1
    if legacy20:
     require(p['cursor']==cur and p['selected']==''.join(chars[cur:cur+sel]),fn+' legacy chain');kind=p['kind'];v=graphemes(p['text'])
    else:
     require((p['before'],p['caretBefore'],p['selectionBefore'])==(''.join(chars),cur,sel),fn+' chain '+row['id']+' '+version+' '+str(i)+' '+repr((p['before'],p['caretBefore'],p['selectionBefore']))+' != '+repr((''.join(chars),cur,sel)));kind=p['kind'];v=graphemes(p['value'])
    require(0<=cur<=len(chars)and 0<=sel<=len(chars)-cur,fn+' before bound')
    if kind=='hostMove':
     removed='';cur=p['caretAfter'];sel=p['selectionAfter'];require(0<=cur<=len(chars)and 0<=sel<=len(chars)-cur,fn+' movebounds');labels[cur:cur+sel]=[False]*sel
    elif kind=='hostReplace':
     removed=''.join(chars);chars=v;cur=p['caretAfter'];sel=p['selectionAfter'];labels=[True]*len(v);require(0<=cur<=len(chars)and 0<=sel<=len(chars)-cur,fn+' replacebounds');labels[cur:cur+sel]=[False]*sel
    else:
     require(kind in ['insert','delete'],fn+' primitivekind')
     start=cur if kind=='insert'or sel else max(0,cur-1);end=cur+sel
     removed=''.join(chars[start:end]);safe=not any(labels[start:end]);conserved &=safe
     chars[start:end]=v if kind=='insert'else [];labels[start:end]=[False]*len(v)if kind=='insert'else [];cur=start+(len(v)if kind=='insert'else 0);sel=0
     require(chars==graphemes(''.join(chars)),fn+' grapheme merge')
     if not legacy20:require(p['conserved']==safe and p['bounded']is True,fn+' safety boolean')
    require(removed==p['removed'],fn+' removed')
    if not legacy20:require((p['after'],p['caretAfter'],p['selectionAfter'])==(''.join(chars),cur,sel),fn+' after')
   caret=x['actualCaret']if main or legacy20 else x['caret'];selection=x['actualSelection']if main else sel
   require((x['actual'],caret,selection)==(''.join(chars),cur,sel),fn+' final')
   badConservation.update([(row['id'],row['language'])]if not conserved else []);require(x['conserved']==conserved and (conserved or not main and not legacy20),fn+' conservation '+row['id']+' '+version+' reported='+str(x['conserved'])+' recomputed='+str(conserved))
   cp=True
   if main:
    require(x['bounded']is True and x['utf16Caret']==utf16(''.join(chars[:cur])),fn+' finalbounds/utf16')
    require(x['expectedCaret']==case['caret']and x['expectedSelection']==0 and x['oracleDefined']==(case.get('oracle')!='ambiguous'),fn+' oraclemetadata')
    require(x['category']==case['category']and x['contentLabel']==case['contentLabel']and x['context']==case.get('context','full')and x['field']==case.get('field','normal')and x['smartPunctuation']==case.get('smartPunctuation',True)and x.get('smartQuotes')==case.get('smartQuotes'),fn+' metadata')
    acts=case['actions'];count=0
    if case.get('route')!='controller':
     for a in acts:
      count+=1
      if a['kind']=='nativeUndo':break
    require(len(x['snapshots'])==count+2,fn+' snapshotcoverage')
    for sn in x['snapshots']:
     gs=graphemes(sn['text']);require(0<=sn['caret']<=len(gs)and 0<=sn['selection']<=len(gs)-sn['caret']and sn['utf16Caret']==utf16(''.join(gs[:sn['caret']])),fn+' snapshotbounds')
    for a,sn in zip(acts,x['snapshots'][1:-1]):
     require(sn['action']==a['kind'],fn+' actionmatching');passed=(a.get('expected',sn['text'])==sn['text']and a.get('caret',sn['caret'])==sn['caret']and a.get('phantom',sn['phantom'])==sn['phantom']);require(passed==sn['checkpointsPass'],fn+' checkpointflag');cp &=passed
    require((x['snapshots'][-1]['text'],x['snapshots'][-1]['caret'],x['snapshots'][-1]['selection'])==(x['actual'],caret,selection),fn+' flushed')
    expectedComplete=case.get('route')!='controller'and not any(a['kind']=='nativeUndo'for a in acts)
    require(x['completed']==expectedComplete,fn+' complete')
   if main or legacy20:
    exact=x['oracleDefined']and x['completed']and x['actual']==case['expected']and caret==case['caret']and selection==0 and cp;require(x['exact']==exact,fn+' score')
   else:
    exact=x['completed']and x['actual']==case['expected'];require(x['passed']==exact,fn+' score')
   stats[version+'Exact']+=exact;stats[version+'Unavailable']+=not x['completed'];exacts.append(exact);final.append((x['actual'],caret,selection))
  gain=not exacts[0]and exacts[1];reg=exacts[0]and not exacts[1];changed=final[0]!=final[1];cf=changed and not any(exacts)
  for k,v in [('gain',gain),('regression',reg),('outputChanged',changed),('changedFailure',cf)]:require(row[k]==v,fn+' row '+k)
  stats['gains']+=gain;stats['regressions']+=reg
  if cf:changedFailure.append([row['id'],row['language']])
  if gain:gains.add(row['id'])
  if gain and changed:finalGains.add(row['id'])
  if main and [(s['text'],s['caret'],s['selection'])for s in row['baseline']['snapshots']]!=[(s['text'],s['caret'],s['selection'])for s in row['candidate']['snapshots']]:snapChanges.add((row['id'],row['language']))
  if changed and not gain:safetyDiff.append((fn,row['id'],row['language'],final))
 require(badConservation==({('D17','en_US'),('D28','es')}if fn=='r5-development-paired-v1.json'else set()),fn+' historical conservation set')
 for k,v in stats.items():require(q['summary'][k]==v,fn+' summary'+k)
 require(q['summary']['changedFailures']==changedFailure,fn+' changedfailure summary')
 require((stats['baselineExact'],stats['candidateExact'],len(rows))=={'development-paired-v1.json':(90,243,267),'heldout-paired-v1.json':(48,93,120),'r20-development-paired-v1.json':(68,92,120),'r20-heldout-paired-v1.json':(45,66,108),'r20-source-controls-paired-v1.json':(36,54,66),'r5-development-paired-v1.json':(71,77,84),'r5-held-out-paired-v1.json':(56,59,66)}[fn],fn+' frozen counts')
 if fn=='heldout-paired-v1.json':require(len(gains)==15 and len(finalGains)==14 and len(snapChanges)==51,'heldout gain interpretation')
 print(fn,dict(stats),'uniqueGains',len(gains),'uniqueFinalGains',len(finalGains),'snapshotChanges',len(snapChanges))
require(primitiveCount==3049,'primitive coverage');print('Original matrices verified: 1662 result rows, 3049 primitives; historical R5 conservation exceptions preserved')
require(len(safetyDiff)==12,'changed nongain coverage')
# The exposed adversary's complete traces, not its summary flags, prove the veto.
diagInputs=json.loads(data('independent/inputs.json'))
expectedInputs={s+'-'+c:(s,c=='callback')for s in ['delete','punctuation','marker']for c in ['silent','callback']};expectedInputs['uninterrupted']=('none',False)
require(len(diagInputs)==7 and {x['id']:(x['stage'],x['callback'])for x in diagInputs}==expectedInputs,'diagnostic inputs')
for docname in ['freeze.json','hashes.json']:
 for name,h in json.loads(data('independent/'+docname)).items():
  alias=name+'.txt'if name.endswith('.swift')else name
  require(hashlib.sha256(data('independent/'+alias)).hexdigest()==h,'independent original '+name)
summary=json.loads(data('independent/summary.json'));observations=[];violations=[]
for version in ['baseline','candidate']:
 rows=json.loads(data('independent/'+version+'.json'))
 require(len(rows)==21 and {(x['id'],x['language'])for x in rows}=={(i,l)for i in expectedInputs for l in hashes},'diagnostic matrix/duplicates')
 for row in rows:
  text='Bring supplies';cur=6;mutation=None
  for i,event in enumerate(row['events']):
   require(event['before']==text and 0<=cur<=len(text),'diagnostic before chain')
   if event['kind']=='hostReplace':
    require(mutation is None and event['value']=='' and event['after']=='FOREIGNsupplies'and event['caret']==7,'diagnostic replacement')
    text='FOREIGNsupplies';cur=7;mutation=i
   elif event['kind']=='insert':
    text=text[:cur]+event['value']+text[cur:];cur+=len(event['value'])
   elif event['kind']=='delete':
    require(event['value']==''and cur>0 and text[cur-1]==' ','diagnostic only owned space deletion')
    text=text[:cur-1]+text[cur:];cur-=1
   else:raise ValueError('diagnostic primitive kind')
   require((event['after'],event['caret'])==(text,cur),'diagnostic after chain')
  require((row['document'],row['caret'])==(text,cur),'diagnostic final chain')
  later=[]if mutation is None else [e for e in row['events'][mutation+1:]if e['kind']in ['insert','delete']]
  case=row['id'];mustMutate=(version=='candidate'and case!='uninterrupted')or case.startswith('punctuation-')
  require((mutation is not None)==mustMutate,'diagnostic mutation coverage')
  expectedLater=[',',' ']if version=='candidate'and case=='delete-silent'else [' ']if version=='candidate'and case=='punctuation-silent'else []
  require([e['value']for e in later]==expectedLater and all(e['kind']=='insert'for e in later),'diagnostic post-destination writes')
  expectedFinal=('FOREIGN'+''.join(expectedLater)+'supplies',7+len(''.join(expectedLater)))if mustMutate else ('Bring fresh'+(', 'if version=='candidate'else ',')+'supplies',13 if version=='candidate'else 12)
  require((text,cur)==expectedFinal,'diagnostic final output')
  observation={'version':version,'id':case,'language':row['language'],'document':text,'mutationExecuted':mutation is not None,'postHostWrites':later}
  observations.append(observation)
  if later:violations.append((case,row['language']))
require(observations==summary['observations'],'diagnostic original observations')
require(summary['contexts']==7 and summary['rowsPerVersion']==21 and summary['candidateViolationRows']==len(violations)==6,'diagnostic original counts')
require(set(summary['candidateViolationContexts'])=={i for i,l in violations}=={'delete-silent','punctuation-silent'},'diagnostic loss contexts')
print('REJECT confirmed: 42 diagnostic traces, 6 candidate violations; callback controls stop; baseline punctuation has no later writes')
