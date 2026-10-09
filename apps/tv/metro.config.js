// The TV app shares mobile's data layer (`@/…` → apps/mobile/src) but runs on
// react-native-tvos, which npm installs as this workspace's own `react-native`.
const path = require('node:path')
const { getDefaultConfig } = require('expo/metro-config')

const config = getDefaultConfig(__dirname)
const tvReactNative = path.dirname(require.resolve('react-native/package.json', { paths: [__dirname] }))

// Phone-only native modules reached through shared mobile code. They are not
// linked into the tvOS binary, so their JS entry points resolve to no-op stubs.
const phoneOnlyModules = {
  'expo-sharing': 'expo-sharing.ts',
  'expo-web-browser': 'expo-web-browser.ts',
  'react-native-passkeys': 'react-native-passkeys.ts',
}

const resolveRequest = config.resolver.resolveRequest
config.resolver.resolveRequest = (context, moduleName, platform) => {
  const resolve = resolveRequest ?? context.resolveRequest
  if (moduleName === 'react-native' || moduleName.startsWith('react-native/')) {
    // Hoisted packages (expo, expo-modules-core, shared mobile code) must see
    // the TV fork, never the phone copy installed at the repository root.
    return resolve({ ...context, originModulePath: path.join(__dirname, 'index.ts') }, moduleName, platform)
  }
  const stub = phoneOnlyModules[moduleName]
  if (stub) return { type: 'sourceFile', filePath: path.join(__dirname, 'src/stubs', stub) }
  return resolve(context, moduleName, platform)
}
config.resolver.extraNodeModules = { ...config.resolver.extraNodeModules, 'react-native': tvReactNative }

module.exports = config
