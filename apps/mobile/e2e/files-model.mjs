// Registers a visible chat model backed by the local deterministic provider (queue-provider.mjs on
// port 8092), so the Files acceptance account can send messages. Only touches the disposable
// pulpo_mobile_files database. Run from the repository root with the backend's environment.
if (process.env.POSTGRES_DATABASE !== 'pulpo_mobile_files') throw new Error('Use POSTGRES_DATABASE=pulpo_mobile_files')
const { db, queryClient } = await import('../../server/dist/database/client.js')
const { providerConnections, models, modelPricingVersions } = await import('../../server/dist/database/schema.js')
const { encryptSecret } = await import('../../server/dist/lib/crypto.js')
const { getConfig } = await import('../../server/dist/config.js')
const providerId = '6f1d3a2e-7c55-4c2b-9f0a-5d0e8f2b6a41'
await db.insert(providerConnections).values({ id: providerId, name: 'Files test provider', baseUrl: 'http://127.0.0.1:8092/v1',
  encryptedApiKey: encryptSecret('test-only', getConfig().ENCRYPTION_KEY) }).onConflictDoNothing()
await db.insert(models).values({ id: 'files-chat', providerConnectionId: providerId, upstreamModelId: 'files-chat',
  name: 'Files Chat', contextWindow: 32000, maxOutputTokens: 1000, compactionEnabled: false, visible: true })
  .onConflictDoUpdate({ target: models.id, set: { visible: true } })
await db.insert(modelPricingVersions).values({ id: '2b0f7f0c-9c1e-4a77-8a10-3d2f1c6e9b55', modelId: 'files-chat',
  inputPriceMicros: 0, cachedInputPriceMicros: 0, cacheWritePriceMicros: 0, outputPriceMicros: 0 }).onConflictDoNothing()
console.log('Files Chat model ready (provider on 127.0.0.1:8092)')
await queryClient.end()
