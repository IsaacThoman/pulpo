"""Read retained raw/ledger and stat metadata only; no product imports/calls/writes."""
from pathlib import Path
from collections import Counter
import hashlib,json,os
base=Path('/tmp/pulpo-r48-paired-final-v2')
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
result={}
for label in ['original-a9e','integrated-82165']:
 p=base/label/'raw.json';ops=json.loads(p.read_text())['operations']
 if any(type(r['available']) is not bool or type(r['invoked']) is not bool for r in ops):raise ValueError('actual flag types')
 unavailable=[r for r in ops if not r['available']];unfired=[r for r in ops if not r['invoked']]
 direct=[r for r in unavailable if r['error']=='invalid("inventory escape")'];first=direct[0];aliases=[]
 for r in direct:
  directory=Path(r['resolvedInput']['url']).parent;a=os.stat(directory);b=os.stat('/private'+str(directory))
  aliases.append({'id':r['id'],'directory':str(directory),'sameDeviceAndInode':(a.st_dev,a.st_ino)==(b.st_dev,b.st_ino),'realpath':os.path.realpath(directory)})
 result[label]={'rawSHA256':sha(p),'operations':len(ops),'unavailable':len(unavailable),'unfired':len(unfired),
  'unavailableByOp':dict(Counter(r['op'] for r in unavailable)),'unfiredByOp':dict(Counter(r['op'] for r in unfired)),
  'firstPersistentConstruct':{k:first[k] for k in ['id','op','session','resolvedInput','status','available','invoked','error']},
  'unavailableInvoked':sum(r['invoked'] for r in unavailable),'unavailableSessions':len(set(r['session'] for r in unavailable)),
  'allUnavailableErrorsContainInventoryEscape':all('inventory escape' in r['error'] for r in unavailable),
  'maxUnavailableErrorUTF8Bytes':max(len(r['error'].encode()) for r in unavailable),
  'directConstructStatusCounts':dict(Counter(r['status'] for r in direct)),
  'directConstructStateRecorded':sum(isinstance(r['state'],dict) for r in direct),
  'directConstructRawInventoryEmpty':sum(r['files']==[] for r in direct),
  'readOnlyStatAliases':aliases,'unavailableWithoutSession':[r['id'] for r in unavailable if r['session'] is None]}
print(json.dumps(result,indent=2))
