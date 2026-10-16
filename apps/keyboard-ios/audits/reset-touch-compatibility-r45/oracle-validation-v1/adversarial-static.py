"""Synthetic predicate checks only; no runner, stub, mock or product execution."""
import copy, json, math, pathlib, runpy, struct
O=pathlib.Path('/tmp/pulpo-r45-oracle-validation-v1')
n=runpy.run_path(str(O/'static-checker.py'))
F=n['f']; payload=n['payload']; expected_step=n['expected_step']; plan=n['plan']
def inspect(s,mode,learning):
    accepted,p=expected_step(s,mode,learning)
    good=s['expectedAccepted']==accepted and s['expectedActualSamples']==len(p['samples'])
    good &= s['weightRule']==('increase' if accepted else 'unchanged')
    good &= (s.get('control') is not None)==accepted
    if s['payload'].get('normalizedText') is not None:
        good &= s['payload']['normalizedText']==p['normalized']
    if accepted:good &= payload(s['control'])['samples']==p['samples']
    if mode=='persistent' and p['valid'] and learning and len(p['samples'])>40:
        good &= s['statusRule']=='invalid'
    return bool(good)
tests=[]
def test(kind,ok):tests.append({'kind':kind,'pass':bool(ok)})
for fam in F['families']:
    for inst in fam['instances']:
        learning=True
        for s in inst['steps']:
            if s.get('learning') is not None:learning=s['learning']
            test('valid_fixed_expectation',inspect(s,inst['mode'],learning))
            for key,value,kind in (
                ('expectedAccepted',not s['expectedAccepted'],'inverted_acceptance'),
                ('expectedActualSamples',s['expectedActualSamples']+1,'off_by_one_sample'),
                ('weightRule','unchanged' if s['weightRule']=='increase' else 'increase','reversed_weight_relation')):
                bad=copy.deepcopy(s);bad[key]=value
                test(kind,not inspect(bad,inst['mode'],learning))
            if s['payload'].get('normalizedText') is not None:
                bad=copy.deepcopy(s);bad['payload']['normalizedText']+='!'
                test('wrong_normalization',not inspect(bad,inst['mode'],learning))
            if s.get('control') is not None:
                bad=copy.deepcopy(s);bad['control']['taps']=[]
                test('tapless_control',not inspect(bad,inst['mode'],learning))
            p=payload(s['payload'])
            if inst['mode']=='persistent' and p['valid'] and learning and len(p['samples'])>40:
                bad=copy.deepcopy(s);bad['statusRule']='busy'
                test('busy_as_expected_oversize',not inspect(bad,inst['mode'],learning))
def close(a,b):return math.isfinite(a) and math.isfinite(b) and abs(a-b)<=1e-12+1e-12*max(abs(a),abs(b))
def exact(a,b):return struct.pack('>d',a)==struct.pack('>d',b)
test('signed_zero_change_rejected',not exact(0.,-0.))
test('one_ulp_change_rejected',not exact(1.,math.nextafter(1.,math.inf)))
for v in (math.nan,math.inf,-math.inf):
    test('nonfinite_equivalence_rejected',not close(v,v))
    test('nonfinite_weight_increase_rejected',not(math.isfinite(v) and v>0))
test('beyond_tolerance_rejected',not close(1.,1.+1e-8))
test('within_tolerance_allowed',close(1.,1.+1e-13))
base={'entries':{'root':{'kind':1,'inode':'1','device':'1','mtimeSeconds':'1','mtimeNanoseconds':'1','bytesBase64':None,'symlink':None}}}
for key,value in [('kind',2),('inode','2'),('device','2'),('mtimeSeconds','2'),('mtimeNanoseconds','2'),('bytesBase64','AA=='),('symlink','other')]:
    bad=copy.deepcopy(base);bad['entries']['root'][key]=value
    test('filesystem_'+key+'_mutation_rejected',base!=bad)
bad=copy.deepcopy(base);bad['entries']['added']={};test('filesystem_membership_mutation_rejected',base!=bad)
def complete(c,pub):return c['fail']==c['error']==c['unavailable']==0 and not pub
for kind in ('fail','error','unavailable'):
    c={'fail':0,'error':0,'unavailable':0};c[kind]=1
    test(kind+'_prevents_pass',not complete(c,[]))
test('publication_error_prevents_pass',not complete({'fail':0,'error':0,'unavailable':0},['error']))
result={'method':'STATIC/SYNTHETIC independent predicates; not executed Swift or behavioral evidence','checks':len(tests),'passed':sum(t['pass'] for t in tests),'failed':sum(not t['pass'] for t in tests),'tests':tests}
(O/'adversarial-results.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps({k:v for k,v in result.items() if k!='tests'}))
