import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Command, CommanderError, Option } from 'commander'
import { z } from 'zod'
import { ManagementApiError, PulpoManagementClient } from '@pulpo/client-core'
import {
  CHAT_PRESET_ICON_NAMES,
  chatPresetsSchema,
  managementAccountSettingsDocumentSchema,
  managementInstanceSettingsDocumentSchema,
  managementSettingsDocumentSchema,
} from '@pulpo/contracts'
import {
  addContext,
  deleteCredential,
  loadConfig,
  removeContext,
  resolveConnection,
  saveConfig,
  setCredential,
} from './config.js'
import { confirmExact, processIo, readSecret, writeError, writeOutput, type CliIo } from './io.js'
import {
  explicitAgentMode,
  followResponse,
  readModelTestPrompt,
  resolvePresetSelections,
  responseText,
  runModelTest,
  type FollowResponse,
  type ModelCatalog,
} from './model-test.js'

declare const __PULPO_CLI_VERSION__: string
declare const __PULPO_CLI_BUNDLED__: boolean
const CLI_VERSION = typeof __PULPO_CLI_VERSION__ === 'string' ? __PULPO_CLI_VERSION__ : '0.1.0'
const CLI_BUNDLED = typeof __PULPO_CLI_BUNDLED__ === 'boolean' && __PULPO_CLI_BUNDLED__
const commandIo = new WeakMap<Command, CliIo>()
const commandClientFactory = new WeakMap<Command, CliDependencies['createClient']>()

class NamedOption extends Option {
  constructor(flags: string, private readonly optionAttribute: string, description?: string) {
    super(flags, description)
  }

  override attributeName(): string {
    return this.optionAttribute
  }
}

export interface CliDependencies {
  createClient?: (url: string, token: string | null, fetchImpl: typeof fetch) => PulpoManagementClient
  followResponse?: FollowResponse
}

export function catalogIconContentType(filename: string): string | null {
  const extension = /\.([^.]+)$/.exec(filename)?.[1]?.toLowerCase()
  return extension === 'png' ? 'image/png'
    : extension === 'jpg' || extension === 'jpeg' ? 'image/jpeg'
      : extension === 'webp' ? 'image/webp'
        : extension === 'svg' ? 'image/svg+xml' : null
}

const COMMAND_CAPABILITIES: Record<string, string> = {
  token: 'managementTokens',
  settings: 'settings',
  provider: 'catalog',
  lab: 'catalog',
  icon: 'catalogIcons',
  model: 'catalog',
  user: 'users',
  usage: 'usage',
  audit: 'audit',
  workspace: 'workspaces',
  banner: 'banners',
  export: 'exports',
  backup: 'backups',
  job: 'operations',
}

interface GlobalOptions {
  context?: string
  url?: string
  json?: boolean
  color?: boolean
  yes?: boolean
  verbose?: boolean
}

function globalOptions(command: Command): GlobalOptions {
  return command.optsWithGlobals() as GlobalOptions
}

function parseValue(value: string): unknown {
  try { return JSON.parse(value) } catch { return value }
}

function valueAt(value: unknown, path: string | undefined): unknown {
  if (!path) return value
  return path.split('.').reduce<unknown>((current, key) => {
    if (!current || typeof current !== 'object' || !(key in current)) throw new Error(`Unknown settings path: ${path}`)
    return (current as Record<string, unknown>)[key]
  }, value)
}

function setValueAt<T>(document: T, path: string, value: unknown, parse: (input: unknown) => T): T {
  if (!path.startsWith('account.') && !path.startsWith('instance.')) {
    throw new Error('Settings paths must begin with account. or instance.')
  }
  const copy = structuredClone(document) as unknown as Record<string, unknown>
  const parts = path.split('.')
  let cursor = copy
  for (const part of parts.slice(0, -1)) {
    const next = cursor[part]
    if (!next || typeof next !== 'object' || Array.isArray(next)) throw new Error(`Unknown settings path: ${path}`)
    cursor = next as Record<string, unknown>
  }
  cursor[parts.at(-1)!] = value
  return parse(copy)
}

const SECRET_INPUT_KEYS = new Set(['apiKey', 'password', 'secret', 'clientSecret'])

function resolveEnvironmentReferences(value: unknown, path = ''): unknown {
  if (Array.isArray(value)) return value.map((item, index) => resolveEnvironmentReferences(item, `${path}[${index}]`))
  if (!value || typeof value !== 'object') return value
  const record = value as Record<string, unknown>
  if (Object.keys(record).length === 1 && typeof record.fromEnv === 'string') {
    const secret = process.env[record.fromEnv]
    if (secret === undefined) throw new Error(`Environment variable ${record.fromEnv} is not set`)
    return secret
  }
  return Object.fromEntries(Object.entries(record).map(([key, item]) => {
    const itemPath = path ? `${path}.${key}` : key
    if (SECRET_INPUT_KEYS.has(key) && typeof item === 'string') {
      throw new Error(`${itemPath} must use { "fromEnv": "NAME" } instead of a plaintext JSON secret`)
    }
    return [key, resolveEnvironmentReferences(item, itemPath)]
  }))
}

function resolveSettingsSecrets<T extends { instance: { webTools: { apiKey?: { configured: true } | { fromEnv: string } | { clear: true } } } }>(document: T): {
  document: T
  secrets?: { webToolsApiKey?: string | null }
} {
  const copy = structuredClone(document)
  const directive = copy.instance.webTools.apiKey
  if (!directive || 'configured' in directive) return { document: copy }
  if ('clear' in directive) {
    delete copy.instance.webTools.apiKey
    return { document: copy, secrets: { webToolsApiKey: null } }
  }
  const value = process.env[directive.fromEnv]
  if (value === undefined) throw new Error(`Environment variable ${directive.fromEnv} is not set`)
  copy.instance.webTools.apiKey = { configured: true }
  return { document: copy, secrets: { webToolsApiKey: value } }
}

async function jsonFile(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, 'utf8'))
}

async function waitForProcess(command: string, args: string[]): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'inherit' })
    child.once('error', reject)
    child.once('exit', (code) => code === 0 ? resolve() : reject(new Error(`${command} exited with status ${code}`)))
  })
}

async function clientFor(command: Command, authenticated = true): Promise<{
  client: PulpoManagementClient
  contextName: string | null
  context: { url: string; email?: string } | null
  info: Awaited<ReturnType<PulpoManagementClient['info']>>
  token: string
  url: string
}> {
  const options = globalOptions(command)
  const connection = await resolveConnection({ context: options.context, url: options.url })
  if (authenticated && !connection.token) throw new Error('Authentication required. Run `pulpo auth login`.')
  let root = command
  while (root.parent) root = root.parent
  const io = commandIo.get(root) ?? processIo
  const fetchImpl: typeof fetch = options.verbose
    ? async (input, init) => {
        const startedAt = Date.now()
        const url = input instanceof Request ? input.url : String(input)
        const method = init?.method ?? (input instanceof Request ? input.method : 'GET')
        io.stderr.write(`> ${method} ${new URL(url).pathname}\n`)
        const response = await fetch(input, init)
        io.stderr.write(`< ${response.status} ${response.statusText} (${Date.now() - startedAt}ms)\n`)
        return response
      }
    : fetch
  const createClient = commandClientFactory.get(root) ?? ((url: string, token: string | null, transport: typeof fetch) => (
    new PulpoManagementClient(url, token, transport)
  ))
  const client = createClient(connection.url, authenticated ? connection.token : null, fetchImpl)
  const info = await client.info()
  if (info.managementApiVersion !== 1) throw new Error(`Unsupported management API version ${info.managementApiVersion}`)
  let topLevel = command
  while (topLevel.parent && topLevel.parent !== root) topLevel = topLevel.parent
  const capability = COMMAND_CAPABILITIES[topLevel.name()]
  if (capability && !info.capabilities.includes(capability)) {
    throw new Error(`The selected Pulpo instance does not advertise the ${capability} capability`)
  }
  return {
    client,
    contextName: connection.contextName,
    context: connection.context,
    info,
    token: connection.token ?? '',
    url: connection.url,
  }
}

async function twoFactorSecret(io: CliIo, json: boolean, prompt = 'Authenticator or recovery code: '): Promise<string> {
  const value = process.env.PULPO_2FA_CODE
  if (value !== undefined) return value
  if (!io.stdin.isTTY) throw new Error('Noninteractive two-factor verification requires PULPO_2FA_CODE')
  if (json) throw new Error('Machine-mode two-factor verification requires PULPO_2FA_CODE')
  return readSecret(io, prompt)
}

async function currentPassword(io: CliIo, json: boolean): Promise<string> {
  const value = process.env.PULPO_PASSWORD
  if (value !== undefined) return value
  if (!io.stdin.isTTY) throw new Error('Noninteractive account security changes require PULPO_PASSWORD')
  if (json) throw new Error('Machine-mode account security changes require PULPO_PASSWORD')
  return readSecret(io, 'Current password: ')
}

function requireTwoFactorCapability(info: Awaited<ReturnType<PulpoManagementClient['info']>>): void {
  if (!info.capabilities.includes('twoFactor')) throw new Error('The selected Pulpo instance does not support two-factor authentication')
}

function emitRecoveryCodes(io: CliIo, command: Command, recoveryCodes: string[]): void {
  io.stderr.write('Save these recovery codes now. They will not be shown again.\n')
  if (globalOptions(command).json) emit(io, command, { recoveryCodes })
  else {
    writeOutput(io, recoveryCodes.map((recoveryCode) => ({ recoveryCode })), false)
  }
}

function emit(io: CliIo, command: Command, value: unknown): void {
  writeOutput(io, value, Boolean(globalOptions(command).json))
}

async function listResource(client: PulpoManagementClient, path: string): Promise<unknown[]> {
  const result = await client.request<{ data: unknown[] }>(path)
  return result.data
}

async function findResource(client: PulpoManagementClient, path: string, id: string): Promise<unknown> {
  const rows = await listResource(client, path) as Array<Record<string, unknown>>
  const row = rows.find((item) => item.id === id || (item.user as Record<string, unknown> | undefined)?.id === id)
  if (!row) throw new Error(`Resource not found: ${id}`)
  return row
}

function registerFileCrud(
  program: Command,
  io: CliIo,
  input: {
    name: string
    pluralPath: string
    create?: boolean
    update?: boolean
    remove?: boolean
    deleteWarning?: string
    preflightBody?: (body: unknown) => unknown
  },
): Command {
  const group = program.command(input.name)
  group.command('list').action(async (_options, command) => {
    const { client } = await clientFor(command)
    emit(io, command, await listResource(client, input.pluralPath))
  })
  group.command('get <id>').action(async (id, _options, command) => {
    const { client } = await clientFor(command)
    emit(io, command, await findResource(client, input.pluralPath, id))
  })
  if (input.create !== false) group.command('create').requiredOption('-f, --file <path>', 'JSON input file').action(async (options, command) => {
    const rawBody = resolveEnvironmentReferences(await jsonFile(options.file))
    const body = input.preflightBody?.(rawBody) ?? rawBody
    const { client } = await clientFor(command)
    emit(io, command, await client.request(input.pluralPath, { method: 'POST', body }))
  })
  if (input.update !== false) group.command('update <id>').requiredOption('-f, --file <path>', 'JSON patch file').action(async (id, options, command) => {
    const rawBody = resolveEnvironmentReferences(await jsonFile(options.file))
    const body = input.preflightBody?.(rawBody) ?? rawBody
    const { client } = await clientFor(command)
    emit(io, command, await client.request(`${input.pluralPath}/${encodeURIComponent(id)}`, { method: 'PATCH', body }))
  })
  if (input.remove !== false) group.command('delete <id>').action(async (id, _options, command) => {
    const options = globalOptions(command)
    if (input.deleteWarning && !options.yes && !options.json) io.stderr.write(`${input.deleteWarning}\n`)
    await confirmExact(io, id, Boolean(options.yes), Boolean(options.json))
    const { client } = await clientFor(command)
    await client.request(`${input.pluralPath}/${encodeURIComponent(id)}`, { method: 'DELETE' })
    emit(io, command, { id, deleted: true })
  })
  return group
}

export function preflightModelBody(body: unknown): unknown {
  if (body && typeof body === 'object' && !Array.isArray(body) && 'presets' in body) {
    const presets = (body as Record<string, unknown>).presets
    if (presets !== undefined) chatPresetsSchema.parse(presets)
  }
  return body
}

export function createProgram(io: CliIo = processIo, dependencies: CliDependencies = {}): Command {
  const program = new Command()
    .name('pulpo')
    .description('Manage a Pulpo instance')
    .version(CLI_VERSION)
    .option('--context <name>', 'named Pulpo context')
    .option('--url <url>', 'override the Pulpo instance URL')
    .option('--json', 'emit stable JSON on stdout')
    .option('--no-color', 'disable color output')
    .option('-y, --yes', 'confirm noninteractive changes')
    .option('--verbose', 'show request diagnostics')
    .configureOutput({
      writeOut: (value) => io.stdout.write(value),
      writeErr: (value) => io.stderr.write(value),
    })
    .exitOverride()
  commandIo.set(program, io)
  commandClientFactory.set(program, dependencies.createClient)

  const contexts = program.command('context').description('Manage Pulpo instance contexts')
  contexts.command('add <name>').action(async (name, _options, command) => {
    const url = globalOptions(command).url
    if (!url) throw new Error('Context URL is required; pass --url <url>')
    const config = await addContext(name, url)
    emit(io, command, { name, ...config.contexts[name], current: config.currentContext === name })
  })
  contexts.command('list').action(async (_options, command) => {
    const config = await loadConfig()
    emit(io, command, Object.entries(config.contexts).map(([name, context]) => ({ name, ...context, current: config.currentContext === name })))
  })
  contexts.command('use <name>').action(async (name, _options, command) => {
    const config = await loadConfig()
    if (!config.contexts[name]) throw new Error(`Unknown context: ${name}`)
    config.currentContext = name
    await saveConfig(config)
    emit(io, command, { currentContext: name })
  })
  contexts.command('remove <name>').action(async (name, _options, command) => {
    await confirmExact(io, name, Boolean(globalOptions(command).yes), Boolean(globalOptions(command).json))
    const config = await removeContext(name)
    emit(io, command, { removed: name, currentContext: config.currentContext })
  })
  contexts.command('current').action(async (_options, command) => {
    const config = await loadConfig()
    emit(io, command, config.currentContext ? { name: config.currentContext, ...config.contexts[config.currentContext] } : null)
  })

  const auth = program.command('auth').description('Authenticate to Pulpo')
  auth.command('login').option('--email <email>').action(async (options, command) => {
    const { client, contextName, context } = await clientFor(command, false)
    if (!contextName) throw new Error('Login requires a named context')
    const email = options.email ?? context?.email
    if (!email) throw new Error('Email is required; pass --email on the first login')
    if (globalOptions(command).json && io.stdin.isTTY && process.env.PULPO_PASSWORD === undefined) {
      throw new Error('Machine-mode login requires the password on stdin or in PULPO_PASSWORD')
    }
    const password = process.env.PULPO_PASSWORD ?? await readSecret(io, 'Password: ')
    let result
    try {
      result = await client.login(email, password)
    } catch (error) {
      if (!(error instanceof ManagementApiError) || error.code !== 'two_factor_required') throw error
      const code = await twoFactorSecret(io, Boolean(globalOptions(command).json))
      result = await client.login(email, password, 'Pulpo CLI', code)
    }
    await setCredential(contextName, result.session.token, (message) => io.stderr.write(`${message}\n`))
    const config = await loadConfig()
    config.contexts[contextName] = { ...config.contexts[contextName]!, email }
    await saveConfig(config)
    emit(io, command, { user: result.user, expiresAt: result.session.expiresAt })
  })
  auth.command('logout').action(async (_options, command) => {
    const { client, contextName } = await clientFor(command)
    await client.logout()
    if (contextName) await deleteCredential(contextName)
    emit(io, command, { loggedOut: true })
  })
  auth.command('status').action(async (_options, command) => {
    const { client } = await clientFor(command)
    emit(io, command, await client.me())
  })

  const twoFactor = auth.command('2fa').description('Manage authenticator-app two-factor authentication')
  twoFactor.command('status').action(async (_options, command) => {
    const { client, info } = await clientFor(command)
    requireTwoFactorCapability(info)
    emit(io, command, await client.twoFactorStatus())
  })
  twoFactor.command('setup').description('Start or replace authenticator enrollment').action(async (_options, command) => {
    const { client, info } = await clientFor(command)
    requireTwoFactorCapability(info)
    const status = await client.twoFactorStatus()
    const password = await currentPassword(io, Boolean(globalOptions(command).json))
    const verificationCode = status.enabled
      ? await twoFactorSecret(io, Boolean(globalOptions(command).json), 'Current authenticator or recovery code: ')
      : undefined
    const enrollment = await client.beginTwoFactorEnrollment({ currentPassword: password, verificationCode })
    io.stderr.write('Save this enrollment secret now. It will not be shown again.\n')
    if (globalOptions(command).json) emit(io, command, enrollment)
    else {
      io.stderr.write('Add this account to your authenticator, then run `pulpo auth 2fa confirm`.\n')
      writeOutput(io, [{ manualKey: enrollment.manualKey, otpauthUri: enrollment.otpauthUri, expiresAt: enrollment.expiresAt }], false)
    }
  })
  twoFactor.command('confirm').description('Confirm a pending enrollment').action(async (_options, command) => {
    const { client, info } = await clientFor(command)
    requireTwoFactorCapability(info)
    const code = await twoFactorSecret(io, Boolean(globalOptions(command).json), 'New six-digit authenticator code: ')
    emitRecoveryCodes(io, command, (await client.confirmTwoFactorEnrollment(code)).recoveryCodes)
  })
  twoFactor.command('regenerate-recovery-codes').description('Replace all recovery codes').action(async (_options, command) => {
    const { client, info } = await clientFor(command)
    requireTwoFactorCapability(info)
    const password = await currentPassword(io, Boolean(globalOptions(command).json))
    const verificationCode = await twoFactorSecret(io, Boolean(globalOptions(command).json))
    emitRecoveryCodes(io, command, (await client.regenerateTwoFactorRecoveryCodes({ currentPassword: password, verificationCode })).recoveryCodes)
  })
  twoFactor.command('disable').description('Disable two-factor authentication').action(async (_options, command) => {
    await confirmExact(io, 'DISABLE', Boolean(globalOptions(command).yes), Boolean(globalOptions(command).json))
    const { client, info } = await clientFor(command)
    requireTwoFactorCapability(info)
    const password = await currentPassword(io, Boolean(globalOptions(command).json))
    const verificationCode = await twoFactorSecret(io, Boolean(globalOptions(command).json))
    await client.disableTwoFactor({ currentPassword: password, verificationCode })
    emit(io, command, { enabled: false })
  })

  const token = program.command('token').description('Manage scoped automation tokens')
  token.command('list').action(async (_options, command) => {
    const { client } = await clientFor(command)
    emit(io, command, (await client.tokens()).data)
  })
  token.command('create').requiredOption('--name <name>').requiredOption('--scope <scopes...>')
    .option('--expires-in <days>', 'expiry in days', '90').action(async (options, command) => {
      const { client } = await clientFor(command)
      emit(io, command, await client.createToken({ name: options.name, scopes: options.scope, expiresInDays: Number(options.expiresIn) }))
    })
  token.command('revoke <id>').action(async (id, _options, command) => {
    await confirmExact(io, id, Boolean(globalOptions(command).yes), Boolean(globalOptions(command).json))
    const { client } = await clientFor(command)
    emit(io, command, await client.revokeToken(id))
  })

  const instance = program.command('instance').description('Inspect the selected instance')
  instance.command('info').action(async (_options, command) => {
    const { client } = await clientFor(command, false)
    emit(io, command, await client.info())
  })
  instance.command('status').action(async (_options, command) => {
    const { client } = await clientFor(command)
    emit(io, command, await client.request('/api/management/v1/status'))
  })

  const settings = program.command('settings').description('Read, diff, and apply settings')
  settings.command('get [path]').action(async (path, _options, command) => {
    const { client } = await clientFor(command)
    const document = path === 'account' || path?.startsWith('account.')
      ? await client.accountSettings()
      : path === 'instance' || path?.startsWith('instance.')
        ? await client.instanceSettings()
        : await client.settings()
    emit(io, command, valueAt(document, path))
  })
  settings.command('set <path> <value>').action(async (path, rawValue, _options, command) => {
    const { client } = await clientFor(command)
    if (path.startsWith('account.')) {
      const desired = setValueAt(
        await client.accountSettings(), path, parseValue(rawValue), (input) => managementAccountSettingsDocumentSchema.parse(input),
      )
      const plan = await client.planAccountSettings(desired)
      if (!plan.changes.length) { emit(io, command, { changed: false, revision: plan.revision }); return }
      emit(io, command, await client.applyAccountSettings(plan.document, plan.revision))
      return
    }
    if (path.startsWith('instance.')) {
      const desired = setValueAt(
        await client.instanceSettings(), path, parseValue(rawValue), (input) => managementInstanceSettingsDocumentSchema.parse(input),
      )
      const resolved = resolveSettingsSecrets(desired)
      const plan = await client.planInstanceSettings(resolved.document, resolved.secrets)
      if (!plan.changes.length) { emit(io, command, { changed: false, revision: plan.revision }); return }
      emit(io, command, await client.applyInstanceSettings(plan.document, plan.revision, resolved.secrets))
      return
    }
    throw new Error('Settings paths must begin with account. or instance.')
  })
  settings.command('schema').action(async (_options, command) => {
    emit(io, command, z.toJSONSchema(managementSettingsDocumentSchema, { io: 'input' }))
  })
  settings.command('export').option('-o, --output <path>').action(async (options, command) => {
    const { client } = await clientFor(command)
    const document = await client.settings()
    if (options.output) {
      await writeFile(options.output, `${JSON.stringify(document, null, 2)}\n`, { mode: 0o600 })
      emit(io, command, { output: options.output, revision: document.revision })
    } else io.stdout.write(`${JSON.stringify(document, null, 2)}\n`)
  })
  settings.command('diff').requiredOption('-f, --file <path>').action(async (options, command) => {
    const document = managementSettingsDocumentSchema.parse(await jsonFile(options.file))
    const resolved = resolveSettingsSecrets(document)
    const { client } = await clientFor(command)
    const plan = await client.planSettings(resolved.document, resolved.secrets)
    emit(io, command, plan.changes)
    if (plan.changes.length) process.exitCode = 2
  })
  settings.command('apply').requiredOption('-f, --file <path>').action(async (options, command) => {
    const document = managementSettingsDocumentSchema.parse(await jsonFile(options.file))
    const resolved = resolveSettingsSecrets(document)
    const { client } = await clientFor(command)
    const plan = await client.planSettings(resolved.document, resolved.secrets)
    if (!plan.changes.length) { emit(io, command, { changed: false, revision: plan.revision }); return }
    if (!globalOptions(command).json) writeOutput(io, plan.changes, false)
    await confirmExact(io, 'APPLY', Boolean(globalOptions(command).yes), Boolean(globalOptions(command).json))
    emit(io, command, await client.applySettings(plan.document, plan.revision, resolved.secrets))
  })
  settings.command('edit').action(async (_options, command) => {
    if (globalOptions(command).json) throw new Error('settings edit is interactive; use settings export/apply in machine mode')
    const { client } = await clientFor(command)
    const directory = await mkdtemp(join(tmpdir(), 'pulpo-settings-'))
    const path = join(directory, 'settings.json')
    try {
      await writeFile(path, `${JSON.stringify(await client.settings(), null, 2)}\n`, { mode: 0o600 })
      const editor = (process.env.VISUAL ?? process.env.EDITOR ?? 'vi').trim().split(/\s+/)
      await waitForProcess(editor[0]!, [...editor.slice(1), path])
      const document = managementSettingsDocumentSchema.parse(await jsonFile(path))
      const resolved = resolveSettingsSecrets(document)
      const plan = await client.planSettings(resolved.document, resolved.secrets)
      if (!plan.changes.length) { emit(io, command, { changed: false }); return }
      writeOutput(io, plan.changes, false)
      await confirmExact(io, 'APPLY', Boolean(globalOptions(command).yes), Boolean(globalOptions(command).json))
      emit(io, command, await client.applySettings(plan.document, plan.revision, resolved.secrets))
    } finally { await rm(directory, { recursive: true, force: true }) }
  })

  const provider = registerFileCrud(program, io, { name: 'provider', pluralPath: '/api/management/v1/providers' })
  provider.command('health <id>').action(async (id, _options, command) => {
    const { client } = await clientFor(command)
    emit(io, command, await client.request(`/api/management/v1/providers/${encodeURIComponent(id)}/health`, { method: 'POST' }))
  })
  provider.command('upstream-models <id>').action(async (id, _options, command) => {
    const { client } = await clientFor(command)
    emit(io, command, await client.request(`/api/management/v1/providers/${encodeURIComponent(id)}/models`))
  })
  provider.command('refresh <id>').action(async (id, _options, command) => {
    const { client } = await clientFor(command)
    emit(io, command, await client.request(`/api/management/v1/providers/${encodeURIComponent(id)}/models/refresh`, { method: 'POST' }))
  })

  const lab = registerFileCrud(program, io, { name: 'lab', pluralPath: '/api/management/v1/labs' })
  lab.command('order-models <id>').requiredOption('-f, --file <path>').action(async (id, options, command) => {
    const { client } = await clientFor(command)
    emit(io, command, await client.request(`/api/management/v1/labs/${encodeURIComponent(id)}/models/order`, { method: 'PUT', body: await jsonFile(options.file) }))
  })
  const icon = registerFileCrud(program, io, {
    name: 'icon', pluralPath: '/api/management/v1/catalog-icons', create: false,
  })
  icon.command('upload <path>')
    .option('-n, --name <name>', 'library name; defaults to the filename')
    .option('-m, --mode <mode>', 'original or monochrome', 'original')
    .action(async (path, options, command) => {
      const mode = z.enum(['original', 'monochrome']).parse(options.mode)
      const filename = basename(path)
      const contentType = catalogIconContentType(filename)
      if (!contentType) throw new Error('Icon files must be PNG, JPEG, WebP, or SVG')
      const bytes = new Uint8Array(await readFile(path))
      const { client } = await clientFor(command)
      emit(io, command, await client.upload('/api/management/v1/catalog-icons', {
        bytes, filename, contentType,
        fields: { name: options.name ?? filename.replace(/\.[^.]+$/, ''), mode },
      }))
    })
  const model = registerFileCrud(program, io, {
    name: 'model',
    pluralPath: '/api/management/v1/models',
    deleteWarning: 'Historical references will be permanently reassigned to “unknown model”.',
    preflightBody: preflightModelBody,
  })
  model.command('icons [query]').description('List canonical Lucide names for chat presets').action((query, _options, command) => {
    const normalized = typeof query === 'string' ? query.trim().toLowerCase() : ''
    const icons = CHAT_PRESET_ICON_NAMES
      .filter((name) => !normalized || name.includes(normalized))
      .map((name) => ({ name }))
    emit(io, command, icons)
  })
  model.command('test <id> [prompt...]')
    .description('Send a model smoke-test message with explicit user-facing options')
    .addOption(new NamedOption('--agent', 'agentEnabled', 'run with agent mode enabled').conflicts('agentDisabled'))
    .addOption(new NamedOption('--no-agent', 'agentDisabled', 'run with agent mode disabled').default(undefined).conflicts('agentEnabled'))
    .option('--preset <preset=choice>', 'explicit preset choice; repeat for every exposed preset', (value, previous: string[]) => [...previous, value], [])
    .option('--keep', 'keep the test in normal chat history')
    .option('--no-stream', 'wait and print only the completed response')
    .option('--jsonl', 'stream response events as JSON Lines')
    .action(async (id, promptParts: string[], options, command) => {
      const globals = globalOptions(command)
      if (globals.json && options.jsonl) throw new Error('--json and --jsonl cannot be used together')
      if (options.jsonl && options.stream === false) throw new Error('--jsonl and --no-stream cannot be used together')
      const agentMode = explicitAgentMode(options)
      const prompt = await readModelTestPrompt(io, promptParts ?? [])
      const { client, token, url } = await clientFor(command)
      if (!token) throw new Error('Model tests require a logged-in session. Run `pulpo auth login`.')
      const catalog = await client.request<ModelCatalog>('/api/models')
      const selectedModel = catalog.data.find((candidate) => candidate.id === id)
      if (!selectedModel) throw new Error(`Exposed model not found: ${id}`)
      if (agentMode && !selectedModel.agentEnabled) throw new Error(`Model ${id} does not expose agent mode`)
      if (agentMode && !catalog.agentAvailable) throw new Error('Agent mode is not available on the selected Pulpo instance')
      const presetSelections = resolvePresetSelections(selectedModel, options.preset as string[])
      const result = await runModelTest({
        client,
        baseUrl: url,
        token,
        model: selectedModel,
        prompt,
        agentMode,
        presetSelections,
        keep: Boolean(options.keep),
        streamText: !globals.json && !options.jsonl && options.stream !== false,
        jsonl: Boolean(options.jsonl),
        io,
        follow: dependencies.followResponse ?? followResponse,
      })
      if (globals.json) emit(io, command, result)
      else if (!options.jsonl && options.stream === false) io.stdout.write(`${responseText(result.snapshot)}\n`)
      if (!globals.json && !options.jsonl) {
        io.stderr.write(`Chat ${result.chatId} · response ${result.responseId}${result.temporary ? ' · temporary' : ''}\n`)
      }
      if (!['completed', 'incomplete'].includes(result.snapshot.status)) {
        const detail = result.snapshot.error && typeof result.snapshot.error === 'object'
          ? (result.snapshot.error as { message?: unknown }).message
          : result.snapshot.error
        throw new Error(typeof detail === 'string' ? detail : `Response ended with status ${result.snapshot.status}`)
      }
    })

  const user = registerFileCrud(program, io, { name: 'user', pluralPath: '/api/management/v1/users' })
  for (const [action, patch] of [['approve', { role: 'user' }], ['block', { blocked: true }], ['unblock', { blocked: false }]] as const) {
    user.command(`${action} <id>`).action(async (id, _options, command) => {
      const { client } = await clientFor(command)
      emit(io, command, await client.request(`/api/management/v1/users/${encodeURIComponent(id)}`, { method: 'PATCH', body: patch }))
    })
  }
  user.command('reset-link <id>').action(async (id, _options, command) => {
    const { client } = await clientFor(command)
    emit(io, command, await client.request(`/api/management/v1/users/${encodeURIComponent(id)}/reset-link`, { method: 'POST' }))
  })
  user.command('role <id> <role>').action(async (id, role, _options, command) => {
    if (!['pending', 'user', 'admin'].includes(role)) throw new Error('Role must be pending, user, or admin')
    const { client } = await clientFor(command)
    emit(io, command, await client.request(`/api/management/v1/users/${encodeURIComponent(id)}`, { method: 'PATCH', body: { role } }))
  })
  user.command('balance <id> <micros>').action(async (id, rawMicros, _options, command) => {
    const balanceMicros = Number(rawMicros)
    if (!Number.isSafeInteger(balanceMicros) || balanceMicros < 0) throw new Error('Balance must be a non-negative integer in micros')
    const { client } = await clientFor(command)
    emit(io, command, await client.request(`/api/management/v1/users/${encodeURIComponent(id)}`, { method: 'PATCH', body: { balanceMicros } }))
  })
  user.command('storage <id> <bytes>').action(async (id, rawBytes, _options, command) => {
    const storageLimitBytes = Number(rawBytes)
    if (!Number.isSafeInteger(storageLimitBytes) || storageLimitBytes < 0) throw new Error('Storage must be a non-negative integer in bytes')
    const { client } = await clientFor(command)
    emit(io, command, await client.request(`/api/management/v1/users/${encodeURIComponent(id)}`, { method: 'PATCH', body: { storageLimitBytes } }))
  })

  const usage = program.command('usage')
  usage.command('summary').action(async (_options, command) => {
    const { client } = await clientFor(command); emit(io, command, await client.request('/api/management/v1/usage/summary'))
  })
  usage.command('requests').action(async (_options, command) => {
    const { client } = await clientFor(command); emit(io, command, await client.request('/api/management/v1/usage/requests'))
  })
  usage.command('request <id>').action(async (id, _options, command) => {
    const { client } = await clientFor(command); emit(io, command, await client.request(`/api/management/v1/usage/requests/${encodeURIComponent(id)}`))
  })

  program.command('audit').command('list').action(async (_options, command) => {
    const { client } = await clientFor(command); emit(io, command, await listResource(client, '/api/management/v1/audit-events'))
  })
  const workspace = program.command('workspace')
  workspace.command('list').action(async (_options, command) => {
    const { client } = await clientFor(command); emit(io, command, await client.request('/api/management/v1/workspaces'))
  })
  workspace.command('release <id>').action(async (id, _options, command) => {
    await confirmExact(io, id, Boolean(globalOptions(command).yes), Boolean(globalOptions(command).json))
    const { client } = await clientFor(command)
    emit(io, command, await client.request(`/api/management/v1/workspaces/${encodeURIComponent(id)}`, { method: 'DELETE' }))
  })

  const banner = registerFileCrud(program, io, { name: 'banner', pluralPath: '/api/management/v1/banners' })
  banner.description('Manage instance banners')

  async function jobs(client: PulpoManagementClient): Promise<Array<Record<string, unknown>>> {
    const [exportResult, backupResult] = await Promise.all([
      client.request<{ data: Array<Record<string, unknown>> }>('/api/management/v1/exports'),
      client.request<{ data: Array<Record<string, unknown>> }>('/api/management/v1/backups'),
    ])
    return [
      ...exportResult.data.map((entry) => ({ kind: 'export', ...entry }) as Record<string, unknown>),
      ...backupResult.data.map((entry) => ({ kind: 'backup', ...entry }) as Record<string, unknown>),
    ]
  }

  const job = program.command('job').description('Inspect asynchronous operation progress')
  job.command('list').action(async (_options, command) => {
    const { client } = await clientFor(command)
    emit(io, command, await jobs(client))
  })
  job.command('get <id>').action(async (id, _options, command) => {
    const { client } = await clientFor(command)
    const found = (await jobs(client)).find((candidate) => candidate['id'] === id)
    if (!found) throw new Error(`Job not found: ${id}`)
    emit(io, command, found)
  })

  const exports = program.command('export').description('Create and download administrative exports')
  exports.command('create <type>').action(async (type, _options, command) => {
    const { client } = await clientFor(command)
    emit(io, command, await client.request('/api/management/v1/exports', { method: 'POST', body: { type } }))
  })
  exports.command('list').action(async (_options, command) => {
    const { client } = await clientFor(command); emit(io, command, await listResource(client, '/api/management/v1/exports'))
  })
  exports.command('download <id>').requiredOption('-o, --output <path>').action(async (id, options, command) => {
    const { client } = await clientFor(command)
    const result = await client.download(`/api/management/v1/exports/${encodeURIComponent(id)}/download`)
    await writeFile(options.output, result.bytes, { mode: 0o600 })
    emit(io, command, { id, output: options.output, filename: result.filename ?? basename(options.output) })
  })

  const backup = program.command('backup').description('Create and download full backups')
  backup.command('create').action(async (_options, command) => {
    const { client } = await clientFor(command); emit(io, command, await client.request('/api/management/v1/backups', { method: 'POST' }))
  })
  backup.command('list').action(async (_options, command) => {
    const { client } = await clientFor(command); emit(io, command, await listResource(client, '/api/management/v1/backups'))
  })
  backup.command('download <id>').requiredOption('-o, --output <path>').action(async (id, options, command) => {
    const { client } = await clientFor(command)
    const result = await client.download(`/api/management/v1/backups/${encodeURIComponent(id)}/download`)
    await writeFile(options.output, result.bytes, { mode: 0o600 })
    emit(io, command, { id, output: options.output, filename: result.filename ?? basename(options.output) })
  })

  return program
}

export async function main(argv = process.argv, io: CliIo = processIo): Promise<void> {
  const program = createProgram(io)
  try {
    await program.parseAsync(argv)
  } catch (error) {
    if (error instanceof CommanderError) {
      if (error.exitCode !== 0) process.exitCode = error.exitCode
      return
    }
    const options = program.opts() as GlobalOptions
    if (error instanceof ManagementApiError) writeError(io, error.message, Boolean(options.json), error.code)
    else writeError(io, error instanceof Error ? error.message : String(error), Boolean(options.json))
    process.exitCode = 1
  }
}

if (CLI_BUNDLED || (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)) void main()
