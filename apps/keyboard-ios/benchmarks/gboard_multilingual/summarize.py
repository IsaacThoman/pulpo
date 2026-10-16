#!/usr/bin/env python3
"""Strict complete-corpus accounting; no normalization or silent missing-case drops."""
import argparse,json,pathlib,collections
p=argparse.ArgumentParser();p.add_argument('artifacts',type=pathlib.Path);a=p.parse_args();d=a.artifacts
cases=json.loads((pathlib.Path(__file__).parent/'cases.json').read_text())['cases'];ids={c['id'] for c in cases}
def index(rows,expected):
 if len(rows)!=len(expected) or {r['id'] for r in rows}!=expected:raise ValueError('Missing/duplicate rows')
 return {r['id']:r for r in rows}
pulpo=index(json.loads((d/'pulpo.json').read_text()),ids)
gboard={}
for mode in ['en','es','en-es']:
 gboard.update(index(json.loads((d/(mode+'.json')).read_text()),{c['id'] for c in cases if c['mode']==mode}))
for c in cases:
 for name,rows in [('Pulpo',pulpo),('Gboard',gboard)]:
  r=rows[c['id']]
  if name=='Gboard':
   if r.get('status') not in {'observed','unavailable'}:raise ValueError('Unknown status: '+c['id'])
   if r['status']=='unavailable':
    if 'output' in r or 'exact' in r or not isinstance(r.get('reason'),str) or not r['reason']:raise ValueError('Invalid unavailable row: '+c['id'])
    continue
  if not isinstance(r.get('output'),str) or type(r.get('exact')) is not bool:raise ValueError('Invalid observed row: '+c['id'])
  if r['exact']!=(r['output']==c['expected']):raise ValueError('Incorrect exact score: '+c['id'])
print('| Group | Pulpo exact | Pulpo available | Gboard exact | Gboard available |')
print('|---|---:|---:|---:|---:|')
for group in ['all','en','es','en-es','typo','literal','switch','ambiguous','accents','unsupported']:
 subset=[c for c in cases if group in ['all',c['mode'],c['category']]]
 pp=sum(pulpo[c['id']]['exact'] for c in subset);gg=sum(gboard[c['id']].get('exact',False) for c in subset);avail=sum(gboard[c['id']]['status']=='observed' for c in subset)
 n=len(subset)
 print(f'| {group} | {pp}/{n} | {n}/{n} | {gg}/{n} | {avail}/{n} |')
paired=[c for c in cases if gboard[c['id']]['status']=='observed']
outcomes=collections.Counter((pulpo[c['id']]['exact'],gboard[c['id']]['exact']) for c in paired)
print('\nPaired available:',len(paired),'Pulpo exact:',sum(pulpo[c['id']]['exact'] for c in paired),'Gboard exact:',sum(gboard[c['id']]['exact'] for c in paired),'both exact:',outcomes[True,True],'Pulpo only:',outcomes[True,False],'Gboard only:',outcomes[False,True],'neither:',outcomes[False,False])
print('\nEvery case (JSON strings preserve exact text and trailing spaces):\n')
print('| ID | Intended | Pulpo | Gboard |')
print('|---|---|---|---|')
for c in cases:
 pp=pulpo[c['id']];gg=gboard[c['id']]
 def cell(r):return ('✓ ' if r['exact'] else 'FAIL ')+json.dumps(r['output'],ensure_ascii=False)
 print('| '+c['id']+' | '+json.dumps(c['expected'],ensure_ascii=False)+' | '+cell(pp)+' | '+(cell(gg) if gg['status']=='observed' else gg['status']+': '+gg['reason'])+' |')
