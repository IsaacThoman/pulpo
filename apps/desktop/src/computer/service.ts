import { mkdir, readdir, realpath, rm, stat } from 'node:fs/promises'
import path from 'node:path'
import {
  computerAccessSchema,
  computerMethods,
  computerRequestSchema,
  isComputerFolderMode,
  type ComputerAccess,
  type ComputerChange,
  type ComputerChangeDetail,
  type ComputerFolder,
  type ComputerFolderMode,
  type ComputerMethod,
  type ComputerParams,
  type ComputerResponse,
  type DesktopComputerApi,
} from '@pulpo/contracts'
import type { AccountResolver } from './account'
import { ChangesStore } from './changes'
import { ComputerError, computerErrorOf } from './errors'
import { missingFiles, receiveFile, sendFile } from './files'
import { FolderService, type FolderSession } from './folder'
import { accountKey, GrantsStore, type ComputerAccount } from './grants'
import { Operations, type OperationContext } from './operations'
import { commandShell, computerNoun, computerOs, osVersionLabel, resolveShellEnvironment, type CommandShell, type Spawn } from './platform'

/**
 * The main process's side of "This computer" and its policy point. The renderer and the server
 * are both untrusted: a session exists only when the grants (native folder dialog, native
 * confirmation) cover it, and a request is served only for a known session and only with the
 * methods its access allows.
 */

const SESSION_IDLE_MS = 24 * 60 * 60_000
const MAX_SESSIONS = 200
const ATTACHMENT_RETENTION_MS = 30 * 24 * 60 * 60_000
const TOOL_OUTPUT_RETENTION_MS = 7 * 24 * 60 * 60_000
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const NO_ID = '00000000-0000-0000-0000-000000000000'

const FULL_METHODS = new Set<ComputerMethod>(['describe', 'operation.start', 'operation.get', 'operation.cancel', 'file.send', 'file.receive', 'file.missing'])
const FOLDER_METHODS = new Set<ComputerMethod>(['folder.list', 'folder.read', 'folder.search', 'folder.send', 'folder.change'])

interface Session {
  id: string
  access: ComputerAccess
  /** The granted folder; for full access, null means the default folder. */
  folder: string | null
  account: ComputerAccount
  /** The sign-in (instance and token) the session was begun under; it ends when that sign-in does. */
  signIn: string
  /** Instance the session was begun under: transfers go there and nowhere else. */
  origin: string
  lastUsedAt: number
}

export interface ComputerServiceOptions {
  userData: string
  home: string
  platform: NodeJS.Platform
  arch: string
  osVersion: () => string
  /** Unpackaged builds talk to http://localhost instances. */
  allowHttpLocalhost: boolean
  accounts: AccountResolver
  /** The native folder dialog; the chosen absolute path, or null when cancelled. */
  chooseFolder: () => Promise<string | null>
  /** The native confirmation; true when the user chose Allow. */
  confirm: (message: string, detail: string) => Promise<boolean>
  trash: (absolutePath: string) => Promise<void>
  onChangesChanged: () => void
  env?: NodeJS.ProcessEnv
  spawn?: Spawn
  now?: () => number
}

type Api = Omit<DesktopComputerApi, 'changes'>

export class ComputerService implements Api {
  private readonly sessionsById = new Map<string, Session>()
  private readonly grants: GrantsStore
  readonly changesStore: ChangesStore
  private readonly folders: FolderService
  private readonly operations: Operations
  private readonly shell: CommandShell
  private shellEnvironment: Promise<NodeJS.ProcessEnv> | null = null
  private readonly now: () => number
  private readonly root: string

  constructor(private readonly options: ComputerServiceOptions) {
    this.now = options.now ?? Date.now
    this.root = path.join(options.userData, 'computer')
    this.grants = new GrantsStore(path.join(this.root, 'grants.json'))
    this.changesStore = new ChangesStore({
      root: path.join(this.root, 'changes'),
      onChanged: options.onChangesChanged,
      folderGranted: async (account, folder) => (await this.grants.get(account)).folders.includes(folder),
      trash: options.trash,
      platform: options.platform,
      now: this.now,
    })
    this.folders = new FolderService({ changes: this.changesStore, platform: options.platform, allowHttpLocalhost: options.allowHttpLocalhost, trash: options.trash })
    this.operations = new Operations({
      platform: options.platform,
      savedOutputDir: path.join(this.root, 'tool-output'),
      scriptDir: path.join(this.root, 'scripts'),
      spawn: options.spawn,
      now: this.now,
    })
    this.shell = commandShell(options.platform, options.env ?? process.env)
  }

  get attachmentsDir(): string { return path.join(this.root, 'attachments') }

  defaultFolder(): ComputerFolder { return { path: path.join(this.options.home, 'Pulpo'), name: 'Pulpo' } }

  private folderOf(folder: string): ComputerFolder { return { path: folder, name: path.basename(folder) || folder } }

  async status(): Promise<{ fullAccess: boolean; folders: ComputerFolder[]; defaultFolder: ComputerFolder }> {
    const account = await this.options.accounts.current()
    const grants = account ? await this.grants.get(account) : { fullAccess: false, folders: [] }
    return { fullAccess: grants.fullAccess, folders: grants.folders.map((folder) => this.folderOf(folder)), defaultFolder: this.defaultFolder() }
  }

  async chooseFolder(): Promise<ComputerFolder | null> {
    const account = await this.options.accounts.current()
    if (!account) return null
    const chosen = await this.options.chooseFolder()
    if (!chosen || !path.isAbsolute(chosen)) return null
    if (!(await stat(chosen).catch(() => null))?.isDirectory()) return null
    const folder = path.resolve(chosen)
    // The account may have changed while the dialog was open.
    const still = await this.options.accounts.current()
    if (!still || accountKey(still) !== accountKey(account)) return null
    await this.grants.addFolder(account, folder)
    return this.folderOf(folder)
  }

  async allowFullAccess(): Promise<boolean> {
    const account = await this.options.accounts.current()
    if (!account) return false
    if ((await this.grants.get(account)).fullAccess) return true
    const allowed = await this.options.confirm(
      `Let Pulpo Agent run commands on ${computerNoun(this.options.platform)}?`,
      'With Full access, the agent can run any command and change any file your account can.',
    )
    if (!allowed) return false
    const still = await this.options.accounts.current()
    if (!still || accountKey(still) !== accountKey(account)) return false
    await this.grants.allowFullAccess(account)
    return true
  }

  async begin(input: { sessionId: string; access: ComputerAccess; folder: string | null }): Promise<{ ok: true } | { ok: false; reason: 'folder_not_allowed' | 'full_access_not_allowed' | 'signed_out' }> {
    const value = (input ?? {}) as Partial<typeof input>
    const access = computerAccessSchema.safeParse(value.access)
    if (typeof value.sessionId !== 'string' || !UUID.test(value.sessionId) || !access.success || (value.folder !== null && typeof value.folder !== 'string')) {
      throw new Error('Invalid computer session.')
    }
    const account = await this.options.accounts.current()
    const signIn = await this.options.accounts.signIn()
    if (!account || !signIn) return { ok: false, reason: 'signed_out' }
    const grants = await this.grants.get(account)
    const folder = value.folder === null || value.folder === undefined ? null : path.resolve(value.folder)
    if (folder !== null && (!path.isAbsolute(value.folder!) || !grants.folders.includes(folder))) return { ok: false, reason: 'folder_not_allowed' }
    if (access.data === 'full') {
      if (!grants.fullAccess) return { ok: false, reason: 'full_access_not_allowed' }
    } else if (folder === null) return { ok: false, reason: 'folder_not_allowed' }
    this.pruneSessions()
    const existing = this.sessionsById.get(value.sessionId)
    if (existing && (existing.access !== access.data || existing.folder !== folder || accountKey(existing.account) !== accountKey(account))) this.operations.cancelSession(existing.id)
    this.sessionsById.delete(value.sessionId)
    this.sessionsById.set(value.sessionId, { id: value.sessionId, access: access.data, folder, account, signIn, origin: account.origin, lastUsedAt: this.now() })
    while (this.sessionsById.size > MAX_SESSIONS) this.endSession(this.sessionsById.keys().next().value!)
    return { ok: true }
  }

  private endSession(sessionId: string, options: { now?: boolean } = {}): void {
    if (!this.sessionsById.delete(sessionId)) return
    this.operations.cancelSession(sessionId, options)
  }

  async end(sessionId: string): Promise<void> {
    if (typeof sessionId === 'string') this.endSession(sessionId)
  }

  private pruneSessions(): void {
    const cutoff = this.now() - SESSION_IDLE_MS
    for (const session of [...this.sessionsById.values()]) if (session.lastUsedAt < cutoff) this.endSession(session.id)
  }

  async sessions(): Promise<string[]> {
    this.pruneSessions()
    return [...this.sessionsById.keys()]
  }

  /** The app is quitting: nothing it started for the agent keeps running after it. */
  shutdown(): void {
    for (const sessionId of [...this.sessionsById.keys()]) this.endSession(sessionId, { now: true })
  }

  /**
   * The stored sign-in changed: sessions begun under any other one (or left behind by a sign-out)
   * end now. This asks nothing of the instance, so a network blip neither ends a running reply
   * nor leaves another account's sessions served while an answer is awaited.
   */
  async sessionChanged(): Promise<void> {
    this.options.accounts.forget()
    const signIn = await this.options.accounts.signIn().catch(() => null)
    for (const session of [...this.sessionsById.values()]) {
      if (session.signIn !== signIn) this.endSession(session.id)
    }
  }

  /** Takes full access back; the next use shows the native confirmation again. */
  async revokeFullAccess(): Promise<void> {
    const account = await this.options.accounts.current()
    if (!account) return
    await this.grants.revokeFullAccess(account)
    for (const session of [...this.sessionsById.values()]) {
      if (session.access === 'full' && accountKey(session.account) === accountKey(account)) this.endSession(session.id)
    }
  }

  /** Forgets an allowed folder; it must be chosen in the folder dialog again to be used. */
  async forgetFolder(folder: string): Promise<void> {
    if (typeof folder !== 'string' || !path.isAbsolute(folder)) return
    const account = await this.options.accounts.current()
    if (!account) return
    const target = path.resolve(folder)
    await this.grants.removeFolder(account, target)
    for (const session of [...this.sessionsById.values()]) {
      if (session.folder === target && accountKey(session.account) === accountKey(account)) this.endSession(session.id)
    }
  }

  async handle(raw: unknown): Promise<ComputerResponse> {
    const ids = (raw ?? {}) as { id?: unknown; sessionId?: unknown }
    const id = typeof ids.id === 'string' && UUID.test(ids.id) ? ids.id : NO_ID
    const sessionId = typeof ids.sessionId === 'string' && UUID.test(ids.sessionId) ? ids.sessionId : NO_ID
    const fail = (code: ComputerError['code'], message: string): ComputerResponse => ({ id, sessionId, ok: false, code, message: message.slice(0, 4_000) })
    try {
      const request = computerRequestSchema.safeParse(raw)
      if (!request.success) return fail('invalid_request', 'The request is malformed.')
      this.pruneSessions()
      const session = this.sessionsById.get(request.data.sessionId)
      if (!session) return fail('unknown_session', 'The Pulpo app on the user\'s computer does not know this session: it was restarted, or the reply that began it is over. Ask the user to send the message again.')
      const { method } = request.data
      const allowed = session.access === 'full' ? FULL_METHODS.has(method) : FOLDER_METHODS.has(method)
      if (!allowed) return fail('not_allowed', session.access === 'full'
        ? `${method} is not available with Full access; use the workspace tools directly.`
        : `${method} is not available in this access mode; only the folder can be used.`)
      const params = computerMethods[method].params.safeParse(request.data.params)
      if (!params.success) return fail('invalid_request', `Invalid parameters for ${method}: ${params.error.issues.map((issue) => `${issue.path.join('.') || 'params'}: ${issue.message}`).join('; ')}`.slice(0, 1_000))
      session.lastUsedAt = this.now()
      try {
        const result = await this.run(session, method, params.data)
        return { id, sessionId, ok: true, result }
      } catch (error) {
        const { code, message } = computerErrorOf(error)
        return fail(code, session.access === 'full' ? message : await this.withoutFolderPath(session, message))
      }
    } catch (error) {
      const { code, message } = computerErrorOf(error)
      return fail(code, message)
    }
  }

  /**
   * In the folder modes the agent, a cloud sandbox, only ever learns the folder's name. Errors
   * raised by the file system carry absolute paths, so the folder's own path is replaced by its name.
   */
  private async withoutFolderPath(session: Session, message: string): Promise<string> {
    if (!session.folder) return message
    const name = path.basename(session.folder) || 'the folder'
    const real = await realpath(session.folder).catch(() => session.folder!)
    let result = message
    // Longest first, so one path is not cut by the other's replacement.
    for (const folder of [...new Set([real, session.folder])].sort((left, right) => right.length - left.length)) result = result.split(folder).join(name)
    return result
  }

  private async sessionCwd(session: Session): Promise<string> {
    if (session.folder === null) {
      const folder = this.defaultFolder().path
      await mkdir(folder, { recursive: true })
      return folder
    }
    if (!(await stat(session.folder).catch(() => null))?.isDirectory()) throw new ComputerError('not_found', `The folder ${session.folder} is no longer available on the user's computer.`)
    return session.folder
  }

  private environment(): Promise<NodeJS.ProcessEnv> {
    this.shellEnvironment ??= resolveShellEnvironment(this.options.platform, this.shell, this.options.env ?? process.env, this.options.spawn)
    return this.shellEnvironment
  }

  private async operationContext(session: Session): Promise<OperationContext> {
    return { sessionId: session.id, cwd: await this.sessionCwd(session), shell: this.shell, env: () => this.environment() }
  }

  private async run(session: Session, method: ComputerMethod, input: unknown): Promise<unknown> {
    // `input` was validated against computerMethods[method].params by the caller.
    const params = <M extends ComputerMethod>() => input as ComputerParams<M>
    const files = { origin: session.origin, allowHttpLocalhost: this.options.allowHttpLocalhost, platform: this.options.platform }
    switch (method) {
      case 'describe': {
        const cwd = await this.sessionCwd(session)
        await mkdir(this.attachmentsDir, { recursive: true })
        return {
          os: computerOs(this.options.platform),
          osVersion: osVersionLabel(this.options.platform, this.options.osVersion()).slice(0, 100),
          arch: this.options.arch.slice(0, 40),
          shell: this.shell.name.slice(0, 40),
          home: this.options.home,
          cwd,
          attachmentsDir: this.attachmentsDir,
        }
      }
      case 'operation.start': { const { id, type, args } = params<'operation.start'>(); return this.operations.start(await this.operationContext(session), id, type, args) }
      case 'operation.get': { const { id, waitMs } = params<'operation.get'>(); return this.operations.get(session.id, id, waitMs) }
      case 'operation.cancel': return this.operations.cancel(session.id, params<'operation.cancel'>().id)
      case 'file.send': return sendFile(files, params<'file.send'>())
      case 'file.receive': return receiveFile(files, params<'file.receive'>())
      case 'file.missing': return missingFiles(files, params<'file.missing'>())
      default: break
    }
    if (!isComputerFolderMode(session.access) || session.folder === null) throw new ComputerError('not_allowed', `${method} needs a folder session.`)
    const folder: FolderSession = { sessionId: session.id, access: session.access as ComputerFolderMode, folder: session.folder, account: session.account, origin: session.origin }
    switch (method) {
      case 'folder.list': return this.folders.list(folder, params<'folder.list'>())
      case 'folder.read': return this.folders.read(folder, params<'folder.read'>())
      case 'folder.search': return this.folders.search(folder, params<'folder.search'>())
      case 'folder.send': return this.folders.send(folder, params<'folder.send'>())
      case 'folder.change': return this.folders.change(folder, params<'folder.change'>())
      default: throw new ComputerError('not_allowed', `Unknown method ${String(method)}`)
    }
  }

  // The review side, for the signed-in account only.

  private async account(): Promise<ComputerAccount> {
    const account = await this.options.accounts.current()
    if (!account) throw new Error('Sign in to review changes.')
    return account
  }

  async listChanges(filter: { sessionIds?: string[]; folder?: string } = {}): Promise<ComputerChange[]> {
    const account = await this.options.accounts.current()
    if (!account) return []
    const sessionIds = Array.isArray(filter?.sessionIds) ? filter.sessionIds.filter((value): value is string => typeof value === 'string') : undefined
    const folder = typeof filter?.folder === 'string' ? filter.folder : undefined
    return this.changesStore.list(account, { sessionIds, folder })
  }

  async getChange(id: string): Promise<ComputerChangeDetail | null> {
    if (typeof id !== 'string') return null
    const account = await this.options.accounts.current()
    return account ? this.changesStore.detail(account, id) : null
  }

  async acceptChanges(ids: string[], options?: { overwrite?: boolean }): Promise<ComputerChange[]> {
    if (!Array.isArray(ids)) throw new Error('Invalid change ids.')
    return this.changesStore.accept(await this.account(), ids.filter((value) => typeof value === 'string'), { overwrite: options?.overwrite === true })
  }

  async rejectChanges(ids: string[]): Promise<ComputerChange[]> {
    if (!Array.isArray(ids)) throw new Error('Invalid change ids.')
    return this.changesStore.reject(await this.account(), ids.filter((value) => typeof value === 'string'))
  }

  /** Startup housekeeping: old attachments, saved outputs and decided changes. */
  async cleanup(): Promise<void> {
    const removeOlderThan = async (directory: string, retentionMs: number) => {
      const cutoff = this.now() - retentionMs
      for (const name of await readdir(directory).catch(() => [] as string[])) {
        const file = path.join(directory, name)
        const metadata = await stat(file).catch(() => null)
        if (metadata && metadata.mtimeMs < cutoff) await rm(file, { recursive: true, force: true }).catch(() => undefined)
      }
    }
    await removeOlderThan(this.attachmentsDir, ATTACHMENT_RETENTION_MS)
    await removeOlderThan(path.join(this.root, 'tool-output'), TOOL_OUTPUT_RETENTION_MS)
    await rm(path.join(this.root, 'scripts'), { recursive: true, force: true }).catch(() => undefined)
    await this.changesStore.prune().catch(() => undefined)
  }
}
