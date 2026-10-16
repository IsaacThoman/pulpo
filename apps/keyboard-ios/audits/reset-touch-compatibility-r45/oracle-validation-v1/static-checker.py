"""Independent STATIC fixture oracle review. Never imports/runs product or runner.
Emits metadata only. Input strings/taps are intentionally never printed.
Normalization uses Unicode case folding plus canonical decomposition/removal of
combining marks; retained punctuation participates in byte alignment.
"""
import collections, copy, hashlib, json, math, pathlib, struct, unicodedata

AUTHOR = pathlib.Path('/tmp/pulpo-r45-new-boundaries-v1')
OUT = pathlib.Path('/tmp/pulpo-r45-oracle-validation-v1')
MAP = pathlib.Path('/Users/isaacthoman/.t3/worktrees/pulpo/t3-a6c40353/apps/keyboard-ios/audits/reset-touch-compatibility-r45/public-api.md')
issues = []
def sha(p): return hashlib.sha256(p.read_bytes()).hexdigest()
def require(ok, code, where):
    if not ok: issues.append({'code':code,'location':where})
def norm(s):
    return ''.join(c for c in unicodedata.normalize('NFD',s.casefold()) if not unicodedata.combining(c))
def scalar(x):
    if isinstance(x,(float,int)): return float(x)
    return {'nan': math.nan, '+inf': math.inf, '-inf': -math.inf}[x]
def payload(p):
    # All supplied non-ASCII scalars must be independent Characters (no combining
    # mark, ZWJ or variation selector); otherwise this simple segmenter is unsafe.
    require(not any(unicodedata.combining(c) or c in '\u200d\ufe0f' for c in p['text']), 'unsupported_grapheme_segmentation', 'payload')
    keyed = norm(p['text'])
    intended = norm(p['intended'])
    expanded=[]
    for i,c in enumerate(p['text']):
        tap = p['taps'][i] if i<len(p['taps']) else None
        expanded.extend([tap]*len(norm(c).encode('utf-8')))
    require(len(expanded)==len(keyed.encode()),'normalization_nonlocal','payload')
    samples=[]
    for b,t in zip(intended.encode(),expanded):
        if 97<=b<=122 and t is not None:
            require(len(t['key'])==1 and 'a'<=t['key']<='z','geometry_key','payload')
            samples.append((chr(b),t['key'],scalar(t['dx']),scalar(t['dy'])))
    finite=all(math.isfinite(v) for x in samples for v in x[2:])
    valid=len(keyed.encode())==len(intended.encode()) and len(intended.encode())>=2 and bool(samples) and finite
    return {'normalized':keyed,'samples':samples,'finite':finite,'valid':valid,
            'sourceBytes':len(keyed.encode()),'targetBytes':len(intended.encode())}
def expected_step(s,mode,learning):
    p=payload(s['payload'])
    return learning and p['valid'] and (mode=='memory' or len(p['samples'])<=40),p
def plan(inst):
    ids=[]
    def add(s): ids.append(s)
    if inst['mode']=='memory': add('constructor.files')
    for x in ('control.constructor.files','initial.weight.control','initial.offsets.control'):add(x)
    for i,s in enumerate(inst['steps']):
        p=f'step.{i}'
        if s.get('learning') is not None:add(p+'.learning')
        if s['payload'].get('normalizedText') is not None:add(p+'.normalization')
        add(p+'.acceptance');add(p+'.weight')
        if not s['expectedAccepted']:add(p+'.offsets.unchanged')
        if s.get('statusRule') is not None:add(p+'.status')
        if inst['mode']=='memory' or not s['expectedAccepted']:add(p+'.files')
        if s['expectedAccepted']:add(p+'.control.acceptance')
        add(p+'.weight.control');add(p+'.offsets.control')
        if s['settleAfter'] and inst['mode']=='persistent':
            for x in ('save','weight','offsets'):add(p+'.settle.'+x)
    if inst['roundTrip']:
        for x in ('save','save.weight','save.offsets','reopen.weight','reopen.offsets','reopen.control.weight','reopen.control.offsets','reload.weight','reload.offsets'):add('roundtrip.'+x)
    if inst['nilSave']:
        for x in ('files','weight','offsets'):add('nilSave.'+x)
    return ids
f=json.loads((AUTHOR/'fixtures.json').read_text())
d=json.loads((AUTHOR/'denominators.json').read_text())
manifest=json.loads((AUTHOR/'sha256-manifest.json').read_text())
att=json.loads((AUTHOR/'author-attestation.json').read_text())
readset=json.loads((AUTHOR/'read-set.json').read_text())
hashes={p.name:sha(p) for p in sorted(AUTHOR.iterdir()) if p.is_file()}
for name,h in manifest['files'].items():require(hashes[name]==h,'manifest_hash',name)
for name,h in att['authoredFileSHA256'].items():require(hashes[name]==h,'attestation_hash',name)
for entry in att['existingContextReadSet']+readset['existingFilesRead']:
    require(entry['path']==str(MAP) and entry['sha256']==sha(MAP),'approved_read_set','attestation')
require(f['publicMapSHA256']==sha(MAP),'public_map_hash','fixtures')
require(f['busyRetryCount']==0,'retry_count','fixtures')
require(f['offsetAbsoluteTolerance']==1e-12 and f['offsetRelativeTolerance']==1e-12,'tolerances','fixtures')
rows=[]; acceptance=collections.Counter(); mutations=[]; histories=[]
for family in f['families']:
    for inst in family['instances']:
        where=family['id']+'/'+inst['id']; learning=True; settled=False; maxkey=collections.Counter()
        require(inst['id']==inst['mode'] and inst['mode'] in ('memory','persistent'),'mode',where)
        require(not inst['nilSave'] or inst['mode']=='memory','nil_save_mode',where)
        require(not inst['roundTrip'] or inst['mode']=='persistent','roundtrip_mode',where)
        for i,s in enumerate(inst['steps']):
            at=where+f'/step.{i}'
            if s.get('learning') is not None: learning=s['learning']
            expected,p=expected_step(s,inst['mode'],learning)
            require(s['expectedAccepted']==expected,'acceptance_oracle',at)
            require(s['expectedActualSamples']==len(p['samples']),'sample_count',at)
            require(s['weightRule']==('increase' if expected else 'unchanged'),'weight_rule',at)
            if s['payload'].get('normalizedText') is not None:
                require(s['payload']['normalizedText']==p['normalized'],'normalization_oracle',at)
            require((s.get('control') is not None)==expected,'control_presence',at)
            if expected:
                cp=payload(s['control'])
                require(cp['valid'] and cp['samples']==p['samples'],'control_ordered_samples',at)
                maxkey.update(x[0] for x in p['samples'])
            if inst['mode']=='persistent' and not expected:
                require(settled,'settled_rejection_baseline',at)
                if p['valid'] and learning and len(p['samples'])>40:
                    require(s['statusRule']=='invalid','oversize_status',at)
            if s['settleAfter'] and inst['mode']=='persistent':settled=True
            acceptance['accepted' if expected else 'rejected']+=1
            # Independent expectation mutation test, with no model execution.
            bad=copy.deepcopy(s);bad['expectedAccepted']=not expected
            mutations.append(bad['expectedAccepted']!=expected)
            bad=copy.deepcopy(s);bad['expectedActualSamples']+=1
            mutations.append(bad['expectedActualSamples']!=len(p['samples']))
        require(not maxkey or max(maxkey.values())<300,'weight_decay_domain',where)
        ids=plan(inst);require(len(ids)==len(set(ids)),'unique_checks',where)
        require(len(ids)==inst['plannedCheckCount'],'instance_denominator',where)
        rows.append({'familyID':family['id'],'instanceID':inst['id'],'plannedCheckCount':len(ids),'stepCount':len(inst['steps'])})
        histories.append({'location':where,'checkIDs':ids})
require(len(f['families'])==f['uniqueFamilyCount']==d['uniqueFamilies']==24,'family_count','global')
require(len(rows)==f['instanceCount']==d['modeInstances']==34,'instance_count','global')
require(sum(x['plannedCheckCount'] for x in rows)==f['plannedCheckCount']==d['plannedChecks']==652,'planned_count','global')
require([{k:v for k,v in r.items() if k!='stepCount'} for r in rows]==d['instances'],'denominator_manifest','global')
require(all(mutations),'synthetic_expectation_mutation_detection','global')
result={'method':'STATIC independent analysis; no product/mock/runner execution',
        'hashes':hashes,'publicMapSHA256':sha(MAP),'counts':{'families':len(f['families']),'instances':len(rows),'plannedChecks':sum(x['plannedCheckCount'] for x in rows),'steps':sum(x['stepCount'] for x in rows),**acceptance},
        'instances':rows,'issues':issues,'syntheticExpectationMutations':{'attempted':len(mutations),'detected':sum(mutations)},'checkPlans':histories}
(OUT/'static-results.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps({'counts':result['counts'],'issueCount':len(issues),'issues':issues,'syntheticMutations':result['syntheticExpectationMutations']}))
