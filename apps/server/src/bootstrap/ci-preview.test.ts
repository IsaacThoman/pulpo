import { describe, expect, it, vi } from 'vitest'
import { parseConfig } from '../config.js'
import {
  CI_PREVIEW_MODEL,
  CI_PREVIEW_MODEL_ID,
  ciPreviewAgentSettings,
  runBootstrapPreset,
  type BootstrapDependencies,
  type BootstrapStore,
  type CiPreviewSeed,
  type LockedBootstrapStore,
} from './ci-preview.js'

const imageDigest = `ghcr.io/isaacthoman/pulpo-agent-workspace@sha256:${'a'.repeat(64)}`
const strongEncryptionKey = 'preview-encryption-key-that-is-long-enough'

function previewConfig(overrides: NodeJS.ProcessEnv = {}) {
  return parseConfig({
    PUBLIC_URL: 'https://pulpo-pr-48.deathgrips.org',
    ENCRYPTION_KEY: strongEncryptionKey,
    WORKSPACE_CONTROLLER_URL: 'https://controller.example.com',
    WORKSPACE_CONTROLLER_TOKEN: 'controller-token-that-is-at-least-32-characters',
    PULPO_BOOTSTRAP_PRESET: 'ci-preview',
    PULPO_PREVIEW_ADMIN_EMAIL: 'preview@example.com',
    PULPO_PREVIEW_ADMIN_PASSWORD: 'preview-password',
    PULPO_PREVIEW_PROVIDER_API_KEY: 'sk-pulpo-preview-provider',
    PULPO_PREVIEW_WORKSPACE_IMAGE_DIGEST: imageDigest,
    ...overrides,
  })
}

class MemoryBootstrapStore implements BootstrapStore {
  marker = false
  hasUser = false
  encryptedProviderApiKey: string | undefined = undefined
  seeds: CiPreviewSeed[] = []
  private tail: Promise<void> = Promise.resolve()

  async withLock<T>(operation: (store: LockedBootstrapStore) => Promise<T>): Promise<T> {
    const previous = this.tail
    let release!: () => void
    this.tail = new Promise<void>((resolve) => { release = resolve })
    await previous
    try {
      return await operation({
        markerExists: async () => this.marker,
        seededProviderEncryptedApiKey: async () => this.encryptedProviderApiKey,
        userExists: async () => this.hasUser,
        create: async (seed) => {
          this.seeds.push(seed)
          this.encryptedProviderApiKey = seed.encryptedProviderApiKey
          this.hasUser = true
          this.marker = true
        },
      })
    } finally {
      release()
    }
  }
}

function dependencies(store: BootstrapStore, models = [CI_PREVIEW_MODEL_ID]): BootstrapDependencies {
  return {
    store,
    fetch: vi.fn(async () => new Response(JSON.stringify({ data: models.map((id) => ({ id })) }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })) as typeof fetch,
    hashPassword: vi.fn(async (password: string) => `hashed:${password}`),
    encrypt: vi.fn(() => 'encrypted-provider-key'),
    decrypt: vi.fn(() => 'provider-key'),
  }
}

describe('ci-preview bootstrap preset', () => {
  it('creates the hard-coded preview seed without retaining plaintext secrets', async () => {
    const store = new MemoryBootstrapStore()
    const result = await runBootstrapPreset(previewConfig(), 'pulpo-pr-48.deathgrips.org', dependencies(store))

    expect(result).toBe('created')
    expect(store.seeds).toEqual([{
      adminEmail: 'preview@example.com',
      passwordHash: 'hashed:preview-password',
      encryptedProviderApiKey: 'encrypted-provider-key',
      workspaceImageDigest: imageDigest,
    }])
    expect(JSON.stringify(store.seeds)).not.toContain('"preview-password"')
    expect(JSON.stringify(store.seeds)).not.toContain('"sk-pulpo-preview-provider"')
  })

  it('preserves an existing seeded preview without requiring bootstrap secrets again', async () => {
    const store = new MemoryBootstrapStore()
    store.marker = true
    store.hasUser = true
    store.encryptedProviderApiKey = 'encrypted-provider-key'
    const config = parseConfig({
      PUBLIC_URL: 'https://pulpo-pr-48.deathgrips.org',
      ENCRYPTION_KEY: strongEncryptionKey,
      WORKSPACE_CONTROLLER_URL: 'https://controller.example.com',
      WORKSPACE_CONTROLLER_TOKEN: 'controller-token-that-is-at-least-32-characters',
      PULPO_BOOTSTRAP_PRESET: 'ci-preview',
    })

    await expect(runBootstrapPreset(config, 'pulpo-pr-48.deathgrips.org', dependencies(store))).resolves.toBe('existing')
    expect(store.seeds).toHaveLength(0)
  })

  it('rejects existing previews when the runtime encryption key cannot decrypt the seeded provider', async () => {
    const store = new MemoryBootstrapStore()
    store.marker = true
    store.hasUser = true
    store.encryptedProviderApiKey = 'encrypted-provider-key'
    const deps = dependencies(store)
    deps.decrypt = vi.fn(() => { throw new Error('unable to authenticate data') })

    await expect(runBootstrapPreset(previewConfig(), 'pulpo-pr-48.deathgrips.org', deps))
      .rejects.toThrow('cannot be decrypted')
  })

  it('rejects preview hosts when the preset or strong runtime encryption key is missing', async () => {
    const store = new MemoryBootstrapStore()
    const missingPreset = parseConfig({ PUBLIC_URL: 'https://pulpo-pr-48.deathgrips.org' })

    await expect(runBootstrapPreset(missingPreset, 'pulpo-pr-48.deathgrips.org', dependencies(store)))
      .rejects.toThrow('PULPO_BOOTSTRAP_PRESET=ci-preview')
    await expect(runBootstrapPreset(
      previewConfig({ ENCRYPTION_KEY: 'development-only-key-change-me-000000' }),
      'pulpo-pr-48.deathgrips.org',
      dependencies(store),
    )).rejects.toThrow('non-default ENCRYPTION_KEY')
  })

  it('serializes concurrent startup attempts and creates the preset once', async () => {
    const store = new MemoryBootstrapStore()
    const deps = dependencies(store)
    const results = await Promise.all([
      runBootstrapPreset(previewConfig(), 'pulpo-pr-48.deathgrips.org', deps),
      runBootstrapPreset(previewConfig(), 'pulpo-pr-48.deathgrips.org', deps),
    ])

    expect(results.sort()).toEqual(['created', 'existing'])
    expect(store.seeds).toHaveLength(1)
    expect(deps.fetch).toHaveBeenCalledTimes(1)
  })

  it('rejects non-preview hosts and non-empty unmarked databases', async () => {
    const store = new MemoryBootstrapStore()
    await expect(runBootstrapPreset(previewConfig(), 'pulpo.baby', dependencies(store)))
      .rejects.toThrow('not allowed')

    store.hasUser = true
    await expect(runBootstrapPreset(previewConfig(), 'pulpo-pr-48.deathgrips.org', dependencies(store)))
      .rejects.toThrow('empty, unconfigured')
    expect(store.seeds).toHaveLength(0)
  })

  it('fails atomically for missing secrets, invalid provider access, and missing Luna access', async () => {
    const missingSecretStore = new MemoryBootstrapStore()
    await expect(runBootstrapPreset(
      previewConfig({ PULPO_PREVIEW_ADMIN_PASSWORD: '' }),
      'pulpo-pr-48.deathgrips.org',
      dependencies(missingSecretStore),
    )).rejects.toThrow('PULPO_PREVIEW_ADMIN_PASSWORD')
    expect(missingSecretStore.seeds).toHaveLength(0)

    const invalidKeyStore = new MemoryBootstrapStore()
    const invalidKeyDependencies = dependencies(invalidKeyStore)
    invalidKeyDependencies.fetch = vi.fn(async () => new Response('{}', { status: 401 })) as typeof fetch
    await expect(runBootstrapPreset(previewConfig(), 'pulpo-pr-48.deathgrips.org', invalidKeyDependencies))
      .rejects.toThrow('returned 401')
    expect(invalidKeyStore.seeds).toHaveLength(0)

    const missingModelStore = new MemoryBootstrapStore()
    await expect(runBootstrapPreset(previewConfig(), 'pulpo-pr-48.deathgrips.org', dependencies(missingModelStore, ['other-model'])))
      .rejects.toThrow(`does not allow ${CI_PREVIEW_MODEL_ID}`)
    expect(missingModelStore.seeds).toHaveLength(0)
  })

  it('defines conservative Luna and workspace settings', () => {
    expect(CI_PREVIEW_MODEL).toMatchObject({
      id: 'gpt-5.6-luna',
      upstreamModelId: 'gpt-5.6-luna',
      contextWindow: 128_000,
      maxOutputTokens: 16_384,
      agentEnabled: true,
      compactionThresholdTokens: 96_000,
      agentCompactionThresholdTokens: 112_000,
    })
    expect(ciPreviewAgentSettings(imageDigest)).toMatchObject({
      enabled: true,
      imageDigest,
      generationConcurrency: 1,
      warmCapacity: 0,
      maxActiveWorkspaces: 1,
      idleTimeoutSeconds: 300,
      hardTimeoutSeconds: 1_800,
      workspaceWaitTimeoutSeconds: 300,
    })
  })
})
