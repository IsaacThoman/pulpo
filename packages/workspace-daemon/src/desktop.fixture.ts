import { chmod, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * A stand-in for the image's `pulpo-desktop`, for tests: `helper` answers the control protocol
 * from a state file the test edits, `frames` writes the state's pictures as an mpjpeg stream, and
 * `status` exits with the state's code. Every run and request is logged to `calls.jsonl`.
 */

export interface FakeWindow { id: number; title: string; minimized: boolean }
export interface FakeApp { id: string; name: string; pid: number; frontmost: boolean; windows: FakeWindow[] }
export interface FakeState {
  apps: FakeApp[]
  /** The apps once the next action is done (a dialog that opened, a window that closed). */
  afterAct?: FakeApp[] | null
  actDelayMs?: number
  /** The helper exits when asked this. */
  crashOn?: string | null
  elements?: unknown[]
  status?: number
  /** Pictures `frames` writes, in order; more can be added while it runs. */
  frames?: string[]
  /** `frames` exits once it has written what there is. */
  framesExit?: boolean
}
export interface FakeCall { command: string; method?: string; params?: Record<string, any>; args?: string[]; pid: number }

export const chromium = (windows: FakeWindow[] = [{ id: 101, title: 'Example Domain', minimized: false }]): FakeApp => (
  { id: 'chromium', name: 'Chromium', pid: 400, frontmost: true, windows }
)
export const terminal: FakeApp = { id: 'xterm', name: 'XTerm', pid: 500, frontmost: false, windows: [{ id: 201, title: 'agent@workspace', minimized: false }] }

const script = (dir: string) => `#!${process.execPath}
import { appendFileSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { createInterface } from 'node:readline'
import { join } from 'node:path'
const dir = ${JSON.stringify(dir)}
const read = () => JSON.parse(readFileSync(join(dir, 'state.json'), 'utf8'))
const save = (state) => { const temporary = join(dir, 'state.' + process.pid + '.tmp'); writeFileSync(temporary, JSON.stringify(state)); renameSync(temporary, join(dir, 'state.json')) }
const log = (entry) => appendFileSync(join(dir, 'calls.jsonl'), JSON.stringify({ ...entry, pid: process.pid }) + '\\n')
const [command, ...args] = process.argv.slice(2)
if (command === 'status') { log({ command }); process.exit(read().status ?? 0) }
if (command === 'helper') {
  log({ command })
  let imageDir
  let shots = 0
  const lines = createInterface({ input: process.stdin })
  lines.on('line', async (line) => {
    const { id, method, params } = JSON.parse(line)
    const state = read()
    log({ command, method, params })
    const answer = (result) => process.stdout.write(JSON.stringify({ id, ok: true, result }) + '\\n')
    const fail = (code, message) => process.stdout.write(JSON.stringify({ id, ok: false, code, message }) + '\\n')
    if (state.crashOn === method) { save({ ...state, crashOn: null }); process.exit(3) }
    if (method === 'configure') { imageDir = params.imageDir; return answer({ protocol: 1, platform: 'linux', background: true }) }
    if (method === 'apps') return answer({ apps: state.apps })
    if (method === 'act') {
      if (state.actDelayMs) await new Promise((done) => setTimeout(done, state.actDelayMs))
      const now = read()
      if (now.afterAct) save({ ...now, apps: now.afterAct, afterAct: null })
      return answer(params.action.type === 'click' ? { note: 'Clicked the button' } : {})
    }
    if (method === 'snapshot') {
      const window = state.apps.flatMap((app) => app.windows).find((one) => one.id === params.windowId)
      if (!window) return fail('not_found', 'The window is gone.')
      const path = join(imageDir, 'shot-' + process.pid + '-' + (++shots) + '.jpg')
      writeFileSync(path, Buffer.alloc(100, 7))
      return answer({ window, image: { path, width: 1280, height: 800, mimeType: 'image/jpeg' }, elements: state.elements ?? [], truncated: false })
    }
    if (method === 'input' || method === 'release') return answer({})
    fail('invalid_request', 'Unknown method.')
  })
  lines.on('close', () => process.exit(0))
}
if (command === 'frames') {
  log({ command, args })
  let sent = 0
  const send = () => {
    const state = read()
    const parts = state.frames ?? []
    for (; sent < parts.length; sent += 1) {
      const data = Buffer.from(parts[sent])
      process.stdout.write(Buffer.concat([Buffer.from('--ffmpeg\\r\\nContent-type: image/jpeg\\r\\nContent-Length: ' + data.length + '\\r\\n\\r\\n'), data, Buffer.from('\\r\\n')]))
    }
    if (state.framesExit) process.exit(1)
  }
  send()
  setInterval(send, 25)
}
`

export interface FakeDesktop {
  dir: string
  command: string
  versionFile: string
  imageDir: string
  set: (patch: Partial<FakeState>) => Promise<void>
  get: () => Promise<FakeState>
  calls: () => Promise<FakeCall[]>
  remove: () => Promise<void>
}

export async function fakeDesktop(initial: Partial<FakeState> = {}): Promise<FakeDesktop> {
  const dir = await mkdtemp(join(tmpdir(), 'pulpo-desktop-'))
  const command = join(dir, 'pulpo-desktop')
  const versionFile = join(dir, 'VERSION')
  const stateFile = join(dir, 'state.json')
  await writeFile(command, script(dir))
  await chmod(command, 0o755)
  await writeFile(versionFile, '1\n')
  await writeFile(join(dir, 'calls.jsonl'), '')
  const get = async () => JSON.parse(await readFile(stateFile, 'utf8')) as FakeState
  // Replaced whole, so the fake never reads half a file.
  const put = async (state: FakeState) => { await writeFile(`${stateFile}.tmp`, JSON.stringify(state)); await rename(`${stateFile}.tmp`, stateFile) }
  await put({ apps: [chromium(), terminal], ...initial })
  return {
    dir, command, versionFile, imageDir: join(dir, 'pictures'),
    get,
    set: async (patch) => { await put({ ...await get(), ...patch }) },
    calls: async () => (await readFile(join(dir, 'calls.jsonl'), 'utf8')).split('\n').filter(Boolean).map((line) => JSON.parse(line) as FakeCall),
    remove: () => rm(dir, { recursive: true, force: true }),
  }
}

export function alive(pid: number): boolean {
  try { process.kill(pid, 0); return true } catch { return false }
}

export async function until(check: () => boolean | Promise<boolean>, timeoutMs = 3_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!await check()) {
    if (Date.now() > deadline) throw new Error('timed out')
    await new Promise((done) => setTimeout(done, 20))
  }
}
