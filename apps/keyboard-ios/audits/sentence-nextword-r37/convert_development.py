#!/usr/bin/env python3
"""Convert only the exposed development v2. Never invent cross-mode gold."""
import argparse
import hashlib
import json
from pathlib import Path
from r37_validate import HERE, MODES, admit, strict_load

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, default=HERE/'development-intents-v2.json')
    parser.add_argument('--output', type=Path, default=HERE/'development-input.json')
    args = parser.parse_args()
    source = strict_load(args.source)
    rows = []
    mapping = []
    for old in source['cases']:
        # The exposed file authors only ONE mode's gold. Preserve it verbatim in
        # rationale/receipt, but do not manufacture three mode-specific scored sets.
        gold = old['acceptableDevelopmentContinuations']
        rows.append(dict(id=old['id'],familyId=old['family'],
            contentLabel='mixed' if old['mode']=='en_es' else ('en' if old['mode']=='en_US' else 'es'),
            prefix=old['prefix'],selected='',suffix='',route='completion' if old['route']=='completion' else 'nextword',
            typed=old.get('typed',''),acceptableByMode={m:[] for m in MODES},oracle='ambiguous',
            rationale='Exposed development; original '+old['mode']+' acceptable set '+json.dumps(gold,ensure_ascii=False)+'. Nonasserting cross-mode replay: no three-mode gold was supplied.',
            actions=[{'action':'observe'}]))
        mapping.append(dict(id=old['id'],suppliedMode=old['mode'],suppliedAcceptable=gold,convertedOracle='ambiguous'))
    result = dict(schemaVersion=1,cohort='development',cases=rows,equivalences=[])
    admit(result)
    args.output.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
    receipt = dict(source=str(args.source.resolve()),sourceSHA256=hashlib.sha256(args.source.read_bytes()).hexdigest(),
        outputSHA256=hashlib.sha256(args.output.read_bytes()).hexdigest(),mapping=mapping,
        restriction='Original single-mode gold is retained, not extrapolated or scored as three authored mode sets.')
    args.output.with_name(args.output.stem+'-conversion.json').write_text(json.dumps(receipt,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps(dict(prompts=len(rows),modeRows=len(rows)*3,oracle='ambiguous',engineExecution=False)))

if __name__=='__main__':
    main()
