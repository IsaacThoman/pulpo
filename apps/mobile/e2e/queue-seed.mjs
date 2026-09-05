// Intentionally restricted to the disposable acceptance database.
if (process.env.POSTGRES_DATABASE !== 'pulpo_mobile_queue_e2e' || process.env.REDIS_URL !== 'redis://localhost:6391') {
  throw new Error('Use POSTGRES_DATABASE=pulpo_mobile_queue_e2e REDIS_URL=redis://localhost:6391')
}
const { db, queryClient } = await import('../../server/dist/database/client.js')
const { providerConnections, models, modelPricingVersions } = await import('../../server/dist/database/schema.js')
const { encryptSecret } = await import('../../server/dist/lib/crypto.js')
const providerId = 'e1744b14-b9fa-4cbf-97ab-2f8334684ce5'
await db.update(models).set({ visible: false })
await db.insert(providerConnections).values({ id: providerId, name: 'Queue test fixture', baseUrl: 'http://127.0.0.1:8092/v1',
  encryptedApiKey: encryptSecret('test-only', 'development-only-key-change-me-000000') }).onConflictDoNothing()
for (const id of ['queue-test', 'queue-test-alternate']) {
  await db.insert(models).values({ id, providerConnectionId: providerId, upstreamModelId: id,
    name: id === 'queue-test' ? 'Queue Test' : 'Queue Alternate', contextWindow: 32000, maxOutputTokens: 1000, compactionEnabled: false })
    .onConflictDoUpdate({ target: models.id, set: { visible: true } })
  await db.insert(modelPricingVersions).values({ id: id === 'queue-test' ? '6167ba0a-8251-4f50-b5f5-a88536679744' : '389c33b3-ec8e-43e7-aa19-49c501f4fa65', modelId: id,
    inputPriceMicros: 0, cachedInputPriceMicros: 0, cacheWritePriceMicros: 0, outputPriceMicros: 0 }).onConflictDoNothing()
}
const config = await fetch('http://localhost:8091/api/mobile/config').then((response) => response.json())
if (config.setupRequired) {
  const response = await fetch('http://localhost:8091/api/mobile/auth/setup', { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Queue Tester', username: 'queue_tester', email: 'queue@example.test', password: 'Queue-test-only-2026', deviceLabel: 'Queue acceptance' }) })
  if (!response.ok) throw new Error(await response.text())
}
console.log('Queue fixture models and disposable account are ready')
await queryClient.end()
