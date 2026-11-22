import { createHash } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { ComputerAllowedApp } from '@pulpo/contracts'

/**
 * What the user allowed, per signed-in instance + account: folders picked in the native folder
 * dialog, whether they confirmed full access in the native prompt, and the apps they let the agent
 * see and work in, each confirmed in its own native prompt. Nothing else can add to it.
 */

export interface ComputerAccount {
  /** Instance origin the account signed in to. */
  origin: string
  userId: string
}

export function accountKey(account: ComputerAccount): string { return `${account.origin} ${account.userId}` }
/** A file-name-safe stand-in for an account key. */
export function accountDirectoryName(account: ComputerAccount): string {
  return createHash('sha256').update(accountKey(account)).digest('hex').slice(0, 32)
}

export interface AccountGrants {
  fullAccess: boolean
  /** Absolute paths, most recently chosen first. */
  folders: string[]
  /** Apps the agent may see and work in, most recently allowed first. */
  apps: ComputerAllowedApp[]
}

interface GrantsFile { version: 1; accounts: Record<string, AccountGrants> }

const MAX_FOLDERS = 30
const MAX_APPS = 100

const noGrants = (): AccountGrants => ({ fullAccess: false, folders: [], apps: [] })
const copy = (grants: AccountGrants): AccountGrants => ({ ...grants, folders: [...grants.folders], apps: grants.apps.map((app) => ({ ...app })) })
const sameApp = (left: string, right: string) => left.toLowerCase() === right.toLowerCase()

function validApp(value: unknown): ComputerAllowedApp | null {
  const { id, name } = (value ?? {}) as Partial<ComputerAllowedApp>
  if (typeof id !== 'string' || !id || id.length > 1_000 || typeof name !== 'string') return null
  return { id, name: name.slice(0, 200) || id }
}

function validGrants(value: unknown): AccountGrants | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as Partial<AccountGrants>
  if (!Array.isArray(candidate.folders)) return null
  return {
    fullAccess: candidate.fullAccess === true,
    folders: candidate.folders.filter((folder): folder is string => typeof folder === 'string' && path.isAbsolute(folder)).slice(0, MAX_FOLDERS),
    // Files written before apps could be allowed have none.
    apps: (Array.isArray(candidate.apps) ? candidate.apps : []).flatMap((app) => { const valid = validApp(app); return valid ? [valid] : [] }).slice(0, MAX_APPS),
  }
}

export class GrantsStore {
  private cache: GrantsFile | null = null
  private queue: Promise<unknown> = Promise.resolve()

  constructor(private readonly file: string) {}

  private async load(): Promise<GrantsFile> {
    if (this.cache) return this.cache
    let accounts: Record<string, AccountGrants> = {}
    try {
      const parsed = JSON.parse(await readFile(this.file, 'utf8')) as Partial<GrantsFile>
      if (parsed.version === 1 && parsed.accounts && typeof parsed.accounts === 'object') {
        for (const [key, value] of Object.entries(parsed.accounts)) {
          const grants = validGrants(value)
          if (grants) accounts[key] = grants
        }
      }
    } catch { accounts = {} }
    this.cache = { version: 1, accounts }
    return this.cache
  }

  private async save(value: GrantsFile): Promise<void> {
    await mkdir(path.dirname(this.file), { recursive: true })
    const temporary = `${this.file}.tmp`
    await writeFile(temporary, `${JSON.stringify(value)}\n`, { mode: 0o600 })
    await rename(temporary, this.file)
  }

  private update(account: ComputerAccount, change: (grants: AccountGrants) => void): Promise<AccountGrants> {
    const next = this.queue.then(async () => {
      const file = await this.load()
      const key = accountKey(account)
      const grants = file.accounts[key] ?? noGrants()
      change(grants)
      file.accounts[key] = grants
      await this.save(file)
      return copy(grants)
    })
    this.queue = next.catch(() => undefined)
    return next
  }

  async get(account: ComputerAccount): Promise<AccountGrants> {
    await this.queue
    const grants = (await this.load()).accounts[accountKey(account)]
    return grants ? copy(grants) : noGrants()
  }

  addFolder(account: ComputerAccount, folder: string): Promise<AccountGrants> {
    return this.update(account, (grants) => {
      grants.folders = [folder, ...grants.folders.filter((existing) => existing !== folder)].slice(0, MAX_FOLDERS)
    })
  }

  allowFullAccess(account: ComputerAccount): Promise<AccountGrants> {
    return this.update(account, (grants) => { grants.fullAccess = true })
  }

  revokeFullAccess(account: ComputerAccount): Promise<AccountGrants> {
    return this.update(account, (grants) => { grants.fullAccess = false })
  }

  removeFolder(account: ComputerAccount, folder: string): Promise<AccountGrants> {
    return this.update(account, (grants) => { grants.folders = grants.folders.filter((existing) => existing !== folder) })
  }

  allowApp(account: ComputerAccount, app: ComputerAllowedApp): Promise<AccountGrants> {
    return this.update(account, (grants) => {
      const valid = validApp(app)
      if (valid) grants.apps = [valid, ...grants.apps.filter((existing) => !sameApp(existing.id, valid.id))].slice(0, MAX_APPS)
    })
  }

  removeApp(account: ComputerAccount, id: string): Promise<AccountGrants> {
    return this.update(account, (grants) => { grants.apps = grants.apps.filter((existing) => !sameApp(existing.id, id)) })
  }
}
