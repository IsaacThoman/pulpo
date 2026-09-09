#!/usr/bin/env python3
"""Run the trusted host-side janitor and require a successful completion."""
import json
import os
import time
import urllib.request

base = os.environ['COOLIFY_URL'].rstrip('/')
if not base.endswith('/api/v1'):
    base += '/api/v1'
app = os.environ['COOLIFY_PREVIEW_MAINTENANCE_APP_UUID']
task = os.environ['COOLIFY_PREVIEW_MAINTENANCE_TASK_UUID']
path = f'/applications/{app}/scheduled-tasks/{task}'


def request(suffix, method='GET'):
    req = urllib.request.Request(base + path + suffix, method=method, headers={
        'Authorization': 'Bearer ' + os.environ['COOLIFY_TOKEN'],
        'Accept': 'application/json', 'User-Agent': 'pulpo-preview-maintenance'})
    with urllib.request.urlopen(req, timeout=30) as response:
        return json.load(response)


before = {e['uuid'] for e in request('/executions')}
request('/execute', 'POST')
for _ in range(90):
    fresh = [e for e in request('/executions') if e['uuid'] not in before]
    if fresh and fresh[0]['status'] in ('success', 'failed'):
        execution = fresh[0]
        print(execution.get('message') or execution['status'])
        if execution['status'] != 'success':
            raise SystemExit('Preview maintenance failed; inspect its Coolify execution.')
        break
    time.sleep(2)
else:
    raise SystemExit('Timed out waiting for preview maintenance.')
