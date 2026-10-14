import { createHash } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { runCli, type CliContext } from './cli-main.js'

type RelayCall = { operationId: string; command: string; args: Record<string, unknown> }
type Reply = { status?: number; body: unknown }

const cleanups: Array<() => Promise<void>> = []
const sha = (text: string) => createHash('sha256').update(text).digest('hex')

afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup() })

/** A stand-in for the daemon's relay socket that answers like Pulpo would. */
async function harness(answer: (call: RelayCall) => Reply | Promise<Reply>) {
  const root = await mkdtemp(join(tmpdir(), 'pulpo-cli-'))
  const socket = join(root, 'relay.sock')
  const calls: RelayCall[] = []
  const server: Server = createServer(async (request, response) => {
    const chunks: Buffer[] = []
    for await (const chunk of request) chunks.push(chunk as Buffer)
    expect(request.method).toBe('POST')
    expect(request.url).toBe('/v1/requests')
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
    return { code: await runCli(['files', ...argv], context), ...output }
  }
  const put = async (path: string, text: string) => { await mkdir(dirname(path), { recursive: true }); await writeFile(path, text) }
  const manifest = async () => JSON.parse(await readFile(context.manifestPath, 'utf8')) as { files: Record<string, { remote: string; nodeId: string; version: string; sha256: string }> }
  return { root, calls, context, run, put, manifest }
}

/** Pretends to be Pulpo pulling Projects/Plan.md: write the bytes where the CLI asked, then report it. */
const pullPlan = (text = '# Plan\n') => async ({ args }: RelayCall): Promise<Reply> => {
  const local = String(args.dest)
  await mkdir(dirname(local), { recursive: true }); await writeFile(local, text)
  return { body: { ok: true, output: `Pulled Projects/Plan.md to ${local}`, data: { files: [{ remote: 'Projects/Plan.md', local, nodeId: 'node-1', version: 'v1', kind: 'doc', sizeBytes: text.length }] } } }
}

describe('pulpo files over the relay socket', () => {
  it('passes commands through, normalizing Files paths, and prints the answer', async () => {
    const { run, calls } = await harness(() => ({ body: { ok: true, output: 'Projects/\n  Plan.md' } }))

    expect(await run('ls', '/Projects/', '-R')).toEqual({ code: 0, stdout: 'Projects/\n  Plan.md\n', stderr: '' })
    await run('tree', '--depth', '2')
    await run('grep', '-i', 'budget', 'Projects')
    await run('mkdir', '-p', 'A/B')

    expect(calls).toEqual([
      { operationId: 'op-1', command: 'ls', args: { path: 'Projects', recursive: true } },
      { operationId: 'op-1', command: 'tree', args: { depth: 2 } },
      { operationId: 'op-1', command: 'grep', args: { pattern: 'budget', path: 'Projects', ignoreCase: true } },
      { operationId: 'op-1', command: 'mkdir', args: { path: 'A/B', parents: true } },
    ])
  })

  it('prints refusals on stderr with exit status 1', async () => {
    const { run } = await harness(({ args }) => args.path === 'Secret.md'
      ? { body: { ok: false, error: 'Secret.md is read only. Ask the user to allow changes.' } }
      : { status: 409, body: { ok: false, error: 'pulpo files only works while the bash command that started it is running' } })

    expect(await run('rm', 'Secret.md')).toEqual({ code: 1, stdout: '', stderr: 'pulpo files rm: Secret.md is read only. Ask the user to allow changes.\n' })
    expect((await run('cat', 'Other.md')).stderr).toContain('only works while the bash command')
  })

  it('keeps going through several paths and reports the failures', async () => {
    const { run } = await harness(({ args }) => args.path === 'bad.md' ? { body: { ok: false, error: 'Not found: bad.md' } } : { body: { ok: true, output: `text of ${String(args.path)}` } })
    expect(await run('cat', 'a.md', 'bad.md', 'c.md')).toEqual({ code: 1, stdout: 'text of a.md\ntext of c.md\n', stderr: 'pulpo files cat: Not found: bad.md\n' })
  })

  it('explains that it only works inside agent bash commands', async () => {
    const { run, context } = await harness(() => ({ body: { ok: true, output: '' } }))
    context.env = {}
    expect(await run('ls')).toMatchObject({ code: 1, stderr: expect.stringContaining('only works inside bash commands run by the Pulpo agent') })
    context.env = { PULPO_OPERATION_ID: 'op-1', PULPO_RELAY_SOCKET: join(context.mirrorRoot, 'missing.sock') }
    expect(await run('ls')).toMatchObject({ code: 1, stderr: expect.stringContaining('cannot reach the workspace daemon') })
  })

  it('pulls into the mirror and records the manifest', async () => {
    const { run, calls, context, manifest } = await harness(pullPlan())
    const local = join(context.mirrorRoot, 'Projects/Plan.md')

    expect(await run('pull', 'Projects/Plan.md')).toMatchObject({ code: 0, stdout: `Pulled Projects/Plan.md to ${local}\n` })

    expect(calls[0]?.args).toEqual({ path: 'Projects/Plan.md', dest: local })
    expect((await manifest()).files).toEqual({ [local]: { remote: 'Projects/Plan.md', nodeId: 'node-1', version: 'v1', sha256: sha('# Plan\n') } })
    expect(await run('status')).toMatchObject({ code: 0, stdout: 'No local changes.\n' })
  })

  it('pulls into an existing directory like cp, but not into an earlier pull of the same item', async () => {
    const { run, calls, context, put } = await harness(async ({ args }) => {
      if (args.path !== 'Projects') return { body: { ok: true, output: '' } }
      const local = join(String(args.dest), 'Plan.md')
      await put(local, 'plan')
      return { body: { ok: true, output: '', data: { files: [{ remote: 'Projects/Plan.md', local, nodeId: 'n', version: 'v' }] } } }
    })
    await mkdir(join(context.cwd, 'out'), { recursive: true })
    await run('pull', 'Data/sales.csv', 'out')
    expect(calls[0]?.args.dest).toBe(join(context.cwd, 'out/sales.csv'))

    await run('pull', 'Projects', 'proj2')
    expect(calls[1]?.args.dest).toBe(join(context.cwd, 'proj2'))
    await run('pull', 'Projects', 'proj2')
    expect(calls[2]?.args.dest).toBe(join(context.cwd, 'proj2'))
    await run('pull', 'Projects', 'proj2/')
    expect(calls[3]?.args.dest).toBe(join(context.cwd, 'proj2/Projects'))
  })

  it('pushes local edits with the pulled base and records the new version', async () => {
    let pushed: unknown
    const { run, context, manifest, put } = await harness((call) => {
      if (call.command === 'pull') return pullPlan()(call)
      pushed = call.args
      const items = call.args.items as Array<{ local: string; remote: string }>
      return { body: { ok: true, output: 'updated Projects/Plan.md (suggested to the user)', data: { results: items.map(({ local, remote }) => ({ local, remote, status: 'suggested', message: 'Waiting for the user', nodeId: 'node-1', version: 'v2' })) } } }
    })
    const local = join(context.mirrorRoot, 'Projects/Plan.md')
    await run('pull', 'Projects/Plan.md')
    await put(local, '# Plan\n\nMore.\n')
    await put(join(context.mirrorRoot, '.notes'), 'hidden')

    expect(await run('status')).toMatchObject({ stdout: `Modified (\`pulpo files push\` saves them):\n  Projects/Plan.md  (${local})\n` })
    expect(await run('push')).toEqual({ code: 0, stdout: 'updated Projects/Plan.md (suggested to the user)\n', stderr: '' })

    expect(pushed).toEqual({ items: [{ local, remote: 'Projects/Plan.md', base: { nodeId: 'node-1', version: 'v1' } }] })
    expect((await manifest()).files[local]).toEqual({ remote: 'Projects/Plan.md', nodeId: 'node-1', version: 'v2', sha256: sha('# Plan\n\nMore.\n') })
    expect(await run('push')).toMatchObject({ code: 0, stdout: expect.stringContaining('Nothing to push') })
  })

  it('exits 1 on conflicts and leaves their manifest entries alone', async () => {
    const { run, context, manifest, put } = await harness((call) => {
      if (call.command === 'pull') return pullPlan()(call)
      const items = call.args.items as Array<{ local: string; remote: string }>
      return { body: { ok: true, output: '', data: { results: items.map(({ local, remote }) => remote === 'Projects/Plan.md'
        ? { local, remote, status: 'conflict', message: 'changed in Files since you pulled it' }
        : { local, remote, status: 'created', message: 'created', nodeId: 'node-2', version: 'n1' }) } } }
    })
    const local = join(context.mirrorRoot, 'Projects/Plan.md')
    await run('pull', 'Projects/Plan.md')
    await put(local, 'mine')
    await put(join(context.mirrorRoot, 'Projects/New.txt'), 'new')

    const result = await run('push')

    expect(result.code).toBe(1)
    expect(result.stdout).toContain('conflict Projects/Plan.md: changed in Files since you pulled it\ncreated Projects/New.txt: created\n')
    expect(result.stdout).toContain('push with --force')
    const files = (await manifest()).files
    expect(files[local]?.version).toBe('v1')
    expect(files[join(context.mirrorRoot, 'Projects/New.txt')]).toEqual({ remote: 'Projects/New.txt', nodeId: 'node-2', version: 'n1', sha256: sha('new') })
  })

  it('splits large pushes into batches of 200', async () => {
    const sizes: number[] = []
    const { run, context, put } = await harness((call) => {
      const items = call.args.items as Array<{ local: string; remote: string }>
      sizes.push(items.length)
      return { body: { ok: true, output: '', data: { results: items.map(({ local, remote }) => ({ local, remote, status: 'created', message: '', nodeId: remote, version: 'v' })) } } }
    })
    for (let index = 0; index < 205; index += 1) await put(join(context.mirrorRoot, `Bulk/${String(index).padStart(3, '0')}.txt`), String(index))
    expect((await run('push')).code).toBe(0)
    expect(sizes).toEqual([200, 5])
  })

  it('after mv, a plain push of an edited copy reports the move instead of recreating the item', async () => {
    const { run, calls, context, put, manifest } = await harness((call) => {
      if (call.command === 'pull') return pullPlan()(call)
      if (call.command === 'mv') return { body: { ok: true, output: 'Moved Projects/Plan.md into Archive' } }
      const items = call.args.items as Array<{ local: string; remote: string }>
      return { body: { ok: true, output: 'created', data: { results: items.map(({ local, remote }) => ({ local, remote, status: 'created', message: '', nodeId: 'node-9', version: 'v9' })) } } }
    })
    const local = join(context.mirrorRoot, 'Projects/Plan.md')
    await run('pull', 'Projects/Plan.md')
    await put(local, '# Plan\n\nEdited.\n')

    expect((await run('mv', 'Projects/Plan.md', 'Archive')).stdout).toContain(`Kept ${local}: it has unpushed edits. Pull the new path`)
    expect((await run('status')).stdout).toBe(`Moved or trashed in Files (push with --to <path>, pull the new path, or delete the copy):\n  Projects/Plan.md (moved to "Archive")  (${local})\n`)
    expect(await run('push')).toEqual({
      code: 1, stderr: '',
      stdout: 'skipped Projects/Plan.md: Projects/Plan.md was moved in Files (to "Archive"). Pull it from its new path, or push this copy with --to <path>.\n',
    })
    expect(calls.filter((call) => call.command === 'push')).toEqual([])

    expect((await run('push', local, '--to', 'Archive/Plan.md')).code).toBe(0)
    expect(calls.at(-1)?.args).toEqual({ items: [{ local, remote: 'Archive/Plan.md', base: null }] })
    expect(await manifest()).toEqual({ version: 1, files: { [local]: { remote: 'Archive/Plan.md', nodeId: 'node-9', version: 'v9', sha256: sha('# Plan\n\nEdited.\n') } } })
  })

  it('after rm and mv forgets the old path and removes unchanged mirror copies', async () => {
    const { run, context, manifest, put } = await harness(async (call) => {
      if (call.command !== 'pull') return { body: { ok: true, output: `${call.command} done` } }
      const dest = String(call.args.dest)
      const files = ['Plan.md', 'Notes.md'].map((name) => ({ remote: `Projects/${name}`, local: join(dest, name), nodeId: name, version: 'v1' }))
      for (const file of files) { await mkdir(dirname(file.local), { recursive: true }); await writeFile(file.local, file.remote) }
      return { body: { ok: true, output: 'pulled', data: { files } } }
    })
    await run('pull', 'Projects')
    await put(join(context.mirrorRoot, 'Projects/Notes.md'), 'edited')

    const removed = await run('rm', '-r', 'projects')

    expect(removed.code).toBe(0)
    expect(removed.stdout).toContain(`Removed the local copy ${join(context.mirrorRoot, 'Projects/Plan.md')}.`)
    expect(removed.stdout).toContain(`Kept ${join(context.mirrorRoot, 'Projects/Notes.md')}: it has unpushed edits`)
    expect((await manifest()).files).toEqual({})
    expect(await stat(join(context.mirrorRoot, 'Projects/Plan.md')).catch(() => undefined)).toBeUndefined()

    await rm(join(context.mirrorRoot, 'Projects'), { recursive: true })
    await run('pull', 'Projects')
    expect((await run('mv', 'Projects/Plan.md', 'Archive')).stdout).toBe(`mv done\nRemoved the local copy ${join(context.mirrorRoot, 'Projects/Plan.md')}.\n`)
    expect(Object.values((await manifest()).files).map((entry) => entry.remote)).toEqual(['Projects/Notes.md'])
  })
})
