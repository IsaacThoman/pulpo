#!/usr/bin/env python3
"""Loopback-only native fixture server. All users, credentials and tokens are fake."""
import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

release = threading.Event()
lock = threading.Lock()
requests = []


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_):
        pass

    def send(self, status, body=None):
        payload = b"" if body is None else json.dumps(body).encode()
        try:
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)
        except (BrokenPipeError, ConnectionResetError):
            pass  # A dismissed sheet may cancel its transport; the issued request still happened.

    def do_GET(self):
        if self.path == "/r35-control/reset":
            release.clear()
            with lock:
                requests.clear()
            return self.send(200, {"ok": True})
        if self.path == "/r35-control/release":
            release.set()
            return self.send(200, {"ok": True})
        if self.path == "/r35-control/state":
            with lock:
                return self.send(200, {"requests": list(requests)})
        if self.path == "/api/mobile/config":
            return self.send(200, {"instance": {"name": "R35 Loopback"}, "capabilities": {"dictation": True}})
        if self.path == "/api/mobile/me":
            return self.send(200, {"user": {"id": "fake-native", "name": "R35 Retry"}})
        return self.send(404, {"error": {"code": "not_found", "message": "Unknown fake endpoint"}})

    def do_POST(self):
        if self.path == "/api/mobile/auth/logout":
            return self.send(204)
        if self.path != "/api/mobile/auth/login":
            return self.send(404, {"error": {"code": "not_found", "message": "Unknown fake endpoint"}})
        body = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))))
        assert body.get("appType") == "mobile" and body.get("platform") == "ios"
        assert body.get("password") == "fake-password"
        email = body.get("email")
        assert email in {"held@fake.invalid", "retry@fake.invalid", "twofactor@fake.invalid"}
        with lock:
            requests.append({"path": self.path, "email": email, "code": body.get("twoFactorCode")})
        if email == "held@fake.invalid":
            if not release.wait(90):
                return self.send(500, {"error": {"code": "fixture_timeout", "message": "Unreleased fake login"}})
        if email == "twofactor@fake.invalid" and body.get("twoFactorCode") != "123456":
            return self.send(401, {"error": {"code": "two_factor_required", "message": "Enter fake code"}})
        name = "R35 Held" if email == "held@fake.invalid" else "R35 Retry"
        self.send(200, {"user": {"id": "fake-native", "name": name}, "session": {"token": "fake-native-token", "expiresAt": "2099-01-01"}})


if __name__ == "__main__":
    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    Path("/tmp/pulpo-r42-validation/native-server-url.txt").write_text(f"http://127.0.0.1:{server.server_port}")
    print(f"R35 native loopback listening on port {server.server_port}", flush=True)
    server.serve_forever()
