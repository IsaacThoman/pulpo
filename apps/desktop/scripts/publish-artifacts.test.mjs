import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { publishArtifacts } from './publish-artifacts.mjs'

vi.mock('node:child_process', () => ({ execFileSync: vi.fn() }))

const directories = []
const macArmAssets = ['Pulpo-darwin-arm64-1.2.3.zip', 'Pulpo-1.2.3-macOS-arm64.dmg']
const platformAssets = [
  ['macOS', 'arm64', macArmAssets],
  ['macOS', 'x64', ['Pulpo-darwin-x64-1.2.3.zip', 'Pulpo-1.2.3-macOS-x64.dmg']],
  ['Windows', 'x64', ['Setup.exe', 'Pulpo-1.2.3-Windows-x64-Setup.exe', 'Pulpo-1.2.3-full.nupkg', 'RELEASES']],
  ['Windows', 'arm64', ['Pulpo-win32-arm64-Setup.exe', 'Pulpo-1.2.3-Windows-arm64-Setup.exe', 'Pulpo-win32-arm64-1.2.3-full.nupkg', 'RELEASES-win32-arm64']],
]

async function fixture(names) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'pulpo-publish-artifacts-'))
  directories.push(directory)
  for (const name of names) {
    const file = path.join(directory, name)
    await mkdir(path.dirname(file), { recursive: true })
    await writeFile(file, 'verified artifact')
  }
  return { directory, platform: 'macOS', arch: 'arm64', version: '1.2.3', repository: 'IsaacThoman/pulpo' }
}

afterEach(async () => {
  vi.resetAllMocks()
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe('publishArtifacts', () => {
  it.each(platformAssets)('publishes %s/%s without sibling platform artifacts', async (platform, arch, names) => {
    const options = await fixture(names)
    await publishArtifacts({ ...options, platform, arch })
    expect(execFileSync).toHaveBeenCalledOnce()
    const [command, args, spawnOptions] = vi.mocked(execFileSync).mock.calls[0]
    expect(command).toBe('gh')
    expect(args.slice(0, 3)).toEqual(['release', 'upload', 'v1.2.3'])
    expect(args.slice(3, -3).sort()).toEqual(names.map((name) => path.join(options.directory, name)).sort())
    expect(args.slice(-3)).toEqual(['--clobber', '--repo', 'IsaacThoman/pulpo'])
    expect(spawnOptions).toEqual({ stdio: 'inherit' })
  })

  it('finds macOS assets in separate Forge output subdirectories', async () => {
    const options = await fixture([`zip/darwin/arm64/${macArmAssets[0]}`, `dmg/${macArmAssets[1]}`])
    await publishArtifacts(options)
    expect(execFileSync).toHaveBeenCalledOnce()
  })

  it.each([
    ['missing DMG', [macArmAssets[0]]],
    ['duplicate ZIP', [...macArmAssets, `nested/${macArmAssets[0]}`]],
    ['wrong version', ['Pulpo-darwin-arm64-1.2.4.zip', macArmAssets[1]]],
    ['wrong architecture', ['Pulpo-darwin-x64-1.2.3.zip', macArmAssets[1]]],
    ['unexpected platform asset', [...macArmAssets, 'Setup.exe']],
  ])('rejects %s before uploading anything', async (_name, names) => {
    await expect(publishArtifacts(await fixture(names))).rejects.toThrow('Expected exactly')
    expect(execFileSync).not.toHaveBeenCalled()
  })

  it.each(platformAssets.filter(([platform]) => platform === 'Windows'))('rejects an incomplete %s/%s update bundle', async (platform, arch, names) => {
    const options = await fixture(names.slice(0, -1))
    await expect(publishArtifacts({ ...options, platform, arch })).rejects.toThrow('Expected exactly')
    expect(execFileSync).not.toHaveBeenCalled()
  })

  it('surfaces upload failures so the platform job can be retried', async () => {
    vi.mocked(execFileSync).mockImplementationOnce(() => { throw new Error('upload failed') })
    await expect(publishArtifacts(await fixture(macArmAssets))).rejects.toThrow('upload failed')
  })
})
