import { spawn } from 'node:child_process'
import { cp, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { looksEncrypted } from './encryption.js'
import { planConversion, UnsupportedConversionError, type TargetFormat } from './formats.js'
import { registryModifications, seedProfile } from './profile.js'

export type ConversionErrorCode = 'unsupported_conversion' | 'unexpected_content' | 'encrypted' | 'conversion_failed' | 'timeout' | 'output_too_large' | 'aborted'

export class ConversionError extends Error {
  constructor(readonly code: ConversionErrorCode, message: string) {
    super(message)
  }
}

export interface SofficeOptions {
  /** The `soffice` executable. */
  sofficePath: string
  /** A private directory (tmpfs in the container) holding the template profile and job directories. */
  workRoot: string
  timeoutMs: number
  maxOutputBytes: number
  /** Linux only: the address-space limit (`ulimit -v`) for each LibreOffice process tree. */
  memoryLimitMb?: number
}

export interface ConversionJob {
  input: Uint8Array
  from: string
  to: TargetFormat
  signal?: AbortSignal
}

interface RunResult {
  exitCode: number | null
  output: string
  timedOut: boolean
  aborted: boolean
}

/** Logs only need the end of LibreOffice's chatter. */
const MAX_LOG_BYTES = 16 * 1024

const BASE_ARGUMENTS = ['--headless', '--invisible', '--nocrashreport', '--nodefault', '--nofirststartwizard', '--nolockcheck', '--nologo', '--norestore']

function profileUrl(directory: string): string {
  return `-env:UserInstallation=${pathToFileURL(directory).href}`
}

/**
 * LibreOffice inherits nothing from the service: no credentials, no proxy variables, and a home
 * and temporary directory inside the job, which is deleted afterwards.
 */
function jobEnvironment(directory: string): NodeJS.ProcessEnv {
  return {
    PATH: process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin',
    HOME: directory,
    TMPDIR: join(directory, 'tmp'),
    LANG: 'C.UTF-8',
    SAL_USE_VCLPLUGIN: 'svp',
  }
}

/** Kills the whole process group: soffice starts soffice.bin and helpers that outlive their parent. */
function killGroup(pid: number | undefined): void {
  if (!pid) return
  try {
    process.kill(-pid, 'SIGKILL')
  } catch {
    // Already gone.
  }
}

/**
 * Runs one LibreOffice process tree in its own process group. On timeout or abort the whole
 * group is killed, and it is killed again after a normal exit so no helper outlives the job.
 */
export function runSoffice(options: Pick<SofficeOptions, 'sofficePath' | 'timeoutMs' | 'memoryLimitMb'> & { maxFileBytes?: number }, directory: string, args: string[], signal?: AbortSignal): Promise<RunResult> {
  const limited = options.memoryLimitMb && process.platform === 'linux'
  const command = limited ? '/bin/sh' : options.sofficePath
  // Address space in KiB; file size in 512-byte blocks, so a hostile file cannot fill the tmpfs
  // (and the container's memory with it) before the output size is checked.
  const fileBlocks = Math.ceil((options.maxFileBytes ?? 1024 * 1024 * 1024) / 512)
  const commandArgs = limited
    ? ['-c', 'ulimit -c 0 && ulimit -v "$0" && ulimit -f "$1" && shift && exec "$@"', String(options.memoryLimitMb! * 1024), String(fileBlocks), options.sofficePath, ...args]
    : args
  return new Promise((resolve, reject) => {
    let output = ''
    let timedOut = false
    let aborted = false
    const child = spawn(command, commandArgs, { cwd: directory, env: jobEnvironment(directory), detached: true, stdio: ['ignore', 'pipe', 'pipe'] })
    const collect = (chunk: Buffer) => { output = (output + chunk.toString('utf8')).slice(-MAX_LOG_BYTES) }
    child.stdout.on('data', collect)
    child.stderr.on('data', collect)
    const timer = setTimeout(() => { timedOut = true; killGroup(child.pid) }, options.timeoutMs)
    const onAbort = () => { aborted = true; killGroup(child.pid) }
    signal?.addEventListener('abort', onAbort, { once: true })
    if (signal?.aborted) onAbort()
    child.once('error', (error) => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      reject(error)
    })
    child.once('close', (exitCode) => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      killGroup(child.pid)
      resolve({ exitCode, output, timedOut, aborted })
    })
  })
}

/**
 * Starts LibreOffice once with the locked settings so it builds a complete profile. Each job
 * copies it, which saves the first-start work and keeps jobs from sharing any state.
 */
export async function prepareTemplateProfile(options: SofficeOptions): Promise<string> {
  await mkdir(options.workRoot, { recursive: true, mode: 0o700 })
  const directory = join(options.workRoot, 'profile-template')
  await rm(directory, { recursive: true, force: true })
  await seedProfile(directory)
  await mkdir(join(options.workRoot, 'profile-init-tmp'), { recursive: true, mode: 0o700 })
  const result = await runSoffice({ ...options, timeoutMs: Math.max(options.timeoutMs, 120_000) }, join(options.workRoot, 'profile-init-tmp'), [profileUrl(directory), ...BASE_ARGUMENTS, '--terminate_after_init'])
  await rm(join(options.workRoot, 'profile-init-tmp'), { recursive: true, force: true })
  if (result.timedOut || result.exitCode !== 0) throw new Error(`LibreOffice could not start (exit ${result.exitCode}): ${result.output.trim().slice(-2_000)}`)
  // LibreOffice rewrites the file on exit; the locks must have survived it.
  const written = await readFile(join(directory, 'user', 'registrymodifications.xcu'), 'utf8')
  for (const line of registryModifications().split('\n').filter((item) => item.startsWith('<item '))) {
    const name = /oor:name="([^"]+)"/.exec(line)![1]!
    if (!written.includes(`oor:name="${name}"`)) throw new Error(`LibreOffice dropped the locked setting ${name}`)
  }
  return directory
}

async function outputFile(path: string, maxBytes: number): Promise<Uint8Array | null> {
  const info = await stat(path).catch(() => null)
  if (!info?.isFile()) return null
  if (info.size > maxBytes) throw new ConversionError('output_too_large', 'The converted file is too large')
  return readFile(path)
}

/** Converts one document in a fresh job directory with its own copy of the profile. */
export async function convertWithSoffice(options: SofficeOptions, templateProfile: string, job: ConversionJob): Promise<Uint8Array> {
  let plan: ReturnType<typeof planConversion>
  try {
    plan = planConversion(job.from, job.to, job.input)
  } catch (error) {
    if (error instanceof UnsupportedConversionError) throw new ConversionError(error.code, error.message)
    throw error
  }
  const directory = await mkdtemp(join(options.workRoot, 'job-'))
  try {
    const profile = join(directory, 'profile')
    await Promise.all([
      cp(templateProfile, profile, { recursive: true }),
      mkdir(join(directory, 'out'), { mode: 0o700 }),
      mkdir(join(directory, 'tmp'), { mode: 0o700 }),
    ])
    // A fixed name: the user's file name never reaches the command line or the file system.
    const input = join(directory, `input.${job.from}`)
    await writeFile(input, job.input, { mode: 0o600 })
    // Generous: LibreOffice spools uncompressed parts to temporary files while it writes a package,
    // and the output's own limit is checked afterwards.
    const result = await runSoffice({ ...options, maxFileBytes: Math.max(options.maxOutputBytes * 4, 512 * 1024 * 1024) }, directory, [
      profileUrl(profile), ...BASE_ARGUMENTS,
      `--infilter=${plan.importFilter}`, '--convert-to', plan.exportFilter, '--outdir', join(directory, 'out'), input,
    ], job.signal)
    if (result.aborted) throw new ConversionError('aborted', 'The conversion was cancelled')
    if (result.timedOut) throw new ConversionError('timeout', 'The conversion took too long')
    const converted = await outputFile(join(directory, 'out', `input.${job.to}`), options.maxOutputBytes)
    if (converted?.byteLength) return converted
    if (looksEncrypted(job.input)) throw new ConversionError('encrypted', 'This file is password-protected')
    throw new ConversionError('conversion_failed', 'This file could not be converted; it may be damaged')
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}
