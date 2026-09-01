import * as Crypto from 'expo-crypto'
import { getValue, setValue } from '../data/database'

export async function realtimeClientId(namespace: string): Promise<string> {
  const existing = await getValue<string>(namespace, 'realtime-client-id')
  if (existing) return existing
  const created = `ios-${Crypto.randomUUID()}`
  await setValue(namespace, 'realtime-client-id', created)
  return created
}
