import type { ForgeConfig } from '@electron-forge/shared-types'
import { MakerDMG } from '@electron-forge/maker-dmg'
import { MakerSquirrel, type MakerSquirrelConfig } from '@electron-forge/maker-squirrel'
import { MakerZIP } from '@electron-forge/maker-zip'
import { VitePlugin } from '@electron-forge/plugin-vite'
import { artifactSigningOptions } from './windows-sign'

const releaseBuild = process.env.PULPO_DESKTOP_RELEASE === '1'
const macReleaseBuild = releaseBuild && process.platform === 'darwin'
const windowsReleaseBuild = releaseBuild && process.platform === 'win32'
const windowsSign = windowsReleaseBuild ? artifactSigningOptions() : undefined
const squirrelWindowsSign = windowsSign as unknown as MakerSquirrelConfig['windowsSign']

function requiredEnvironment(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is required for a desktop release build.`)
  return value
}

const config: ForgeConfig = {
  packagerConfig: {
    asar: true,
    name: 'Pulpo',
    executableName: 'Pulpo',
    icon: process.platform === 'win32'
      ? 'assets/Pulpo.ico'
      : ['assets/Pulpo.icns', '../mobile/assets/Pulpo.icon'],
    ...(process.platform === 'darwin' ? {
      appBundleId: 'com.isaacthoman.pulpo.desktop',
      appCategoryType: 'public.app-category.productivity',
      extendInfo: {
        LSMinimumSystemVersion: '13.0',
        NSAppTransportSecurity: { NSAllowsArbitraryLoads: false },
        NSMicrophoneUsageDescription: 'Allow Pulpo to use the microphone for dictation.',
        CFBundleURLTypes: [{
          CFBundleURLName: 'Pulpo authentication',
          CFBundleURLSchemes: ['pulpo'],
        }],
      },
    } : {}),
    ...(process.platform === 'win32' ? {
      win32metadata: {
        CompanyName: 'Isaac Thoman',
        FileDescription: 'Pulpo desktop application',
        ProductName: 'Pulpo',
        InternalName: 'Pulpo',
        OriginalFilename: 'Pulpo.exe',
      },
    } : {}),
    ...(macReleaseBuild ? {
      osxSign: {},
      osxNotarize: {
        appleApiKey: requiredEnvironment('APPLE_API_KEY_PATH'),
        appleApiKeyId: requiredEnvironment('APP_STORE_CONNECT_API_KEY_ID'),
        appleApiIssuer: requiredEnvironment('APP_STORE_CONNECT_API_ISSUER_ID'),
      },
    } : {}),
    ...(windowsSign ? { windowsSign } : {}),
  },
  makers: [
    new MakerZIP({}, ['darwin']),
    new MakerDMG({}, ['darwin']),
    new MakerSquirrel({
      name: 'Pulpo',
      authors: 'Isaac Thoman',
      owners: 'Isaac Thoman',
      description: 'Pulpo desktop application',
      setupExe: 'Setup.exe',
      setupIcon: 'assets/Pulpo.ico',
      // electron-winstaller resolves the CommonJS copy of @electron/windows-sign's
      // enum types, while Electron Packager resolves the ESM copy. The runtime
      // options are identical.
      ...(squirrelWindowsSign ? { windowsSign: squirrelWindowsSign } : {}),
    }, ['win32']),
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
