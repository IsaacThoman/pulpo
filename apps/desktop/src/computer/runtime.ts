import { scopeChatPaths } from './scoped-paths'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { computerChatAttachmentsDirectory, type ComputerAnnounce, type ComputerOs } from '@pulpo/contracts'
import { OperationRunner, StagedFiles, createPathPolicy, defaultShellFor, platformForProcess, type PathPolicy } from '@pulpo/workspace-daemon/core'
import type { ComputerConfig } from './config-store'

export interface ComputerRuntimeInput {
  config: ComputerConfig
  userDataDir: string
  homeDir: string
  platform: NodeJS.Platform
  arch: string
  appVersion: string
  rgPath?: string
  env?: NodeJS.ProcessEnv
  /** Streams operation changes (shell output) back to whoever is polling. */
  onOperationChange?: (operationId: string) => void
}

export interface ComputerRuntime {
  announce: ComputerAnnounce
  forChat(chatId: string): ChatComputerRuntime
  cancelAll(): Promise<void>
}

export interface ChatComputerRuntime {
  runner: OperationRunner
  /** Governs agent tools: confined to the chosen folder, or unrestricted in full mode. */
  policy: PathPolicy
  /** Governs attachment staging, which always lands in the app's own attachments directory. */
  attachmentsPolicy: PathPolicy
  stagedFiles: StagedFiles
  attachmentsDir: string
}

export function computerOsFor(platform: NodeJS.Platform): ComputerOs {
  return platform === 'darwin' ? 'macos' : platform === 'win32' ? 'windows' : 'linux'
}

export function attachmentsDirectory(userDataDir: string): string {
  return path.join(userDataDir, 'agent-workspace', 'chats')
}

/** The folder shell commands start in and file tools resolve against. */
export function computerRootPath(config: ComputerConfig, homeDir: string): string {
  if (config.accessMode === 'full') return homeDir
  if (!config.rootPath) throw new Error('Choose a folder before enabling this computer')
  return config.rootPath
}

export function buildComputerAnnounce(input: Pick<ComputerRuntimeInput, 'config' | 'userDataDir' | 'homeDir' | 'platform' | 'arch' | 'appVersion'>): ComputerAnnounce {
  const { config } = input
  return {
    computerId: config.computerId,
    name: config.name,
    os: computerOsFor(input.platform),
    arch: input.arch,
    appVersion: input.appVersion,
    accessMode: config.accessMode,
    rootPath: computerRootPath(config, input.homeDir),
    attachmentsDir: attachmentsDirectory(input.userDataDir),
    homeDir: input.homeDir,
    shell: defaultShellFor(input.platform),
    approvalPolicy: config.approvalPolicy,
    allowRemote: config.allowRemote,
  }
}

let cachedLoginPath: string | undefined

/**
 * macOS apps launched from the Dock inherit a minimal PATH. Ask the user's login shell for the
 * real one once so the agent can find tools like git, node, and brew installs.
 */
export function loginShellPath(platform: NodeJS.Platform, env: NodeJS.ProcessEnv = process.env): string | undefined {
  if (platform !== 'darwin') return env.PATH
  if (cachedLoginPath) return cachedLoginPath
  try {
    const shell = env.SHELL && env.SHELL.trim() ? env.SHELL : '/bin/zsh'
    const output = execFileSync(shell, ['-ilc', 'echo -n "$PATH"'], { encoding: 'utf8', timeout: 5_000, stdio: ['ignore', 'pipe', 'ignore'] })
    cachedLoginPath = output.trim() || env.PATH
  } catch {
    cachedLoginPath = env.PATH
  }
  return cachedLoginPath
}

export function createComputerRuntime(input: ComputerRuntimeInput): ComputerRuntime {
  const announce = buildComputerAnnounce(input)
  const chats = new Map<string, ChatComputerRuntime>()
  return {
    announce,
    cancelAll: async () => { await Promise.all([...chats.values()].map((chat) => chat.runner.cancelAll())) },
    forChat: (chatId) => {
      const attachmentsDir = computerChatAttachmentsDirectory(announce.attachmentsDir, chatId, announce.os)
      const existing = chats.get(chatId)
      if (existing) return existing
      const pathPlatform = platformForProcess(input.platform)
      const storageRoot = path.join(input.userDataDir, 'agent-workspace')
      const policy = scopeChatPaths(createPathPolicy({
        writableRoot: announce.rootPath,
        readableRoots: [attachmentsDir],
        platform: pathPlatform,
        unrestricted: input.config.accessMode === 'full',
      }), storageRoot, attachmentsDir)
      const attachmentsPolicy = scopeChatPaths(createPathPolicy({ writableRoot: attachmentsDir, platform: pathPlatform }), storageRoot, attachmentsDir)
      const baseEnv = input.env ?? process.env
      const shellPath = loginShellPath(input.platform, baseEnv)
      const runner = new OperationRunner({
        policy, shell: announce.shell,
        env: { ...baseEnv, ...(shellPath ? { PATH: shellPath } : {}) },
        journalDir: path.join(input.userDataDir, 'agent-workspace', 'chats', chatId, 'operations'),
        searchPathAllowed: async (target) => { try { await policy.readable(target); return true } catch { return false } },
        rgPath: input.rgPath, platform: input.platform,
        onChange: (operation) => input.onOperationChange?.(operation.id),
      })
      const runtime = { runner, policy, attachmentsPolicy, stagedFiles: new StagedFiles(), attachmentsDir }
      chats.set(chatId, runtime)
      return runtime
    },
  }
}
