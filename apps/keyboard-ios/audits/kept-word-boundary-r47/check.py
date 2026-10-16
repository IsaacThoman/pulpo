#!/usr/bin/env python3
"""Strict complete-run gate. Pure functions also support adversarial development tests."""
import json, math, sys
from pathlib import Path

class Invalid(ValueError): pass

def require(ok, message):
    if not ok: raise Invalid(message)

def finite(x): return type(x) in (int,float) and math.isfinite(x)
def integer(x): return type(x) is int and x >= 0

OPS = {
 'type': {'text','taps','dx','dy'}, 'space': set(),
 'external': {'text','spacing','transition'}, 'delete': set(),
 'host': {'text','cursor','selection','hidden','newDocument','callback'},
 'field': {'keyboard','contentType','secure'},
 'settings': {'learns','autocorrect','touchLearning'}, 'callback': set(), 'reset': set(),
 'snapshot': set(), 'probe': {'intended','dx','dy'},
 'document': {'hidden','hiddenBefore','hiddenAfter','beforeOverride','clearOverride','decline','queued','callback'},
 'flush': {'callback'} }
BOOLS={'taps','spacing','hidden','newDocument','callback','secure','learns','autocorrect','touchLearning','hiddenBefore','hiddenAfter','clearOverride','decline','queued'}
STRINGS={'text','beforeOverride','contentType','intended','transition','keyboard'}
FIELDS={'text','cursor','selection','total','counts','pairs','learns','identity','edits','valid'}
PROBE={'intended','decoded','cost','autocorrection','slots'}

def preflight(packet):
    require(type(packet) is dict and set(packet)=={'version','cases','relations'},'packet schema')
    require(type(packet['version']) is int and packet['version']==1 and type(packet['cases']) is list and packet['cases'],'version/cases')
    cases={}
    for c in packet['cases']:
        require(type(c) is dict and set(c)=={'id','language','initial','cursor','watch','pairs','ops','expect','role'},'case schema')
        require(c['role'] in ('positive','zero','preserve'),'case role')
        require(type(c['id']) is str and c['id'] and c['id'] not in cases,'unique case id')
        require(c['language'] in ('en_US','es','en_es') and type(c['initial']) is str and integer(c['cursor']),'case coordinates/resource')
        require(type(c['watch']) is list and all(type(w) is str for w in c['watch']) and len(set(c['watch']))==len(c['watch']),'watch')
        require(type(c['pairs']) is list and all(type(p) is list and len(p)==2 and all(type(w) is str for w in p) for p in c['pairs']),'pairs')
        require(type(c['ops']) is list and c['ops'],'ops')
        for op in c['ops']:
            require(type(op) is dict and op.get('op') in OPS,'operation')
            require(set(op)-{'op'} <= OPS[op['op']],'operation fields')
            for k,v in op.items():
                if k in BOOLS: require(type(v) is bool,k)
                if k in STRINGS: require(type(v) is str,k)
                if k in ('dx','dy'): require(finite(v),k)
                if k in ('cursor','selection'): require(integer(v),k)
            if op['op'] in ('type','external'): require('text' in op,'required text')
            if 'keyboard' in op: require(op['keyboard'] in ('standard','url','email','numberPad'),'keyboard')
            if 'transition' in op: require(op['transition'] in ('identity','identity-callback','private','selection'),'transition')
            if op['op']=='probe': require(type(op.get('intended')) is str and op['intended'] and all('a'<=x<='z' for x in op['intended']),'probe letters')
        require(type(c['expect']) is list and len(c['expect'])==len(c['ops']),'every operation requires expectation record')
        for i,e in enumerate(c['expect']):
            require(type(e) is dict and type(e.get('index')) is int and e.get('index')==i and set(e)-{'index'} <= FIELDS|{'weight','offsets'}|PROBE,'expectation schema/index')
            require(len(e)>1,'empty expectation')
            for k,v in e.items():
                if k in ('index','cursor','selection','total','identity','edits'): require(integer(v),'expected integer')
                if k in ('text','intended','decoded'): require(type(v) is str,'expected string')
                if k=='autocorrection': require(v is None or type(v) is str,'expected correction')
                if k=='slots': require(type(v) is list and all(type(x) is str for x in v),'expected slots')
                if k=='learns': require(type(v) is bool,'expected policy')
                if k in ('weight','cost'): require(finite(v) and v>=0,'expected finite scalar')
                if k=='pairs': require(type(v) is list and len(v)==len(c['pairs']) and all(integer(x) for x in v),'expected pairs')
                if k in ('counts','valid'):
                    require(type(v) is dict and set(v)<=set(c['watch']),'expected declared watches')
                    require(all((integer(x) if k=='counts' else type(x) is bool) for x in v.values()),'expected watch values')
                if k=='offsets': require(type(v) is list and len(v)==26 and all(type(x) is list and len(x)==2 and all(finite(z) for z in x) for x in v),'expected full offsets')
        cases[c['id']]=c
    require(type(packet['relations']) is list,'relations')
    def point(p):
        require(type(p) is list and len(p)==2 and p[0] in cases and integer(p[1]) and p[1]<len(cases[p[0]]['ops']),'relation point')
    allowed=set(); positives=[]; replacements={}; roots={}; holds={}; witnesses={}
    for rel in packet['relations']:
        require(type(rel) is dict and rel.get('kind') in ('parity','hold','zero'),'relation kind')
        kind=rel['kind']
        if kind=='parity':
            require(set(rel)=={'kind','external','space','samples','witness'},'parity schema')
            require(rel['witness'] in ('first','second-word','second-occurrence'),'witness role')
            e,s=rel['external'],rel['space']
            point(e);point(s)
            require(e[1]>0 and s[1]==e[1] and integer(rel['samples']) and rel['samples']>0,'positive parity samples/indices')
            ec,sc=cases[e[0]],cases[s[0]]
            require(ec['role']==sc['role']=='positive','positive case roles')
            roots.setdefault(e[0],set()).add(e[1]);roots.setdefault(s[0],set()).add(s[1])
            witnesses[tuple(e)]=rel['witness']
            require(ec['language']==sc['language'] and ec['initial']==sc['initial'] and ec['cursor']==sc['cursor'],'same initial history/resource')
            require(ec['ops'][e[1]]['op']=='external' and sc['ops'][s[1]]=={'op':'space'},'parity route')
            require(tuple(e) not in allowed,'overlapping touch allowance')
            allowed.add(tuple(e)); positives.append((e,s)); replacements[tuple(e)]={'op':'space'}
        elif kind=='hold':
            require(set(rel)=={'kind','from','to'},'hold schema');point(rel['from']);point(rel['to'])
            a,b=rel['from'],rel['to']
            require(a[0]==b[0] and a[1]<b[1] and tuple(b) not in allowed,'ordered nonoverlap hold')
            allowed.add(tuple(b));holds[tuple(b)]=tuple(a)
        else:
            require(set(rel)=={'kind','at'},'zero schema');point(rel['at'])
    for case in cases.values():
        events=sorted(roots.get(case['id'],set()))
        if case['role']=='positive': require(events,'positive case without event')
        else: require(not events,'unclassified positive event')
        for i in range(len(case['ops'])):
            previous=[event for event in events if event<i]
            if previous and i not in events:
                require(holds.get((case['id'],i))==(case['id'],previous[-1]),'every follow-on must hold latest accepted state')
    for target,origin in holds.items():
        events=sorted(roots.get(target[0],set()))
        previous=[event for event in events if event<target[1]]
        require(previous and origin==(target[0],previous[-1]),'hold cannot cross or erase contribution')
    for e,s in positives:
        witness=witnesses[tuple(e)]
        if witness=='second-occurrence':
            require(any(i<e[1] for i in roots[e[0]]),'second occurrence without earlier acceptance')
        if witness=='second-word':
            earlier=cases[e[0]]['ops'][:e[1]]
            require(any(o['op']=='space' for o in earlier) and sum(o['op']=='type' for o in earlier)>=2,'second word lacks prior Space/type history')
        ec,sc=cases[e[0]],cases[s[0]]
        eh=[replacements.get((e[0],i),op) for i,op in enumerate(ec['ops'][:e[1]+1])]
        require(eh==sc['ops'][:s[1]+1],'Space reference must have exact same operation history except declared parity commits')
    # Every resource must contain meaningful parity, with at least two separate words/occurrences.
    for language in ('en_US','es','en_es'):
        for witness in ('first','second-word','second-occurrence'):
            require(any(cases[e[0]]['language']==language and witnesses[tuple(e)]==witness for e,s in positives),'missing required resource witness '+language+'/'+witness)
    require(any(c['role']=='zero' for c in cases.values()),'missing zero-control coverage')
    return cases,allowed

def validate_rows(packet,rows):
    require(type(rows) is list,'row array')
    manifest=[(c,i,op) for c in packet['cases'] for i,op in enumerate(c['ops'])]
    require(len(rows)==len(manifest),'complete row count')
    indexed={}
    for r,(c,i,op) in zip(rows,manifest):
        require(type(r) is dict,'row object')
        required=FIELDS|{'id','language','index','op','weight','offsets'}|(PROBE if op['op']=='probe' else set())
        require(set(r)==required,'exact row fields')
        require(type(r['index']) is int and (r['id'],r['language'],r['index'],r['op'])==(c['id'],c['language'],i,op['op']),'exact row identity/order/operation')
        require(type(r['text']) is str and all(integer(r[k]) for k in ('cursor','selection','total','identity','edits')),'text/count types')
        require(type(r['learns']) is bool and type(r['counts']) is dict and set(r['counts'])==set(c['watch']) and all(integer(v) for v in r['counts'].values()),'word counts/policy')
        require(type(r['valid']) is dict and set(r['valid'])==set(c['watch']) and all(type(v) is bool for v in r['valid'].values()),'validity observations')
        require(type(r['pairs']) is list and len(r['pairs'])==len(c['pairs']) and all(integer(v) for v in r['pairs']),'ordered pairs')
        require(finite(r['weight']) and r['weight']>=0,'finite weight')
        require(type(r['offsets']) is list and len(r['offsets'])==26 and all(type(p) is list and len(p)==2 and all(finite(v) for v in p) for p in r['offsets']),'full finite offsets')
        if op['op']=='probe':
            require(finite(r['cost']) and type(r['decoded']) is str and r['intended']==op['intended'] and (r['autocorrection'] is None or type(r['autocorrection']) is str) and type(r['slots']) is list and all(type(v) is str for v in r['slots']),'probe fields')
        indexed[(c['id'],i)]=r
    return indexed

def touch(row): return [row['weight'],row['offsets']]
def evaluate(packet,baseline,candidate):
    cases,allowed=preflight(packet)
    b=validate_rows(packet,baseline); c=validate_rows(packet,candidate)
    checks=[]
    def check(group,key,ok,detail=None): checks.append({'group':group,'key':key,'passed':bool(ok),'detail':detail})
    for scenario in packet['cases']:
        for i,e in enumerate(scenario['expect']):
            key=(scenario['id'],i); br,cr=b[key],c[key]
            for field in sorted(FIELDS|(PROBE if cr['op']=='probe' else set())):
                check('preservation',[*key,field],br[field]==cr[field])
            if scenario['role']=='zero':
                for name,r in [('baseline',br),('candidate',cr)]: check('role-full-zero',[*key,name],touch(r)==[0,[[0,0] for _ in range(26)]])
            if key not in allowed: check('touch-preservation',list(key),touch(br)==touch(cr))
            for field,expected in e.items():
                if field=='index':continue
                for name,r in [('baseline',br),('candidate',cr)]:
                    actual=r[field]
                    ok=all(actual.get(k)==v for k,v in expected.items()) if type(expected) is dict and type(actual) is dict else actual==expected
                    check('assertion-'+name,[*key,field],ok,{'expected':expected,'actual':actual})
    for n,rel in enumerate(packet['relations']):
        if rel['kind']=='parity':
            e,s=tuple(rel['external']),tuple(rel['space']); ep=(e[0],e[1]-1);sp=(s[0],s[1]-1)
            for name,ref in [('baseline',b),('candidate',c)]:
                check('parity-before',[n,name],touch(c[ep])==touch(ref[sp]))
                check('parity-after',[n,name],touch(c[e])==touch(ref[s]))
                check('positive-exact-increment',[n,name],ref[s]['weight']-ref[sp]['weight']==rel['samples'])
            check('external-exact-increment',n,c[e]['weight']-c[ep]['weight']==rel['samples'])
            check('baseline-missing-contribution',n,touch(b[e])==touch(b[ep]))
        elif rel['kind']=='hold':
            a,z=tuple(rel['from']),tuple(rel['to'])
            for name,ref in [('baseline',b),('candidate',c)]:check('no-follow-on-update',[n,name],touch(ref[a])==touch(ref[z]))
        else:
            at=tuple(rel['at'])
            for name,ref in [('baseline',b),('candidate',c)]:check('full-zero-control',[n,name],touch(ref[at])==[0,[[0,0] for _ in range(26)]])
    failures=[x for x in checks if not x['passed']]
    groups={g:{'checks':sum(x['group']==g for x in checks),'passed':sum(x['group']==g and x['passed'] for x in checks)} for g in sorted({x['group'] for x in checks})}
    return {'groups':groups,'status':'PASS' if not failures else 'FAIL','cases':len(cases),'rowsPerVariant':len(b),'unavailable':0,'checks':len(checks),'passed':len(checks)-len(failures),'failures':failures,'allChecks':checks}

def main():
    try:
        packet=json.loads(Path(sys.argv[1]).read_text());preflight(packet)
        if len(sys.argv)==2: print(json.dumps({'status':'PREFLIGHT_PASS'}));return
        require(len(sys.argv)==6,'usage: check.py input baseline candidate process output')
        process=json.loads(Path(sys.argv[4]).read_text())
        require(set(process)=={'baseline','candidate'},'process records')
        for name in ('baseline','candidate'):
            rec=process[name]
            require(type(rec) is dict and {'exit','stderr'}<=set(rec)<= {'exit','stderr','stdout','started','finished','unavailable','error'},'process record schema')
            require(type(rec['exit']) is int and type(rec['stderr']) is str,'typed process status')
            for field in ('stdout','started','finished','error'):
                if field in rec: require(type(rec[field]) is str,'typed process '+field)
            if 'unavailable' in rec: require(type(rec['unavailable']) is bool,'typed unavailable')
            require(rec['exit']==0 and rec['stderr']=='' and not rec.get('unavailable',False) and not rec.get('error',''),'whole-run process failure/unavailable')
        result=evaluate(packet,json.loads(Path(sys.argv[2]).read_text()),json.loads(Path(sys.argv[3]).read_text()))
    except Exception as error:
        result={'status':'WHOLE_GATE_ERROR','unavailable':1,'error':str(error)}
    output=json.dumps(result,indent=2,allow_nan=False)+'\n'
    if len(sys.argv)==6: Path(sys.argv[5]).write_text(output)
    else: print(output)
    sys.exit(0 if result['status']=='PASS' else 1)
if __name__=='__main__':main()
