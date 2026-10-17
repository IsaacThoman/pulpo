#!/usr/bin/env python3
"""Enable software-keyboard testing on one headless iOS Simulator.

The Simulator GUI's hardware-keyboard preference does not configure devices
booted without Simulator.app. Use CoreSimulator's host API, never app code.
Pass --enable-hardware to restore the simulated hardware keyboard afterward.
"""

import argparse
from pathlib import Path
import subprocess
import tempfile
import uuid


SOURCE = r'''
#import <Foundation/Foundation.h>
#import <objc/runtime.h>
#import <dlfcn.h>

@interface NSObject (PKSimulatorAccess)
+ (id)sharedServiceContextForDeveloperDir:(NSString *)directory error:(NSError **)error;
- (id)defaultDeviceSetWithError:(NSError **)error;
- (NSArray *)availableDevices;
- (NSUUID *)UDID;
- (BOOL)setHardwareKeyboardEnabled:(BOOL)enabled keyboardType:(unsigned char)type error:(NSError **)error;
@end

int main(int argc, const char **argv) {
  @autoreleasepool {
    if (argc != 4) return 2;
    if (!dlopen("/Library/Developer/PrivateFrameworks/CoreSimulator.framework/Versions/A/CoreSimulator", RTLD_NOW)) {
      fprintf(stderr, "CoreSimulator unavailable: %s\n", dlerror()); return 1;
    }
    Class service = NSClassFromString(@"SimServiceContext");
    if (![service respondsToSelector:@selector(sharedServiceContextForDeveloperDir:error:)]) {
      fprintf(stderr, "CoreSimulator service API unavailable\n"); return 1;
    }
    NSError *error = nil;
    id context = [service sharedServiceContextForDeveloperDir:[NSString stringWithUTF8String:argv[2]] error:&error];
    id set = [context defaultDeviceSetWithError:&error];
    NSString *target = [NSString stringWithUTF8String:argv[1]];
    for (id device in [set availableDevices]) {
      if (![[[device UDID] UUIDString] isEqualToString:target]) continue;
      SEL selector = @selector(setHardwareKeyboardEnabled:keyboardType:error:);
      if (![device respondsToSelector:selector]) {
        fprintf(stderr, "Hardware keyboard control unavailable\n"); return 1;
      }
      BOOL enabled = strcmp(argv[3], "enable") == 0;
      if (![device setHardwareKeyboardEnabled:enabled keyboardType:0 error:&error]) {
        fprintf(stderr, "%s\n", [[error description] UTF8String]); return 1;
      }
      printf("%s hardware keyboard for %s\n", enabled ? "Enabled" : "Disabled", argv[1]);
      return 0;
    }
    fprintf(stderr, "Target simulator not found: %s\n", [[error description] UTF8String]);
    return 1;
  }
}
'''


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('device', help='Exact iOS Simulator UDID; physical devices are not supported')
    parser.add_argument('--enable-hardware', action='store_true')
    args = parser.parse_args()
    try:
        device = str(uuid.UUID(args.device)).upper()
    except ValueError:
        parser.error('device must be an iOS Simulator UUID')
    developer = subprocess.check_output(['xcode-select', '-p'], text=True).strip()
    with tempfile.TemporaryDirectory(prefix='pulpo-simulator-keyboard-') as temporary:
        source = Path(temporary) / 'keyboard.m'
        binary = Path(temporary) / 'keyboard'
        source.write_text(SOURCE)
        subprocess.run(['xcrun', 'clang', '-fobjc-arc', '-framework', 'Foundation',
                        str(source), '-o', str(binary)], check=True)
        subprocess.run([str(binary), device, developer,
                        'enable' if args.enable_hardware else 'disable'], check=True)


if __name__ == '__main__':
    main()
