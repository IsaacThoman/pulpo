import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { ComputerOperationSnapshot, ComputerReply, ComputerRequest, ToolApproval } from '@pulpo/contracts'
import { ComputerAgent, type ComputerPromptHandle, type ComputerSocket } from './agent'
import { saveComputerConfig, defaultComputerConfig } from './config-store'

const posixOnly = process.platform === 'win32' ? describe.skip : describe

class FakeSocket extends EventEmitter {
  emitted: Array<{ event: string; args: unknown[] }> = []
  disconnected = false
  emit(event: string, ...args: unknown[]): boolean {
    if (['connect', 'disconnect', 'connect_error'].includes(event) || event.startsWith('computer.') && this.listenerCount(event) > 0 && !['computer.heartbeat', 'computer.update', 'computer.approval.decide', 'computer.pairing.decide'].includes(event)) {
      return super.emit(event, ...args)
    }
    this.emitted.push({ event, args })
    const ack = args.at(-1)
    if (typeof ack === 'function') ack({ ok: true })
    return true
  }
  disconnect(): this { this.disconnected = true; return this }
}

function prompt(decision: Promise<boolean>): ComputerPromptHandle {
  return { decision, dismiss: vi.fn() }
}

async function settled(agent: ComputerAgent, id: string): Promise<ComputerOperationSnapshot> {
  for (let attempt = 0; attempt < 400; attempt += 1) {
    const reply = await agent.handleRequest({ kind: 'operation.status', id }) as ComputerReply<'operation.status'>
    if (reply.ok && reply.result && reply.result.status !== 'running') return reply.result
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  throw new Error('operation did not settle')
}

posixOnly('ComputerAgent', () => {
  let directory = ''
  let root = ''
  let socket: FakeSocket
  let approvalPrompts: Array<{ approval: ToolApproval; resolve: (value: boolean) => void }> = []
  let agent: ComputerAgent

  beforeEach(async () => {
    directory = await realpath(await mkdtemp(join(tmpdir(), 'pulpo-agent-')))
    root = join(directory, 'project')
    await mkdir(root)
    await writeFile(join(directory, 'outside.txt'), 'secret')
    await saveComputerConfig(directory, { ...defaultComputerConfig('studio'), enabled: true, rootPath: root })
    socket = new FakeSocket()
    approvalPrompts = []
    agent = new ComputerAgent({
      userDataDir: directory, homeDir: directory, hostname: 'studio', platform: process.platform, arch: 'arm64', appVersion: '0.0.0-test',
      loadSession: async () => ({ instanceUrl: 'https://pulpo.test', token: 'x'.repeat(40) }),
      prompts: {
        approval: (approval) => prompt(new Promise((resolve) => approvalPrompts.push({ approval, resolve }))),
        pairing: () => prompt(Promise.resolve(false)),
      },
      connect: () => socket as unknown as ComputerSocket,
      log: { info() {}, warn() {}, error() {} },
      approvalGraceMs: 50,
    })
    await agent.start()
    socket.emit('connect')
  })
  afterEach(async () => {
    await agent.stop()
    await rm(directory, { recursive: true, force: true })
  })

  it('announces itself with the folder configuration and reports online', () => {
    expect(agent.state.status).toBe('online')
    expect(agent.state).toMatchObject({ enabled: true, accessMode: 'folder', rootPath: root, name: 'studio' })
  })

  it('runs unrestricted reads and lists immediately but refuses gated operations without an approval', async () => {
    await writeFile(join(root, 'notes.txt'), 'hello\n')
    await agent.handleRequest({ kind: 'operation.start', id: 'op-ls', type: 'list', args: {} })
    expect((await settled(agent, 'op-ls')).output).toContain('- notes.txt')
    const refused = await agent.handleRequest({ kind: 'operation.start', id: 'op-bash', type: 'bash', args: { command: 'echo hi' } })
    expect(refused).toEqual({ ok: false, error: expect.stringMatching(/approval/), code: 'approval_required' })
    expect((await agent.handleRequest({ kind: 'operation.status', id: 'op-bash' })).ok && (await agent.handleRequest({ kind: 'operation.status', id: 'op-bash' }) as { result: unknown }).result).toBeNull()
  })

  it('runs a gated operation once the user approves it natively and reports the decision', async () => {
    const approval: ToolApproval = {
      id: '11111111-1111-4111-8111-111111111111', responseId: '22222222-2222-4222-8222-222222222222', chatId: '33333333-3333-4333-8333-333333333333',
      computerId: agent.state.computerId, computerName: 'studio', toolCallId: 'op-write', kind: 'write', summary: 'notes.txt', status: 'pending',
      expiresAt: new Date(Date.now() + 60_000).toISOString(), decidedAt: null, decidedVia: null, createdAt: new Date().toISOString(),
    }
    socket.emit('computer.approval.requested', approval)
    expect(approvalPrompts).toHaveLength(1)
    expect(agent.state.pendingApprovals).toBe(1)
    approvalPrompts[0]!.resolve(true)
    await vi.waitFor(() => expect(socket.emitted.some((entry) => entry.event === 'computer.approval.decide')).toBe(true))
    const started = await agent.handleRequest({ kind: 'operation.start', id: 'op-write', type: 'write', args: { path: 'notes.txt', content: 'written' }, approvalId: approval.id })
    expect(started.ok).toBe(true)
    await settled(agent, 'op-write')
    expect(await readFile(join(root, 'notes.txt'), 'utf8')).toBe('written')
    expect(agent.state.pendingApprovals).toBe(0)
  })

  it('accepts an approval decided from the chat that arrives just after the operation request', async () => {
    const approvalId = '44444444-4444-4444-8444-444444444444'
    const pending = agent.handleRequest({ kind: 'operation.start', id: 'op-late', type: 'bash', args: { command: 'echo late' }, approvalId })
    setTimeout(() => socket.emit('computer.approval.decided', { approvalId, status: 'approved' }), 10)
    const reply = await pending
    expect(reply.ok).toBe(true)
    expect((await settled(agent, 'op-late')).output.trim()).toBe('late')
  })

  it('confines file tools to the chosen folder and stages attachments into the app directory', async () => {
    const outside = await agent.handleRequest({ kind: 'operation.start', id: 'op-outside', type: 'read', args: { path: join(directory, 'outside.txt') } })
    expect(outside.ok).toBe(true)
    expect((await settled(agent, 'op-outside')).error).toMatch(/readable roots/)

    const attachmentsDir = join(directory, 'agent-workspace', 'attachments')
    const target = join(attachmentsDir, 'abc-file.txt')
    const data = Buffer.from('attached content')
    const begin = await agent.handleRequest({ kind: 'file.begin', transferId: 't1', path: target, sizeBytes: data.byteLength, checksum: null })
    expect(begin.ok).toBe(true)
    await agent.handleRequest({ kind: 'file.chunk', transferId: 't1', data: data.toString('base64') })
    const end = await agent.handleRequest({ kind: 'file.end', transferId: 't1' })
    expect(end).toEqual({ ok: true, result: { path: target } })
    expect(await readFile(target, 'utf8')).toBe('attached content')
    const missing = await agent.handleRequest({ kind: 'files.missing', files: [{ path: target, checksum: null, sizeBytes: data.byteLength }] })
    expect(missing).toEqual({ ok: true, result: { missing: [target] } })

    const denied = await agent.handleRequest({ kind: 'file.begin', transferId: 't2', path: join(root, 'escape.txt'), sizeBytes: 1, checksum: null }).catch((error: Error) => error.message)
    expect(String(denied)).toMatch(/escapes/)

    const exported = await agent.handleRequest({ kind: 'file.read', scope: 'export', path: target, offset: 0, length: 1024, maxBytes: 1_000_000 }) as Extract<ComputerReply<'file.read'>, { ok: true }>
    expect(Buffer.from(exported.result.data, 'base64').toString('utf8')).toBe('attached content')
    expect(exported.result.eof).toBe(true)
  })

  it('disables itself and cancels running work when the server revokes it', async () => {
    socket.emit('computer.approval.decided', { approvalId: '55555555-5555-4555-8555-555555555555', status: 'approved' })
    await agent.handleRequest({ kind: 'operation.start', id: 'op-sleep', type: 'bash', args: { command: 'sleep 30' }, approvalId: '55555555-5555-4555-8555-555555555555' })
    socket.emit('computer.revoked', { reason: 'disabled' })
    await vi.waitFor(() => expect(agent.state.status).toBe('disabled'))
    expect(agent.state.enabled).toBe(false)
    const reply = await agent.handleRequest({ kind: 'operation.status', id: 'op-sleep' } satisfies ComputerRequest)
    expect(reply).toEqual({ ok: false, error: expect.any(String), code: 'disabled' })
  })

  it('reconnects with a fresh announce when the configuration changes', async () => {
    const state = await agent.updateConfig({ approvalPolicy: 'never', allowRemote: true })
    expect(state).toMatchObject({ approvalPolicy: 'never', allowRemote: true })
    const update = socket.emitted.find((entry) => entry.event === 'computer.update')
    expect(update?.args[0]).toMatchObject({ approvalPolicy: 'never', allowRemote: true, rootPath: root })
    const reply = await agent.handleRequest({ kind: 'operation.start', id: 'op-free', type: 'bash', args: { command: 'echo free' } })
    expect(reply.ok).toBe(true)
  })
})
