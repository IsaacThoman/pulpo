#!/usr/bin/env python3
"""Additional audit of recorded carets only; never invokes/replaces frozen scoring."""
import argparse
import copy
import gzip
import hashlib
import json
from pathlib import Path

HERE=Path(__file__).resolve().parent
LOCALES=('en_US','es_ES','es_MX','ar_EG')
VERSIONS=('baseline','candidate')

def need(condition,message):
    if not condition: raise ValueError(message)

def parse(raw):
    def unique(pairs):
        result={}
        for key,value in pairs:
            need(key not in result,'Duplicate JSON key: '+key)
            result[key]=value
        return result
    return json.loads(raw,object_pairs_hook=unique,parse_constant=lambda value: (_ for _ in ()).throw(ValueError('Nonfinite JSON number')))

def utf16_length(value):
    need(type(value) is str,'Caret text must be a string')
    return len(value.encode('utf-16-le'))//2

def load_bound(audit):
    bindings=parse((HERE/'bindings.json').read_bytes())
    expected={'fresh-input.json'} | {v+'-output.json.gz' for v in VERSIONS} | {v+'-'+l+'-raw.json.gz' for v in VERSIONS for l in LOCALES}
    need(type(bindings) is dict and set(bindings)==expected,'Binding inventory')
    decoded={}
    for name in sorted(expected):
        raw=(audit/name).read_bytes();entry=bindings[name]
        need(hashlib.sha256(raw).hexdigest()==entry['fileSHA256'],'File hash: '+name)
        payload=gzip.decompress(raw) if name.endswith('.gz') else raw
        need(hashlib.sha256(payload).hexdigest()==entry['payloadSHA256'],'Payload hash: '+name)
        decoded[name]=parse(payload)
    rows=decoded['fresh-input.json']
    for version in VERSIONS:
        merged=decoded[version+'-output.json.gz']
        byid={}
        for locale in LOCALES:
            group=decoded[version+'-'+locale+'-raw.json.gz']
            need([r['id'] for r in group['rows']]==[r['id'] for r in rows if r['locale']==locale],version+' raw locale inventory')
            for row in group['rows']:
                need(row['id'] not in byid,'Duplicate grouped row')
                byid[row['id']]=row
        need(merged['rows']==[byid[r['id']] for r in rows],version+' raw/merged rows differ')
    return rows,{v:decoded[v+'-output.json.gz'] for v in VERSIONS}

def check_observations(rows,outputs):
    need(type(rows) is list and len(rows)==12,'Twelve original workflows required')
    ids=[r['id'] for r in rows]
    need(all(type(i) is str for i in ids) and len(set(ids))==len(ids),'Unique workflow IDs')
    counts={}
    for version in VERSIONS:
        recorded=outputs[version]['rows']
        need(type(recorded) is list and [r['id'] for r in recorded]==ids,version+' complete ordered row inventory')
        action_count=globe_count=0
        for requested,actual in zip(rows,recorded):
            actions=actual['actions']
            need(type(actions) is list and len(actions)==len(requested['actions']),version+' complete action count')
            previous=requested['initialText']
            for index,(given,observation) in enumerate(zip(requested['actions'],actions)):
                where=version+'/'+requested['id']+'/'+str(index)
                need(type(observation['index']) is int and observation['index']==index,where+' action index')
                need(observation['action']==given,where+' action identity')
                need(observation['beforeText']==previous,where+' document chain')
                for prefix in ('before','after'):
                    caret=observation[prefix+'Caret']
                    need(type(caret) is int,where+' '+prefix+' caret must be integer, not Boolean')
                    need(caret==utf16_length(observation[prefix+'Text']),where+' '+prefix+' caret not at recorded UTF16 EOF')
                if given['kind'] in ('globeTouch','globeAX'):
                    globe_count+=1
                    need(observation['beforeText']==observation['afterText'],where+' globe changed text')
                    need(observation['beforeCaret']==observation['afterCaret'],where+' globe changed caret')
                previous=observation['afterText'];action_count+=1
            need(previous==actual['text'],version+'/'+requested['id']+' final recorded text chain')
        need(action_count==160 and globe_count==15,version+' original observation inventory')
        counts[version]={'workflows':12,'actionBeforeAfterPairs':action_count,'integerCaretOffsets':action_count*2,'globePreservationPairs':globe_count}
    return {'scope':'additional recorded-caret observation audit; frozen completion scores unchanged','versions':counts,'totalActionBeforeAfterPairs':sum(c['actionBeforeAfterPairs'] for c in counts.values()),'totalIntegerCaretOffsets':sum(c['integerCaretOffsets'] for c in counts.values())}

def probe(rows,outputs):
    result=[]
    for kind in ('wrongEOF','BooleanCaret','missingAction'):
        altered=copy.deepcopy(outputs)
        if kind=='wrongEOF': altered['candidate']['rows'][0]['actions'][0]['afterCaret']+=1
        if kind=='BooleanCaret': altered['candidate']['rows'][0]['actions'][0]['beforeCaret']=False
        if kind=='missingAction': altered['candidate']['rows'][0]['actions'].pop()
        try: check_observations(rows,altered)
        except ValueError as error: result.append({'probe':kind,'rejected':True,'reason':str(error)})
        else: raise ValueError('Malformed observation accepted: '+kind)
    return {'scope':'in-memory malformed observation probes after original byte binding; no frozen data changed','probes':result}

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--audit',type=Path,required=True,help='Explicit original accepted-v3 folder; read only')
    parser.add_argument('--probe',action='store_true')
    args=parser.parse_args()
    rows,outputs=load_bound(args.audit)
    result=probe(rows,outputs) if args.probe else check_observations(rows,outputs)
    print(json.dumps(result,indent=2,sort_keys=True))

if __name__=='__main__': main()
