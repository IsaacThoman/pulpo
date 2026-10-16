#!/usr/bin/env python3
"""Exposed parent verification. Explicit checks remain active with python -O."""
from collections import Counter
import hashlib
import json
from pathlib import Path
import subprocess
import sys

HERE = Path(__file__).resolve().parent
ORIGINAL = HERE / 'original-r35'

def require(ok, reason):
    if not ok:
        raise ValueError(reason)

def sha(data):
    return hashlib.sha256(data).hexdigest()

def read(name):
    return json.loads((ORIGINAL / name).read_bytes())

def schema(cases):
    require(type(cases) is list and len(cases) == 24, '24 cases required')
    ids, hosts = set(), {}
    required = {'startLogin': {'id','host'}, 'startRefresh': {'id'}, 'awaitRequest': {'id','host','path'},
                'respond': {'id','status','body'}, 'waitTask': {'id'}, 'cancelTask': {'id'},
                'revokeLogin': {'id'}, 'signOut': set(), 'checkpoint': {'id','expected'}, 'reload': {'id','expected'}}
    optional = {'startLogin': {'email','password','code'}, 'signOut': {'remote'}}
    for case in cases:
        require(set(case) == {'id','purpose','steps'}, 'case fields')
        require(type(case['id']) is str and case['id'] and case['id'] not in ids, 'case identity')
        ids.add(case['id'])
        require(type(case['purpose']) is str and bool(case['purpose']), 'purpose')
        require(type(case['steps']) is list and case['steps'], 'steps')
        tasks, requests, waited, checks = {}, set(), set(), set()
        for step in case['steps']:
            op = step['op']; require(op in required, 'unknown op')
            require({'op'} | required[op] <= set(step) <= {'op'} | required[op] | optional.get(op,set()), 'step fields')
            if 'id' in step: require(type(step['id']) is str and step['id'], 'id type')
            if 'host' in step:
                h=step['host']; require(type(h) is str and h.endswith('.r35.invalid'), 'host type/domain')
                require(hosts.setdefault(h,case['id']) == case['id'], 'host reused across cases')
            if op in ('startLogin','startRefresh'):
                require(step['id'] not in tasks, 'duplicate task'); tasks[step['id']]=op
            if op in ('cancelTask','revokeLogin','waitTask'):
                require(step['id'] in tasks, 'unknown task')
                if op=='revokeLogin': require(tasks[step['id']]=='startLogin', 'revoke nonlogin')
                if op=='waitTask': waited.add(step['id'])
            if op=='awaitRequest':
                require(step['path'] in ('/api/mobile/config','/api/mobile/auth/login','/api/mobile/me','/api/mobile/auth/logout'), 'endpoint')
                require(step['id'] not in requests, 'duplicate request'); requests.add(step['id'])
            if op=='respond':
                require(type(step['status']) is int and 100<=step['status']<=599, 'status')
                require(step['id'] in requests, 'unknown/repeated response'); requests.remove(step['id'])
            if op=='startLogin': require(all(type(step[k]) is str for k in ('email','password','code') if k in step), 'credentials types')
            if op=='signOut' and 'remote' in step: require(type(step['remote']) is bool, 'remote type')
            if 'expected' in step:
                e=step['expected']; require(set(e)=={'name','host','token','dictation'}, 'expected fields')
                require(all(e[k] is None or type(e[k]) is str for k in ('name','host','token')) and type(e['dictation']) is bool, 'expected types')
                if e['name'] is None: require(e==dict(name=None,host=None,token=None,dictation=False), 'signedout expectation')
                require(step['id'] not in checks, 'duplicate checkpoint'); checks.add(step['id'])
            if op=='reload': require(set(tasks)==waited and not requests, 'reload before settlement')
        require(checks and not requests and set(tasks)==waited, 'fixture final settlement')

def audit_rows(rows, fixtures):
    require([r['id'] for r in rows]==[f['id'] for f in fixtures], 'complete ordered inventory')
    result=[]
    for row, fixture in zip(rows,fixtures):
        tag=row['id']; events=row['events']; steps=fixture['steps']
        require(row['purpose']==fixture['purpose'] and [e['step'] for e in events if 'step' in e]==steps, tag+' exact inputs')
        expected_checks=[]
        for step in steps:
            if step['op']=='reload': expected_checks.append((step['id']+'.beforeReload',step['expected']))
            if step['op'] in ('reload','checkpoint'): expected_checks.append((step['id'],step['expected']))
        require([(c['id'],c['expected']) for c in row['checks']]==expected_checks, tag+' full check inventory')
        failed=[]
        for c in row['checks']:
            e=c['expected']; snapshot=dict(name=e['name'],host=e['host'],dictation=e['dictation'],signedIn=e['name'] is not None)
            actual=c['memory']==e and c['persisted']==e and c['snapshot']==snapshot
            require(type(c['pass']) is bool and c['pass']==actual, tag+' reported state verdict')
            if not actual: failed.append(c['id'])
        require(not failed or row['failures'], tag+' dropped checkpoint failures')
        require(not row['unsettled'], tag+' unsettled work')
        tasks={s['id'] for s in steps if s['op'] in ('startLogin','startRefresh')}
        require(set(row['tasks'])==tasks, tag+' task inventory')
        require({e['task']:e['outcome'] for e in events if 'task' in e and 'outcome' in e}==row['tasks'], tag+' task outcomes')
        dispositions=row['httpDispositions']
        require([d['sequence'] for d in dispositions]==list(range(len(dispositions))), tag+' issuance sequence')
        require(all(d['released'] or d['cancelled'] for d in dispositions), tag+' unaccounted request')
        require(row['httpIssued']==['request '+d['method']+' '+d['host']+d['path'] for d in dispositions],tag+' issuance trace')
        counts=Counter('HTTP '+d['method']+' '+d['path'] for d in dispositions)
        counts.update(e['event'] for e in events if e.get('event') in ('save','clear','publish','logoutStarted','logoutFinished'))
        require(dict(counts)==row['counts'],tag+' exact counts')
        require(counts['logoutStarted']==counts['logoutFinished'],tag+' logout settlement')
        requests={s['id']:s for s in steps if s['op']=='awaitRequest'}
        observed={e['request']:e for e in events if 'request' in e}
        require(set(requests)==set(observed),tag+' request reservation inventory')
        require({e['response'] for e in events if 'response' in e}=={s['id'] for s in steps if s['op']=='respond'},tag+' releases')
        for key,s in requests.items():
            event=observed[key]; method='POST' if s['path'].endswith(('/login','/logout')) else 'GET'
            require((event['host'],event['path'],event['method'])==(s['host'],s['path'],method),tag+' request endpoint')
            if s['path'].endswith('/login'):
                body=event['body']; require(body['appType']=='mobile' and body['platform']=='ios' and body['deviceLabel'],tag+' login metadata')
                require(any(body['email']==s2.get('email','fake@example.invalid') and body['password']==s2.get('password','fake-password') and body.get('twoFactorCode')==(s2.get('code') or None) for s2 in steps if s2['op']=='startLogin' and s2['host']==event['host']),tag+' captured credentials')
                require(event['authorization'] is None,tag+' anonymous login')
            else: require(event['body'] is None,tag+' absent body')
            if s['path'].endswith(('/me','/logout')): require(event['authorization'] and event['authorization'].startswith('Bearer fake-'),tag+' fake captured bearer')
        result.append(dict(id=tag,status='unavailable' if row['unavailable'] else 'fail' if row['failures'] else 'pass',failedChecks=failed,failures=row['failures'],unavailable=row['unavailable'],checks=len(row['checks']),requests=len(dispositions),common=all(s['op']!='revokeLogin' for s in steps)))
    return result

def main():
    fixtures=read('heldout/cases.json'); seal=read('freeze.json'); schema(fixtures)
    require(sha((ORIGINAL/'heldout/cases.json').read_bytes())==seal['blindCases']['sha256'], 'fixture seal')
    require(sha((ORIGINAL/'heldout/author-notes.txt').read_bytes())==seal['blindCases']['authorNotesSHA256'], 'author notes seal')
    source_checks={}
    for label,root in [('candidate',Path('/tmp/pulpo-r35-account-lifecycle')),('baseline',Path('/tmp/pulpo-r35-baseline'))]:
        for path,digest in seal[label].items():
            file = root/'apps/keyboard-ios'/path
            data = file.read_bytes() if file.exists() else subprocess.check_output(
                ['git','show',seal['commits'][label]+':apps/keyboard-ios/'+path],cwd=HERE)
            require(sha(data)==digest,label+' sealed source '+path)
        source_checks[label]=len(seal[label])
    original=HERE/'original-parent-review'
    require(sha((original/'REACHABILITY-ADDENDUM.md').read_bytes())=='fa8aa15e2d8dc657c0d46934b829cf4363ac874269a05800b85c0200efdfe126','addendum binding')
    for path,digest in json.loads((original/'reachability-receipt.json').read_text())['unchangedPriorArtifactsSHA256'].items(): require(sha((original/path).read_bytes())==digest,'historical review '+path)
    baseline, candidate = read('heldout/baseline-raw.json'), read('heldout/candidate-raw.json')
    for old,new in zip(baseline,candidate):
        require([e for e in old['events'] if 'request' in e] == [e for e in new['events'] if 'request' in e], old['id']+' paired request methods/bodies/bearers')
    output={'sourceSealFiles':source_checks,'pairedRequestsIdentical':True,'rows':{},'commonCounts':{}}
    for label in ('baseline','candidate'):
        rows=read('heldout/'+label+'-raw.json'); output['rows'][label]=audit_rows(rows,fixtures)
        counts=Counter()
        for r,f in zip(rows,fixtures):
            if all(s['op']!='revokeLogin' for s in f['steps']): counts.update(r['counts'])
        output['commonCounts'][label]=dict(counts)
    print(json.dumps(output,indent=2,sort_keys=True))

if __name__=='__main__': main()
