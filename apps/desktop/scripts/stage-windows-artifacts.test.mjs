import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { stageWindowsArtifacts } from './stage-windows-artifacts.mjs'

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'pulpo-windows-artifacts-'))
  const input = path.join(root, 'input')
  const output = path.join(root, 'output')
  await mkdir(input)
  await writeFile(path.join(input, 'Setup.exe'), 'signed installer')
  await writeFile(path.join(input, 'Pulpo-1.2.3-full.nupkg'), 'signed package')
  await writeFile(path.join(input, 'RELEASES'), 'ABC Pulpo-1.2.3-full.nupkg 14')
  return { input, output }
}

describe('stageWindowsArtifacts', () => {
  it.each([
    ['x64', 'Setup.exe', 'Pulpo-1.2.3-Windows-x64-Setup.exe', 'Pulpo-1.2.3-full.nupkg', 'RELEASES'],
    ['arm64', 'Pulpo-win32-arm64-Setup.exe', 'Pulpo-1.2.3-Windows-arm64-Setup.exe', 'Pulpo-win32-arm64-1.2.3-full.nupkg', 'RELEASES-win32-arm64'],
  ])('stages collision-free %s release assets', async (arch, setupName, installerName, packageName, manifestName) => {
    const { input, output } = await fixture()
    const names = await stageWindowsArtifacts(input, output, arch)
    expect(names).toEqual({
      setupName,
      installerName,
      packageName,
      manifestName,
    })
    expect((await readdir(output)).sort()).toEqual([
      manifestName,
      packageName,
      setupName,
      installerName,
    ].sort())
    expect(await readFile(path.join(output, installerName), 'utf8'))
      .toBe(await readFile(path.join(output, setupName), 'utf8'))
    expect(await readFile(path.join(output, manifestName), 'utf8'))
      .toBe(`ABC ${packageName} 14`)
  })

  it('rejects an incomplete Squirrel output', async () => {
    const { input, output } = await fixture()
    await writeFile(path.join(input, 'unexpected.txt'), 'unexpected')
    await expect(stageWindowsArtifacts(input, output, 'arm64'))
      .rejects.toThrow('Expected exactly one Setup EXE, one full NUPKG, and one RELEASES manifest.')
  })
})
