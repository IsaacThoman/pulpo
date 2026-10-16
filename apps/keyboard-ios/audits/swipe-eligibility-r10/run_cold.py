#!/usr/bin/env python3
"""Supplementary dev-only cold timing with invocation evidence; no heldout access."""
import hashlib
import json
import os
import subprocess
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[3]
COMMAND = ['swift', 'test', '--package-path', 'apps/keyboard-ios/PulpoKeyboardKit',
           '-c', 'release', '--skip-build', '--filter', 'SwipeEligibilityRound10Tests.frozenSweep']
rows = []
with tempfile.TemporaryDirectory(prefix='pulpo-r10-cold-provenance-') as temp:
    for language in ['spanish', 'bilingual', 'english']:
        for index in range(3):
            output = str(Path(temp) / f'{language}-{index}.json')
            env = dict(os.environ, PULPO_R10_COLD=language, PULPO_R10_OUTPUT=output)
            process = subprocess.Popen(COMMAND, cwd=REPO, env=env, stdout=subprocess.PIPE,
                                       stderr=subprocess.STDOUT, text=True)
            stdout, _ = process.communicate()
            assert process.returncode == 0, stdout
            assert '1 test in 1 suite passed' in stdout, stdout
            assert 'boundarySmoke' not in stdout, stdout
            report = json.loads(Path(output).read_text())
            assert report['rows'] == [] and report['literals'] == []
            rows.append(dict(language=language, invocationPID=process.pid, returncode=process.returncode,
                             exactFilter='SwipeEligibilityRound10Tests.frozenSweep',
                             stdoutSHA256=hashlib.sha256(stdout.encode()).hexdigest(),
                             testEvidence=[line for line in stdout.splitlines() if 'frozenSweep' in line or '1 test in 1 suite' in line],
                             cold=report['cold']))
result = dict(classification='post-reveal development-only timing diagnostic; not a replacement frozen baseline',
              command=COMMAND, processFreshness='nine separate swift test launches, exact single-test filter; OS disk caches may be warm',
              samples=rows)
(ROOT / 'post-reveal-cold-provenance.json').write_text(json.dumps(result, indent=2) + '\n')
print('9 separate single-test dev-only cold runs recorded; no heldout access')
