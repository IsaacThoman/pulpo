import { spawn as nodeSpawn, type ChildProcess, type SpawnOptions } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'

/**
 * Everything that differs between macOS/Linux and Windows when running the agent's commands. The
 * platform is always passed in, so both branches are tested on any machine.
 */

export type Spawn = (command: string, args: string[], options: SpawnOptions) => ChildProcess

export function computerOs(platform: NodeJS.Platform): 'macos' | 'windows' | 'linux' {
  return platform === 'darwin' ? 'macos' : platform === 'win32' ? 'windows' : 'linux'
}

/** Windows 11 still reports itself as 10.0; its builds start at 22000. */
export function osVersionLabel(platform: NodeJS.Platform, version: string): string {
  if (platform === 'darwin') return `macOS ${version}`
  if (platform !== 'win32') return `Linux ${version}`
  const build = Number(version.split('.')[2])
  return `Windows ${Number.isFinite(build) && build >= 22_000 ? '11' : '10'} (${version})`
}

/** "this Mac" / "this PC", for the native confirmation. */
export function computerNoun(platform: NodeJS.Platform): string {
  return platform === 'darwin' ? 'this Mac' : platform === 'win32' ? 'this PC' : 'this computer'
}

export interface CommandShell {
  /** Executable to spawn. */
  path: string
  /** Shown to the agent: `zsh`, `bash`, `pwsh`, `powershell`, … */
  name: string
}

/** Finds an executable on a PATH value without spawning anything. */
export function findOnPath(executable: string, pathValue: string | undefined, platform: NodeJS.Platform, exists: (file: string) => boolean = existsSync): string | null {
  const paths = platform === 'win32' ? path.win32 : path.posix
  for (const directory of (pathValue ?? '').split(platform === 'win32' ? ';' : ':')) {
    if (!directory) continue
    const candidate = paths.join(directory.replace(/^"(.*)"$/, '$1'), executable)
    if (exists(candidate)) return candidate
  }
  return null
}

function windowsPath(env: NodeJS.ProcessEnv): string | undefined {
  // Windows environment names are case-insensitive; Node keeps whatever case the parent used.
  return Object.entries(env).find(([key]) => key.toLowerCase() === 'path')?.[1]
}

/** The user's own shell: their login shell on macOS/Linux; PowerShell 7 when installed on Windows, else Windows PowerShell. */
export function commandShell(platform: NodeJS.Platform, env: NodeJS.ProcessEnv, exists: (file: string) => boolean = existsSync): CommandShell {
  if (platform === 'win32') {
    const pwsh = findOnPath('pwsh.exe', windowsPath(env), platform, exists)
    if (pwsh) return { path: pwsh, name: 'pwsh' }
    const root = env.SystemRoot ?? env.SYSTEMROOT ?? 'C:\\Windows'
    const builtIn = path.win32.join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
    return { path: exists(builtIn) ? builtIn : 'powershell.exe', name: 'powershell' }
  }
  const candidates = [env.SHELL, '/bin/zsh', '/bin/bash', '/bin/sh']
  const shell = candidates.find((candidate): candidate is string => Boolean(candidate && path.posix.isAbsolute(candidate) && exists(candidate))) ?? '/bin/sh'
  return { path: shell, name: path.posix.basename(shell) }
}

export const WINDOWS_SHELL_ARGS = ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass']

/**
 * The script a command runs as on Windows. A file passed with `-File` avoids every quoting rule of
 * the command line; the BOM makes Windows PowerShell read it as UTF-8 rather than the ANSI code
 * page. The preamble makes output UTF-8 and the trailer turns the command's outcome into the
 * process exit code (PowerShell otherwise exits 0 after a failing native command).
 */
export function windowsCommandScript(command: string): string {
  return [
    '\uFEFF$ErrorActionPreference = \'Continue\'',
    '$ProgressPreference = \'SilentlyContinue\'',
    '$__pulpoUtf8 = New-Object System.Text.UTF8Encoding $false',
    '[Console]::OutputEncoding = $__pulpoUtf8',
    '$OutputEncoding = $__pulpoUtf8',
    '$global:LASTEXITCODE = 0',
    command,
    '$__pulpoSucceeded = $?',
    'if ($global:LASTEXITCODE -is [int] -and $global:LASTEXITCODE -ne 0) { exit $global:LASTEXITCODE }',
    'if (-not $__pulpoSucceeded) { exit 1 }',
    'exit 0',
    '',
  ].join('\r\n')
}

export interface ShellInvocation {
  file: string
  args: string[]
  /** macOS/Linux: its own process group, so the whole tree can be signalled. */
  detached: boolean
  /** Windows: write this to `scriptPath` before spawning and delete it afterwards. */
  script?: string
}

export function shellInvocation(platform: NodeJS.Platform, shell: CommandShell, command: string, scriptPath?: string): ShellInvocation {
  if (platform === 'win32') {
    if (!scriptPath) throw new Error('A script path is required on Windows')
    return { file: shell.path, args: [...WINDOWS_SHELL_ARGS, '-File', scriptPath], detached: false, script: windowsCommandScript(command) }
  }
  return { file: shell.path, args: ['-c', command], detached: true }
}

/** Ends a command and everything it started. */
export function killProcessTree(platform: NodeJS.Platform, child: ChildProcess, signal: NodeJS.Signals, spawn: Spawn = nodeSpawn): void {
  if (!child.pid) return
  const exited = child.exitCode !== null || child.signalCode !== null
  if (platform === 'win32') {
    // taskkill finds the tree through the parent, so there is nothing to ask once that is gone.
    if (exited) return
    try {
      const killer = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true })
      killer.on('error', () => child.kill())
    } catch { child.kill() }
    return
  }
  // The shell may be gone while something it started lives on in its process group, holding the
  // output pipes open so the command never ends: signal the group whatever became of the shell.
  try { process.kill(-child.pid, signal) } catch {
    if (!exited) { try { child.kill(signal) } catch { /* already exited */ } }
  }
}

/**
 * Kills whatever is left of a command's process group on macOS/Linux, where the shell may be gone
 * while something it started lives on (or ignored the polite signal). Windows needs none of this:
 * `taskkill /T /F` already forces the whole tree.
 */
export function forceKillGroup(platform: NodeJS.Platform, pid: number | undefined): void {
  if (platform === 'win32' || !pid) return
  try { process.kill(-pid, 'SIGKILL') } catch { /* nothing left */ }
}

/** Whether anything is still running in a command's process group (macOS/Linux; always false on Windows, which has none). */
export function processGroupAlive(platform: NodeJS.Platform, pid: number | undefined): boolean {
  if (platform === 'win32' || !pid) return false
  try { process.kill(-pid, 0); return true } catch (error) { return (error as NodeJS.ErrnoException).code === 'EPERM' }
}

/** Asks a command's process group to stop (macOS/Linux). */
export function stopGroup(platform: NodeJS.Platform, pid: number | undefined): void {
  if (platform === 'win32' || !pid) return
  try { process.kill(-pid, 'SIGTERM') } catch { /* nothing left */ }
}

const ENV_MARK = '__PULPO_ENV_7f3a__'

/** Parses `env -0` output printed between two marks, ignoring anything the shell's startup files printed around it. */
export function parseShellEnvironment(output: string): NodeJS.ProcessEnv | null {
  const start = output.indexOf(ENV_MARK)
  const end = output.lastIndexOf(ENV_MARK)
  if (start < 0 || end <= start) return null
  const env: NodeJS.ProcessEnv = {}
  for (const entry of output.slice(start + ENV_MARK.length, end).split('\0')) {
    const separator = entry.indexOf('=')
    if (separator > 0) env[entry.slice(0, separator)] = entry.slice(separator + 1)
  }
  // Describe the probe shell itself, not the commands that will run later.
  for (const key of ['PWD', 'OLDPWD', '_', 'SHLVL']) delete env[key]
  return env.PATH ? env : null
}

/** Variables that describe Pulpo itself, not the user's environment. */
function withoutAppVariables(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const result = { ...env }
  for (const key of Object.keys(result)) if (key.startsWith('ELECTRON_') || key === 'PULPO_RESOLVING_ENVIRONMENT') delete result[key]
  return result
}

/**
 * The environment the user's commands should see. Apps opened from Finder inherit a bare PATH, so
 * on macOS/Linux this runs the login, interactive shell once and reads back its environment (what
 * VS Code does), falling back to the app's own environment when that fails or takes too long.
 */
export async function resolveShellEnvironment(platform: NodeJS.Platform, shell: CommandShell, baseEnv: NodeJS.ProcessEnv, spawn: Spawn = nodeSpawn, timeoutMs = 10_000): Promise<NodeJS.ProcessEnv> {
  if (platform === 'win32') return withoutAppVariables(baseEnv)
  const resolved = await new Promise<NodeJS.ProcessEnv | null>((done) => {
    let child: ChildProcess
    try {
      child = spawn(shell.path, ['-i', '-l', '-c', `printf '%s' '${ENV_MARK}'; command env -0; printf '%s' '${ENV_MARK}'`], {
        detached: true,
        stdio: ['ignore', 'pipe', 'ignore'],
        env: { ...baseEnv, PULPO_RESOLVING_ENVIRONMENT: '1' },
      })
    } catch { return done(null) }
    const chunks: Buffer[] = []
    const timer = setTimeout(() => { killProcessTree(platform, child, 'SIGKILL', spawn); done(null) }, timeoutMs)
    child.stdout?.on('data', (chunk: Buffer) => chunks.push(chunk))
    child.once('error', () => { clearTimeout(timer); done(null) })
    child.once('close', () => { clearTimeout(timer); done(parseShellEnvironment(Buffer.concat(chunks).toString('utf8'))) })
  })
  return withoutAppVariables(resolved ? { ...baseEnv, ...resolved } : baseEnv)
}
