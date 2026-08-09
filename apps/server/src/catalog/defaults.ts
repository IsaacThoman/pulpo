import { UNKNOWN_MODEL_ID } from '@pulpo/contracts'
import { isNull } from 'drizzle-orm'
import { db } from '../database/client.js'
import { labs, models, providerConnections } from '../database/schema.js'

export const INTERNAL_LAB_ID = '00000000-0000-7000-8000-000000000001'
export const INTERNAL_PROVIDER_ID = '00000000-0000-7000-8000-000000000002'
export { UNKNOWN_MODEL_ID }

export async function ensureBuiltinCatalog(): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.insert(labs).values({
      id: INTERNAL_LAB_ID,
      name: 'Internal',
      logo: 'pulpo',
    }).onConflictDoNothing({ target: labs.id })

    await tx.insert(providerConnections).values({
      id: INTERNAL_PROVIDER_ID,
      name: 'Pulpo internal',
      baseUrl: 'http://127.0.0.1',
      encryptedApiKey: 'unused',
      enabled: false,
    }).onConflictDoUpdate({
      target: providerConnections.id,
      set: {
        name: 'Pulpo internal',
        baseUrl: 'http://127.0.0.1',
        encryptedApiKey: 'unused',
        enabled: false,
      },
    })

    await tx.insert(models).values({
      id: UNKNOWN_MODEL_ID,
      providerConnectionId: INTERNAL_PROVIDER_ID,
      labId: INTERNAL_LAB_ID,
      upstreamModelId: UNKNOWN_MODEL_ID,
      name: 'unknown model',
      description: 'Historical usage for a deleted model.',
      sortOrder: -1,
      enabled: false,
      visible: false,
      logo: 'pulpo',
      contextWindow: 1,
      maxOutputTokens: 1,
    }).onConflictDoUpdate({
      target: models.id,
      set: {
        providerConnectionId: INTERNAL_PROVIDER_ID,
        labId: INTERNAL_LAB_ID,
        upstreamModelId: UNKNOWN_MODEL_ID,
        name: 'unknown model',
        description: 'Historical usage for a deleted model.',
        sortOrder: -1,
        enabled: false,
        visible: false,
        logo: 'pulpo',
        contextWindow: 1,
        maxOutputTokens: 1,
        fallbackModelId: null,
      },
    })

    await tx.update(models).set({ labId: INTERNAL_LAB_ID }).where(isNull(models.labId))
  })
}
