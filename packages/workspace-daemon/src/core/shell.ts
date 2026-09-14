import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { delimiter, join } from 'node:path'

export type ShellKind = 'bash' | 'powershell'

export interface ShellSpawnSpec {
  file: string
  args: string[]
  detached: boolean
  windowsHide: boolean
}

export function defaultShellFor(platform: NodeJS.Platform = process.platform): ShellKind {
  return platform === 'win32' ? 'powershell' : 'bash'
}

let cachedPowerShell: string | undefined

/** Prefer PowerShell 7 (pwsh) when it is on PATH; fall back to Windows PowerShell 5.1. */
export function resolvePowerShellExecutable(env: NodeJS.ProcessEnv = process.env): string {
  if (cachedPowerShell) return cachedPowerShell
  const entries = (env.PATH ?? env.Path ?? '').split(delimiter).filter(Boolean)
  for (const entry of entries) {
    const candidate = join(entry, 'pwsh.exe')
    if (existsSync(candidate)) { cachedPowerShell = candidate; return candidate }
  }
  cachedPowerShell = 'powershell.exe'
  return cachedPowerShell
}

const POWERSHELL_PRELUDE = '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; $ErrorActionPreference = "Continue"; $ProgressPreference = "SilentlyContinue";'

export function shellSpawnSpec(shell: ShellKind, command: string, env: NodeJS.ProcessEnv = process.env): ShellSpawnSpec {
  if (shell === 'powershell') {
    return {
      file: resolvePowerShellExecutable(env),
      args: ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', `${POWERSHELL_PRELUDE} ${command}`],
      detached: false,
      windowsHide: true,
    }
  }
  return { file: '/bin/bash', args: ['-lc', command], detached: true, windowsHide: false }
}

export function spawnShell(spec: ShellSpawnSpec, options: { cwd: string; env: NodeJS.ProcessEnv }): ChildProcess {
  return spawn(spec.file, spec.args, { cwd: options.cwd, env: options.env, detached: spec.detached, windowsHide: spec.windowsHide })
}

/** Terminate a shell and everything it started. Detached POSIX children form a process group; Windows uses taskkill's tree flag. */
export function killTree(child: ChildProcess, signal: NodeJS.Signals, platform: NodeJS.Platform = process.platform): void {
  if (!child.pid) return
  if (platform === 'win32') {
    try {
      const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
      killer.once('error', () => { try { child.kill(signal) } catch { /* already exited */ } })
    } catch {
      try { child.kill(signal) } catch { /* already exited */ }
    }
    return
  }
  try { process.kill(-child.pid, signal) } catch {
    try { child.kill(signal) } catch { /* already exited */ }
  }
}
