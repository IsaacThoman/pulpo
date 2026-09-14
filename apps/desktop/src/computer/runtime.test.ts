import { afterEach, beforeEach, expect, it } from 'vitest'
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createComputerRuntime, type ComputerRuntime } from './runtime'
import { defaultComputerConfig } from './config-store'

const chatA = '00000000-0000-4000-8000-000000000001'
const chatB = '00000000-0000-4000-8000-000000000002'
let directory: string
let runtime: ComputerRuntime
beforeEach(async () => {
  directory = await realpath(await mkdtemp(join(tmpdir(), 'pulpo-chat-paths-')))
  runtime = createComputerRuntime({ config: { ...defaultComputerConfig('test'), accessMode: 'full', enabled: true }, userDataDir: directory, homeDir: directory, platform: process.platform, arch: 'test', appVersion: 'test' })
})
afterEach(async () => { await runtime.cancelAll(); await rm(directory, { recursive: true, force: true }) })

it('gives each chat stable attachment storage and keeps its working root', async () => {
  const a = runtime.forChat(chatA), b = runtime.forChat(chatB)
  expect(a).toBe(runtime.forChat(chatA))
  expect(a.attachmentsDir).toBe(join(directory, 'agent-workspace', 'chats', chatA, 'attachments'))
  expect(a.policy.root).toBe(directory)
  await mkdir(a.attachmentsDir, { recursive: true })
  await mkdir(b.attachmentsDir, { recursive: true })
  const own = join(a.attachmentsDir, 'same.txt'), other = join(b.attachmentsDir, 'same.txt')
  await writeFile(own, 'own'); await writeFile(other, 'other')
  expect(await a.policy.readable(own)).toBe(own)
  expect(await a.attachmentsPolicy.exportable(own)).toBe(own)
  await expect(a.policy.readable(other)).rejects.toThrow(/different chat/)
  await expect(a.policy.exportable(other)).rejects.toThrow(/different chat/)
  await expect(a.policy.writableChecked(other)).rejects.toThrow(/different chat/)
  await expect(a.attachmentsPolicy.writableChecked(other)).rejects.toThrow()
  await expect(a.policy.readable(join(directory, 'agent-workspace', 'attachments', 'old.txt'))).rejects.toThrow(/different chat/)
})

it('rejects missing and malformed chat IDs before constructing paths', () => {
  for (const id of ['', '../escape', 'a/b', 'C:\\escape']) expect(() => runtime.forChat(id)).toThrow()
})

it.skipIf(process.platform === 'win32')('rejects symlinks into other chats and staging through a redirected parent', async () => {
  const a = runtime.forChat(chatA), b = runtime.forChat(chatB)
  await mkdir(b.attachmentsDir, { recursive: true })
  const other = join(b.attachmentsDir, 'secret.txt')
  await writeFile(other, 'secret')
  await symlink(other, join(directory, 'alias.txt'))
  await expect(a.policy.readable(join(directory, 'alias.txt'))).rejects.toThrow(/different chat/)
  await symlink(join(directory, 'agent-workspace', 'chats', chatB), join(directory, 'agent-workspace', 'chats', chatA))
  await expect(a.attachmentsPolicy.writableChecked(join(a.attachmentsDir, 'new.txt'))).rejects.toThrow()
})

it('keeps search results and operation journals within the requesting chat', async () => {
  const a = runtime.forChat(chatA), b = runtime.forChat(chatB)
  await mkdir(b.attachmentsDir, { recursive: true })
  await writeFile(join(b.attachmentsDir, 'secret.txt'), 'hidden-chat-content')
  await writeFile(join(directory, 'project.txt'), 'visible-project-content')
  await a.runner.execute('same-operation', 'grep', { path: directory, pattern: 'content' })
  let operation = await a.runner.find('same-operation')
  for (let i = 0; operation?.status === 'running' && i < 100; i++) {
    await new Promise((resolve) => setTimeout(resolve, 10))
    operation = await a.runner.find('same-operation')
  }
  expect(operation?.status).toBe('completed')
  expect(operation?.output).toContain('visible-project-content')
  expect(operation?.output).not.toContain('hidden-chat-content')
  expect(await b.runner.find('same-operation')).toBeUndefined()
})
