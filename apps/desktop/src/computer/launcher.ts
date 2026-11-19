import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

/**
 * The `pulpo` command in a full-access reply. The app ships the workspace daemon's CLI as one
 * CommonJS file (`pulpo-cli.cjs`, built from src/computer/pulpo-cli.ts) and, before the agent's
 * first command, copies it out of the app (it may be inside the asar) into `<userData>/computer/bin`
 * beside launchers that run it with the app's own executable as Node, as VS Code runs its CLI.
 * `ELECTRON_RUN_AS_NODE` is set inside the launchers only: in the agent's own commands it would turn
 * any Electron app they start into Node.
 *
 * - `pulpo`: a POSIX sh script (macOS, Linux, and Git Bash on Windows).
 * - `pulpo.ps1`: what PowerShell, the agent's shell on Windows, picks over `pulpo.cmd`. It passes
 *   arguments as they are; through a .cmd, cmd.exe would read `&`, `|` or `%` in them.
 * - `pulpo.cmd`: for cmd.exe and programs that start `pulpo` through it.
 */

export const PULPO_CLI_FILE = 'pulpo-cli.cjs'

export interface LauncherFile { name: string; content: string; mode: number }

/** One single-quoted sh word: `'` cannot be escaped inside quotes, so it closes, adds `\'` and reopens. */
export function shQuote(value: string): string { return `'${value.replaceAll('\'', '\'\\\'\'')}'` }

/** One single-quoted PowerShell word. PowerShell also reads the typographic single quotes as quotes. */
export function powershellQuote(value: string): string { return `'${value.replace(/['\u2018\u2019\u201a\u201b]/g, '$&$&')}'` }

/** A path in a batch file, quoted. Windows paths cannot contain `"`; `%` would start a variable. */
export function batchQuote(value: string): string { return `"${value.replaceAll('%', '%%')}"` }

export function posixLauncher(executable: string, cliFile: string): string {
  return [
    '#!/bin/sh',
    '# Pulpo Files for the agent\'s commands. Written by the Pulpo app; changes are overwritten.',
    // exec: the CLI's exit status is the command's, with no shell left waiting.
    `ELECTRON_RUN_AS_NODE=1 exec ${shQuote(executable)} ${shQuote(cliFile)} "$@"`,
    '',
  ].join('\n')
}

export function powershellLauncher(executable: string, cliFile: string): string {
  return [
    // The BOM makes Windows PowerShell read the file as UTF-8 rather than the ANSI code page.
    '\uFEFF# Pulpo Files for the agent\'s commands. Written by the Pulpo app; changes are overwritten.',
    // A script runs in its caller's process, so the variable is put back however the CLI ends.
    '$__pulpoRunAsNode = $env:ELECTRON_RUN_AS_NODE',
    '$env:ELECTRON_RUN_AS_NODE = \'1\'',
    // Left as it is when the executable cannot start at all, which must not read as success.
    '$global:LASTEXITCODE = 1',
    `try { & ${powershellQuote(executable)} ${powershellQuote(cliFile)} @args } finally { $env:ELECTRON_RUN_AS_NODE = $__pulpoRunAsNode }`,
    'exit $LASTEXITCODE',
    '',
  ].join('\r\n')
}

/**
 * cmd.exe reads a batch file in the console's code page, so a path that is not ASCII (a user
 * folder like `C:\Users\José`) is read correctly only after switching to UTF-8; the code page is
 * put back afterwards. The CLI beside the launcher is named through `%~dp0`, which needs no decoding.
 */
export function cmdLauncher(executable: string): string {
  // eslint-disable-next-line no-control-regex
  const ascii = /^[\x00-\x7f]*$/.test(executable)
  return [
    '@echo off',
    ':: Pulpo Files for the agent\'s commands. Written by the Pulpo app; changes are overwritten.',
    // setlocal keeps the variable out of the caller's cmd session; delayed expansion would eat `!`.
    'setlocal DisableDelayedExpansion',
    ...(ascii ? [] : [
      'for /f "tokens=2 delims=:." %%c in (\'chcp\') do set "__PULPO_CP=%%c"',
      'chcp 65001 >nul',
    ]),
    'set "ELECTRON_RUN_AS_NODE=1"',
    `${batchQuote(executable)} "%~dp0${PULPO_CLI_FILE}" %*`,
    // Expanded when this line is read, after the CLI ran.
    ...(ascii ? ['exit /b %ERRORLEVEL%'] : ['set "__PULPO_EXIT=%ERRORLEVEL%"', 'chcp %__PULPO_CP% >nul', 'exit /b %__PULPO_EXIT%']),
    '',
  ].join('\r\n')
}

/** The launchers for a platform, given where the CLI copy lives. */
export function launcherFiles(platform: NodeJS.Platform, executable: string, cliFile: string): LauncherFile[] {
  const posix = { name: 'pulpo', content: posixLauncher(executable, cliFile), mode: 0o755 }
  if (platform !== 'win32') return [posix]
  return [posix, { name: 'pulpo.ps1', content: powershellLauncher(executable, cliFile), mode: 0o644 }, { name: 'pulpo.cmd', content: cmdLauncher(executable), mode: 0o644 }]
}

export interface PulpoCliEnvironment {
  /** Holds the launchers; goes first on PATH. */
  binDir: string
  relayEndpoint: string
  /** The CLI keeps its copies in `files` and its manifest in `.pulpo/files.json` below it. */
  workspaceRoot: string
}

/**
 * The environment of a full-access command, so `pulpo files` works in it. Windows keeps PATH under
 * any capitalisation (usually `Path`) and separates it with `;`; adding a second spelling would
 * leave the child with whichever Windows happens to read.
 */
export function withPulpoCli(platform: NodeJS.Platform, env: NodeJS.ProcessEnv, cli: PulpoCliEnvironment): NodeJS.ProcessEnv {
  const result: NodeJS.ProcessEnv = { ...env }
  const separator = platform === 'win32' ? ';' : ':'
  const keys = platform === 'win32' ? Object.keys(result).filter((key) => key.toLowerCase() === 'path') : ['PATH']
  if (!keys.length) keys.push(platform === 'win32' ? 'Path' : 'PATH')
  for (const key of keys) {
    const rest = (result[key] ?? '').split(separator).filter((entry) => entry && entry !== cli.binDir)
    result[key] = [cli.binDir, ...rest].join(separator)
  }
  delete result.ELECTRON_RUN_AS_NODE
  result.PULPO_RELAY_SOCKET = cli.relayEndpoint
  result.PULPO_WORKSPACE_ROOT = cli.workspaceRoot
  return result
}

async function writeIfChanged(file: string, content: string | Buffer, mode: number, platform: NodeJS.Platform): Promise<void> {
  const current = await readFile(file).catch(() => null)
  if (!current || !current.equals(Buffer.isBuffer(content) ? content : Buffer.from(content))) await writeFile(file, content, { mode })
  if (platform !== 'win32') await chmod(file, mode)
}

/**
 * Writes the CLI and its launchers into `binDir`. Run on every start: the executable's path changes
 * when the app moves or updates (on Windows every version has its own folder).
 */
export async function installPulpoCli(options: { platform: NodeJS.Platform; binDir: string; executable: string; source: string }): Promise<void> {
  const { platform, binDir } = options
  await mkdir(binDir, { recursive: true })
  const cliFile = path.join(binDir, PULPO_CLI_FILE)
  // Electron's fs reads inside the asar; the copy is what the launchers run.
  await writeIfChanged(cliFile, await readFile(options.source), 0o644, platform)
  for (const file of launcherFiles(platform, options.executable, cliFile)) await writeIfChanged(path.join(binDir, file.name), file.content, file.mode, platform)
}
