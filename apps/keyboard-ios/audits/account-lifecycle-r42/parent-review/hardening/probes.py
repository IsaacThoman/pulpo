"""In-memory audit forgeries only. No frozen report/oracle is changed."""
import copy
import json
import verify
cases=verify.read('heldout/cases.json')
original=verify.read('heldout/candidate-raw.json')
probes=[]
for container,key in [('memory','dictation'),('persisted','dictation'),('snapshot','dictation'),('snapshot','signedIn')]:
    for forged in (0,1,'false'):
        rows=copy.deepcopy(original)
        rows[0]['checks'][0][container][key]=forged
        try: verify.audit_rows(rows,cases)
        except ValueError as error: probes.append(dict(probe=container+'.'+key,forged=forged,rejected=True,reason=str(error)))
        else: raise ValueError('State forgery accepted: '+container+'.'+key)
for flag in ('reserved','released','cancelled'):
    for forged in (0,1,'false'):
        rows=copy.deepcopy(original)
        rows[0]['httpDispositions'][0][flag]=forged
        try: verify.audit_rows(rows,cases)
        except ValueError as error: probes.append(dict(probe='disposition.'+flag,forged=forged,rejected=True,reason=str(error)))
        else: raise ValueError('Disposition forgery accepted: '+flag)
print(json.dumps(probes,indent=2))
