import { PassThrough } from 'node:stream'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createProgram, preflightModelBody } from './index.js'
import { addContext, loadConfig, macosKeychainWriteCommand, resolveConnection } from './config.js'
import { confirmExact, readSecret } from './io.js'

function commandNames(program: ReturnType<typeof createProgram>, group: string): string[] {
  return program.commands.find((command) => command.name() === group)?.commands.map((command) => command.name()) ?? []
}

function nestedCommandNames(program: ReturnType<typeof createProgram>, group: string, child: string): string[] {
  return program.commands.find((command) => command.name() === group)?.commands
    .find((command) => command.name() === child)?.commands.map((command) => command.name()) ?? []
}

describe('Pulpo CLI command surface', () => {
  it('exposes the operator command groups and omits restore', () => {
    const program = createProgram({ stdin: new PassThrough() as never, stdout: new PassThrough(), stderr: new PassThrough() })
    expect(program.commands.map((command) => command.name())).toEqual(expect.arrayContaining([
      'context', 'auth', 'token', 'instance', 'settings', 'provider', 'lab', 'icon', 'model', 'user',
      'usage', 'audit', 'workspace', 'banner', 'job', 'export', 'backup',
    ]))
    expect(commandNames(program, 'settings')).toEqual(expect.arrayContaining(['get', 'set', 'edit', 'schema', 'export', 'diff', 'apply']))
    expect(commandNames(program, 'auth')).toContain('2fa')
    expect(nestedCommandNames(program, 'auth', '2fa')).toEqual(expect.arrayContaining([
      'status', 'setup', 'confirm', 'regenerate-recovery-codes', 'disable',
    ]))
    expect(commandNames(program, 'model')).toContain('icons')
    expect(commandNames(program, 'icon')).toEqual(expect.arrayContaining(['list', 'get', 'upload', 'update', 'delete']))
    expect(commandNames(program, 'backup')).not.toContain('restore')
    expect(commandNames(program, 'user')).toEqual(expect.arrayContaining([
      'approve', 'role', 'block', 'unblock', 'balance', 'storage', 'reset-link', 'delete',
    ]))
  })

  it('defines stable machine and safety flags', () => {
    const program = createProgram({ stdin: new PassThrough() as never, stdout: new PassThrough(), stderr: new PassThrough() })
    const flags = program.options.map((option) => option.long)
    expect(flags).toEqual(expect.arrayContaining(['--context', '--url', '--json', '--no-color', '--yes', '--verbose']))
  })

  it('lists and filters canonical preset icons locally in machine mode', async () => {
    const stdout = new PassThrough()
    let createdClient = false
    const program = createProgram(
      { stdin: new PassThrough() as never, stdout, stderr: new PassThrough() },
      { createClient: () => { createdClient = true; throw new Error('unexpected client') } },
    )
    await program.parseAsync(['node', 'pulpo', 'model', 'icons', 'CAMERA', '--json'])
    const rows = JSON.parse(stdout.read().toString()) as Array<{ name: string }>
    expect(rows).toContainEqual({ name: 'camera' })
    expect(rows.every(({ name }) => name.includes('camera'))).toBe(true)
    expect(createdClient).toBe(false)
  })

  it('preflights model preset and choice icons', () => {
    expect(preflightModelBody({
      presets: [{
        id: 'media', name: 'Media', icon: 'camera',
        choices: [{ id: 'chart', displayName: 'Chart', icon: 'chart-no-axes-column', action: { type: 'none' } }],
      }],
    })).toBeTruthy()
    expect(() => preflightModelBody({
      presets: [{
        id: 'bad', name: 'Bad', icon: 'not-a-lucide-icon',
        choices: [{ id: 'on', displayName: 'On', action: { type: 'none' } }],
      }],
    })).toThrow('pulpo model icons')
  })

  it('accepts the global URL option after context add', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pulpo-cli-context-test-'))
    const previous = process.env.XDG_CONFIG_HOME
    const io = { stdin: new PassThrough() as never, stdout: new PassThrough(), stderr: new PassThrough() }
    try {
      process.env.XDG_CONFIG_HOME = root
      const program = createProgram(io)
      await program.parseAsync(['node', 'pulpo', 'context', 'add', 'production', '--url', 'https://pulpo.baby'])
      expect(await loadConfig()).toEqual({
        currentContext: 'production',
        contexts: { production: { url: 'https://pulpo.baby' } },
      })
    } finally {
      if (previous === undefined) delete process.env.XDG_CONFIG_HOME
      else process.env.XDG_CONFIG_HOME = previous
      await rm(root, { recursive: true, force: true })
    }
  })

  it('keeps macOS Keychain secret data out of process arguments', () => {
    const invocation = macosKeychainWriteCommand('production')
    expect(invocation.command).toBe('/usr/bin/expect')
    expect(invocation.args.join(' ')).not.toContain('production')
    expect(invocation.env.PULPO_CLI_KEYCHAIN_CONTEXT).toBe('production')
  })

  it('reads noninteractive secrets from injected stdin and requires --yes in machine mode', async () => {
    const stdin = new PassThrough()
    const io = { stdin: stdin as never, stdout: new PassThrough(), stderr: new PassThrough() }
    stdin.end('correct horse battery staple\n')
    await expect(readSecret(io, 'Password: ')).resolves.toBe('correct horse battery staple')
    await expect(confirmExact(io, 'resource-id', false, true)).rejects.toThrow('--yes')
    await expect(confirmExact(io, 'resource-id', true, true)).resolves.toBeUndefined()
  })

  it('does not leak a stored credential to a URL override', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pulpo-cli-test-'))
    const previous = {
      xdg: process.env.XDG_CONFIG_HOME,
      url: process.env.PULPO_URL,
      token: process.env.PULPO_TOKEN,
      context: process.env.PULPO_CONTEXT,
    }
    try {
      process.env.XDG_CONFIG_HOME = root
      delete process.env.PULPO_URL
      delete process.env.PULPO_TOKEN
      delete process.env.PULPO_CONTEXT
      await addContext('production', 'https://one.example.com')
      await mkdir(join(root, 'pulpo'), { recursive: true })
      await writeFile(join(root, 'pulpo', 'credentials.json'), JSON.stringify({ production: 'stored-token' }), { mode: 0o600 })

      process.env.PULPO_URL = 'https://two.example.com'
      expect(await resolveConnection({})).toMatchObject({ url: 'https://two.example.com', token: null })
      process.env.PULPO_TOKEN = 'environment-token'
      expect(await resolveConnection({})).toMatchObject({ url: 'https://two.example.com', token: 'environment-token' })
      await expect(addContext('__proto__', 'https://one.example.com')).rejects.toThrow('Context names')
    } finally {
      for (const [key, value] of Object.entries(previous)) {
        const name = key === 'xdg' ? 'XDG_CONFIG_HOME' : `PULPO_${key.toUpperCase()}`
        if (value === undefined) delete process.env[name]
        else process.env[name] = value
      }
      await rm(root, { recursive: true, force: true })
    }
  })
})
