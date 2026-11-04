import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** The committed presentation corpus and the optional Python/LibreOffice fidelity tools. */

export const PACKAGE_ROOT = fileURLToPath(new URL('../../../../', import.meta.url))
export const FIXTURES = join(PACKAGE_ROOT, 'fixtures/presentation')
export const TOOLS = join(PACKAGE_ROOT, 'test-tools/presentation')

/** Every fixture that should open, by corpus folder. */
export function corpus(): { name: string; path: string }[] {
  return ['poi', 'generated', 'libreoffice'].flatMap((folder) =>
    readdirSync(join(FIXTURES, folder))
      .filter((file) => /\.(pptx|pptm|potx|ppsx)$/.test(file))
      .map((file) => ({ name: `${folder}/${file}`, path: join(FIXTURES, folder, file) })),
  )
}

export function hostileCorpus(): { name: string; path: string }[] {
  return readdirSync(join(FIXTURES, 'hostile'))
    .filter((file) => /\.(pptx|pptm|potx|ppsx)$/.test(file))
    .map((file) => ({ name: `hostile/${file}`, path: join(FIXTURES, 'hostile', file) }))
}

export function fixture(name: string): Uint8Array {
  return new Uint8Array(readFileSync(join(FIXTURES, name)))
}

/** Python with python-pptx, when the fidelity suites are enabled. */
export const FIDELITY = process.env.PULPO_OFFICE_FIDELITY === '1'
export const PYTHON = process.env.PULPO_PPTX_PYTHON ?? '/tmp/pulpo-pptx-venv/bin/python'

export function scratchDir(): string {
  return mkdtempSync(join(tmpdir(), 'pulpo-pptx-'))
}

export function writeScratch(directory: string, name: string, bytes: Uint8Array): string {
  const file = join(directory, name)
  writeFileSync(file, bytes)
  return file
}

/** Runs a fidelity tool; returns stdout, or throws with its output on a nonzero exit. */
export function runTool(tool: string, args: string[], options: { allowFailure?: boolean } = {}): { status: number; output: string } {
  const command = tool.endsWith('.py') ? PYTHON : 'bash'
  const commandArgs = tool.endsWith('.py') ? ['-I', join(TOOLS, tool), ...args] : [join(TOOLS, tool), ...args]
  try {
    const output = execFileSync(command, commandArgs, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 300_000, env: { ...process.env, PULPO_PPTX_PYTHON: PYTHON } })
    return { status: 0, output }
  } catch (error) {
    const failure = error as { status?: number; stdout?: string; stderr?: string }
    if (options.allowFailure) return { status: failure.status ?? 1, output: `${failure.stdout ?? ''}${failure.stderr ?? ''}` }
    throw new Error(`${tool} failed (${failure.status}): ${failure.stdout ?? ''}${failure.stderr ?? ''}`, { cause: error })
  }
}

/** Runs a short python-pptx script with `file` as sys.argv[1]. */
export function runPython(script: string, ...args: string[]): string {
  return execFileSync(PYTHON, ['-I', '-c', script, ...args], { encoding: 'utf8', timeout: 120_000 })
}

export const fidelityAvailable = () => FIDELITY && existsSync(PYTHON)
