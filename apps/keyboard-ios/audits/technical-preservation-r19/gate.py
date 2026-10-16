#!/usr/bin/env python3
"""Reject any passing-case loss; retain every row and oracle error in the audit."""
import argparse,json,pathlib
p=argparse.ArgumentParser();p.add_argument('summaries',nargs='+');a=p.parse_args()
regressions=[];unavailable=[];ordinary_changes=[];infrastructure=[]
for file in a.summaries:
 s=json.loads(pathlib.Path(file).read_text())
 infrastructure += [(file,e) for e in s.get('infrastructureErrors',[])]
 unavailable += [(file,k) for field in ['missingBaseline','missingCandidate','unexpectedRows'] for k in s[field]]
 for mode,r in s['modes'].items():
  regressions += [(file,mode,k) for k in r['regressions']]
  ordinary_changes += [(file,mode,k) for k in r['ordinaryStateChanges']]
r={'passingCaseRegressions':regressions,'ordinaryStateChanges':ordinary_changes,'unavailableRows':unavailable,'infrastructureErrors':infrastructure,'observedEngineGatePass':not(regressions or unavailable or ordinary_changes or infrastructure),'nativeControllerVerification':'unavailable: task ownership prohibits device use; no candidate native acceptance'}
print(json.dumps(r,indent=2))
raise SystemExit(0 if r['observedEngineGatePass'] else 1)
