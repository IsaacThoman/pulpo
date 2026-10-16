"""Synthetic JSON ledger tests only, no product or model simulated/executed."""
import collections, copy, importlib.util, json, pathlib
O=pathlib.Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('accounting',O/'output-accounting.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
fixed=json.loads((O/'static-results.json').read_text())
families=[]
for row in fixed['checkPlans']:
    fid,iid=row['location'].split('/')
    if not families or families[-1]['familyID']!=fid:
        families.append({'familyID':fid,'instances':[]})
    checks=[{'id':cid,'expected':'synthetic metadata placeholder','status':'pass','actual':None} for cid in row['checkIDs']]
    counts={'check':len(checks),'pass':len(checks),'fail':0,'unavailable':0,'error':0}
    families[-1]['instances'].append({'id':iid,'mode':iid,'result':{'checks':checks,'counts':counts,'events':[]}})
for f in families:f['counts']={k:sum(i['result']['counts'][k] for i in f['instances']) for k in ('check','pass','fail','unavailable','error')}
base={'schemaVersion':1,'uniqueFamilies':24,'modeInstances':34,'plannedCheckCount':652,'busyRetryCount':0,'families':families,'counts':{'check':652,'pass':652,'fail':0,'unavailable':0,'error':0},'publicationErrors':[],'completePass':True}
def accepted(doc,exitcode=0,missing=False):
    def load(p):
        if p.name=='static-results.json':return fixed
        if p.name=='results.json':return doc
        if missing:raise FileNotFoundError()
        return next(f for f in doc['families'] if f['familyID']+'.json'==p.name)
    m.load=load
    try:m.verify(pathlib.Path('/synthetic-ledger-only'),exitcode);return True
    except (AssertionError,FileNotFoundError,KeyError,StopIteration):return False
tests=[{'kind':'synthetic_structurally_complete_ledger','pass':accepted(base)}]
def mutation(kind,change,exitcode=0,missing=False):
    bad=copy.deepcopy(base);change(bad)
    tests.append({'kind':kind,'pass':not accepted(bad,exitcode,missing)})
mutation('wrong_total',lambda d:d['counts'].update(check=651))
mutation('pending_status',lambda d:d['families'][0]['instances'][0]['result']['checks'][0].update(status='pending'))
mutation('duplicate_family',lambda d:d['families'].append(copy.deepcopy(d['families'][0])))
mutation('missing_family',lambda d:d['families'].pop())
mutation('missing_planned_check',lambda d:d['families'][0]['instances'][0]['result']['checks'].pop())
mutation('unexpected_check',lambda d:d['families'][0]['instances'][0]['result']['checks'].append({'id':'extra','status':'pass','actual':None,'expected':''}))
mutation('wrong_exit',lambda d:None,exitcode=2)
mutation('missing_family_file',lambda d:None,missing=True)
mutation('busy_event_hidden_as_pass',lambda d:d['families'][0]['instances'][0]['result']['events'].append({'classification':'unavailable'}))
mutation('publication_error_hidden_as_pass',lambda d:d['publicationErrors'].append('synthetic error'))
mutation('wrong_complete_flag',lambda d:d.update(completePass=False))
r={'method':'STATIC/SYNTHETIC JSON accounting only, no product/model/runner execution','checks':len(tests),'passed':sum(t['pass'] for t in tests),'failed':sum(not t['pass'] for t in tests),'tests':tests}
(O/'accounting-synthetic-results.json').write_text(json.dumps(r,indent=2)+'\n')
print(json.dumps({k:v for k,v in r.items() if k!='tests'}))
