import { mkdir, readdir, realpath, rm, stat } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {
  COMPUTER_APP_IMAGE_MAX_EDGE,
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
import { AppControl, appControlCapability } from './control/apps'
import { ControlHelper, type ControlHelperCommand } from './control/helper'
import { ComputerError, computerErrorOf } from './errors'
import { missingFiles, receiveFile, sendFile } from './files'
import { FolderService, type FolderSession } from './folder'
import { accountDirectoryName, accountKey, GrantsStore, type ComputerAccount } from './grants'
import { installPulpoCli, withPulpoCli } from './launcher'
import { Operations, type OperationContext } from './operations'
import { commandShell, computerNoun, computerOs, osVersionLabel, resolveShellEnvironment, type CommandShell, type Spawn } from './platform'
import { startRelayServer, type RelayServer } from './relay'

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

const UNKNOWN_SESSION = 'The Pulpo app on the user\'s computer does not know this session: it was restarted, or the reply that began it is over. Ask the user to send the message again.'

const FULL_METHODS = new Set<ComputerMethod>(['describe', 'operation.start', 'operation.get', 'operation.cancel', 'operation.relay', 'file.send', 'file.receive', 'file.missing', 'app.list', 'app.act'])
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
  /**
   * `pulpo files` for full-access commands: the executable the launchers run as Node (the app's
   * own, with ELECTRON_RUN_AS_NODE; plain `node` in tests) and the bundled CLI to copy. Without it
   * full access works but offers no Files.
   */
  pulpoCli?: { executable: string; source: string }
  /**
   * Seeing and working in other apps for full-access sessions: how to start this system's helper
   * (control/helper.ts), the processes it must leave alone (the app's own), and the native question
   * that allows one app, which ends as a refusal when its signal aborts. Without it, or on a system
   * with no helper, the app tools are not offered.
   */
  appControl?: { helper: ControlHelperCommand; excludePids: number[]; confirmApp: (message: string, detail: string, signal: AbortSignal) => Promise<boolean> }
  /** For the relay socket when the usual path is too long; os.tmpdir() by default. */
  tmpdir?: string
  /** Tests shorten the daemon's relay limits. */
  relayTimeoutMs?: number
  relayHandshakeMs?: number
  /** Something went wrong that costs the agent a feature but fails nothing. */
  onError?: (message: string, error: unknown) => void
}

/** What full-access commands need for `pulpo files`, once the launchers are written and the relay listens. */
interface FilesRelay { binDir: string; relay: RelayServer }

type Api = Omit<DesktopComputerApi, 'changes'>

export class ComputerService implements Api {
  private readonly sessionsById = new Map<string, Session>()
  private readonly grants: GrantsStore
  readonly changesStore: ChangesStore
  private readonly folders: FolderService
  private readonly operations: Operations
  /** Null where other apps cannot be seen or controlled; then `describe` does not offer it. */
  private readonly apps: AppControl | null
  private readonly shell: CommandShell
  private shellEnvironment: Promise<NodeJS.ProcessEnv> | null = null
  private readonly now: () => number
  private readonly root: string
  private filesRelay: Promise<FilesRelay | null> | null = null
  /** Counts changes of the stored sign-in, so work that began under one can tell it is no longer current. */
  private signInChanges = 0
  /** Counts what the user took back (full access, a folder), so a session being begun reads its grants again. */
  private revocations = 0
  private shuttingDown = false

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
      relayTimeoutMs: options.relayTimeoutMs,
      relayHandshakeMs: options.relayHandshakeMs,
    })
    this.shell = commandShell(options.platform, options.env ?? process.env)
    const control = appControlCapability(options.platform) ? options.appControl : undefined
    this.apps = control ? new AppControl({
      helper: new ControlHelper({
        command: control.helper, excludePids: control.excludePids, imageDir: this.appImagesDir, maxImageEdge: COMPUTER_APP_IMAGE_MAX_EDGE,
        prepare: async () => { await mkdir(this.appImagesDir, { recursive: true }) },
        spawn: options.spawn, onError: options.onError,
      }),
      platform: options.platform, imageDir: this.appImagesDir, confirmApp: control.confirmApp,
    }) : null
  }

  /** Where the helper writes the pictures it takes of windows; each is deleted once the server has it. */
  private get appImagesDir(): string { return path.join(this.root, 'app-images') }

  get attachmentsDir(): string { return path.join(this.root, 'attachments') }

  defaultFolder(): ComputerFolder { return { path: path.join(this.options.home, 'Pulpo'), name: 'Pulpo' } }

  private folderOf(folder: string): ComputerFolder { return { path: folder, name: path.basename(folder) || folder } }

  async status(): Promise<Awaited<ReturnType<DesktopComputerApi['status']>> & { signedIn: boolean }> {
    const account = await this.options.accounts.current()
    const grants = account ? await this.grants.get(account) : { fullAccess: false, folders: [], apps: [] }
    return {
      fullAccess: grants.fullAccess, folders: grants.folders.map((folder) => this.folderOf(folder)), defaultFolder: this.defaultFolder(), signedIn: account !== null,
      ...(this.apps ? { apps: grants.apps } : {}),
    }
  }

  /**
   * Per account, what `/workspace` is to the CLI in the cloud: its copies of Files in `files` and
   * its manifest in `.pulpo`. Kept apart so one account's copies never answer for another's.
   */
  private workspaceRoot(account: ComputerAccount): string { return path.join(this.root, 'workspaces', accountDirectoryName(account)) }

  /**
   * Writes the launchers and starts the relay endpoint on first use by a full-access session. Null
   * when either fails; the next session tries again.
   */
  private pulpoFiles(): Promise<FilesRelay | null> {
    const cli = this.options.pulpoCli
    if (!cli || this.shuttingDown) return Promise.resolve(null)
    this.filesRelay ??= (async () => {
      const binDir = path.join(this.root, 'bin')
      await installPulpoCli({ platform: this.options.platform, binDir, executable: cli.executable, source: cli.source })
      const relay = await startRelayServer({ platform: this.options.platform, computerDir: this.root, tmpdir: this.options.tmpdir ?? os.tmpdir(), operations: this.operations })
      // Quitting began while the endpoint was starting.
      if (this.shuttingDown) { await relay.close(); return null }
      this.operations.enableRelay(true)
      return { binDir, relay }
    })().catch((error: unknown) => {
      this.options.onError?.('pulpo files is unavailable on this computer', error)
      this.filesRelay = null
      return null
    })
    return this.filesRelay
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
    const signInChanges = this.signInChanges
    const identity = await this.options.accounts.identity()
    if (!identity) return { ok: false, reason: 'signed_out' }
    const { account, signIn } = identity
    const folder = value.folder === null || value.folder === undefined ? null : path.resolve(value.folder)
    for (;;) {
      const revocations = this.revocations
      const grants = await this.grants.get(account)
      if (folder !== null && (!path.isAbsolute(value.folder!) || !grants.folders.includes(folder))) return { ok: false, reason: 'folder_not_allowed' }
      if (access.data === 'full') {
        if (!grants.fullAccess) return { ok: false, reason: 'full_access_not_allowed' }
      } else if (folder === null) return { ok: false, reason: 'folder_not_allowed' }
      // The account and its grants were read a moment ago. If someone else signed in meanwhile, they
      // are not that person's, and the cleanup for the change may already be over.
      if (await this.options.accounts.signIn() !== signIn || signInChanges !== this.signInChanges) return { ok: false, reason: 'signed_out' }
      // Likewise when something was taken back meanwhile: the grants are read again. Nothing is
      // awaited between this check and registering the session.
      if (revocations === this.revocations) break
    }
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
    this.apps?.endSession(sessionId)
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
  shutdown(): Promise<void> {
    this.shuttingDown = true
    for (const sessionId of [...this.sessionsById.keys()]) this.endSession(sessionId, { now: true })
    // Commands cancelled moments ago may still be ignoring the polite signal.
    this.operations.killStopping()
    this.operations.enableRelay(false)
    this.apps?.shutdown()
    const filesRelay = this.filesRelay
    this.filesRelay = null
    return (filesRelay ?? Promise.resolve(null)).then((value) => value?.relay.close())
  }

  /**
   * The stored sign-in changed: sessions begun under any other one (or left behind by a sign-out)
   * end now. This asks nothing of the instance, so a network blip neither ends a running reply
   * nor leaves another account's sessions served while an answer is awaited.
   */
  async sessionChanged(): Promise<void> {
    this.signInChanges += 1
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
    this.revocations += 1
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
    this.revocations += 1
    for (const session of [...this.sessionsById.values()]) {
      if (session.folder === target && accountKey(session.account) === accountKey(account)) this.endSession(session.id)
    }
  }

  /** Forgets an app the user allowed: what a reply is doing in it stops, and the agent must ask again to use it. */
  async forgetApp(id: string): Promise<void> {
    if (typeof id !== 'string' || !id) return
    const account = await this.options.accounts.current()
    if (!account) return
    await this.grants.removeApp(account, id)
    this.apps?.revoke(accountKey(account), id)
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
      if (!session) return fail('unknown_session', UNKNOWN_SESSION)
      const { method } = request.data
      const allowed = session.access === 'full' ? FULL_METHODS.has(method) : FOLDER_METHODS.has(method)
      if (!allowed) return fail('not_allowed', session.access === 'full'
        ? `${method} is not available with Full access; use the workspace tools directly.`
        : `${method} is not available in this access mode; only the folder can be used.`)
      const params = computerMethods[method].params.safeParse(request.data.params)
      if (!params.success) return fail('invalid_request', `Invalid parameters for ${method}: ${params.error.issues.map((issue) => `${issue.path.join('.') || 'params'}: ${issue.message}`).join('; ')}`.slice(0, 1_000))
      session.lastUsedAt = this.now()
      try {
        const result = await this.run(session, method, params.data, request.data.timeoutMs)
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
    const cwd = await this.sessionCwd(session)
    const files = await this.pulpoFiles()
    const workspaceRoot = this.workspaceRoot(session.account)
    return {
      sessionId: session.id, cwd, shell: this.shell,
      env: async () => files
        ? withPulpoCli(this.options.platform, await this.environment(), { binDir: files.binDir, relayEndpoint: files.relay.endpoint, workspaceRoot })
        : this.environment(),
    }
  }

  private async run(session: Session, method: ComputerMethod, input: unknown, timeoutMs: number): Promise<unknown> {
    // `input` was validated against computerMethods[method].params by the caller.
    const params = <M extends ComputerMethod>() => input as ComputerParams<M>
    // Ending a session cannot reach a request that is still being prepared, so each one asks again
    // just before it changes anything.
    const active = () => this.sessionsById.get(session.id) === session
    const files = { origin: session.origin, allowHttpLocalhost: this.options.allowHttpLocalhost, platform: this.options.platform, active }
    switch (method) {
      case 'describe': {
        const cwd = await this.sessionCwd(session)
        await mkdir(this.attachmentsDir, { recursive: true })
        // Offered only when commands can really run `pulpo files`.
        const filesDir = await this.pulpoFiles() ? path.join(this.workspaceRoot(session.account), 'files') : null
        if (filesDir) await mkdir(filesDir, { recursive: true })
        return {
          os: computerOs(this.options.platform),
          osVersion: osVersionLabel(this.options.platform, this.options.osVersion()).slice(0, 100),
          arch: this.options.arch.slice(0, 40),
          shell: this.shell.name.slice(0, 40),
          home: this.options.home,
          cwd,
          attachmentsDir: this.attachmentsDir,
          ...(filesDir ? { filesDir } : {}),
          ...(this.apps ? { apps: appControlCapability(this.options.platform)! } : {}),
        }
      }
      case 'operation.start': {
        const { id, type, args } = params<'operation.start'>()
        const context = await this.operationContext(session)
        // The reply may have ended, or access been taken back, while that was prepared. Ending a
        // session cancels the operations it has, and this one is not among them yet: started now,
        // it would run with nothing left that could stop it.
        if (!active()) throw new ComputerError('unknown_session', UNKNOWN_SESSION)
        return this.operations.start(context, id, type, args)
      }
      case 'operation.get': { const { id, waitMs } = params<'operation.get'>(); return this.operations.get(session.id, id, waitMs) }
      case 'operation.cancel': return this.operations.cancel(session.id, params<'operation.cancel'>().id)
      case 'operation.relay': { const { requestId, result } = params<'operation.relay'>(); return { delivered: this.operations.answerRelay(session.id, requestId, result) } }
      case 'file.send': return sendFile(files, params<'file.send'>())
      case 'file.receive': return receiveFile(files, params<'file.receive'>())
      case 'file.missing': return missingFiles(files, params<'file.missing'>())
      case 'app.list':
      case 'app.act': {
        if (!this.apps) throw new ComputerError('not_allowed', 'This computer cannot show or control other apps.')
        const control = {
          sessionId: session.id, account: accountKey(session.account), active,
          allowedApps: async () => (await this.grants.get(session.account)).apps,
          allowApp: async (app: { id: string; name: string }) => { await this.grants.allowApp(session.account, app) },
        }
        // `input` holds the parsed action, defaults filled in.
        return method === 'app.list' ? this.apps.list(control) : this.apps.act(control, input as Parameters<AppControl['act']>[1], timeoutMs)
      }
      default: break
    }
    if (!isComputerFolderMode(session.access) || session.folder === null) throw new ComputerError('not_allowed', `${method} needs a folder session.`)
    const folder: FolderSession = { sessionId: session.id, access: session.access as ComputerFolderMode, folder: session.folder, account: session.account, origin: session.origin, active }
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
    await rm(this.appImagesDir, { recursive: true, force: true }).catch(() => undefined)
    await this.changesStore.prune().catch(() => undefined)
  }
}
