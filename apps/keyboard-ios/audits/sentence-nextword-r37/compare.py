#!/usr/bin/env python3
"""Frozen R37 paired comparison. Retains raw JSON and every changed failed row."""
import argparse
import hashlib
import json
from pathlib import Path
from r37_validate import MODES, strict_load

MIN_BI_GAIN_PP = 10.0
MIN_IMPROVED_FAMILIES = 6
FRESH_PROMPTS = 72
FRESH_ROWS = 216

def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()

def visible_slots(row):
    return [{k:s.get(k) for k in ('displayIndex','modelRank','text','kind','isAutocorrection','accessibilityLabel')}
            for s in row.get('initialSlots',[])]

def mechanical(row):
    # Identity UUIDs/addresses and measured time differ between independent runs.
    # Every observable document/range, actual insertion/removal and oracle remains.
    def stable(value):
        if isinstance(value,dict):
            omit={'documentID','sourceContext','objects','elapsedMilliseconds','resourceSHA256','resourcePath','languageContextDiagnostic','captureStart'}
            return {k:stable(v) for k,v in value.items() if k not in omit}
        if isinstance(value,list):
            return [stable(v) for v in value]
        return value
    return stable({'initialSlots':visible_slots(row),'final':row.get('final'),
                   'actions':row.get('actions'),'acceptance':row.get('acceptance'),'failures':row.get('failures')})

def safety(row):
    if row.get('failures') or 'final' not in row:
        return False
    if row['route'] != 'control':
        branches=row.get('acceptance',[])
        if len(branches)!=3 or {b.get('displayIndex') for b in branches}!={0,1,2}:
            return False
        for branch in branches:
            if branch.get('error') is not None or not isinstance(branch.get('expected'),dict):
                return False
            expected=branch['expected']; after=branch.get('after',{}).get('document',{})
            if any(after.get(k)!=expected[k] for k in ('document','caret','selectionLength')):
                return False
            if len(branch.get('primitives',[]))!=expected['primitiveCount']:
                return False
    return True

def compare(baseline,candidate, baseline_path='',candidate_path=''):
    if baseline['variant']!='baseline' or candidate['variant']!='candidate':
        raise ValueError('variant labels must be baseline and candidate')
    if baseline['artifactSHA256']!=candidate['artifactSHA256']:
        raise ValueError('input/public contract/schema/API/executor bytes differ')
    if baseline['cohort']!=candidate['cohort']:
        raise ValueError('cohorts differ')
    if not baseline.get('resourceDirectory') or not candidate.get('resourceDirectory'):
        raise ValueError('explicit resource directories required')
    for mode in ('en_US','es'):
        if baseline['resourceSHA256'][mode]!=candidate['resourceSHA256'][mode]:
            raise ValueError('monolingual resource bytes changed')
    def keyed(raw):
        rows=raw['rows']; indexed={(r['id'],r['mode']):r for r in rows}
        if len(indexed)!=len(rows) or raw['rowCount']!=len(rows):
            raise ValueError('duplicate/missing raw rows')
        return indexed
    b,c=keyed(baseline),keyed(candidate)
    if b.keys()!=c.keys():
        raise ValueError('paired row identities differ; denominator cannot shrink')
    prompts={key[0] for key in b}
    if set(b)!={(p,m) for p in prompts for m in MODES}:
        raise ValueError('every prompt must retain all three modes')
    pairs=[]; losses=[]; gains=[]; secondary=[]; changed_failed=[]; mono_changed=[]; safety_failed=[]
    gain_families=set(); loss_families=set()
    counts={m:{'denominator':0,'scored':0,'ambiguous':0,'control':0,'baselineHits':0,'candidateHits':0} for m in MODES}
    for key,old in b.items():
        new=c[key]
        for field in ('familyId','contentLabel','oracle','route','acceptable'):
            if old[field]!=new[field]:
                raise ValueError(f'{key}: sealed {field} differs')
        for row in (old,new):
            if row['oracle']=='scored':
                if type(row.get('top3Hit')) is not bool or type(row.get('centerHit')) is not bool or type(row.get('reciprocalRank')) not in (float,int):
                    raise ValueError('scored outcome missing')
            elif any(row.get(k) is not None for k in ('top3Hit','centerHit','reciprocalRank')):
                raise ValueError('nonasserting rows cannot count as successes')
        mode=old['mode']; count=counts[mode]; count['denominator']+=1; count[old['oracle']]+=1
        count['baselineHits']+=int(old.get('top3Hit') is True);count['candidateHits']+=int(new.get('top3Hit') is True)
        gain=old.get('top3Hit') is False and new.get('top3Hit') is True
        loss=old.get('top3Hit') is True and new.get('top3Hit') is False
        ident={'id':key[0],'mode':mode,'familyId':old['familyId']}
        changed=mechanical(old)!=mechanical(new)
        if gain:
            gains.append(ident)
            if mode=='en_es':gain_families.add(old['familyId'])
        if loss:
            losses.append(ident);loss_families.add(old['familyId'])
        if old['oracle']=='scored' and (old['centerHit'] and not new['centerHit'] or new['reciprocalRank']<old['reciprocalRank']):
            secondary.append(dict(**ident,baselineCenter=old['centerHit'],candidateCenter=new['centerHit'],baselineRR=old['reciprocalRank'],candidateRR=new['reciprocalRank']))
        if changed and (old.get('top3Hit') is not True or new.get('top3Hit') is not True or not safety(old) or not safety(new)):
            changed_failed.append(dict(**ident,baseline=old,candidate=new))
        if (old['contentLabel'],mode) in (('en','en_US'),('es','es')) and changed:
            mono_changed.append(dict(**ident,baseline=old,candidate=new))
        if not safety(old) or not safety(new):
            safety_failed.append(dict(**ident,baselineFailures=old.get('failures'),candidateFailures=new.get('failures')))
        pairs.append(dict(**ident,oracle=old['oracle'],changed=changed,top3Gain=gain,top3Loss=loss,
            baselineSlots=visible_slots(old),candidateSlots=visible_slots(new),
            baselineTop3=old.get('top3Hit'),candidateTop3=new.get('top3Hit'),
            baselineCenter=old.get('centerHit'),candidateCenter=new.get('centerHit'),
            baselineRR=old.get('reciprocalRank'),candidateRR=new.get('reciprocalRank')))
    bi=counts['en_es']
    delta=(bi['candidateHits']-bi['baselineHits'])/bi['denominator']*100
    improved=sorted(gain_families-loss_families)
    fresh=baseline['cohort']=='fresh' and len(prompts)==FRESH_PROMPTS and len(b)==FRESH_ROWS
    gates={'fullFresh216Rows':fresh,'biTop3GainAtLeast10pp':delta>=MIN_BI_GAIN_PP,
           'atLeast6ImprovedFamilies':len(improved)>=MIN_IMPROVED_FAMILIES,
           'zeroTop3LossesAllModes':not losses,'strictAppropriateMonoUnchanged':not mono_changed,
           'zeroExecutorSafetyFailures':not safety_failed and not baseline.get('failures') and not candidate.get('failures')}
    return dict(schemaVersion=1,thresholds=dict(minBITop3GainPP=MIN_BI_GAIN_PP,minImprovedFamilies=MIN_IMPROVED_FAMILIES,
            zeroLossScope='scored top3 hit-to-miss in all modes',familyDefinition='>=1 BI top3 gain and no scored top3 loss in any mode',
            rrOrder='center,left,right; for two index1,index0; for one index0',secondaryLossesBlock=False),
        baselineRaw=str(baseline_path),candidateRaw=str(candidate_path),rawJSONRetained=True,
        denominators=counts,biGainPercentagePoints=delta,improvedFamilies=improved,
        gains=gains,losses=losses,secondaryCenterOrRRLosses=secondary,
        changedFailedOutputs=changed_failed,strictMonoChangedOutputs=mono_changed,safetyFailures=safety_failed,
        pairedRows=pairs,gates=gates,executorAndUtilityPass=all(gates.values()),
        limitation='Resource/storage/latency, ordinary-suite and native safety gates are separate mandatory parent admissions; this comparison does not claim overall feature admission.')

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--baseline',required=True,type=Path);parser.add_argument('--candidate',required=True,type=Path)
    parser.add_argument('--output',required=True,type=Path)
    args=parser.parse_args()
    if args.output.resolve() in (args.baseline.resolve(),args.candidate.resolve()):
        raise ValueError('comparison cannot overwrite either raw input')
    report=compare(strict_load(args.baseline),strict_load(args.candidate),args.baseline.resolve(),args.candidate.resolve())
    report['baselineRawSHA256']=digest(args.baseline);report['candidateRawSHA256']=digest(args.candidate)
    report['comparisonSHA256']=digest(__file__)
    args.output.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps({'gates':report['gates'],'biGainPercentagePoints':report['biGainPercentagePoints'],'improvedFamilies':len(report['improvedFamilies'])}))
    raise SystemExit(0 if report['executorAndUtilityPass'] else 1)

if __name__=='__main__':
    main()
