import type { PackagerWindowsSignOptions } from '@electron/packager'

function requiredEnvironment(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is required for a signed Windows desktop release.`)
  return value
}

export function artifactSigningOptions(): PackagerWindowsSignOptions {
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
    hashes: ['sha256' as NonNullable<PackagerWindowsSignOptions['hashes']>[number]],
    description: 'Pulpo',
    website: 'https://isaacthoman.com',
    debug: true,
  }
}
