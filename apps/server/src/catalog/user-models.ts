import { and, asc, eq, ne } from 'drizzle-orm'
import { db } from '../database/client.js'
import { models, providerConnections, userProviderCredentials } from '../database/schema.js'
import { codexEnabled } from '../codex/policy.js'
import { CODEX_PI_PROVIDER_ID, CODEX_PROVIDER_ID } from '../codex/constants.js'

type CatalogDatabase = Pick<typeof db, 'select'>

export async function userModelEligibility(userId: string, database: CatalogDatabase = db) {
  const codexAvailable = await codexEnabled(database)
  const [credential] = await database.select({ status: userProviderCredentials.status })
    .from(userProviderCredentials).where(and(
      eq(userProviderCredentials.userId, userId),
      eq(userProviderCredentials.providerId, CODEX_PI_PROVIDER_ID),
    )).limit(1)
  return {
    codexAvailable,
    condition: and(
      eq(models.enabled, true), eq(models.visible, true),
      codexAvailable && credential?.status === 'connected' ? undefined : ne(models.providerConnectionId, CODEX_PROVIDER_ID),
    ),
  }
}

export async function availableUserModels(userId: string, database: CatalogDatabase = db) {
  const { condition } = await userModelEligibility(userId, database)
  return database.select({ id: models.id, name: models.name }).from(models)
    .innerJoin(providerConnections, eq(models.providerConnectionId, providerConnections.id))
    .where(condition).orderBy(asc(models.sortOrder), asc(models.createdAt))
}
