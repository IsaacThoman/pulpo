"""Opaque static exclusion check. Never print protected inputs or queries."""
import json,sys,hashlib,unicodedata,re
from pathlib import Path
ROOT=Path(__file__).resolve().parent

def canon(s):
 s=unicodedata.normalize('NFD',s.casefold())
 s=''.join(c for c in s if not unicodedata.combining(c))
 return ' '.join(sorted(set(re.findall(r'[^\W_]+',s,re.UNICODE))))

def strings(x):
 if isinstance(x,str):yield x
 elif isinstance(x,list):
  for v in x:yield from strings(v)
 elif isinstance(x,dict):
  for v in x.values():yield from strings(v)

def main():
 suite=json.loads(Path(sys.argv[1]).read_text())
 old=Path('/tmp/pulpo-r31-6eb3ff2a/apps/keyboard-ios/audits/multilingual-emoji-r31')
 paths=[Path('/tmp/pulpo-r31-exclusions.json'),old/'development.json',Path('/tmp/pulpo-r31-independent-exposed-diagnostics.json'),ROOT/'exposed-development.json',Path('/tmp/pulpo-r31-sealed-v1.json'),Path('/tmp/pulpo-r34-sealed-v1.json')]
 paths += [ROOT/'native-exposed-inputs.json',Path('/tmp/r34-protocol-engineering/smoke/protocol-exposed-smoke.json'),Path('/tmp/r34-protocol-engineering/smoke/protocol-exposed-oracles.json')]
 paths += [Path('/tmp/r34-protocol-engineering/smoke')/n for n in ['protocol-exposed-negative-archive.json','protocol-exposed-fixture-only.json','comparator-selfcheck-suite.json','comparator-selfcheck-wrapper-suite.json']]
 paths += sorted(ROOT.glob('protocol-*-witness.json'))
 paths += [Path('/tmp/pulpo-r40-protocol/baseline')/n for n in ['protocol-exposed-smoke.json','protocol-exposed-oracles.json','protocol-exposed-negative-archive.json','protocol-exposed-fixture-only.json','comparator-selfcheck-suite.json','comparator-selfcheck-wrapper-suite.json']]
 paths += [Path('/tmp/pulpo-r40-domain-inputs.json'),ROOT/'development-intents.json']
 blocked=set();targets=set();families=set();hashes=[]
 def extract(x):
  if isinstance(x,dict):
   for k,v in x.items():
    if k in ('query','name','reference','references','knownEnglish','knownQueries'):blocked.update(canon(s) for s in strings(v))
    if k in ('acceptable','forbidden','targets'):targets.update(strings(v))
    if k in ('family','families'):families.update(canon(s) for s in strings(v))
    extract(v)
  elif isinstance(x,list):
   for v in x:extract(v)
 for p in paths:
  b=p.read_bytes();h=hashlib.sha256(b).hexdigest();hashes.append(h)
  if p.name=='pulpo-r31-sealed-v1.json':assert h=='a7067871f9f61e2b8d4d6378c259e8fbd7c9e1ac5fcbaa4db5a50c5b4ac891de','protected artifact integrity failure'
  if p.name=='pulpo-r34-sealed-v1.json':assert h=='a00397e33f570f0aa79975b21ae906bdb7fd2a327011e03affca4b753391ee35','protected artifact integrity failure'
  x=json.loads(b)
  blocked.update(canon(s) for s in strings(x))
  if p.name=='pulpo-r31-exclusions.json':
   blocked.update(canon(s) for s in x['strings']);targets.update(s for s in x['strings'] if any(ord(c)>0x2000 for c in s));families.update(canon(s) for s in x['families'])
  extract(x)
 # Every exposed compatibility query is excluded, but output glyph arrays are not semantic target oracles.
 compat=Path('/tmp/pulpo-r31-compatibility-queries.json');hashes.append(hashlib.sha256(compat.read_bytes()).hexdigest());x=json.loads(compat.read_text())
 blocked.update(canon(s) for s in strings(x))
 collisions=[]
 for r in suite['cases']:
  kinds=[]
  if canon(r['query']) in blocked:kinds.append('query')
  if any(s in targets for s in r['acceptable']+r.get('forbidden',[])):kinds.append('target')
  if canon(r['family']) in families:kinds.append('family')
  # Names and aliases inside fixtures are also input references, never reveal matches.
  if any(canon(s) in blocked for e in r.get('entries',[]) for s in [e['name']]+e.get('keywords',[])):kinds.append('fixture-reference')
  if any(canon(e['name']) in blocked for e in r.get('spanishAliases',[])):kinds.append('fixture-alias')
  if kinds:collisions.append({'id':r['id'],'categories':kinds})
 print(json.dumps({'pass':not collisions,'rows':len(suite['cases']),'collisions':collisions,'protectedInputDigests':hashes,'suiteSHA256':hashlib.sha256(Path(sys.argv[1]).read_bytes()).hexdigest(),'payloadDisplayed':False}))
 sys.exit(bool(collisions))
if __name__=='__main__':main()
