import { EventEmitter } from 'node:events'
import type { ChildProcess } from 'node:child_process'
import { PassThrough } from 'node:stream'
import { describe, expect, it, vi } from 'vitest'
import {
  commandShell,
  computerNoun,
  computerOs,
  findOnPath,
  killProcessTree,
  osVersionLabel,
  parseShellEnvironment,
  resolveShellEnvironment,
  shellInvocation,
  windowsCommandScript,
  WINDOWS_SHELL_ARGS,
} from './platform'

describe('platform naming', () => {
  it('maps Node platforms to the contract names and dialog copy', () => {
    expect([computerOs('darwin'), computerOs('win32'), computerOs('linux')]).toEqual(['macos', 'windows', 'linux'])
    expect([computerNoun('darwin'), computerNoun('win32')]).toEqual(['this Mac', 'this PC'])
    expect(osVersionLabel('darwin', '15.1')).toBe('macOS 15.1')
    expect(osVersionLabel('win32', '10.0.22631')).toBe('Windows 11 (10.0.22631)')
    expect(osVersionLabel('win32', '10.0.19045')).toBe('Windows 10 (10.0.19045)')
    expect(osVersionLabel('linux', '6.8.0')).toBe('Linux 6.8.0')
  })
})

describe('commandShell', () => {
  it('uses the login shell on macOS, falling back to zsh then bash', () => {
    const all = () => true
    expect(commandShell('darwin', { SHELL: '/opt/homebrew/bin/fish' }, all)).toEqual({ path: '/opt/homebrew/bin/fish', name: 'fish' })
    expect(commandShell('darwin', { SHELL: 'zsh' }, all)).toEqual({ path: '/bin/zsh', name: 'zsh' })
    expect(commandShell('darwin', {}, (file) => file === '/bin/bash')).toEqual({ path: '/bin/bash', name: 'bash' })
  })

  it('prefers PowerShell 7 on Windows, else Windows PowerShell', () => {
    const env = { Path: 'C:\\Windows\\System32;"C:\\Program Files\\PowerShell\\7"', SystemRoot: 'C:\\Windows' }
    const pwsh = 'C:\\Program Files\\PowerShell\\7\\pwsh.exe'
    expect(commandShell('win32', env, (file) => file === pwsh)).toEqual({ path: pwsh, name: 'pwsh' })
    const builtIn = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe'
    expect(commandShell('win32', env, (file) => file === builtIn)).toEqual({ path: builtIn, name: 'powershell' })
    expect(commandShell('win32', {}, () => false)).toEqual({ path: 'powershell.exe', name: 'powershell' })
  })

  it('finds executables on a PATH', () => {
    expect(findOnPath('rg', '/usr/bin:/opt/bin', 'darwin', (file) => file === '/opt/bin/rg')).toBe('/opt/bin/rg')
    expect(findOnPath('rg', undefined, 'darwin', () => true)).toBeNull()
  })
})

describe('shellInvocation', () => {
  it('runs the command with -c in its own process group on macOS', () => {
    expect(shellInvocation('darwin', { path: '/bin/zsh', name: 'zsh' }, 'echo "hi" && ls')).toEqual({ file: '/bin/zsh', args: ['-c', 'echo "hi" && ls'], detached: true })
  })

  it('runs a BOM-prefixed script file with -File on Windows', () => {
    const invocation = shellInvocation('win32', { path: 'pwsh.exe', name: 'pwsh' }, 'Get-ChildItem "C:\\x y"; git status', 'C:\\tmp\\abc.ps1')
    expect(invocation.file).toBe('pwsh.exe')
    expect(invocation.args).toEqual([...WINDOWS_SHELL_ARGS, '-File', 'C:\\tmp\\abc.ps1'])
    expect(invocation.args).toEqual(['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', 'C:\\tmp\\abc.ps1'])
    expect(invocation.detached).toBe(false)
    expect(invocation.script?.startsWith('\uFEFF')).toBe(true)
    expect(invocation.script).toContain('\r\nGet-ChildItem "C:\\x y"; git status\r\n')
    expect(() => shellInvocation('win32', { path: 'pwsh.exe', name: 'pwsh' }, 'dir')).toThrow()
  })

  it('makes the script UTF-8 and exit with the command\'s code', () => {
    const script = windowsCommandScript('cmd /c exit 3')
    const lines = script.split('\r\n')
    expect(lines.indexOf('cmd /c exit 3')).toBeGreaterThan(lines.findIndex((line) => line.includes('[Console]::OutputEncoding')))
    expect(script).toContain('New-Object System.Text.UTF8Encoding $false')
    expect(script).toContain('exit $global:LASTEXITCODE')
    expect(script).toContain('if (-not $__pulpoSucceeded) { exit 1 }')
    expect(lines.at(-2)).toBe('exit 0')
  })
})

function fakeChild(pid = 4321): ChildProcess {
  return Object.assign(new EventEmitter(), { pid, exitCode: null, signalCode: null, kill: vi.fn() }) as unknown as ChildProcess
}

describe('killProcessTree', () => {
  it('uses taskkill /T /F on Windows', () => {
    const spawn = vi.fn(() => fakeChild(1))
    killProcessTree('win32', fakeChild(), 'SIGTERM', spawn)
    expect(spawn).toHaveBeenCalledWith('taskkill', ['/pid', '4321', '/T', '/F'], expect.objectContaining({ windowsHide: true }))
  })

  it('signals the process group elsewhere', () => {
    const kill = vi.spyOn(process, 'kill').mockImplementation(() => true)
    killProcessTree('darwin', fakeChild(), 'SIGTERM')
    expect(kill).toHaveBeenCalledWith(-4321, 'SIGTERM')
    kill.mockRestore()
  })

  it('still signals the group after the shell itself has exited, since what it started may live on', () => {
    const exited = () => Object.assign(fakeChild(), { exitCode: 0 })
    const kill = vi.spyOn(process, 'kill').mockImplementation(() => true)
    killProcessTree('darwin', exited(), 'SIGKILL')
    expect(kill).toHaveBeenCalledWith(-4321, 'SIGKILL')
    kill.mockRestore()
    // Windows reaches the tree through the parent, which is gone.
    const spawn = vi.fn(() => fakeChild(1))
    killProcessTree('win32', exited(), 'SIGKILL', spawn)
    expect(spawn).not.toHaveBeenCalled()
  })
})

describe('shell environment', () => {
  const mark = '__PULPO_ENV_7f3a__'

  it('parses env -0 between the marks and ignores startup noise', () => {
    const output = `Welcome!\n${mark}PATH=/opt/homebrew/bin:/usr/bin\0MULTI=a\nb\0PWD=/tmp\0EMPTY=\0${mark}bye`
    expect(parseShellEnvironment(output)).toEqual({ PATH: '/opt/homebrew/bin:/usr/bin', MULTI: 'a\nb', EMPTY: '' })
    expect(parseShellEnvironment('no marks')).toBeNull()
  })

  it('runs the login interactive shell once and merges its environment', async () => {
    const spawn = vi.fn(() => {
      const child = fakeChild()
      const stdout = new PassThrough()
      Object.assign(child, { stdout })
      setTimeout(() => { stdout.end(`${mark}PATH=/opt/homebrew/bin:/usr/bin\0LANG=en_US.UTF-8\0${mark}`); child.emit('close', 0) }, 1)
      return child
    })
    const env = await resolveShellEnvironment('darwin', { path: '/bin/zsh', name: 'zsh' }, { PATH: '/usr/bin', HOME: '/Users/me', ELECTRON_RUN_AS_NODE: '1' }, spawn)
    expect(spawn).toHaveBeenCalledWith('/bin/zsh', ['-i', '-l', '-c', expect.stringContaining('env -0')], expect.objectContaining({ detached: true }))
    expect(env).toEqual({ PATH: '/opt/homebrew/bin:/usr/bin', HOME: '/Users/me', LANG: 'en_US.UTF-8' })
  })

  it('falls back to the app environment when the shell hangs or fails', async () => {
    const kill = vi.spyOn(process, 'kill').mockImplementation(() => true)
    const hanging = vi.fn(() => Object.assign(fakeChild(), { stdout: new PassThrough() }))
    await expect(resolveShellEnvironment('darwin', { path: '/bin/zsh', name: 'zsh' }, { PATH: '/usr/bin' }, hanging, 20)).resolves.toEqual({ PATH: '/usr/bin' })
    kill.mockRestore()
    const failing = vi.fn(() => { throw new Error('ENOENT') })
    await expect(resolveShellEnvironment('linux', { path: '/bin/nope', name: 'nope' }, { PATH: '/usr/bin' }, failing)).resolves.toEqual({ PATH: '/usr/bin' })
  })

  it.skipIf(process.platform === 'win32')('reads a real shell\'s environment', async () => {
    const env = await resolveShellEnvironment(process.platform, { path: '/bin/sh', name: 'sh' }, { PATH: '/usr/bin:/bin', PULPO_TEST_MARKER: 'kept' })
    expect(env.PATH).toBeTruthy()
    expect(env.PULPO_TEST_MARKER).toBe('kept')
    expect(env.PULPO_RESOLVING_ENVIRONMENT).toBeUndefined()
  })

  it('uses the app environment directly on Windows', async () => {
    const spawn = vi.fn()
    await expect(resolveShellEnvironment('win32', { path: 'pwsh.exe', name: 'pwsh' }, { Path: 'C:\\x', ELECTRON_NO_ATTACH_CONSOLE: '1' }, spawn)).resolves.toEqual({ Path: 'C:\\x' })
    expect(spawn).not.toHaveBeenCalled()
  })
})
