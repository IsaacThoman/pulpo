import { randomBytes, randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { ComputerAccessMode, ComputerApprovalPolicy } from '@pulpo/contracts'

/** Persisted on disk in the app's user-data directory. Defaults keep the feature off until the user opts in. */
export interface ComputerConfig {
  version: 1
  /** Stable identity for this installation; generated once and reused across sign-ins. */
  computerId: string
  deviceSecret: string
  enabled: boolean
  name: string
  accessMode: ComputerAccessMode
  rootPath: string | null
  approvalPolicy: ComputerApprovalPolicy
  allowRemote: boolean
}

export const COMPUTER_CONFIG_FILE = 'computer.json'

const ACCESS_MODES: ComputerAccessMode[] = ['folder', 'full']
const APPROVAL_POLICIES: ComputerApprovalPolicy[] = ['default', 'bash-only', 'never']
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function defaultComputerConfig(hostname: string): ComputerConfig {
  return {
    version: 1,
    computerId: randomUUID(),
    deviceSecret: randomBytes(32).toString('hex'),
    enabled: false,
    name: hostname.trim() || 'This computer',
    accessMode: 'folder',
    rootPath: null,
    approvalPolicy: 'default',
    allowRemote: false,
  }
}

/** Coerce whatever is on disk into a valid config, keeping the stored id whenever it is usable. */
export function normalizeComputerConfig(value: unknown, hostname: string): ComputerConfig {
  const fallback = defaultComputerConfig(hostname)
  if (!value || typeof value !== 'object') return fallback
  const candidate = value as Partial<ComputerConfig>
  const name = typeof candidate.name === 'string' && candidate.name.trim() ? candidate.name.trim().slice(0, 120) : fallback.name
  const rootPath = typeof candidate.rootPath === 'string' && candidate.rootPath.trim() ? candidate.rootPath : null
  const accessMode = ACCESS_MODES.includes(candidate.accessMode as ComputerAccessMode) ? candidate.accessMode as ComputerAccessMode : 'folder'
  return {
    version: 1,
    computerId: typeof candidate.computerId === 'string' && UUID_PATTERN.test(candidate.computerId) ? candidate.computerId : fallback.computerId,
    deviceSecret: typeof candidate.deviceSecret === 'string' && /^[a-f0-9]{64}$/.test(candidate.deviceSecret) ? candidate.deviceSecret : fallback.deviceSecret,
    // Folder mode without a folder cannot run, so it is never enabled.
    enabled: candidate.enabled === true && (accessMode === 'full' || rootPath !== null),
    name,
    accessMode,
    rootPath,
    approvalPolicy: APPROVAL_POLICIES.includes(candidate.approvalPolicy as ComputerApprovalPolicy) ? candidate.approvalPolicy as ComputerApprovalPolicy : 'default',
    allowRemote: candidate.allowRemote === true,
  }
}

export async function loadComputerConfig(directory: string, hostname: string): Promise<ComputerConfig> {
  try {
    return normalizeComputerConfig(JSON.parse(await readFile(path.join(directory, COMPUTER_CONFIG_FILE), 'utf8')), hostname)
  } catch {
    return defaultComputerConfig(hostname)
  }
}

export async function saveComputerConfig(directory: string, config: ComputerConfig): Promise<void> {
  const destination = path.join(directory, COMPUTER_CONFIG_FILE)
  const temporary = `${destination}.tmp`
  await mkdir(directory, { recursive: true })
  await writeFile(temporary, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 })
  await rename(temporary, destination)
}
