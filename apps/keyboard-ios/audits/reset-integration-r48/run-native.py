#!/usr/bin/env python3
"""Exposed integration controls on an explicitly owned disposable device."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import time

def write(path, value):
    path.write_text(json.dumps(value, indent=2) + '\n')

def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--device', required=True)
    parser.add_argument('--raw', required=True, type=Path)
    parser.add_argument('--receipt', required=True, type=Path)
    parser.add_argument('--label', required=True)
    parser.add_argument('--configuration', choices=['Debug', 'Release'], default='Release')
    parser.add_argument('--derived-data', type=Path)
    parser.add_argument('--integration', action='store_true')
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[4]
    raw = args.raw.resolve(strict=True)
    receipt = json.loads(args.receipt.read_text())
    if receipt.get('purpose') != 'R48-owned-test-store' or receipt.get('deviceUDID') != args.device or receipt.get('disposable') is not True:
        raise RuntimeError('Device is not bound to the disposable integration receipt')
    group = Path(receipt['groupContainer']).resolve(strict=True)
    receipt['initialStoreFiles'] = {p.name:digest(p) for p in group.iterdir() if p.name.startswith(('PersonalDictionary.json', 'TouchModel.json'))}
    receipt_path = raw / (args.label + '-fixture.json')
    write(receipt_path, receipt)
    source_paths = [p for directory in ['App','AppTests','UITests','PulpoKeyboardKit/Sources'] for p in (root/'apps/keyboard-ios'/directory).rglob('*.swift')]
    derived = (args.derived_data or raw/'DerivedData').resolve(strict=True)
    derived.relative_to(raw)  # Only this round's owned build directory.
    products = derived/'Build/Products'
    binaries = [p for p in products.rglob('*') if p.is_file()
        and p.name in ['PulpoKeyboard','PulpoKeyboardUITests','PulpoKeyboardAppTests']
        and not any(part.endswith('.dSYM') for part in p.parts)]
    if len(binaries) != 3:
        raise RuntimeError('Expected exactly three test app/bundle binaries')
    write(raw/(args.label+'-source-binaries.json'), {'head':subprocess.check_output(['git','rev-parse','HEAD'],cwd=root,text=True).strip(),'configuration':args.configuration,'derivedData':str(derived),'sources':{str(p.relative_to(root)):digest(p) for p in sorted(source_paths)},'binaries':{str(p):digest(p) for p in sorted(binaries)}})
    gate_log = (raw/(args.label+'-gate.log')).open('w')
    gate = subprocess.Popen([sys.executable,str(Path(__file__).with_name('host_fault_gate.py')),'--group-container',str(group),'--fixture-receipt',str(receipt_path),'--idle-seconds','600'],stdout=gate_log,stderr=subprocess.STDOUT)
    control = Path('/tmp/pulpo-r33-settings-reset-native-control.json')
    tests = ['PulpoKeyboardUITests/'+name for name in ['LearningResetResultUITests','SuggestionForgetFeedbackTests','LearningForgetControllerTests','LearningForgetResultUITests','LearningClearScopeUITests']]
    if args.integration:
        tests += ['PulpoKeyboardAppTests/'+name for name in ['AccountLifecycleR35Tests','NativeContentTypePrivacyR38Tests','NativeContentTypeCalibrationR38Tests','CompanionWorkflowR24Tests']]
        tests += ['PulpoKeyboardUITests/'+name for name in ['NumericKeyboardControllerTests','SettingsUsabilitySweepTests','DraftNavigationTests']]
    code = None
    try:
        deadline = time.monotonic()+10
        while not control.exists():
            if gate.poll() is not None or time.monotonic() >= deadline:
                raise RuntimeError('Fault gate did not publish its control')
            time.sleep(.02)
        session = json.loads(control.read_text())
        if session.get('groupContainer') != str(group):
            raise RuntimeError('Control belongs to a different group')
        write(raw/(args.label+'-gate-session.json'),session)
        command = ['xcodebuild','test-without-building','-project',str(root/'apps/keyboard-ios/PulpoKeyboard.xcodeproj'),'-scheme','PulpoKeyboard','-configuration',args.configuration,'-destination','platform=iOS Simulator,id='+args.device,'-derivedDataPath',str(derived),'-parallel-testing-enabled','NO','-collect-test-diagnostics','never','-resultBundlePath',str(raw/(args.label+'.xcresult'))]
        command += ['-only-testing:'+name for name in tests]
        write(raw/(args.label+'-command.json'),command)
        with (raw/(args.label+'.log')).open('w') as log:
            code = subprocess.call(command,cwd=root,stdout=log,stderr=subprocess.STDOUT)
        try:
            gate_code = gate.wait(timeout=20)
        except subprocess.TimeoutExpired:
            gate.terminate()
            gate_code = gate.wait(timeout=10)
        bundle = raw/(args.label+'.xcresult')
        summary = json.loads(subprocess.check_output(['xcrun','xcresulttool','get','test-results','summary','--path',str(bundle),'--compact'],text=True))
        write(raw/(args.label+'-summary.json'),summary)
        markers = Path(session['root'])
        complete = json.loads((markers/'complete.json').read_text()) if (markers/'complete.json').exists() else None
        outcome = {'exit':code,'gateExit':gate_code,'testsRequested':tests,'summary':summary,'complete':complete,'markers':{p.name:json.loads(p.read_text()) for p in markers.glob('*.json')}}
        write(raw/(args.label+'-outcome.json'),outcome)
        print(json.dumps({'exit':code,'gateExit':gate_code,**{k:summary.get(k) for k in ['totalTestCount','passedTests','failedTests','skippedTests','testFailures']},'complete':complete}))
        if code != 0 or gate_code != 0 or complete is None:
            raise SystemExit(1)
    finally:
        if gate.poll() is None:
            gate.terminate()
            gate.wait(timeout=10)
        gate_log.close()

if __name__ == '__main__':
    main()
