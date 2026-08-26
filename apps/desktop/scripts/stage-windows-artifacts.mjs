import { copyFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const WINDOWS_ARCHITECTURES = new Set(['x64', 'arm64'])

export async function stageWindowsArtifacts(inputDirectory, outputDirectory, arch) {
  if (!WINDOWS_ARCHITECTURES.has(arch)) throw new Error(`Unsupported Windows architecture: ${arch}`)

  const entries = await readdir(inputDirectory, { withFileTypes: true })
  const files = entries.filter((entry) => entry.isFile()).map((entry) => entry.name)
  const setupFiles = files.filter((name) => name.endsWith('Setup.exe'))
  const packageFiles = files.filter((name) => name.endsWith('-full.nupkg'))
  const manifests = files.filter((name) => name === 'RELEASES')
  if (files.length !== 3 || setupFiles.length !== 1 || packageFiles.length !== 1 || manifests.length !== 1) {
    throw new Error('Expected exactly one Setup EXE, one full NUPKG, and one RELEASES manifest.')
  }

  const packageMatch = packageFiles[0].match(/^.+-(\d+\.\d+\.\d+)-full\.nupkg$/)
  if (!packageMatch) throw new Error(`Could not determine the release version from ${packageFiles[0]}.`)

  const setupName = arch === 'x64' ? 'Setup.exe' : 'Pulpo-win32-arm64-Setup.exe'
  const installerName = `Pulpo-${packageMatch[1]}-Windows-${arch}-Setup.exe`
  const packageName = arch === 'x64'
    ? packageFiles[0]
    : `Pulpo-win32-arm64-${packageMatch[1]}-full.nupkg`
  const manifestName = arch === 'x64' ? 'RELEASES' : 'RELEASES-win32-arm64'
  const manifest = await readFile(path.join(inputDirectory, manifests[0]), 'utf8')
  if (!manifest.includes(packageFiles[0])) {
    throw new Error(`The RELEASES manifest does not reference ${packageFiles[0]}.`)
  }

  await mkdir(outputDirectory, { recursive: true })
  await Promise.all([
    copyFile(path.join(inputDirectory, setupFiles[0]), path.join(outputDirectory, setupName)),
    copyFile(path.join(inputDirectory, setupFiles[0]), path.join(outputDirectory, installerName)),
    copyFile(path.join(inputDirectory, packageFiles[0]), path.join(outputDirectory, packageName)),
    writeFile(path.join(outputDirectory, manifestName), manifest.replaceAll(packageFiles[0], packageName), 'utf8'),
  ])

  return { setupName, installerName, packageName, manifestName }
}

async function main() {
  const [inputDirectory, outputDirectory, arch] = process.argv.slice(2)
  if (!inputDirectory || !outputDirectory || !arch) {
    throw new Error('Usage: stage-windows-artifacts <input-directory> <output-directory> <x64|arm64>')
  }
  await stageWindowsArtifacts(path.resolve(inputDirectory), path.resolve(outputDirectory), arch)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
}
