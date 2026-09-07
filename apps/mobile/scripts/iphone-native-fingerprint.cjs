const { createFingerprintAsync, SourceSkips } = require('expo/fingerprint')

// Generated native output must not invalidate its own inputs. Include all config
// fields (including build numbers) and assets consumed by Pulpo's custom plugins.
createFingerprintAsync(process.cwd(), {
  platforms: ['ios'],
  ignorePaths: ['ios', 'ios/**/*', 'android', 'android/**/*'],
  sourceSkips: SourceSkips.None,
  extraSources: [
    { type: 'dir', filePath: 'assets', reasons: ['pulpoNativeAssets'] },
    { type: 'dir', filePath: 'plugins', reasons: ['pulpoNativePlugins'] },
  ],
  silent: true,
}).then(({ hash }) => {
  process.stdout.write(hash)
}).catch((error) => {
  console.error(error)
  process.exitCode = 1
})
