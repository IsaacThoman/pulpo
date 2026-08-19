import { agentSettingsSchema, authSettingsSchema } from '@pulpo/contracts'
import { eq, sql } from 'drizzle-orm'
import { z } from 'zod'
import { createPasswordHash } from '../auth/service.js'
import { getConfig, getWorkspaceInstanceId, type Config } from '../config.js'
import { db } from '../database/client.js'
import {
  applicationSettings,
  auditEvents,
  labs,
  modelPricingVersions,
  models,
  passwordCredentials,
  providerConnections,
  providerUpstreamModels,
  userPreferences,
  users,
} from '../database/schema.js'
import { decryptSecret, encryptSecret } from '../lib/crypto.js'
import { newId } from '../lib/ids.js'

export const CI_PREVIEW_BOOTSTRAP_MARKER = 'bootstrap:ci-preview'
export const CI_PREVIEW_ADMIN_ID = '00000000-0000-7000-8000-000000000101'
export const CI_PREVIEW_PROVIDER_ID = '00000000-0000-7000-8000-000000000102'
export const CI_PREVIEW_LAB_ID = '00000000-0000-7000-8000-000000000103'
export const CI_PREVIEW_PRICING_ID = '00000000-0000-7000-8000-000000000104'
export const CI_PREVIEW_MODEL_ID = 'gpt-5.6-luna'

const PREVIEW_HOST_PATTERN = /^pulpo(?:-dev)?-pr-[1-9]\d*\.deathgrips\.org$/
const LOCAL_PREVIEW_INSTANCE_ID = 'local-preview'
const PROVIDER_BASE_URL = 'https://pulpo.baby/v1'
const DEVELOPMENT_ENCRYPTION_KEY = 'development-only-key-change-me-000000'
const BOOTSTRAP_LOCK_ID = 1_886_747_745

const providerModelsSchema = z.object({
  data: z.array(z.object({ id: z.string() })),
})

export function ciPreviewAgentSettings(workspaceImageDigest: string) {
  return agentSettingsSchema.parse({
    enabled: true,
    generationConcurrency: 1,
    imageDigest: workspaceImageDigest,
    warmCapacity: 0,
    maxActiveWorkspaces: 1,
    cpu: '2',
    memory: '2048Mi',
    ephemeralStorage: '20Gi',
    idleTimeoutSeconds: 300,
    hardTimeoutSeconds: 1_800,
    workspaceWaitTimeoutSeconds: 300,
    maxModelTurns: 20,
    maxToolCalls: 50,
    responseTimeoutSeconds: 900,
    commandTimeoutSeconds: 300,
    maxToolOutputBytes: 100_000,
  })
}

export const CI_PREVIEW_MODEL = {
  id: CI_PREVIEW_MODEL_ID,
  upstreamModelId: CI_PREVIEW_MODEL_ID,
  name: 'GPT-5.6 Luna',
  description: 'GPT-5.6 Luna through the budget-limited Pulpo Baby preview provider.',
  enabled: true,
  visible: true,
  logo: 'openai',
  agentEnabled: true,
  contextWindow: 128_000,
  maxOutputTokens: 16_384,
  compactionEnabled: true,
  compactionThresholdTokens: 96_000,
  compactionRetainedTurns: 4,
  executionMode: 'stream' as const,
  tags: ['Reasoning', 'Agent'],
  allowedParameters: [],
  useProviderCost: false,
}

export type CiPreviewSeed = {
  adminEmail: string
  passwordHash: string
  encryptedProviderApiKey: string
  workspaceImageDigest: string
}

export interface LockedBootstrapStore {
  markerExists(): Promise<boolean>
  seededProviderEncryptedApiKey(): Promise<string | undefined>
  userExists(): Promise<boolean>
  create(seed: CiPreviewSeed): Promise<void>
}

export interface BootstrapStore {
  withLock<T>(operation: (store: LockedBootstrapStore) => Promise<T>): Promise<T>
}

export type BootstrapDependencies = {
  store: BootstrapStore
  fetch: typeof globalThis.fetch
  hashPassword: typeof createPasswordHash
  encrypt: typeof encryptSecret
  decrypt: typeof decryptSecret
}

function requirePreviewRuntimeConfig(config: Config): void {
  if (!config.WORKSPACE_CONTROLLER_URL || !config.WORKSPACE_CONTROLLER_TOKEN) {
    throw new Error('WORKSPACE_CONTROLLER_URL and WORKSPACE_CONTROLLER_TOKEN are required by the ci-preview preset')
  }
  if (config.ENCRYPTION_KEY === DEVELOPMENT_ENCRYPTION_KEY) {
    throw new Error('A non-default ENCRYPTION_KEY is required by the ci-preview preset')
  }
}

function requirePreviewSeedConfig(config: Config): {
  adminEmail: string
  adminPassword: string
  providerApiKey: string
  workspaceImageDigest: string
} {
  if (!config.PULPO_PREVIEW_ADMIN_EMAIL) throw new Error('PULPO_PREVIEW_ADMIN_EMAIL is required by the ci-preview preset')
  if (!config.PULPO_PREVIEW_ADMIN_PASSWORD) throw new Error('PULPO_PREVIEW_ADMIN_PASSWORD is required by the ci-preview preset')
  if (!config.PULPO_PREVIEW_PROVIDER_API_KEY) throw new Error('PULPO_PREVIEW_PROVIDER_API_KEY is required by the ci-preview preset')
  if (!config.PULPO_PREVIEW_WORKSPACE_IMAGE_DIGEST) throw new Error('PULPO_PREVIEW_WORKSPACE_IMAGE_DIGEST is required by the ci-preview preset')
  requirePreviewRuntimeConfig(config)
  return {
    adminEmail: config.PULPO_PREVIEW_ADMIN_EMAIL,
    adminPassword: config.PULPO_PREVIEW_ADMIN_PASSWORD,
    providerApiKey: config.PULPO_PREVIEW_PROVIDER_API_KEY,
    workspaceImageDigest: config.PULPO_PREVIEW_WORKSPACE_IMAGE_DIGEST,
  }
}

async function validateProviderAccess(fetchImplementation: typeof globalThis.fetch, apiKey: string): Promise<void> {
  let response: Response
  try {
    response = await fetchImplementation(`${PROVIDER_BASE_URL}/models`, {
      headers: { authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(10_000),
    })
  } catch (error) {
    throw new Error(
      `Pulpo Baby model validation failed: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    )
  }
  if (!response.ok) throw new Error(`Pulpo Baby model validation returned ${response.status}`)
  const body = providerModelsSchema.parse(await response.json())
  if (!body.data.some((model) => model.id === CI_PREVIEW_MODEL_ID)) {
    throw new Error(`Pulpo Baby API key does not allow ${CI_PREVIEW_MODEL_ID}`)
  }
}

export async function runBootstrapPreset(
  config: Config,
  instanceId: string,
  dependencies: BootstrapDependencies,
): Promise<'disabled' | 'existing' | 'created'> {
  const isTrustedPreview = PREVIEW_HOST_PATTERN.test(instanceId)
    || (config.NODE_ENV === 'development' && instanceId === LOCAL_PREVIEW_INSTANCE_ID)
  if (!config.PULPO_BOOTSTRAP_PRESET) {
    if (isTrustedPreview) {
      throw new Error('PULPO_BOOTSTRAP_PRESET=ci-preview is required for trusted Pulpo preview deployments')
    }
    return 'disabled'
  }
  if (!isTrustedPreview) {
    throw new Error(`The ci-preview preset is not allowed for Pulpo instance ${instanceId}`)
  }
  requirePreviewRuntimeConfig(config)

  return dependencies.store.withLock(async (store) => {
    if (await store.markerExists()) {
      const encryptedApiKey = await store.seededProviderEncryptedApiKey()
      if (!encryptedApiKey) throw new Error('The ci-preview provider connection is missing from the seeded database')
      try {
        dependencies.decrypt(encryptedApiKey, config.ENCRYPTION_KEY)
      } catch {
        throw new Error('The ci-preview provider key cannot be decrypted with the configured ENCRYPTION_KEY')
      }
      return 'existing'
    }
    if (await store.userExists()) throw new Error('The ci-preview preset requires an empty, unconfigured Pulpo database')

    const input = requirePreviewSeedConfig(config)
    await validateProviderAccess(dependencies.fetch, input.providerApiKey)
    const [passwordHash, encryptedProviderApiKey] = await Promise.all([
      dependencies.hashPassword(input.adminPassword),
      Promise.resolve(dependencies.encrypt(input.providerApiKey, config.ENCRYPTION_KEY)),
    ])
    await store.create({
      adminEmail: input.adminEmail,
      passwordHash,
      encryptedProviderApiKey,
      workspaceImageDigest: input.workspaceImageDigest,
    })
    return 'created'
  })
}

type BootstrapTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0]

function lockedDatabaseStore(transaction: BootstrapTransaction): LockedBootstrapStore {
  return {
    async markerExists() {
      const [marker] = await transaction.select({ key: applicationSettings.key }).from(applicationSettings)
        .where(eq(applicationSettings.key, CI_PREVIEW_BOOTSTRAP_MARKER)).limit(1)
      return Boolean(marker)
    },
    async seededProviderEncryptedApiKey() {
      const [provider] = await transaction.select({ encryptedApiKey: providerConnections.encryptedApiKey })
        .from(providerConnections).where(eq(providerConnections.id, CI_PREVIEW_PROVIDER_ID)).limit(1)
      return provider?.encryptedApiKey
    },
    async userExists() {
      const [user] = await transaction.select({ id: users.id }).from(users).limit(1)
      return Boolean(user)
    },
    async create(seed) {
      const agentSettings = ciPreviewAgentSettings(seed.workspaceImageDigest)
      const authSettings = authSettingsSchema.parse({
        signupEnabled: false,
        adminEmail: seed.adminEmail,
      })

      await transaction.insert(users).values({
        id: CI_PREVIEW_ADMIN_ID,
        email: seed.adminEmail,
        name: 'Preview Admin',
        username: 'preview_admin',
        role: 'admin',
        balanceMicros: 100_000_000,
        storageLimitBytes: 5_000 * 1024 * 1024,
      })
      await transaction.insert(passwordCredentials).values({ userId: CI_PREVIEW_ADMIN_ID, passwordHash: seed.passwordHash })
      await transaction.insert(providerConnections).values({
        id: CI_PREVIEW_PROVIDER_ID,
        name: 'Pulpo Baby',
        baseUrl: PROVIDER_BASE_URL,
        encryptedApiKey: seed.encryptedProviderApiKey,
        enabled: true,
        lastHealthStatus: 'healthy',
        lastHealthAt: new Date(),
        upstreamModelsSyncedAt: new Date(),
      })
      await transaction.insert(providerUpstreamModels).values({ providerConnectionId: CI_PREVIEW_PROVIDER_ID, modelId: CI_PREVIEW_MODEL_ID })
      await transaction.insert(labs).values({ id: CI_PREVIEW_LAB_ID, name: 'OpenAI', logo: 'openai' })
      await transaction.insert(models).values({
        ...CI_PREVIEW_MODEL,
        providerConnectionId: CI_PREVIEW_PROVIDER_ID,
        labId: CI_PREVIEW_LAB_ID,
      })
      await transaction.insert(modelPricingVersions).values({
        id: CI_PREVIEW_PRICING_ID,
        modelId: CI_PREVIEW_MODEL_ID,
        inputPriceMicros: 0,
        cachedInputPriceMicros: 0,
        cacheWritePriceMicros: 0,
        outputPriceMicros: 0,
        perRequestPriceMicros: 0,
      })
      await transaction.insert(userPreferences).values({
        userId: CI_PREVIEW_ADMIN_ID,
        values: {
          defaultModelId: CI_PREVIEW_MODEL_ID,
          favoriteModelIds: [CI_PREVIEW_MODEL_ID],
          providerOrder: [CI_PREVIEW_LAB_ID],
          agentModes: {},
        },
      })
      await transaction.insert(applicationSettings).values([
        { key: 'auth', value: authSettings, updatedBy: CI_PREVIEW_ADMIN_ID },
        { key: 'agent', value: agentSettings, updatedBy: CI_PREVIEW_ADMIN_ID },
      ])
      await transaction.insert(auditEvents).values({
        id: newId(),
        actorUserId: CI_PREVIEW_ADMIN_ID,
        action: 'bootstrap.ci_preview',
        targetType: 'application',
        metadata: { modelId: CI_PREVIEW_MODEL_ID, providerBaseUrl: PROVIDER_BASE_URL },
      })
      await transaction.insert(applicationSettings).values({
        key: CI_PREVIEW_BOOTSTRAP_MARKER,
        value: { version: 1, completedAt: new Date().toISOString() },
        updatedBy: CI_PREVIEW_ADMIN_ID,
      })
    },
  }
}

const databaseBootstrapStore: BootstrapStore = {
  withLock(operation) {
    return db.transaction(async (transaction) => {
      await transaction.execute(sql`select pg_advisory_xact_lock(${BOOTSTRAP_LOCK_ID})`)
      return operation(lockedDatabaseStore(transaction))
    })
  },
}

export async function ensureBootstrapPreset(
  config = getConfig(),
  environment: NodeJS.ProcessEnv = process.env,
): Promise<'disabled' | 'existing' | 'created'> {
  return runBootstrapPreset(config, getWorkspaceInstanceId(config, environment), {
    store: databaseBootstrapStore,
    fetch: globalThis.fetch,
    hashPassword: createPasswordHash,
    encrypt: encryptSecret,
    decrypt: decryptSecret,
  })
}
