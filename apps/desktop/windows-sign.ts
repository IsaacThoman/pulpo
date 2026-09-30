import type { Options } from '@electron/packager'

type WindowsSignOptions = Extract<Options['windowsSign'], object>
type WindowsSigningHash = NonNullable<WindowsSignOptions['hashes']>[number]

function requiredEnvironment(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is required for a signed Windows desktop release.`)
  return value
}

export function artifactSigningOptions(): WindowsSignOptions {
  return {
    signToolPath: requiredEnvironment('WINDOWS_SIGNTOOL_PATH'),
    signWithParams: [
      '/v',
      '/dlib',
      requiredEnvironment('AZURE_CODE_SIGNING_DLIB'),
      '/dmdf',
      requiredEnvironment('AZURE_ARTIFACT_SIGNING_METADATA'),
    ],
    timestampServer: 'http://timestamp.acs.microsoft.com/',
    hashes: ['sha256' as WindowsSigningHash],
    description: 'Pulpo',
    website: 'https://isaacthoman.com',
    debug: true,
  }
}
