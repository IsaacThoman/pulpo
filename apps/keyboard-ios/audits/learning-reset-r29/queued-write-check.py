#!/usr/bin/env python3
"""Bounded pipe barriers order two real processes around Foundation's atomic rename."""
import json, os, pathlib, select, subprocess, sys, tempfile, time

def command(process, text):
    process.stdin.write(text + '\n')
    process.stdin.flush()
    if not select.select([process.stdout], [], [], 15)[0]:
        raise RuntimeError('worker response timeout: ' + text)
    answer = process.stdout.readline().strip()
    if not answer:
        raise RuntimeError('worker exited: ' + str(process.poll()))
    return answer

start = time.monotonic()
with tempfile.TemporaryDirectory(prefix='pulpo-r29-process-') as directory:
    url = str(pathlib.Path(directory) / 'PersonalDictionary.json')
    notified, notify = os.pipe()
    release, releasing = os.pipe()
    environment = dict(os.environ, DYLD_INSERT_LIBRARIES=sys.argv[2], R29_NOTIFY_FD=str(notify), R29_RELEASE_FD=str(release))
    writer = subprocess.Popen([sys.argv[1], url], stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True, env=environment, pass_fds=(notify, release))
    clearer = subprocess.Popen([sys.argv[1], url], stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True)
    released = False
    try:
        command(writer, 'pin durableold')
        command(writer, 'save')
        command(writer, 'pin queuedold')
        command(writer, 'arm')
        command(writer, 'background')
        if not select.select([notified], [], [], 15)[0]:
            raise RuntimeError('atomic rename gate not reached (unavailable, not a pass)')
        assert os.read(notified, 1) == b'x'
        # Writer has fully prepared its old snapshot but has not replaced disk.
        command(clearer, 'clear')
        after_clear = json.loads(command(clearer, 'state'))
        os.write(releasing, b'x')
        released = True
        after_late_write = json.loads(command(writer, 'state'))
        retained_reload = json.loads(command(writer, 'reload'))
        print(json.dumps({'available': True, 'gate': 'before Foundation atomic replacement syscall', 'after_completed_clear': after_clear, 'after_preclear_background_write_finishes': after_late_write, 'retained_writer_reload_after_own_late_save': retained_reload, 'reset_survives': after_late_write['total'] == 0, 'elapsed_seconds': round(time.monotonic()-start, 3)}, sort_keys=True))
    finally:
        if not released:
            os.write(releasing, b'x')
        for process in (writer, clearer):
            try:
                process.stdin.write('quit\n')
                process.stdin.flush()
                process.wait(timeout=5)
            except (RuntimeError, BrokenPipeError):
                pass
            if process.poll() is None:
                process.terminate()
            process.wait(timeout=5)
        for fd in (notified, notify, release, releasing):
            os.close(fd)
