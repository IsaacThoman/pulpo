import { execFile, spawn } from 'node:child_process'
import { chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'
import { normalizeInstanceUrl } from '@pulpo/client-core'

const execFileAsync = promisify(execFile)
const KEYCHAIN_SERVICE = 'Pulpo CLI'

export interface CliContext {
  url: string
  email?: string
}

export interface CliConfig {
  currentContext: string | null
  contexts: Record<string, CliContext>
}

function configRoot(): string {
  if (process.platform === 'win32') return join(process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'), 'pulpo')
  return join(process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config'), 'pulpo')
}

export function configPath(): string {
  return join(configRoot(), 'config.json')
}

function credentialPath(): string {
  return join(configRoot(), 'credentials.json')
}

async function readJson<T>(path: string, fallback: T): Promise<T> {
  try { return JSON.parse(await readFile(path, 'utf8')) as T } catch { return fallback }
}

async function secureWrite(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  const temporary = `${path}.${process.pid}.tmp`
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 })
  await chmod(temporary, 0o600)
  await rename(temporary, path)
}

export async function loadConfig(): Promise<CliConfig> {
  return readJson(configPath(), { currentContext: null, contexts: {} })
}

export async function saveConfig(config: CliConfig): Promise<void> {
  await secureWrite(configPath(), config)
}

export async function addContext(name: string, url: string): Promise<CliConfig> {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(name) || ['__proto__', 'prototype', 'constructor'].includes(name)) {
    throw new Error('Context names may contain letters, numbers, dots, underscores, and hyphens')
  }
  const config = await loadConfig()
  config.contexts[name] = { ...config.contexts[name], url: normalizeInstanceUrl(url, true) }
  config.currentContext ??= name
  await saveConfig(config)
  return config
}

export async function removeContext(name: string): Promise<CliConfig> {
  const config = await loadConfig()
  delete config.contexts[name]
  if (config.currentContext === name) config.currentContext = Object.keys(config.contexts)[0] ?? null
  await deleteCredential(name)
  await saveConfig(config)
  return config
}

async function commandExists(command: string): Promise<boolean> {
  try { await execFileAsync(process.platform === 'win32' ? 'where' : 'which', [command]); return true } catch { return false }
}

async function keychainGet(context: string): Promise<string | null> {
  try {
    if (process.platform === 'darwin') {
      const { stdout } = await execFileAsync('security', ['find-generic-password', '-s', KEYCHAIN_SERVICE, '-a', context, '-w'])
      return stdout.trim() || null
    }
    if (process.platform === 'linux' && await commandExists('secret-tool')) {
      const { stdout } = await execFileAsync('secret-tool', ['lookup', 'service', 'pulpo-cli', 'context', context])
      return stdout.trim() || null
    }
  } catch { return null }
  return null
}

async function keychainSet(context: string, token: string): Promise<boolean> {
  try {
    if (process.platform === 'darwin') {
      await new Promise<void>((resolve, reject) => {
        const child = spawn('security', ['add-generic-password', '-U', '-s', KEYCHAIN_SERVICE, '-a', context, '-w'], { stdio: ['pipe', 'ignore', 'ignore'] })
        child.once('error', reject)
        child.once('exit', (code) => code === 0 ? resolve() : reject(new Error(`security exited ${code}`)))
        child.stdin.end(token)
      })
      return true
    }
    if (process.platform === 'linux' && await commandExists('secret-tool')) {
      await new Promise<void>((resolve, reject) => {
        const child = spawn('secret-tool', ['store', '--label', KEYCHAIN_SERVICE, 'service', 'pulpo-cli', 'context', context], { stdio: ['pipe', 'ignore', 'ignore'] })
        child.once('error', reject)
        child.once('exit', (code) => code === 0 ? resolve() : reject(new Error(`secret-tool exited ${code}`)))
        child.stdin.end(token)
      })
      return true
    }
  } catch { return false }
  return false
}

async function keychainDelete(context: string): Promise<void> {
  try {
    if (process.platform === 'darwin') await execFileAsync('security', ['delete-generic-password', '-s', KEYCHAIN_SERVICE, '-a', context])
    else if (process.platform === 'linux' && await commandExists('secret-tool')) {
      await execFileAsync('secret-tool', ['clear', 'service', 'pulpo-cli', 'context', context])
    }
  } catch { /* already absent */ }
}

export async function getCredential(context: string): Promise<string | null> {
  const keychain = await keychainGet(context)
  if (keychain) return keychain
  const credentials = await readJson<Record<string, string>>(credentialPath(), {})
  return credentials[context] ?? null
}

export async function setCredential(context: string, token: string, warn: (message: string) => void): Promise<void> {
  if (await keychainSet(context, token)) return
  const credentials = await readJson<Record<string, string>>(credentialPath(), {})
  credentials[context] = token
  await secureWrite(credentialPath(), credentials)
  warn(`OS credential storage is unavailable; the token was stored in ${credentialPath()} with mode 0600.`)
}

export async function deleteCredential(context: string): Promise<void> {
  await keychainDelete(context)
  const path = credentialPath()
  const credentials = await readJson<Record<string, string>>(path, {})
  if (!(context in credentials)) return
  delete credentials[context]
  if (Object.keys(credentials).length) await secureWrite(path, credentials)
  else await rm(path, { force: true })
}

export async function resolveConnection(input: { context?: string; url?: string }): Promise<{
  contextName: string | null
  context: CliContext | null
  url: string
  token: string | null
}> {
  const config = await loadConfig()
  const contextName = input.context ?? process.env.PULPO_CONTEXT ?? config.currentContext
  const context = contextName ? config.contexts[contextName] ?? null : null
  const rawUrl = input.url ?? process.env.PULPO_URL ?? context?.url
  if (!rawUrl) throw new Error('No Pulpo instance selected. Run `pulpo context add <name> --url <url>`.')
  const url = normalizeInstanceUrl(rawUrl, true)
  const contextMatchesUrl = context && normalizeInstanceUrl(context.url, true) === url
  // Never send a stored context credential to an unrelated --url/PULPO_URL override.
  const token = process.env.PULPO_TOKEN ?? (contextName && contextMatchesUrl ? await getCredential(contextName) : null)
  return { contextName, context, url, token }
}
