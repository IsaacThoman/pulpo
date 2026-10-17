#!/usr/bin/env python3
"""Probe keys, derive geometry from hierarchy labels, and retain every scored row."""
import argparse,json,pathlib,shlex,subprocess,time,string
SDK='/Users/isaacthoman/Library/Android/sdk'
p=argparse.ArgumentParser();p.add_argument('--out',type=pathlib.Path,required=True);p.add_argument('--adb',default=SDK+'/platform-tools/adb')
s=p.add_subparsers(dest='action',required=True)
q=s.add_parser('probe');q.add_argument('name');q.add_argument('--key');q.add_argument('--hold',action='store_true');q.add_argument('--select-language')
g=s.add_parser('geometry');g.add_argument('--mode',choices=['en','es','en-es'],required=True);g.add_argument('--active',required=True);g.add_argument('--letters',required=True);g.add_argument('--symbols',required=True);g.add_argument('--accent',action='append',default=[],help='CHAR:BASE:PROBE_NAME, e.g. é:e:accent-en-e')
r=s.add_parser('run');r.add_argument('--mode',choices=['en','es','en-es'],required=True)
a=p.parse_args();a.out.mkdir(parents=True,exist_ok=True)
adb=[a.adb,'-s','emulator-5554'];component='com.pulpo.multilingualaudit/com.pulpo.keyboardaudit.MultilingualRunner'
def call(*args):return subprocess.check_output(adb+list(args))
def instrument(extras):
 cmd=['am','instrument','--no-hidden-api-checks','-w']
 for k,v in extras.items():cmd+=['-e',k,v]
 cmd.append(component)
 output=call('shell',shlex.join(cmd)).decode();print(output)
 if 'Completed multilingual' not in output:raise RuntimeError('Instrumentation did not complete; do not use stale device output')
def pull(remote,local):
 (a.out/local).write_bytes(call('exec-out','run-as','com.pulpo.multilingualaudit','cat','files/'+remote))
def load(name):return json.loads((a.out/(name+'.json')).read_text())
def key_any(nodes,*labels):
 for label in labels:
  if any(n['package']=='com.google.android.inputmethod.latin' and n['desc']==label for n in nodes):return key(nodes,label)
 raise ValueError('None of the verified labels present: '+str(labels))
def key(nodes,label):
 ns=[n for n in nodes if n['package']=='com.google.android.inputmethod.latin' and n['desc']==label]
 if not ns:raise ValueError('No verified label: '+label)
 # Duplicate accessible key/legend nodes: use the full touch region.
 n=max(ns,key=lambda n:(n['bounds'][2]-n['bounds'][0])*(n['bounds'][3]-n['bounds'][1]))
 l,t,r,b=n['bounds'];return [(l+r)/2,(t+b)/2]
if a.action=='probe':
 if (a.out/(a.name+'.json')).exists():raise ValueError('Keep prior probes; choose a new name')
 extras={'action':'probe'}
 if a.select_language:extras['selectLanguage']=a.select_language
 if a.key:extras['probeKey']=a.key
 if a.hold:extras['hold']='true'
 instrument(extras)
 for ext in ['json','png']:pull('probe.'+ext,a.name+'.'+ext)
elif a.action=='geometry':
 letters=load(a.letters);symbols=load(a.symbols)
 key(letters,a.active)
 geom={c:[key(letters,c)] for c in string.ascii_lowercase}
 geom[' ']=[key_any(letters,'Space','Espacio')]
 geom['__active']=a.active
 for digit in string.digits:
  geom[digit]=[key_any(letters,'Symbol keyboard','Teclado de símbolos'),key(symbols,digit),key_any(symbols,'Letter keyboard','Teclado de letras')]
 for char in ['ñ']:
  if any(n['desc']==char for n in letters):geom[char]=[key(letters,char)]
 for spec in a.accent:
  char,base,probe=spec.split(':');target=key(load(probe),char)
  geom[char]=[key(letters,base)+target]
 path=a.out/'geometry.json';allgeom=json.loads(path.read_text()) if path.exists() else {};allgeom[a.mode]=geom
 path.write_text(json.dumps(allgeom,ensure_ascii=False,indent=2)+'\n')
else:
 if (a.out/(a.mode+'.json')).exists():raise ValueError('Scored output exists; retain it and use a new artifact directory for an infrastructure retry')
 started=time.time();instrument({'action':'run','language':a.mode});pull(a.mode+'.json',a.mode+'.json')
 rows=load(a.mode);cases=json.loads((pathlib.Path(__file__).parent/'cases.json').read_text())['cases'];expected={c['id'] for c in cases if c['mode']==a.mode}
 assert {r['id'] for r in rows}==expected and len(rows)==len(expected),'Missing/duplicate frozen rows'
 # Pull full instrumentation files, including all pre/post hierarchies and screenshots.
 archive=call('exec-out','run-as','com.pulpo.multilingualaudit','tar','-cf','-','files')
 (a.out/(a.mode+'-device-files.tar')).write_bytes(archive)
 (a.out/(a.mode+'-wall-seconds.txt')).write_text(str(time.time()-started)+'\n')
 print(json.dumps({'rows':len(rows),'observed':sum(r['status']=='observed' for r in rows),'exact':sum(r.get('exact',False) for r in rows)},indent=2))
