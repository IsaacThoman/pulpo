import { execFileSync } from 'node:child_process'
import { readdir } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

async function artifactFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = await Promise.all(entries.map(async (entry) => {
    const file = path.join(directory, entry.name)
    if (entry.isDirectory()) return artifactFiles(file)
    if (entry.isFile() && /(?:\.zip|\.dmg|Setup\.exe|-full\.nupkg)$|^RELEASES/.test(entry.name)) return [file]
    return []
  }))
  return files.flat()
}

export async function publishArtifacts({ directory, platform, arch, version, repository }) {
  if (!/^\d+\.\d+\.\d+$/.test(version ?? '')) throw new Error('Invalid release version.')
  if (!['macOS', 'Windows'].includes(platform)) throw new Error(`Unsupported desktop platform: ${platform}`)
  if (!['x64', 'arm64'].includes(arch)) throw new Error(`Unsupported desktop architecture: ${arch}`)
  if (!repository) throw new Error('The GitHub repository is required.')

  const expected = platform === 'macOS'
    ? [
        `Pulpo-darwin-${arch}-${version}.zip`,
        `Pulpo-${version}-macOS-${arch}.dmg`,
      ]
    : [
        arch === 'x64' ? 'Setup.exe' : 'Pulpo-win32-arm64-Setup.exe',
        `Pulpo-${version}-Windows-${arch}-Setup.exe`,
        arch === 'x64' ? `Pulpo-${version}-full.nupkg` : `Pulpo-win32-arm64-${version}-full.nupkg`,
        arch === 'x64' ? 'RELEASES' : 'RELEASES-win32-arm64',
      ]
  const artifacts = await artifactFiles(directory)
  const names = artifacts.map((file) => path.basename(file))
  if (names.length !== expected.length || expected.some((name) => names.filter((actual) => actual === name).length !== 1)) {
    throw new Error(`Expected exactly the ${platform}/${arch} release assets: ${expected.join(', ')}; found: ${names.join(', ')}`)
  }

  execFileSync('gh', [
    'release', 'upload', `v${version}`, ...artifacts, '--clobber', '--repo', repository,
  ], { stdio: 'inherit' })
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  publishArtifacts({
    directory: process.env.DESKTOP_ARTIFACT_DIRECTORY,
    platform: process.env.DESKTOP_PLATFORM,
    arch: process.env.DESKTOP_ARCH,
    version: process.env.RELEASE_VERSION,
    repository: process.env.GITHUB_REPOSITORY,
  }).catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
}
