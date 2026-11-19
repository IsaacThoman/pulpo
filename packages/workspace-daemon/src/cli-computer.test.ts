import { createHash } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { helpText, parseCli, parseInvocation, UsageError } from './cli-args.js'
import { COMMAND_HELP, COMPUTER_COMMAND_HELP } from './cli-help.js'
import { runCli, type CliContext } from './cli-main.js'
import { COMPUTER_STORE } from './cli-store.js'

type RelayCall = { operationId: string; command: string; args: Record<string, unknown> }
type Reply = { status?: number; body: unknown }

const cleanups: Array<() => Promise<void>> = []
const sha = (text: string) => createHash('sha256').update(text).digest('hex')
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup() })

const usageError = (argv: string[]) => {
  try { parseCli(argv) } catch (error) { if (error instanceof UsageError) return error }
  throw new Error(`expected a usage error for ${argv.join(' ')}`)
}

describe('pulpo computer argument parsing and help', () => {
  it('parses the same commands as pulpo files', () => {
    expect(parseInvocation(['computer', 'ls', 'src', '-R'])).toEqual({ store: COMPUTER_STORE, invocation: { command: 'ls', path: 'src', recursive: true } })
    expect(parseCli(['computer', 'push', 'a.pdf', '--to', 'docs/', '-f'])).toEqual({ command: 'push', locals: ['a.pdf'], to: 'docs/', force: true })
    expect(parseCli(['computer', 'help', 'pull'])).toEqual({ command: 'help', topic: 'pull' })
    expect(parseInvocation(['--help'])).toEqual({ invocation: { command: 'help' } })
  })

  it('names the computer group in usage errors and mentions both groups at the top level', () => {
    expect(usageError(['computer', 'download', 'x']).message).toContain('Did you mean `pulpo computer pull`?')
    expect(usageError(['computer', 'push', '--to', ' ']).message).toBe('--to needs a path in the folder.')
    expect(usageError(['git']).message).toContain('`pulpo files <command>` and `pulpo computer <command>`')
    expect(usageError([]).message).toContain('pulpo computer <command>')
  })

  it('has its own help for every command, never mentioning Files', () => {
    expect(helpText(undefined, COMPUTER_STORE)).toContain('pulpo computer pull src/app.ts')
    expect(Object.keys(COMPUTER_COMMAND_HELP).sort()).toEqual(Object.keys(COMMAND_HELP).sort())
    for (const text of [helpText(undefined, COMPUTER_STORE), ...Object.values(COMPUTER_COMMAND_HELP)]) {
      expect(text).not.toMatch(/pulpo files|My files|\bFiles\b/)
      expect(text).toContain('pulpo computer')
    }
  })
})

async function harness(answer: (call: RelayCall) => Reply | Promise<Reply>) {
  const root = await mkdtemp(join(tmpdir(), 'pulpo-cli-computer-'))
  const socket = join(root, 'relay.sock')
  const calls: RelayCall[] = []
  const server: Server = createServer(async (request, response) => {
    const chunks: Buffer[] = []
    for await (const chunk of request) chunks.push(chunk as Buffer)
    const call = JSON.parse(Buffer.concat(chunks).toString('utf8')) as RelayCall
    calls.push(call)
    const reply = await answer(call)
    response.writeHead(reply.status ?? 200, { 'content-type': 'application/json' })
    response.end(JSON.stringify(reply.body))
  })
  await new Promise<void>((resolve) => server.listen(socket, resolve))
  cleanups.push(async () => { await new Promise((resolve) => server.close(resolve)); await rm(root, { recursive: true, force: true }) })
  const output = { stdout: '', stderr: '' }
  const context: CliContext = {
    cwd: join(root, 'work'), env: { PULPO_OPERATION_ID: 'op-1', PULPO_RELAY_SOCKET: socket },
    mirrorRoot: join(root, 'files'), manifestPath: join(root, '.pulpo', 'files.json'),
    stdout: (text) => { output.stdout += text }, stderr: (text) => { output.stderr += text },
  }
  const run = async (...argv: string[]) => {
    output.stdout = ''; output.stderr = ''
    return { code: await runCli(argv, context), ...output }
  }
  const put = async (path: string, text: string) => { await mkdir(dirname(path), { recursive: true }); await writeFile(path, text) }
  const manifest = async (name: string) => JSON.parse(await readFile(join(root, '.pulpo', name), 'utf8')) as { files: Record<string, { remote: string; nodeId: string; version: string; sha256: string }> }
  return { root, calls, context, run, put, manifest, mirror: join(root, 'computer') }
}

/** Pretends to be Pulpo pulling src/app.ts from the user's computer. */
const pullApp = (text = 'one\n') => async ({ args }: RelayCall): Promise<Reply> => {
  const local = String(args.dest)
  await mkdir(dirname(local), { recursive: true }); await writeFile(local, text)
  return { body: { ok: true, output: `Pulled "src/app.ts" into ${local}`, data: { files: [{ remote: 'src/app.ts', local, nodeId: 'src/app.ts', version: sha(text) }] } } }
}

describe('pulpo computer over the relay socket', () => {
  it('prefixes relay commands and prints answers and refusals under its own name', async () => {
    const { run, calls } = await harness(({ args }) => args.path === 'secret.txt'
      ? { body: { ok: false, error: 'The folder is read only.' } }
      : { body: { ok: true, output: 'src/  (folder)' } })

    expect(await run('computer', 'ls', '/src/', '-R')).toEqual({ code: 0, stdout: 'src/  (folder)\n', stderr: '' })
    await run('computer', 'grep', '-iF', 'todo')
    expect(await run('computer', 'rm', 'secret.txt')).toEqual({ code: 1, stdout: '', stderr: 'pulpo computer rm: The folder is read only.\n' })

    expect(calls.map(({ command, args }) => ({ command, args }))).toEqual([
      { command: 'computer:ls', args: { path: 'src', recursive: true } },
      { command: 'computer:grep', args: { pattern: 'todo', ignoreCase: true, fixed: true } },
      { command: 'computer:rm', args: { path: 'secret.txt' } },
    ])
  })

  it('reports usage errors and the agent-bash requirement with its own name', async () => {
    const { run, context } = await harness(() => ({ body: { ok: true, output: '' } }))
    expect(await run('computer', 'fetch', 'x')).toMatchObject({ code: 2, stderr: 'pulpo computer: unknown command "fetch". Did you mean `pulpo computer pull`?\nRun `pulpo computer --help` for usage.\n' })
    expect(await run('nope')).toMatchObject({ code: 2, stderr: expect.stringContaining('Run `pulpo --help` for usage.') })
    expect(await run('--help')).toMatchObject({ code: 0, stdout: expect.stringContaining('pulpo computer <command>') })
    context.env = {}
    expect(await run('computer', 'ls')).toMatchObject({ code: 1, stderr: expect.stringMatching(/^pulpo computer only works inside bash commands/) })
  })

  it('pulls into /workspace/computer with its own manifest, then pushes with the pulled version as base', async () => {
    let pushed: unknown
    const { run, calls, put, manifest, mirror, root } = await harness((call) => {
      if (call.command === 'computer:pull') return pullApp()(call)
      pushed = call.args
      const items = call.args.items as Array<{ local: string; remote: string }>
      return { body: { ok: true, output: '', data: { results: items.map(({ local, remote }) => ({ local, remote, status: 'suggested', message: 'Suggested', nodeId: remote, version: sha('two\n') })) } } }
    })
    const local = join(mirror, 'src/app.ts')

    expect((await run('computer', 'pull', 'src/app.ts')).code).toBe(0)
    expect(calls[0]?.args).toEqual({ path: 'src/app.ts', dest: local })
    expect((await manifest('computer.json')).files).toEqual({ [local]: { remote: 'src/app.ts', nodeId: 'src/app.ts', version: sha('one\n'), sha256: sha('one\n') } })
    expect(await stat(join(root, '.pulpo', 'files.json')).catch(() => undefined)).toBeUndefined()
    expect(await run('files', 'status')).toMatchObject({ stdout: expect.stringContaining('Nothing has been pulled yet') })

    await put(local, 'two\n')
    await put(join(mirror, 'docs/new.md'), 'new')
    expect((await run('computer', 'status')).stdout).toBe([
      'Modified (`pulpo computer push` saves them):', `  src/app.ts  (${local})`,
      'New (`pulpo computer push` creates them in the folder on the user\'s computer):', `  docs/new.md  (${join(mirror, 'docs/new.md')})`, '',
    ].join('\n'))

    expect(await run('computer', 'push', local)).toMatchObject({ code: 0, stdout: 'suggested src/app.ts: Suggested\n' })
    expect(pushed).toEqual({ items: [{ local, remote: 'src/app.ts', base: { nodeId: 'src/app.ts', version: sha('one\n') } }] })
    expect((await manifest('computer.json')).files[local]?.version).toBe(sha('two\n'))
  })

  it('keeps Files and computer copies apart', async () => {
    const { run, put, mirror, context } = await harness(() => ({ body: { ok: true, output: '' } }))
    await put(join(context.mirrorRoot, 'Notes.md'), 'files')
    await put(join(mirror, 'notes.txt'), 'computer')
    expect((await run('files', 'status')).stdout).toContain('Notes.md')
    expect((await run('files', 'status')).stdout).not.toContain('notes.txt')
    expect((await run('computer', 'status')).stdout).toContain('notes.txt')
    expect((await run('computer', 'status')).stdout).not.toContain('Notes.md')
  })
})
