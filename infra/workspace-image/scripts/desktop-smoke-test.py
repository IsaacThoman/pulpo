"""Exercise the workspace's screen without network access: the session, the browser, the control
helper's JSON-lines protocol as the daemon speaks it, the live frames, headless Chromium and
Playwright. Run by pulpo-workspace-smoke-test with the system Python."""
import io
import json
import os
import select
import subprocess
import sys
import tempfile
import time
from pathlib import Path

from PIL import Image

SCREEN = (1280, 800)
PAGE = """<!doctype html>
<meta charset="utf-8">
<title>Pulpo smoke</title>
<style>
  body { font: 16px sans-serif; margin: 16px; }
  #pad { width: 300px; height: 120px; background: #cde; }
  #status { position: fixed; bottom: 8px; left: 16px; margin: 0; }
  #spacer { height: 3000px; }
</style>
<h1>Desktop smoke page</h1>
<p id="status">ready</p>
<button id="first" onclick="note('first')">First button</button>
<button id="second" onclick="note('second')">Second button</button>
<button onclick="window.open('popup.html', 'popup', 'width=420,height=300')">Open popup</button>
<label>Name <input id="name"></label>
<label>Amount <input id="amount" type="range" min="0" max="10" value="3"></label>
<div id="pad" aria-label="Drag pad"></div>
<div id="spacer"></div>
<script>
  function note(text) { document.getElementById('status').textContent = text }
  document.addEventListener('keydown', (event) => {
    if (event.ctrlKey && event.altKey) note('chord ' + event.key.toLowerCase())
  })
  let start = null
  const pad = document.getElementById('pad')
  pad.addEventListener('mousedown', (event) => { start = [event.clientX, event.clientY] })
  document.addEventListener('mouseup', (event) => {
    if (start) note('dragged ' + Math.round(event.clientX - start[0]) + ' ' + Math.round(event.clientY - start[1]))
    start = null
  })
  addEventListener('scroll', () => note('scrolled ' + (scrollY > 0 ? 'down' : 'top')))
</script>
"""
POPUP = '<!doctype html><title>Pulpo popup</title><p>A second window</p>'


def fail(message):
    print(f'FAIL: {message}', file=sys.stderr)
    log_directory = Path('/tmp/pulpo-desktop/log')
    if log_directory.is_dir():
        for log in sorted(log_directory.iterdir()):
            print(f'--- {log}', file=sys.stderr)
            print(log.read_text(errors='replace')[-2000:], file=sys.stderr)
    sys.exit(1)


def check(condition, message):
    if not condition:
        fail(message)


def until(description, probe, timeout=20.0, interval=0.2):
    deadline = time.monotonic() + timeout
    while True:
        value = probe()
        if value:
            return value
        if time.monotonic() > deadline:
            fail(f'{description} (waited {timeout:.0f} s)')
        time.sleep(interval)


def processes(name):
    count = 0
    for entry in Path('/proc').iterdir():
        try:
            count += entry.name.isdigit() and (entry / 'comm').read_text().strip() == name
        except OSError:
            pass
    return count


def login_shell(command, timeout=20):
    """As the daemon runs agent commands: a login shell whose output must close when it is done."""
    return subprocess.run(['bash', '-lc', command], capture_output=True, text=True, timeout=timeout)


class Helper:
    """The control helper as the daemon runs it: `pulpo-desktop helper`, one JSON line each way."""

    def __init__(self):
        self.process = subprocess.Popen(
            ['pulpo-desktop', 'helper'], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=sys.stderr, text=True,
        )
        self.next_id = 1

    def ask(self, method, params=None, timeout=15.0):
        request_id = self.next_id
        self.next_id += 1
        self.process.stdin.write(json.dumps({'id': request_id, 'method': method, 'params': params or {}}) + '\n')
        self.process.stdin.flush()
        ready, _, _ = select.select([self.process.stdout], [], [], timeout)
        check(ready, f'the helper did not answer {method} in {timeout:.0f} s')
        answer = json.loads(self.process.stdout.readline())
        check(answer.get('id') == request_id, f'the helper answered {method} out of order: {answer}')
        return answer

    def result(self, method, params=None, timeout=15.0):
        answer = self.ask(method, params, timeout)
        check(answer.get('ok') is True, f'{method} {json.dumps(params)} failed: {answer}')
        return answer['result']

    def close(self):
        self.process.stdin.close()
        try:
            self.process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            fail('the helper did not leave when its input closed')


def find(elements, role, label=None, value=None):
    for element in elements:
        if element['role'] == role and (label is None or element.get('label') == label) and (value is None or element.get('value') == value):
            return element
    return None


def middle(element):
    return element['x'] + element['width'] / 2, element['y'] + element['height'] / 2


def main():
    started = time.monotonic()
    work = Path(tempfile.mkdtemp(prefix='pulpo-desktop-smoke-'))
    (work / 'page.html').write_text(PAGE)
    (work / 'popup.html').write_text(POPUP)
    images = work / 'images'
    images.mkdir()
    page_url = (work / 'page.html').as_uri()

    # Nothing of the screen runs until it is used.
    check(subprocess.run(['pulpo-desktop', 'status']).returncode == 1, 'the screen runs before anything used it')
    check(processes('Xvfb') == 0, 'Xvfb runs before anything used the screen')
    check(Path('/opt/pulpo/desktop/VERSION').read_text().strip() == '1', 'the desktop VERSION file is missing')
    check(login_shell('echo "$DISPLAY"').stdout.strip() == ':1', 'login shells do not have DISPLAY=:1')

    # Concurrent starts bring up one session; a start when it is up is quick.
    starts = [subprocess.Popen(['pulpo-desktop', 'start']) for _ in range(3)]
    check(all(start.wait(timeout=30) == 0 for start in starts), 'pulpo-desktop start failed')
    check(processes('Xvfb') == 1, 'concurrent starts ran more than one display')
    warm = time.monotonic()
    check(subprocess.run(['pulpo-desktop', 'start']).returncode == 0, 'a second start failed')
    check(time.monotonic() - warm < 1, 'a start with the screen up took a second or more')
    check(subprocess.run(['pulpo-desktop', 'status']).returncode == 0, 'pulpo-desktop status says the screen is down after start')

    # The browser opens on the screen and the command returns with its output closed.
    opened = time.monotonic()
    browser = login_shell(f'chromium {page_url}')
    check(browser.returncode == 0, f'chromium failed: {browser.stderr}')
    check(time.monotonic() - opened < 5, 'chromium did not return at once')

    helper = Helper()
    configured = helper.result('configure', {'excludePids': [], 'imageDir': str(images), 'maxImageEdge': 1280}, timeout=30)
    check(configured == {'protocol': 1, 'platform': 'linux', 'background': True}, f'configure answered {configured}')
    check(helper.result('permissions', {'prompt': True}) == {'accessibility': True, 'screenRecording': True}, 'permissions are not both true')

    def chromium_app():
        apps = helper.result('apps')['apps']
        return next((app for app in apps if app['id'] == 'chromium' and any(window['title'].startswith('Pulpo smoke') for window in app['windows'])), None)

    app = until('the browser window to appear in apps', chromium_app, timeout=30)
    check(app['name'] == 'Chromium' and app['frontmost'] is True, f'unexpected app entry: {app}')
    window = next(window for window in app['windows'] if window['title'].startswith('Pulpo smoke'))
    target = {'pid': app['pid'], 'windowId': window['id']}

    def snapshot(**options):
        return helper.result('snapshot', {**target, **options})

    def page_loaded():
        shot = snapshot()
        return shot if find(shot['elements'], 'button', 'First button') else None

    shot = until('the page to show its elements', page_loaded, timeout=20, interval=0.3)
    check(shot['image']['width'] == SCREEN[0] and shot['image']['height'] == SCREEN[1], f'the picture is not the whole screen: {shot["image"]}')
    with Image.open(shot['image']['path']) as image:
        check(image.format == 'JPEG' and image.size == SCREEN, 'the snapshot is not a 1280x800 JPEG')
    check(shot['truncated'] is False, 'a small page was truncated')
    check(find(shot['elements'], 'heading', 'Desktop smoke page') is not None, 'the heading is not among the elements')
    check(find(shot['elements'], 'textfield', 'Name') is not None, 'the text field is not among the elements')
    check(find(shot['elements'], 'slider', 'Amount', '3') is not None, 'the slider and its value are not among the elements')
    bare = snapshot(outline=False)
    check(bare['elements'] == [] and Path(bare['image']['path']).is_file(), 'outline: false still listed elements')
    limited = snapshot(maxElements=3)
    check(len(limited['elements']) == 3 and limited['truncated'] is True, 'maxElements did not cut the list')

    def act(action):
        return helper.result('act', {**target, 'action': action})

    def status(expected):
        def probe():
            elements = snapshot()['elements']
            return elements if find(elements, 'text', expected) else None
        return until(f'the page to say "{expected}"', probe, timeout=10, interval=0.2)

    # Click by element and by coordinates.
    elements = snapshot()['elements']
    act({'type': 'click', 'element': find(elements, 'button', 'First button')['index'], 'button': 'left', 'count': 1})
    elements = status('first')
    x, y = middle(find(elements, 'button', 'Second button'))
    act({'type': 'click', 'x': x, 'y': y, 'button': 'left', 'count': 1})
    elements = status('second')

    # Typing (with characters off the US keyboard), a chord, and set_value.
    act({'type': 'click', 'element': find(elements, 'textfield', 'Name')['index'], 'button': 'left', 'count': 1})
    act({'type': 'type', 'text': 'héllo wörld'})
    until('the typed text to reach the field', lambda: find(snapshot()['elements'], 'textfield', 'Name', 'héllo wörld'), timeout=10)
    act({'type': 'key', 'keys': 'ctrl+alt+u'})
    elements = status('chord u')
    act({'type': 'set_value', 'element': find(elements, 'textfield', 'Name')['index'], 'value': 'set directly'})
    elements = until('set_value to change the field', lambda: find(snapshot()['elements'], 'textfield', 'Name', 'set directly') and snapshot()['elements'], timeout=10)
    act({'type': 'set_value', 'element': find(elements, 'slider', 'Amount')['index'], 'value': '7'})
    elements = until('set_value to move the slider', lambda: find(snapshot()['elements'], 'slider', 'Amount', '7') and snapshot()['elements'], timeout=10)
    stale = helper.ask('act', {**target, 'action': {'type': 'click', 'element': 9999, 'button': 'left', 'count': 1}})
    check(stale.get('code') == 'stale_element', f'an unknown element was not refused as stale: {stale}')

    # Drag across the pad, then scroll the page.
    pad = find(elements, 'group', 'Drag pad')
    check(pad is not None, 'the drag pad is not among the elements')
    from_x, from_y = middle(pad)
    act({'type': 'drag', 'fromX': from_x - 60, 'fromY': from_y, 'toX': from_x + 40, 'toY': from_y + 20})
    status('dragged 100 20')
    act({'type': 'scroll', 'dx': 0, 'dy': 5})
    status('scrolled down')
    act({'type': 'scroll', 'dx': 0, 'dy': -50})
    elements = status('scrolled top')

    # A second window: it is listed in front, can be pictured, and closes with a chord.
    act({'type': 'click', 'element': find(elements, 'button', 'Open popup')['index'], 'button': 'left', 'count': 1})

    def popup():
        apps = helper.result('apps')['apps']
        browser_app = next((candidate for candidate in apps if candidate['pid'] == app['pid']), None)
        return browser_app if browser_app and len(browser_app['windows']) == 2 and browser_app['windows'][0]['title'].startswith('Pulpo popup') else None

    browser_app = until('the popup window to be listed in front', popup, timeout=15)
    popup_target = {'pid': app['pid'], 'windowId': browser_app['windows'][0]['id']}
    popup_shot = until('the popup to show its text', lambda: (lambda shot: shot if find(shot['elements'], 'text', 'A second window') else None)(helper.result('snapshot', popup_target)), timeout=10)
    check(popup_shot['window']['title'].startswith('Pulpo popup'), 'the popup snapshot has the wrong title')
    helper.result('act', {**popup_target, 'action': {'type': 'key', 'keys': 'ctrl+w'}})
    until('the popup to close', lambda: len(next(candidate for candidate in helper.result('apps')['apps'] if candidate['pid'] == app['pid'])['windows']) == 1, timeout=10)
    gone = helper.ask('snapshot', popup_target)
    check(gone.get('code') == 'not_found', f'a closed window was not reported gone: {gone}')

    # A minimized window is listed as such and restored by a snapshot.
    act({'type': 'click', 'element': find(snapshot()['elements'], 'button', 'Minimize')['index'], 'button': 'left', 'count': 1})
    until('the window to be listed as minimized', lambda: next(candidate for candidate in helper.result('apps')['apps'] if candidate['pid'] == app['pid'])['windows'][0]['minimized'], timeout=10)
    elements = snapshot()['elements']
    check(find(elements, 'button', 'First button') is not None, 'a snapshot of a minimized window did not restore it')
    check(next(candidate for candidate in helper.result('apps')['apps'] if candidate['pid'] == app['pid'])['windows'][0]['minimized'] is False, 'the window is still minimized after a snapshot')

    # A person in control: screen coordinates through a second helper, as the daemon does.
    first = find(elements, 'button', 'First button')
    person = Helper()
    person.result('configure', {'excludePids': [], 'imageDir': str(images), 'maxImageEdge': 1280})
    x, y = middle(first)
    person.result('input', {'events': [{'type': 'move', 'x': x, 'y': y}, {'type': 'down', 'x': x, 'y': y, 'button': 'left'}, {'type': 'up', 'x': x, 'y': y, 'button': 'left'}]})
    status('first')
    x, y = middle(find(elements, 'button', 'Second button'))
    person.result('input', {'events': [{'type': 'click', 'x': x, 'y': y, 'button': 'left', 'count': 1}]})
    status('second')
    x, y = middle(find(elements, 'textfield', 'Name'))
    person.result('input', {'events': [
        {'type': 'click', 'x': x, 'y': y, 'button': 'left', 'count': 3},
        {'type': 'text', 'text': 'from the user'},
        {'type': 'key', 'keys': 'ctrl+alt+p'},
    ]})
    elements = status('chord p')
    check(find(elements, 'textfield', 'Name', 'from the user') is not None, 'text typed by the user did not reach the field')
    person.result('input', {'events': [{'type': 'scroll', 'x': 640, 'y': 500, 'dx': 0, 'dy': 3}]})
    status('scrolled down')
    bad = person.ask('input', {'events': [{'type': 'wave'}]})
    check(bad.get('code') == 'invalid_request', f'an unknown input event was not refused: {bad}')
    person.close()
    helper.close()
    print(f'Desktop helper checks passed ({time.monotonic() - started:.1f} s).')

    # The live view: multipart JPEG frames of the whole screen, as ffmpeg's mpjpeg writes them.
    frames = subprocess.Popen(['pulpo-desktop', 'frames', '4'], stdout=subprocess.PIPE, stderr=sys.stderr)
    stream = b''
    deadline = time.monotonic() + 15
    pictures = []
    while len(pictures) < 3 and time.monotonic() < deadline:
        ready, _, _ = select.select([frames.stdout], [], [], 1)
        if ready:
            stream += os.read(frames.stdout.fileno(), 1 << 20)
        while True:
            header_end = stream.find(b'\r\n\r\n')
            if header_end < 0:
                break
            headers = stream[:header_end].decode('latin-1').lower().split('\r\n')
            length = next((int(line.split(':', 1)[1]) for line in headers if line.startswith('content-length:')), None)
            check(length is not None, f'a frame has no Content-Length: {headers}')
            if len(stream) < header_end + 4 + length:
                break
            pictures.append(stream[header_end + 4:header_end + 4 + length])
            stream = stream[header_end + 4 + length:]
    frames.kill()
    frames.wait()
    check(len(pictures) >= 3, f'pulpo-desktop frames wrote {len(pictures)} frames in 15 s')
    for picture in pictures:
        with Image.open(io.BytesIO(picture)) as image:
            check(image.format == 'JPEG' and image.size == SCREEN, f'a frame is not a 1280x800 JPEG: {image.format} {image.size}')

    # Headless Chromium runs in the foreground with no screen.
    screenshot = work / 'headless.png'
    headless = subprocess.run(
        ['chromium', '--headless', f'--screenshot={screenshot}', '--window-size=800,600', page_url],
        capture_output=True, text=True, timeout=60,
    )
    check(headless.returncode == 0 and screenshot.is_file(), f'headless chromium failed: {headless.stderr[-1000:]}')
    with Image.open(screenshot) as image:
        check(image.size == (800, 600), f'the headless screenshot is {image.size}')

    # Playwright resolves from any folder, attaches to the browser on the screen, and launches its own.
    script = work / 'playwright-check.mjs'
    script.write_text("""
import { chromium } from 'playwright'
const screen = await chromium.connectOverCDP('http://127.0.0.1:9222')
const titles = screen.contexts().flatMap((context) => context.pages()).map((page) => page.url())
if (!titles.some((url) => url.endsWith('page.html'))) throw new Error('the screen browser has no smoke page: ' + titles)
await screen.close()
const browser = await chromium.launch()
const page = await browser.newPage()
await page.setContent('<p id="x">playwright-ok</p>')
console.log(await page.textContent('#x'))
await browser.close()
""")
    playwright = subprocess.run(['node', str(script)], capture_output=True, text=True, timeout=90, cwd=work)
    check(playwright.stdout.strip() == 'playwright-ok', f'Playwright failed: {playwright.stdout} {playwright.stderr[-1500:]}')

    check(subprocess.run(['pulpo-desktop', 'stop']).returncode == 0, 'pulpo-desktop stop failed')
    check(subprocess.run(['pulpo-desktop', 'status']).returncode == 1, 'the screen still runs after stop')
    print(f'Desktop smoke test passed ({time.monotonic() - started:.1f} s).')


if __name__ == '__main__':
    main()
