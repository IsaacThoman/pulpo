const path = require('node:path')
const { getDefaultConfig } = require('expo/metro-config')

const config = getDefaultConfig(__dirname)

/**
 * Module replacements for React Native:
 * - `lib0/webcrypto`: lib0 (used by Yjs) maps it to `isomorphic-webcrypto` under React Native,
 *   which is not installed. The replacement draws random values from expo-crypto.
 */
const replacements = new Map([
  ['lib0/webcrypto', path.resolve(__dirname, 'src/polyfills/lib0-webcrypto.ts')],
])

const resolveRequest = config.resolver.resolveRequest
config.resolver.resolveRequest = (context, moduleName, platform) => {
  const replacement = replacements.get(moduleName)
  if (replacement) return { type: 'sourceFile', filePath: replacement }
  return (resolveRequest ?? context.resolveRequest)(context, moduleName, platform)
}

module.exports = config
