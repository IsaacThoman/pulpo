#!/usr/bin/env python3
"""A stand-in Pulpo server for testing the keyboard's sign-in and dictation flow.

Implements the endpoints Pulpo Keyboard calls, with the same shapes and error
envelope as apps/server. Transcription returns a fixed sentence after checking
the bearer token and that a non-empty audio file was uploaded.

  python3 scripts/stub_pulpo_server.py --port 8091
"""

import argparse
import json
import re
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

TOKEN = 'stub-session-token-0123456789abcdefghijklmnop'
USER = {'id': 'usr_stub', 'name': 'Stub Tester', 'email': 'tester@example.com', 'role': 'user'}
TRANSCRIPT = 'Hello from Pulpo dictation.'


class Handler(BaseHTTPRequestHandler):
  uploads = []

  def send_json(self, status, body):
    data = json.dumps(body).encode()
    self.send_response(status)
    self.send_header('content-type', 'application/json')
    self.send_header('content-length', str(len(data)))
    self.end_headers()
    self.wfile.write(data)

  def error(self, status, code, message):
    self.send_json(status, {'error': {'message': message, 'type': 'invalid_request_error', 'code': code, 'param': None}})

  def authorized(self):
    return self.headers.get('authorization') == f'Bearer {TOKEN}'

  def body(self):
    length = int(self.headers.get('content-length') or 0)
    return self.rfile.read(length) if length else b''

  def do_GET(self):
    if self.path == '/api/mobile/config':
      return self.send_json(200, {
        'mobileApiVersion': 1,
        'instance': {'name': 'Stub', 'version': '0.0.0', 'publicUrl': 'http://localhost'},
        'capabilities': {'dictation': True, 'bearerSessions': True},
      })
    if self.path == '/api/mobile/me':
      if not self.authorized():
        return self.error(401, 'unauthorized', 'Authentication required')
      return self.send_json(200, {'user': USER})
    if self.path == '/stub/uploads':
      return self.send_json(200, {'uploads': Handler.uploads})
    self.error(404, 'not_found', 'Not found')

  def do_POST(self):
    raw = self.body()
    if self.path == '/api/mobile/auth/login':
      payload = json.loads(raw or b'{}')
      if payload.get('email') != USER['email'] or payload.get('password') != 'correct horse':
        return self.error(401, 'unauthorized', 'Invalid email or password')
      if payload.get('appType') != 'mobile' or not payload.get('deviceLabel'):
        return self.error(400, 'validation_error', 'deviceLabel and appType are required')
      return self.send_json(200, {'user': USER, 'session': {'token': TOKEN, 'expiresAt': '2099-01-01T00:00:00.000Z'}})
    if self.path == '/api/mobile/auth/logout':
      self.send_response(204)
      self.end_headers()
      return
    if self.path == '/api/dictation/transcriptions':
      if not self.authorized():
        return self.error(401, 'unauthorized', 'Authentication required')
      content_type = self.headers.get('content-type', '')
      match = re.search(r'boundary=(.+)$', content_type)
      if not match:
        return self.error(400, 'dictation_audio_required', 'An audio recording is required')
      parts = raw.split(b'--' + match.group(1).encode())
      files = [p for p in parts if b'name="file"' in p]
      if not files:
        return self.error(400, 'dictation_audio_required', 'An audio recording is required')
      header, _, audio = files[0].partition(b'\r\n\r\n')
      audio = audio.rstrip(b'\r\n')
      mime = re.search(rb'Content-Type: ([^\r\n]+)', header)
      Handler.uploads.append({'bytes': len(audio), 'type': mime.group(1).decode() if mime else None})
      if not audio:
        return self.error(400, 'dictation_audio_empty', 'The audio recording is empty')
      return self.send_json(200, {'text': TRANSCRIPT})
    self.error(404, 'not_found', 'Not found')

  def log_message(self, fmt, *args):
    print(fmt % args, flush=True)


def main():
  parser = argparse.ArgumentParser()
  parser.add_argument('--port', type=int, default=8091)
  args = parser.parse_args()
  ThreadingHTTPServer(('127.0.0.1', args.port), Handler).serve_forever()


if __name__ == '__main__':
  main()
