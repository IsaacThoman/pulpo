import type { ForgeConfig } from '@electron-forge/shared-types'
import { MakerDMG } from '@electron-forge/maker-dmg'
import { MakerZIP } from '@electron-forge/maker-zip'
import { VitePlugin } from '@electron-forge/plugin-vite'

const releaseBuild = process.env.PULPO_DESKTOP_RELEASE === '1'

function requiredEnvironment(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is required for a desktop release build.`)
  return value
}

const config: ForgeConfig = {
  packagerConfig: {
    asar: true,
    name: 'Pulpo',
    appBundleId: 'com.isaacthoman.pulpo.desktop',
    appCategoryType: 'public.app-category.productivity',
    icon: [
      'assets/Pulpo.icns',
      '../mobile/assets/Pulpo.icon',
    ],
    extendInfo: {
      LSMinimumSystemVersion: '13.0',
      NSAppTransportSecurity: { NSAllowsArbitraryLoads: false },
      NSMicrophoneUsageDescription: 'Allow Pulpo to use the microphone for dictation.',
      CFBundleURLTypes: [{
        CFBundleURLName: 'Pulpo authentication',
        CFBundleURLSchemes: ['pulpo'],
      }],
    },
    ...(releaseBuild ? {
      osxSign: {},
      osxNotarize: {
        appleApiKey: requiredEnvironment('APPLE_API_KEY_PATH'),
        appleApiKeyId: requiredEnvironment('APP_STORE_CONNECT_API_KEY_ID'),
        appleApiIssuer: requiredEnvironment('APP_STORE_CONNECT_API_ISSUER_ID'),
      },
    } : {}),
  },
  makers: [
    new MakerZIP({}, ['darwin']),
    new MakerDMG({}, ['darwin']),
  ],
  plugins: [new VitePlugin({
    build: [
      { entry: 'src/main.ts', config: 'vite.main.config.mjs', target: 'main' },
      { entry: 'src/preload.ts', config: 'vite.preload.config.mjs', target: 'preload' },
    ],
    renderer: [{ name: 'main_window', config: 'vite.renderer.config.mjs' }],
  })],
}

export default config
