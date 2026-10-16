"""Offline retained-output audit, never launches a runner or product.
Usage: python3 output-accounting.py OUTPUT_DIR RUNNER_EXIT
Metadata-only stdout. Exit 0 means internally valid accounting, not product pass.
"""
import collections, hashlib, json, pathlib, sys
O=pathlib.Path(__file__).resolve().parent
def unique(pairs):
    d={}
    for k,v in pairs:
        if k in d:raise ValueError('duplicate JSON key')
        d[k]=v
    return d
def load(p):return json.loads(p.read_text(),object_pairs_hook=unique)
def verify(root,runner_exit):
    fixed=load(O/'static-results.json'); result=load(root/'results.json')
    plans={(r['location'].split('/')[0],r['location'].split('/')[1]):r['checkIDs'] for r in fixed['checkPlans']}
    assert result['schemaVersion']==1 and result['busyRetryCount']==0
    assert (result['uniqueFamilies'],result['modeInstances'],result['plannedCheckCount'])==(24,34,652)
    categories=('check','pass','fail','unavailable','error')
    total=dict.fromkeys(categories,0);seen=set();families=set()
    for family in result['families']:
        fid=family['familyID'];assert fid not in families;families.add(fid)
        assert load(root/(fid+'.json'))==family
        subtotal=dict.fromkeys(categories,0)
        for inst in family['instances']:
            key=(fid,inst['id']);assert key in plans and key not in seen;seen.add(key)
            assert inst['mode']==inst['id']
            r=inst['result'];checks=r['checks'];p=plans[key]
            assert [c['id'] for c in checks[:len(p)]]==p
            ids=[c['id'] for c in checks];assert len(ids)==len(set(ids))
            for extra in checks[len(p):]:
                assert extra['id'].startswith('runner.bookkeeping.') and extra['status']=='error'
            counts=dict.fromkeys(categories,0);counts['check']=len(checks)
            for c in checks:
                assert c['status'] in categories[1:]
                assert set(c)=={'id','expected','status','actual'}
                counts[c['status']]+=1
            assert r['counts']==counts and sum(counts[k] for k in categories[1:])==counts['check']
            busy=any(e.get('classification')=='unavailable' for e in r['events'])
            assert not busy or counts['unavailable']>0
            for k in categories:subtotal[k]+=counts[k]
        assert family['counts']==subtotal
        for k in categories:total[k]+=subtotal[k]
    assert seen==set(plans) and len(families)==24
    assert result['counts']==total
    assert total['check']>=652
    complete=total['fail']==total['error']==total['unavailable']==0 and not result['publicationErrors']
    assert result['completePass']==complete
    assert runner_exit==(1 if total['fail'] else 0 if complete else 2)
    if complete:assert total['check']==total['pass']==652
    return {'accountingValid':True,'completePass':complete,'counts':total}
if __name__=='__main__':
    try:
        assert len(sys.argv)==3
        print(json.dumps(verify(pathlib.Path(sys.argv[1]),int(sys.argv[2]))))
    except Exception:
        print(json.dumps({'accountingValid':False,'reason':'missing, malformed, mismatched, incomplete or inconsistent retained output'}))
        sys.exit(2)
