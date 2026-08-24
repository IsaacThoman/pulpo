import type { ForgeConfig } from '@electron-forge/shared-types'
import { MakerZIP } from '@electron-forge/maker-zip'
import { VitePlugin } from '@electron-forge/plugin-vite'

const config: ForgeConfig = {
  packagerConfig: {
    asar: true,
    name: 'Pulpo',
    appBundleId: 'com.isaacthoman.pulpo.desktop',
    appCategoryType: 'public.app-category.productivity',
    icon: 'assets/Pulpo',
    extendInfo: {
      LSMinimumSystemVersion: '13.0',
      NSAppTransportSecurity: { NSAllowsArbitraryLoads: false },
      NSMicrophoneUsageDescription: 'Allow Pulpo to use the microphone for dictation.',
      CFBundleURLTypes: [{
        CFBundleURLName: 'Pulpo authentication',
        CFBundleURLSchemes: ['pulpo'],
      }],
    },
  },
  makers: [new MakerZIP({}, ['darwin'])],
  plugins: [new VitePlugin({
    build: [
      { entry: 'src/main.ts', config: 'vite.main.config.mjs', target: 'main' },
      { entry: 'src/preload.ts', config: 'vite.preload.config.mjs', target: 'preload' },
    ],
    renderer: [{ name: 'main_window', config: 'vite.renderer.config.mjs' }],
  })],
}

export default config
