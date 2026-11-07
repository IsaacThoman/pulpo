/**
 * Test-only bridge to the Python/LibreOffice fidelity tools in
 * `packages/client-core/scripts/sheets/`. Engine tests use it to compare what
 * we write with what openpyxl and LibreOffice read.
 *
 * Node-only (child_process/fs). Nothing in the runtime may import this module.
 * Set it up with `scripts/sheets/setup-fidelity-env.sh`, and gate tests on
 * `fidelityAvailable()` / `libreOfficeAvailable()`.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** packages/client-core, resolved from both src/ and dist/ (same depth). */
const PACKAGE_ROOT = fileURLToPath(new URL('../../../../', import.meta.url))

export const SHEETS_SCRIPTS_DIR = join(PACKAGE_ROOT, 'scripts', 'sheets')
export const SHEETS_FIXTURES_DIR = join(PACKAGE_ROOT, 'test-fixtures', 'sheets')

const MAX_BUFFER = 1024 * 1024 * 1024
const DEFAULT_TIMEOUT_MS = 180_000

export function sheetsFixture(relativePath: string): string {
  return join(SHEETS_FIXTURES_DIR, relativePath)
}

export function fidelityPython(): string {
  const venv = process.env.PULPO_SHEETS_VENV ?? join(homedir(), '.cache', 'pulpo-sheets-venv')
  return join(venv, 'bin', 'python')
}

/** Directory of the opt-in large corpus (`PULPO_SHEETS_CORPUS`), or null when unset/missing. */
export function sheetsCorpusDir(): string | null {
  const dir = process.env.PULPO_SHEETS_CORPUS
  if (!dir) return null
  const expanded = dir.startsWith('~/') ? join(homedir(), dir.slice(2)) : dir
  return existsSync(expanded) ? resolve(expanded) : null
}

let pythonOk: boolean | undefined
/** True when the venv exists and can import openpyxl. Cached per process. */
export function fidelityAvailable(): boolean {
  if (pythonOk === undefined) {
    const python = fidelityPython()
    pythonOk =
      existsSync(python) &&
      spawnSync(python, ['-I', '-c', 'import openpyxl'], { timeout: 30_000 }).status === 0
  }
  return pythonOk
}

const SOFFICE_CANDIDATES = ['/Applications/LibreOffice.app/Contents/MacOS/soffice', '/usr/bin/soffice', '/usr/local/bin/soffice', '/opt/homebrew/bin/soffice']

let sofficePath: string | null | undefined
export function libreOfficePath(): string | null {
  if (sofficePath === undefined) {
    const fromEnv = process.env.PULPO_SOFFICE
    sofficePath = (fromEnv && existsSync(fromEnv) ? fromEnv : SOFFICE_CANDIDATES.find((candidate) => existsSync(candidate))) ?? null
  }
  return sofficePath
}

export function libreOfficeAvailable(): boolean {
  return libreOfficePath() !== null
}

export class FidelityToolError extends Error {
  constructor(
    message: string,
    readonly tool: string,
    readonly exitCode: number | null,
    readonly stderr: string,
  ) {
    super(message)
    this.name = 'FidelityToolError'
  }
}

interface RunOptions {
  /** Exit codes that still mean "the tool ran and printed its JSON". */
  okCodes?: readonly number[]
  timeoutMs?: number
}

function runJson<T>(command: string, args: readonly string[], tool: string, options: RunOptions = {}): T {
  const okCodes = options.okCodes ?? [0]
  const result = spawnSync(command, args, {
    cwd: SHEETS_SCRIPTS_DIR,
    encoding: 'utf8',
    maxBuffer: MAX_BUFFER,
    timeout: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
  })
  if (result.error) {
    throw new FidelityToolError(`${tool} failed to run: ${result.error.message}`, tool, result.status, result.stderr ?? '')
  }
  let parsed: T
  try {
    parsed = JSON.parse(result.stdout) as T
  } catch {
    throw new FidelityToolError(
      `${tool} printed no JSON (exit ${result.status}): ${result.stderr.slice(-2000)}`,
      tool,
      result.status,
      result.stderr,
    )
  }
  if (result.status === null || !okCodes.includes(result.status)) {
    throw new FidelityToolError(
      `${tool} exited ${result.status}: ${result.stdout.slice(0, 2000)}`,
      tool,
      result.status,
      result.stderr,
    )
  }
  return parsed
}

function runPython<T>(script: string, args: readonly string[], options?: RunOptions): T {
  return runJson<T>(fidelityPython(), ['-I', join(SHEETS_SCRIPTS_DIR, script), ...args], script, options)
}

// ---------------------------------------------------------------------------
// inspect_xlsx.py

export interface ToolError {
  type: string
  message: string
  container?: 'zip' | 'cfb' | 'empty' | 'unknown' | 'missing'
  hint?: string | null
}

/** A cell as dumped by inspect_xlsx.py (only non-default properties are present). */
export interface InspectCell {
  /** openpyxl data type: n, s, b, d (date-formatted number), f (formula), e (error), or 'empty' for styled blanks. */
  t: string
  v?: unknown
  f?: string
  array?: string
  rich?: Array<{ text: string; font?: Record<string, unknown> }>
  numFmt?: string
  font?: Record<string, unknown>
  fill?: Record<string, unknown>
  border?: Record<string, unknown>
  alignment?: Record<string, unknown>
  protection?: string
  style?: string
}

export interface InspectSheet {
  dimensions?: string
  cells?: Record<string, InspectCell>
  merged?: string[]
  view?: Record<string, unknown>
  columns?: Record<string, Record<string, unknown>>
  rows?: Record<string, Record<string, unknown>>
  conditionalFormatting?: Array<Record<string, unknown>>
  dataValidations?: Array<Record<string, unknown>>
  hyperlinks?: Array<Record<string, unknown>>
  comments?: Record<string, { author?: string; text?: string }>
  tables?: Record<string, Record<string, unknown>>
  autoFilter?: Record<string, unknown>
  drawings?: { images?: Array<Record<string, unknown>>; charts?: Array<Record<string, unknown>> }
  print?: Record<string, unknown>
  protection?: Record<string, unknown>
  /** extLst content openpyxl drops (x14 conditional formats, validations, sparklines), parsed from raw XML. */
  x14?: Record<string, unknown>
  charts?: Array<Record<string, unknown>>
  inspectErrors?: string[]
  [key: string]: unknown
}

export interface InspectDump {
  tool?: 'inspect_xlsx'
  version?: number
  file: string
  mode?: 'formulas' | 'values'
  workbook?: {
    sheets: Array<{ name: string; kind: 'worksheet' | 'chartsheet'; state?: string; tabColor?: string }>
    active?: string
    date1904?: boolean
    definedNames?: Array<{ name: string; value: string; scope?: string; hidden?: boolean }>
    calc?: Record<string, string> | null
    protection?: Record<string, boolean>
    [key: string]: unknown
  }
  sheets?: Record<string, InspectSheet>
  package?: { parts: Record<string, string>; features: Record<string, unknown> }
  warnings?: string[]
  error?: ToolError
}

export interface InspectOptions {
  /** Dump cached values (`data_only=True`) instead of formulas. */
  values?: boolean
  styles?: boolean
  package?: boolean
  sheets?: readonly string[]
  maxCells?: number
}

/**
 * Canonical openpyxl view of a workbook. Files openpyxl cannot load (encrypted,
 * strict, corrupt) return `{ error }` rather than throwing.
 */
export function inspectXlsx(path: string, options: InspectOptions = {}): InspectDump {
  const args = [path]
  if (options.values) args.push('--values')
  if (options.styles === false) args.push('--no-styles')
  if (options.package === false) args.push('--no-package')
  for (const sheet of options.sheets ?? []) args.push('--sheet', sheet)
  if (options.maxCells !== undefined) args.push('--max-cells', String(options.maxCells))
  return runPython<InspectDump>('inspect_xlsx.py', args, { okCodes: [0, 2] })
}

// ---------------------------------------------------------------------------
// compare_xlsx.py

export interface Difference {
  path: string
  kind: 'added' | 'removed' | 'changed' | 'type' | 'length'
  a: unknown
  b: unknown
}

export interface CompareResult {
  equal: boolean
  count: number
  truncated: boolean
  differences: Difference[]
  error?: { type: string; sides?: Record<string, ToolError> }
}

export interface CompareOptions {
  /** Ignore patterns: a bare segment name (`package`, `font`) or a slash path glob (`sheets/*\/columns`). */
  ignore?: readonly string[]
  values?: boolean
  styles?: boolean
  max?: number
}

/** Diff the inspect dumps of two workbooks (or of saved `.json` dumps). */
export function compareXlsx(a: string, b: string, options: CompareOptions = {}): CompareResult {
  const args = [a, b]
  if (options.ignore?.length) args.push('--ignore', options.ignore.join(','))
  if (options.values) args.push('--values')
  if (options.styles === false) args.push('--no-styles')
  if (options.max !== undefined) args.push('--max', String(options.max))
  return runPython<CompareResult>('compare_xlsx.py', args, { okCodes: [0, 1, 2] })
}

/** Human-readable one-line-per-difference rendering, for assertion messages. */
export function formatDifferences(result: CompareResult, limit = 50): string {
  const lines = result.differences
    .slice(0, limit)
    .map((d) => `${d.kind} ${d.path}: ${JSON.stringify(d.a)} -> ${JSON.stringify(d.b)}`)
  if (result.differences.length > limit) lines.push(`... ${result.differences.length - limit} more`)
  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// xml_parts_diff.py

export interface PartChange {
  path: string
  kind: 'tag' | 'attr' | 'text' | 'added' | 'removed'
  a?: unknown
  b?: unknown
}

export interface PartsDiffResult {
  same: boolean
  added: string[]
  removed: string[]
  identical: string[]
  /** Part -> why it is only a serialisation difference (attribute order, prefixes, ...). */
  equivalent: Record<string, string[]>
  different: Record<string, { changes?: PartChange[]; truncated?: boolean; error?: string }>
  binary: Record<string, { a: { size: number; sha256: string }; b: { size: number; sha256: string } }>
  order: 'same' | 'different'
  summary: Record<'added' | 'removed' | 'identical' | 'equivalent' | 'different' | 'binary', number>
}

export function xmlPartsDiff(a: string, b: string, options: { maxDiffs?: number; ignoreParts?: readonly string[] } = {}): PartsDiffResult {
  const args = [a, b]
  if (options.maxDiffs !== undefined) args.push('--max-diffs', String(options.maxDiffs))
  for (const glob of options.ignoreParts ?? []) args.push('--ignore-part', glob)
  return runPython<PartsDiffResult>('xml_parts_diff.py', args, { okCodes: [0, 1] })
}

// ---------------------------------------------------------------------------
// cached_values.py / edit_with_openpyxl.py

export interface CachedFormulaCell {
  sheet: string
  cell: string
  formula: string
  array?: string
  /** Stored value; dates stay serial numbers. null when the writer stored no <v>. */
  cached: number | string | boolean | null
  type: 'n' | 's' | 'b' | 'e' | null
  isDate?: boolean
  numFmt?: string
}

export interface CachedValuesResult {
  file: string
  date1904: boolean
  summary: { formulaCells: number; withCachedValue: number; withoutCachedValue: number; errors: number }
  cells: CachedFormulaCell[]
  warnings: string[]
  error?: ToolError
}

export function cachedValues(path: string, options: { sheets?: readonly string[]; onlyCached?: boolean } = {}): CachedValuesResult {
  const args = [path]
  for (const sheet of options.sheets ?? []) args.push('--sheet', sheet)
  if (options.onlyCached) args.push('--only-cached')
  return runPython<CachedValuesResult>('cached_values.py', args, { okCodes: [0, 2] })
}

export type OpenpyxlEditOp = { op: string } & Record<string, unknown>

export interface EditResult {
  ok: boolean
  applied: number
  output?: string
  sheets?: string[]
  warnings: string[]
  error?: { type: string; message: string }
}

/** Simulate an agent editing `input` with openpyxl; writes `output`. See edit_with_openpyxl.py for ops. */
export function editWithOpenpyxl(input: string, output: string, ops: readonly OpenpyxlEditOp[]): EditResult {
  return runPython<EditResult>('edit_with_openpyxl.py', [input, output, JSON.stringify(ops)], { okCodes: [0, 2] })
}

// ---------------------------------------------------------------------------
// LibreOffice

export type LibreOfficeFormat = 'pdf' | 'png' | 'xlsx' | 'csv' | 'ods' | 'html' | (string & {})

export interface LibreOfficeResult {
  ok: boolean
  input?: string
  format?: string
  outputs?: string[]
  elapsedMs?: number
  error?: string
  log?: string
}

function freshDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix))
}

/**
 * Convert with headless LibreOffice (private profile, timeout). `csv` exports every
 * sheet to `<stem>-<Sheet>.csv`. Output goes to a fresh temp dir unless `outDir` is given.
 */
export function libreOfficeConvert(path: string, format: LibreOfficeFormat, outDir?: string, timeoutSeconds = 120): LibreOfficeResult {
  const dir = outDir ?? freshDir('pulpo-lo-convert-')
  return runJson<LibreOfficeResult>(join(SHEETS_SCRIPTS_DIR, 'lo_convert.sh'), [path, dir, format], 'lo_convert.sh', {
    okCodes: [0, 1, 124],
    timeoutMs: (timeoutSeconds + 30) * 1000,
  })
}

export interface RenderResult {
  ok: boolean
  pdf?: string
  pages?: string[]
  renderer?: string
  error?: string
}

/** Render every printed page to PNG (`<stem>-page-<n>.png`) for visual comparison. */
export function libreOfficeRenderPng(path: string, outDir?: string): RenderResult {
  const dir = outDir ?? freshDir('pulpo-lo-render-')
  return runJson<RenderResult>(join(SHEETS_SCRIPTS_DIR, 'lo_render_png.sh'), [path, dir], 'lo_render_png.sh', {
    okCodes: [0, 1, 124],
    timeoutMs: 240_000,
  })
}
