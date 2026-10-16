#!/usr/bin/env python3
"""Read ordinary dictionary bytes for exposed targets only; no benchmark or sealed data."""
import pathlib,json,struct,unicodedata
root=pathlib.Path(__file__).resolve().parents[2]
out=[]
for mode,prefix,target in [('en_US','hel','hello'),('en_es','hel','hello'),('en_es','hol','hola'),('es','maña','mañana')]:
 b=(root/f'LanguageData/{mode}.pkdict').read_bytes()
 sections={}
 for i in range(struct.unpack_from('<I',b,8)[0]):
  name,offset,length=struct.unpack_from('<4sQQ',b,12+20*i);sections[name.decode()]=b[offset:offset+length]
 def ints(name):return struct.unpack('<'+'I'*(len(sections[name])//4),sections[name])
 offsets=ints('WKOF');ids=ints('DSID');doff=ints('DSOF')
 displays={wid:sections['DSTX'][doff[i]:doff[i+1]].decode() for i,wid in enumerate(ids)}
 folded=''.join(c for c in unicodedata.normalize('NFD',prefix.lower()) if unicodedata.category(c)!='Mn')
 words=[]
 for i in range(len(offsets)-1):
  key=sections['WKEY'][offsets[i]:offsets[i+1]].decode()
  if key.startswith(folded) and len(key)>len(folded) and not sections['WFLG'][i]&1:
   words.append((displays.get(i,key),sections['WFRQ'][i]))
 words.sort(key=lambda x:(-x[1],x[0]))
 out.append(dict(mode=mode,prefix=prefix,target=target,frequencyRankWithinExactPrefix=next((i+1 for i,x in enumerate(words) if x[0]==target),None),frequencyTiesCaveat='Lexical tie break for diagnostic only; heap tie ordering unspecified',top12=words[:12],targetFrequency=next((x[1] for x in words if x[0]==target),None)))
pathlib.Path(__file__).with_name('exposed-greeting-diagnosis.json').write_text(json.dumps(out,ensure_ascii=False,indent=2)+'\n')
