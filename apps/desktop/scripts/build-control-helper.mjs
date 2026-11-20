import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, readdir, rename, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Builds the macOS helper that sees and controls other apps (native/macos, plain Swift files) into
 * one universal binary, native/build/macos/pulpo-control, for Apple silicon and Intel Macs. It needs
 * Xcode or the Command Line Tools. The binary is rebuilt only when a source is newer than it.
 *
 *   node apps/desktop/scripts/build-control-helper.mjs [--force]
 */

const desktop = path.resolve(import.meta.dirname, '..')
const sourceDir = path.join(desktop, 'native', 'macos')
const outputDir = path.join(desktop, 'native', 'build', 'macos')
export const CONTROL_HELPER_PATH = path.join(outputDir, 'pulpo-control')

/** macOS 13 is the oldest system the helper runs on; newer APIs are checked for at run time. */
const DEPLOYMENT_TARGET = '13.0'
const ARCHITECTURES = ['arm64', 'x86_64']

/** Returns the binary's path, or null on a system other than macOS, where there is nothing to build. */
export async function buildControlHelper({ force = false } = {}) {
  if (process.platform !== 'darwin') return null
  const sources = (await readdir(sourceDir)).filter((name) => name.endsWith('.swift')).sort().map((name) => path.join(sourceDir, name))
  if (sources.length === 0) throw new Error(`No Swift sources in ${sourceDir}.`)
  if (!force && await isFresh(CONTROL_HELPER_PATH, [...sources, fileURLToPath(import.meta.url)])) return CONTROL_HELPER_PATH

  const swiftc = await findSwiftc()
  await mkdir(outputDir, { recursive: true })
  const work = await mkdtemp(path.join(tmpdir(), 'pulpo-control-'))
  try {
    const slices = []
    for (const arch of ARCHITECTURES) {
      const slice = path.join(work, `pulpo-control-${arch}`)
      await run('xcrun', [
        '--sdk', 'macosx', swiftc,
        '-O', '-swift-version', '5',
        '-target', `${arch}-apple-macos${DEPLOYMENT_TARGET}`,
        '-module-name', 'PulpoControl',
        '-o', slice,
        ...sources,
      ])
      slices.push(slice)
    }
    const universal = path.join(work, 'pulpo-control')
    await run('xcrun', ['lipo', '-create', '-output', universal, ...slices])
    // Moved into place whole, so a build that fails halfway never leaves a broken binary behind.
    await rename(universal, CONTROL_HELPER_PATH).catch(async (error) => {
      if (error.code !== 'EXDEV') throw error
      await run('cp', [universal, CONTROL_HELPER_PATH])
    })
  } finally {
    await rm(work, { recursive: true, force: true })
  }
  return CONTROL_HELPER_PATH
}

async function isFresh(binary, inputs) {
  const built = await stat(binary).catch(() => null)
  if (!built) return false
  for (const input of inputs) {
    if ((await stat(input)).mtimeMs > built.mtimeMs) return false
  }
  return true
}

async function findSwiftc() {
  try {
    const found = (await run('xcrun', ['--sdk', 'macosx', '--find', 'swiftc'], { capture: true })).trim()
    if (found) return found
  } catch {
    // Explained below.
  }
  throw new Error('Building the Pulpo control helper needs the Swift compiler (swiftc), which was not found. Install Xcode, or the Command Line Tools with `xcode-select --install`.')
}

function run(command, args, { capture = false } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: capture ? ['ignore', 'pipe', 'pipe'] : ['ignore', 'inherit', 'inherit'] })
    let stdout = ''
    let stderr = ''
    child.stdout?.on('data', (chunk) => { stdout += chunk })
    child.stderr?.on('data', (chunk) => { stderr += chunk })
    child.on('error', (error) => {
      reject(error.code === 'ENOENT' ? new Error(`\`${command}\` was not found; install Xcode or the Command Line Tools.`) : error)
    })
    child.on('exit', (code, signal) => {
      if (code === 0) resolve(stdout)
      else reject(new Error(`${command} ${args.slice(0, 3).join(' ')}… failed (${signal ?? `exit ${code}`})${stderr ? `:\n${stderr.trim()}` : '.'}`))
    })
  })
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const binary = await buildControlHelper({ force: process.argv.includes('--force') })
    console.log(binary ? `Built ${path.relative(process.cwd(), binary) || binary}` : 'The control helper is built on macOS only; nothing to do.')
  } catch (error) {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  }
}
