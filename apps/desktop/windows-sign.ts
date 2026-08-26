import type { WindowsSignOptions } from '@electron/packager'
import type { HASHES } from '@electron/windows-sign/dist/esm/types'

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
    hashes: ['sha256' as HASHES],
    description: 'Pulpo',
    website: 'https://isaacthoman.com',
    debug: true,
  }
}
