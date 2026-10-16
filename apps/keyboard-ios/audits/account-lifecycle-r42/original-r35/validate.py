#!/usr/bin/env python3
"""Validate the public fixture schema without revealing case content."""
import hashlib
import json
import sys
from pathlib import Path

path = Path(sys.argv[1])
raw = path.read_bytes()
cases = json.loads(raw)
assert isinstance(cases, list) and cases
case_ids, hosts = set(), {}
required = {
    "startLogin": ("id", "host"), "startRefresh": ("id",),
    "awaitRequest": ("id", "host", "path"), "respond": ("id", "status", "body"),
    "waitTask": ("id",), "cancelTask": ("id",), "revokeLogin": ("id",),
    "signOut": (), "checkpoint": ("id", "expected"), "reload": ("id", "expected"),
}
optional = {"startLogin": {"email", "password", "code"}, "signOut": {"remote"}}
for case in cases:
    assert set(case) == {"id", "purpose", "steps"}
    assert isinstance(case["id"], str) and case["id"] and case["id"] not in case_ids
    case_ids.add(case["id"])
    assert isinstance(case["purpose"], str) and case["purpose"]
    assert isinstance(case["steps"], list) and case["steps"]
    assert any(s["op"] in ("checkpoint", "reload") for s in case["steps"])
    tasks, requests = set(), set()
    for step in case["steps"]:
        op = step["op"]
        assert op in required and all(k in step for k in required[op])
        assert set(step) <= {"op", *required[op], *optional.get(op, set())}
        if "id" in step:
            assert isinstance(step["id"], str) and step["id"]
        if "host" in step:
            host = step["host"]
            assert isinstance(host, str) and host.endswith(".r35.invalid")
            assert hosts.setdefault(host, case["id"]) == case["id"]
        if op == "respond":
            assert type(step["status"]) is int and 100 <= step["status"] <= 599
            assert step["id"] in requests
            requests.remove(step["id"])
        if op in ("startLogin", "startRefresh"):
            assert step["id"] not in tasks
            tasks.add(step["id"])
        if op in ("waitTask", "cancelTask", "revokeLogin"):
            assert step["id"] in tasks
        if op == "revokeLogin":
            assert any(s["op"] == "startLogin" and s["id"] == step["id"] for s in case["steps"])
        if op == "awaitRequest":
            assert isinstance(step["path"], str) and step["path"] in {
                "/api/mobile/config", "/api/mobile/auth/login", "/api/mobile/me", "/api/mobile/auth/logout"}
            assert step["id"] not in requests
            requests.add(step["id"])
        if op == "startLogin":
            assert all(isinstance(step[k], str) for k in ("email", "password", "code") if k in step)
        if op == "signOut" and "remote" in step:
            assert type(step["remote"]) is bool
        if "expected" in step:
            expected = step["expected"]
            assert set(expected) == {"name", "host", "token", "dictation"}
            assert all(expected[k] is None or isinstance(expected[k], str) for k in ("name", "host", "token"))
            assert type(expected["dictation"]) is bool
            if expected["name"] is None:
                assert expected == dict(name=None, host=None, token=None, dictation=False)
print(json.dumps({"count": len(cases), "schema": "pass", "sha256": hashlib.sha256(raw).hexdigest()}, sort_keys=True))
