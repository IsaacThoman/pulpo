import { existsSync } from 'node:fs'
import { cp, mkdir, readdir, rm } from 'node:fs/promises'
import path from 'node:path'
import type { ForgeConfig } from '@electron-forge/shared-types'
import { MakerDMG } from '@electron-forge/maker-dmg'
import { MakerSquirrel, type MakerSquirrelConfig } from '@electron-forge/maker-squirrel'
import { MakerZIP } from '@electron-forge/maker-zip'
import { VitePlugin } from '@electron-forge/plugin-vite'
import { buildControlHelper } from './scripts/build-control-helper.mjs'
import { artifactSigningOptions } from './windows-sign'

const releaseBuild = process.env.PULPO_DESKTOP_RELEASE === '1'
const macReleaseBuild = releaseBuild && process.platform === 'darwin'
const windowsReleaseBuild = releaseBuild && process.platform === 'win32'
const windowsSign = windowsReleaseBuild ? artifactSigningOptions() : undefined
const squirrelWindowsSign = windowsSign as unknown as MakerSquirrelConfig['windowsSign']

/**
 * The helper that lets the agent see and work in other apps (src/computer/control), as it ships:
 * on macOS one universal binary compiled from `native/macos`, on Windows the sources in
 * `native/windows`, which Windows PowerShell compiles when the helper starts. Paths are relative to
 * this folder, where Forge runs.
 */
const controlHelperResource = process.platform === 'darwin'
  ? path.resolve('native/build/macos/pulpo-control')
  : process.platform === 'win32' ? path.resolve('native/build/windows/pulpo-control') : null

async function prepareControlHelper(): Promise<void> {
  if (process.platform === 'darwin') await buildControlHelper()
  if (process.platform !== 'win32' || !controlHelperResource) return
  const sources = path.resolve('native/windows')
  await rm(controlHelperResource, { recursive: true, force: true })
  await mkdir(controlHelperResource, { recursive: true })
  for (const name of await readdir(sources)) {
    if (/\.(ps1|cs)$/i.test(name)) await cp(path.join(sources, name), path.join(controlHelperResource, name))
  }
}

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
    ...(controlHelperResource ? { extraResource: [controlHelperResource] } : {}),
    ...(process.platform === 'darwin' ? {
      appBundleId: 'com.isaacthoman.pulpo.desktop',
      appCategoryType: 'public.app-category.productivity',
      extendInfo: {
        LSMinimumSystemVersion: '13.0',
        NSAppTransportSecurity: { NSAllowsArbitraryLoads: false },
        NSMicrophoneUsageDescription: 'Allow Pulpo to use the microphone for dictation.',
        // "This computer": the agent works with files in folders the user chooses, or anywhere with Full access.
        NSDesktopFolderUsageDescription: 'Pulpo Agent works with files in folders you choose.',
        NSDocumentsFolderUsageDescription: 'Pulpo Agent works with files in folders you choose.',
        NSDownloadsFolderUsageDescription: 'Pulpo Agent works with files in folders you choose.',
        NSRemovableVolumesUsageDescription: 'Pulpo Agent works with files on drives you choose.',
        NSNetworkVolumesUsageDescription: 'Pulpo Agent works with files on network drives you choose.',
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
  hooks: {
    // Before the app is started from a checkout or packaged. A checkout without the tools to build
    // the helper still runs, without the app tools; a package is never made without it.
    generateAssets: async () => {
      await prepareControlHelper().catch((error: unknown) => {
        console.warn(`The helper that controls apps was not built: ${error instanceof Error ? error.message : String(error)}`)
      })
    },
    prePackage: async () => {
      if (controlHelperResource && !existsSync(controlHelperResource)) {
        throw new Error(`The helper that controls apps is missing (${controlHelperResource}). On macOS it needs the Xcode command line tools to build.`)
      }
    },
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
      // `pulpo files` for full-access commands on the user's computer: the workspace daemon's CLI as one file, .vite/build/pulpo-cli.cjs.
      { entry: 'src/computer/pulpo-cli.ts', config: 'vite.cli.config.mjs', target: 'main' },
    ],
    renderer: [{ name: 'main_window', config: 'vite.renderer.config.mjs' }],
  })],
}

export default config
