#!/usr/bin/env python3
"""Run production Swift tests; retain compact issue/summary metadata, never raw logs."""
import argparse, json, os, pathlib, re, subprocess, time
p = argparse.ArgumentParser()
p.add_argument('--package', required=True)
p.add_argument('--summary', required=True)
p.add_argument('--suite')
p.add_argument('--results')
p.add_argument('--filter')
a = p.parse_args()
cmd = ['swift', 'test', '-c', 'release', '--package-path', a.package]
if a.filter:
    cmd += ['--filter', a.filter]
env = dict(os.environ)
if a.suite:
    if not a.results:
        p.error('--suite requires --results')
    env['PULPO_R20_SUITE'] = str(pathlib.Path(a.suite).resolve())
    env['PULPO_R20_RESULTS'] = str(pathlib.Path(a.results).resolve())
start = time.monotonic()
r = subprocess.run(cmd, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
lines = r.stdout.splitlines()
# Retain individual known/unexpected issue diagnostics and final counts, not raw build/test output.
issue_lines = [line for line in lines if re.search(r'(?i)(known issue|issue recorded|recorded an issue|error:|failed after|failed with|R20 exact|Test run with|Build complete)', line)]
summary = {'command': cmd, 'exit': r.returncode, 'wallSeconds': round(time.monotonic()-start,3), 'diagnostics': issue_lines}
pathlib.Path(a.summary).write_text(json.dumps(summary, ensure_ascii=False, indent=2)+'\n')
print(json.dumps(summary, ensure_ascii=False, indent=2), flush=True)
if r.returncode and not issue_lines:
    print(r.stdout[-4000:], flush=True)
raise SystemExit(r.returncode)
