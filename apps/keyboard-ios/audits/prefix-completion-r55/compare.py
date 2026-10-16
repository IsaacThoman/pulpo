#!/usr/bin/env python3
"""Public development comparison. Counts unavailable selection branches as unfired."""
import pathlib,json,gzip,hashlib
p=pathlib.Path(__file__).resolve().parent
prompts=json.loads((p/'development.json').read_bytes())
base=json.loads(gzip.decompress((p/'baseline/raw.json.gz').read_bytes()))
cand=json.loads(gzip.decompress((p/'candidate/raw.json.gz').read_bytes()))
assert [x['id'] for x in prompts]==[x['id'] for x in base]==[x['id'] for x in cand]
changes=[]
for f,b,c in zip(prompts,base,cand):
 d={k:{'baseline':b.get(k),'candidate':c.get(k)} for k in ['slots','automatic','targetVisible','targetTop8','saved','fired','text','caret','fullTextPass'] if b.get(k)!=c.get(k)}
 if d:changes.append({'id':f['id'],'action':f['action'],'changes':d})
def summary(rows):
 selections=[(f,x) for f,x in zip(prompts,rows) if f['action']=='select']
 return {'rows':len(rows),'selectionRows':len(selections),'usefulSelections':sum(x['saved']>0 for f,x in selections),'charactersSaved':sum(x['saved'] for f,x in selections),'selectionUnavailable':[f['id'] for f,x in selections if not x['fired']], 'selectionFullTextFailures':[f['id'] for f,x in selections if x.get('fullTextPass') is False], 'literalUnavailable':[f['id'] for f,x in zip(prompts,rows) if f['action']=='literal' and not x['fired']], 'literalFullTextFailures':[f['id'] for f,x in zip(prompts,rows) if f['action']=='literal' and x.get('fullTextPass') is False]}
result={'baseline':summary(base),'candidate':summary(cand),'changes':changes,'automaticChanges':[f['id'] for f,b,c in zip(prompts,base,cand) if b.get('automatic')!=c.get('automatic')], 'candidateListChanges':sum(b['candidates']!=c['candidates'] for b,c in zip(base,cand)), 'rawBindings':{side:hashlib.sha256(gzip.decompress((p/side/'raw.json.gz').read_bytes())).hexdigest() for side in ['baseline','candidate']}}
(p/'comparison.json').write_text(json.dumps(result,ensure_ascii=False,sort_keys=True,indent=2)+'\n')
print(json.dumps(result,ensure_ascii=False))
