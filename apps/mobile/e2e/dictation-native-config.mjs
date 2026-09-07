// Validate the resolved plugin output, including image-picker/audio interactions.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
const cwd = fileURLToPath(new URL('..', import.meta.url))
const expo = fileURLToPath(new URL('../../../node_modules/expo/bin/cli', import.meta.url))
const config = JSON.parse(execFileSync(process.execPath, [expo, 'config', '--type', 'introspect', '--json'], {
  cwd, encoding: 'utf8', maxBuffer: 10 * 1024 * 1024,
}))
const microphone = config._internal.modResults.android.manifest.manifest['uses-permission']
  .filter((permission) => permission.$['android:name'] === 'android.permission.RECORD_AUDIO')
assert(microphone.length > 0, 'Android must declare microphone permission')
assert(microphone.every((permission) => permission.$['tools:node'] !== 'remove'), 'A plugin must not remove microphone permission')
const plist = config._internal.modResults.ios.infoPlist
assert.match(plist.NSMicrophoneUsageDescription, /dictation/i)
assert(!plist.UIBackgroundModes?.includes('audio'), 'Dictation must not enable background audio')
console.log('Passed: resolved iOS/Android microphone permissions and foreground-only audio.')
