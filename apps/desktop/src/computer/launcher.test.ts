import { spawnSync } from 'node:child_process'
import { copyFile, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { batchQuote, cmdLauncher, installPulpoCli, launcherFiles, posixLauncher, powershellLauncher, powershellQuote, PULPO_CLI_FILE, shQuote, withPulpoCli } from './launcher'
import { commandShell } from './platform'

/** Stands in for the CLI: prints what it was given and exits with the status it was asked for. */
// The newline ends the line, so what a shell prints next starts its own.
const ECHO_CLI = `process.stdout.write(JSON.stringify({ args: process.argv.slice(2), runAsNode: process.env.ELECTRON_RUN_AS_NODE ?? null }) + '\\n')
process.exitCode = Number(process.argv[2] === 'exit' ? process.argv[3] : 0)
`

const MAC_APP = '/Applications/Pulpo Beta.app/Contents/MacOS/Pulpo'
const MAC_CLI = '/Users/first last/Library/Application Support/Pulpo/computer/bin/pulpo-cli.cjs'
const WIN_APP = 'C:\\Users\\First Last\\AppData\\Local\\Pulpo\\app-0.1.0\\Pulpo.exe'
const WIN_CLI = 'C:\\Users\\First Last\\AppData\\Roaming\\Pulpo\\computer\\bin\\pulpo-cli.cjs'

describe('launcher text', () => {
  it('quotes for sh, PowerShell and cmd', () => {
    expect(shQuote('it\'s $HOME `x`')).toBe('\'it\'\\\'\'s $HOME `x`\'')
    expect(powershellQuote('C:\\Users\\O\'Brien’s\\$env')).toBe('\'C:\\Users\\O\'\'Brien’’s\\$env\'')
    expect(batchQuote('C:\\100% & ^ (x)\\Pulpo.exe')).toBe('"C:\\100%% & ^ (x)\\Pulpo.exe"')
  })

  it('runs the CLI with the app as Node from sh, passing arguments and the exit status through', () => {
    expect(posixLauncher(MAC_APP, MAC_CLI)).toBe([
      '#!/bin/sh',
      '# Pulpo Files for the agent\'s commands. Written by the Pulpo app; changes are overwritten.',
      'ELECTRON_RUN_AS_NODE=1 exec \'/Applications/Pulpo Beta.app/Contents/MacOS/Pulpo\' \'/Users/first last/Library/Application Support/Pulpo/computer/bin/pulpo-cli.cjs\' "$@"',
      '',
    ].join('\n'))
  })

  it('writes a PowerShell launcher that restores the variable and returns the exit code', () => {
    expect(powershellLauncher(WIN_APP, WIN_CLI)).toBe([
      '\uFEFF# Pulpo Files for the agent\'s commands. Written by the Pulpo app; changes are overwritten.',
      '$__pulpoRunAsNode = $env:ELECTRON_RUN_AS_NODE',
      '$env:ELECTRON_RUN_AS_NODE = \'1\'',
      '$global:LASTEXITCODE = 1',
      'try { & \'C:\\Users\\First Last\\AppData\\Local\\Pulpo\\app-0.1.0\\Pulpo.exe\' \'C:\\Users\\First Last\\AppData\\Roaming\\Pulpo\\computer\\bin\\pulpo-cli.cjs\' @args } finally { $env:ELECTRON_RUN_AS_NODE = $__pulpoRunAsNode }',
      'exit $LASTEXITCODE',
      '',
    ].join('\r\n'))
  })

  it('writes a cmd launcher that keeps the variable local and passes the exit code', () => {
    expect(cmdLauncher(WIN_APP)).toBe([
      '@echo off',
      ':: Pulpo Files for the agent\'s commands. Written by the Pulpo app; changes are overwritten.',
      'setlocal DisableDelayedExpansion',
      'set "ELECTRON_RUN_AS_NODE=1"',
      '"C:\\Users\\First Last\\AppData\\Local\\Pulpo\\app-0.1.0\\Pulpo.exe" "%~dp0pulpo-cli.cjs" %*',
      'exit /b %ERRORLEVEL%',
      '',
    ].join('\r\n'))
    // A path cmd.exe would misread in the console's code page is read as UTF-8, and the code page put back.
    const accented = cmdLauncher('C:\\Users\\José\\AppData\\Local\\Pulpo\\app-0.1.0\\Pulpo.exe').split('\r\n')
    expect(accented.slice(3, 9)).toEqual([
      'for /f "tokens=2 delims=:." %%c in (\'chcp\') do set "__PULPO_CP=%%c"',
      'chcp 65001 >nul',
      'set "ELECTRON_RUN_AS_NODE=1"',
      '"C:\\Users\\José\\AppData\\Local\\Pulpo\\app-0.1.0\\Pulpo.exe" "%~dp0pulpo-cli.cjs" %*',
      'set "__PULPO_EXIT=%ERRORLEVEL%"',
      'chcp %__PULPO_CP% >nul',
    ])
    expect(accented[9]).toBe('exit /b %__PULPO_EXIT%')
  })

  it('names the launchers per platform', () => {
    expect(launcherFiles('darwin', MAC_APP, MAC_CLI).map(({ name, mode }) => [name, mode])).toEqual([['pulpo', 0o755]])
    expect(launcherFiles('win32', WIN_APP, WIN_CLI).map(({ name }) => name)).toEqual(['pulpo', 'pulpo.ps1', 'pulpo.cmd'])
  })
})

describe('withPulpoCli', () => {
  const cli = { binDir: '/data/Pulpo/computer/bin', relayEndpoint: '/data/Pulpo/computer/relay/pulpo.sock', workspaceRoot: '/data/Pulpo/computer/workspaces/abc' }

  it('puts the launchers first on PATH and names the relay and the workspace root', () => {
    expect(withPulpoCli('darwin', { PATH: '/usr/bin:/bin', HOME: '/Users/me', ELECTRON_RUN_AS_NODE: '1' }, cli)).toEqual({
      PATH: '/data/Pulpo/computer/bin:/usr/bin:/bin', HOME: '/Users/me',
      PULPO_RELAY_SOCKET: cli.relayEndpoint, PULPO_WORKSPACE_ROOT: cli.workspaceRoot,
    })
    expect(withPulpoCli('linux', {}, cli).PATH).toBe(cli.binDir)
    // Not twice, and not after itself.
    expect(withPulpoCli('linux', { PATH: `/usr/bin:${cli.binDir}` }, cli).PATH).toBe(`${cli.binDir}:/usr/bin`)
  })

  it('keeps Windows\' own spelling of Path and its separator', () => {
    const win = { binDir: 'C:\\Users\\First Last\\AppData\\Roaming\\Pulpo\\computer\\bin', relayEndpoint: '\\\\.\\pipe\\pulpo-relay-1', workspaceRoot: 'C:\\Users\\First Last\\AppData\\Roaming\\Pulpo\\computer\\workspaces\\abc' }
    const env = withPulpoCli('win32', { Path: 'C:\\Windows\\system32;C:\\Windows', SystemRoot: 'C:\\Windows' }, win)
    expect(env).toEqual({
      Path: `${win.binDir};C:\\Windows\\system32;C:\\Windows`, SystemRoot: 'C:\\Windows',
      PULPO_RELAY_SOCKET: win.relayEndpoint, PULPO_WORKSPACE_ROOT: win.workspaceRoot,
    })
    expect(Object.keys(env).filter((key) => key.toLowerCase() === 'path')).toEqual(['Path'])
    expect(withPulpoCli('win32', {}, win).Path).toBe(win.binDir)
  })
})

describe('installPulpoCli', () => {
  let base: string
  beforeEach(async () => { base = await mkdtemp(path.join(os.tmpdir(), 'pulpo launcher ')) })
  afterEach(async () => { await rm(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }) })

  it('copies the CLI beside its launchers and rewrites them when the app moves', async () => {
    const source = path.join(base, 'source.cjs'); await writeFile(source, ECHO_CLI)
    const binDir = path.join(base, 'user data', 'computer', 'bin')
    await installPulpoCli({ platform: process.platform, binDir, executable: '/old/Pulpo', source })
    expect(await readFile(path.join(binDir, PULPO_CLI_FILE), 'utf8')).toBe(ECHO_CLI)
    if (process.platform !== 'win32') expect((await stat(path.join(binDir, 'pulpo'))).mode & 0o777).toBe(0o755)
    await installPulpoCli({ platform: process.platform, binDir, executable: '/new/Pulpo', source })
    expect(await readFile(path.join(binDir, 'pulpo'), 'utf8')).toContain('\'/new/Pulpo\'')
  })

  it.skipIf(process.platform === 'win32')('runs through sh from a folder with spaces, with arguments and exit status intact', async () => {
    const source = path.join(base, 'source.cjs'); await writeFile(source, ECHO_CLI)
    const binDir = path.join(base, 'user data', 'bin')
    // Plain node stands in for the app's executable.
    await installPulpoCli({ platform: process.platform, binDir, executable: process.execPath, source })
    const args = ['files', 'ls', 'two words', 'it\'s', '$HOME', '*', '']
    const result = spawnSync('/bin/sh', ['-c', 'pulpo "$@"', 'sh', ...args], { env: { PATH: `${binDir}:/usr/bin:/bin` }, encoding: 'utf8' })
    expect(result.status).toBe(0)
    expect(JSON.parse(result.stdout)).toEqual({ args, runAsNode: '1' })
    expect(spawnSync('/bin/sh', ['-c', 'pulpo exit 7; echo "after $? ${ELECTRON_RUN_AS_NODE-unset}"'], { env: { PATH: `${binDir}:/usr/bin:/bin` }, encoding: 'utf8' }).stdout)
      .toMatch(/after 7 unset\n$/)
  })
})

/** The real thing on Windows: node.exe stands in for Pulpo.exe, from folders with spaces and accents. */
describe.skipIf(process.platform !== 'win32')('launchers on Windows', () => {
  let base: string
  let binDir: string
  const args = ['files', 'grep', 'a&b|c', 'two words', '100%', '^caret', '!bang']

  beforeEach(async () => {
    base = await mkdtemp(path.join(os.tmpdir(), 'pulpo launcher '))
    const appDir = path.join(base, 'José Ñ', 'app-0.1.0')
    await mkdir(appDir, { recursive: true })
    const executable = path.join(appDir, 'Pulpo.exe')
    await copyFile(process.execPath, executable)
    const source = path.join(base, 'source.cjs'); await writeFile(source, ECHO_CLI)
    binDir = path.join(base, 'First Last é', 'computer', 'bin')
    await installPulpoCli({ platform: 'win32', binDir, executable, source })
  })

  afterEach(async () => { await rm(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }) })

  const env = () => withPulpoCli('win32', { ...process.env }, { binDir, relayEndpoint: '\\\\.\\pipe\\unused', workspaceRoot: base })
  const quotedPs = (value: string) => `'${value.replaceAll('\'', '\'\'')}'`

  it('passes arguments and the exit code through from PowerShell, and leaves the variable unset', () => {
    const shell = commandShell('win32', process.env)
    const script = [
      `pulpo ${args.map(quotedPs).join(' ')}`,
      '"code=$LASTEXITCODE"',
      'pulpo exit 7',
      '"code=$LASTEXITCODE runAsNode=$($null -eq $env:ELECTRON_RUN_AS_NODE)"',
    ].join('; ')
    const result = spawnSync(shell.path, ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], { env: env(), encoding: 'utf8' })
    const lines = result.stdout.trim().split(/\r?\n/)
    expect(JSON.parse(lines[0]!)).toEqual({ args, runAsNode: '1' })
    expect(lines[1]).toBe('code=0')
    expect(lines.at(-1)).toBe('code=7 runAsNode=True')
  })

  it('passes the exit code through from cmd', () => {
    // Verbatim: Node would otherwise escape the quotes in the command line in a way cmd.exe does not read.
    const options = { env: env(), encoding: 'utf8', windowsVerbatimArguments: true } as const
    const result = spawnSync('cmd.exe', ['/d', '/c', 'pulpo exit 7'], options)
    expect(result.status).toBe(7)
    expect(JSON.parse(result.stdout)).toEqual({ args: ['exit', '7'], runAsNode: '1' })
    const plain = spawnSync('cmd.exe', ['/d', '/c', 'pulpo files ls "two words"'], options)
    expect(plain.status).toBe(0)
    expect(JSON.parse(plain.stdout)).toEqual({ args: ['files', 'ls', 'two words'], runAsNode: '1' })
  })
})
